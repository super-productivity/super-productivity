import {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  type RequestPayload,
  type preParsingHookHandler,
} from 'fastify';
import { Transform, type TransformCallback } from 'node:stream';
import { z } from 'zod';
import { uuidv7 } from 'uuidv7';
import {
  SuperSyncDownloadOpsQuerySchema,
  SuperSyncUploadOpsRequestSchema,
  SuperSyncUploadSnapshotRequestSchema,
} from '@sp/shared-schema';
import { authenticate, getAuthUser } from '../middleware';
import { getSyncService } from './sync.service';
import { getWsConnectionService } from './services/websocket-connection.service';
import { Logger } from '../logger';
import { prisma } from '../db';
import {
  Operation,
  ServerOperation,
  UploadOpsRequest,
  UploadOpsResponse,
  UploadResult,
  DownloadOpsResponse,
  SnapshotResponse,
  SyncStatusResponse,
  SYNC_ERROR_CODES,
} from './sync.types';
import {
  parseCompressedJsonBody,
  isSingleTokenGzipEncoding,
  normalizeContentEncoding,
  type CompressedJsonBodyParseResult,
} from './compressed-body-parser';
import { computeOpStorageBytes } from './sync.const';
import { EncryptedOpsNotSupportedError } from './services/snapshot.service';
import type { SnapshotDedupResponse } from './services';

type ZodIssue = z.ZodError['issues'][number];

/**
 * Static client-facing message for encrypted-op snapshot rejection.
 * The thrown error's `message` contains the encrypted-op count and must
 * NOT be echoed to the client (data-volume side-channel).
 */
const ENCRYPTED_OPS_CLIENT_MESSAGE =
  'Server-side snapshot is unavailable because operations are end-to-end encrypted. ' +
  'Use the client app\'s "Sync Now" button to decrypt and restore locally.';

/**
 * Helper to create validation error response.
 * In production, hides detailed Zod error info to prevent schema leakage.
 */
const createValidationErrorResponse = (
  zodIssues: ZodIssue[],
): { error: string; details?: ZodIssue[] } => {
  if (process.env.NODE_ENV === 'production') {
    return { error: 'Validation failed' };
  }
  return { error: 'Validation failed', details: zodIssues };
};

// Two-stage protection against zip bombs:
// 1. Pre-check: Reject compressed data > limit (typical ratio ~10:1)
// 2. Post-check: Reject decompressed data > limit (catches edge cases)
//
// Different limits for ops vs snapshots:
// - Ops uploads are incremental and smaller
// - Snapshots can be larger for backup/repair imports
const MAX_COMPRESSED_SIZE_OPS = 10 * 1024 * 1024; // 10MB for /ops
const MAX_COMPRESSED_SIZE_SNAPSHOT = 30 * 1024 * 1024; // 30MB for /snapshot (matches bodyLimit)
// B9: per-endpoint decompressed caps. A blanket 100MB lets a 10MB gzip body
// expand to 100MB of JSON.parse work, which stalls the event loop. Ops are
// incremental so 30MB raw is plenty (matches the largest expected SYNC_IMPORT
// op fanout); snapshots get 60MB to fit the 50MB cacheable cap plus headroom
// for the JSON-vs-compressed ratio.
const MAX_DECOMPRESSED_SIZE_OPS = 30 * 1024 * 1024; // 30MB for /ops
const MAX_DECOMPRESSED_SIZE_SNAPSHOT = 60 * 1024 * 1024; // 60MB for /snapshot

// Fastify's route bodyLimit runs before our parser can decode Android's
// Content-Transfer-Encoding: base64 wrapper. Use the raw base64 envelope limit
// at the HTTP layer, then enforce the true binary gzip limit in
// parseCompressedJsonBody().
const getMaxRawBodySizeForCompressedPayload = (maxCompressedSize: number): number =>
  Math.ceil(maxCompressedSize / 3) * 4 + 4;
const MAX_RAW_BODY_SIZE_OPS = getMaxRawBodySizeForCompressedPayload(
  MAX_COMPRESSED_SIZE_OPS,
);
const MAX_RAW_BODY_SIZE_SNAPSHOT = getMaxRawBodySizeForCompressedPayload(
  MAX_COMPRESSED_SIZE_SNAPSHOT,
);

type PayloadTooLargeError = Error & {
  code: string;
  statusCode: number;
};

const createPayloadTooLargeError = (limitBytes: number): PayloadTooLargeError =>
  Object.assign(new Error(`Request body exceeded ${limitBytes} byte limit`), {
    code: 'FST_ERR_CTP_BODY_TOO_LARGE',
    statusCode: 413,
  });

const getHeaderString = (
  value: string | string[] | number | undefined,
): string | undefined => {
  if (Array.isArray(value)) return value[0];
  if (typeof value === 'number') return String(value);
  return value;
};

const hasHeaderToken = (
  value: string | string[] | number | undefined,
  expectedToken: string,
): boolean =>
  getHeaderString(value)
    ?.split(',')
    .some((token) => token.trim().toLowerCase() === expectedToken) ?? false;

const getParsedContentLength = (
  value: string | string[] | number | undefined,
): number | null => {
  const contentLength = getHeaderString(value);
  if (contentLength === undefined) return null;

  const parsed = Number.parseInt(contentLength, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

class RawBodyLimitTransform extends Transform {
  receivedEncodedLength = 0;

  constructor(private readonly limitBytes: number) {
    super();
  }

  _transform(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    const chunkBytes = Buffer.isBuffer(chunk)
      ? chunk.length
      : Buffer.byteLength(chunk, encoding);
    this.receivedEncodedLength += chunkBytes;

    if (this.receivedEncodedLength > this.limitBytes) {
      callback(createPayloadTooLargeError(this.limitBytes));
      return;
    }

    callback(null, chunk);
  }
}

const createRawBodyLimitPreParsingHook =
  (maxCompressedSize: number, maxBase64RawSize: number): preParsingHookHandler =>
  (
    request: FastifyRequest,
    _reply: FastifyReply,
    payload: RequestPayload,
    done,
  ): void => {
    const isBase64GzipRequest =
      hasHeaderToken(request.headers['content-encoding'], 'gzip') &&
      hasHeaderToken(request.headers['content-transfer-encoding'], 'base64');
    const rawBodyLimit = isBase64GzipRequest ? maxBase64RawSize : maxCompressedSize;
    const contentLength = getParsedContentLength(request.headers['content-length']);

    if (contentLength !== null && contentLength > rawBodyLimit) {
      done(createPayloadTooLargeError(rawBodyLimit));
      return;
    }

    done(null, payload.pipe(new RawBodyLimitTransform(rawBodyLimit)));
  };

// Error helper
const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : 'Unknown error';

/**
 * Approximate on-disk byte cost of a set of operations, computed locally so
 * the hot path never scans the operations table. Approximation ignores TOAST
 * compression overhead and is used to size the pre-write quota gate.
 *
 * Delegates to the shared `computeOpStorageBytes` helper so the gate here and
 * the in-transaction counter increment inside `uploadOps` cannot disagree on
 * what "size" means. The `fallback` counter is the number of ops in this
 * batch whose payload could not be JSON-serialized — kept so route callers
 * can log how often unserializable ops are charged at APPROX_BYTES_PER_OP
 * without ever logging op content.
 */
const computeOpsStorageBytes = (
  ops: Array<{ id?: string; payload: unknown; vectorClock: unknown }>,
): { bytes: number; fallback: number } => {
  let bytes = 0;
  let fallback = 0;
  for (const op of ops) {
    const sized = computeOpStorageBytes(op);
    bytes += sized.bytes;
    if (sized.fallback) fallback += 1;
  }
  return { bytes, fallback };
};

const computeJsonStorageBytes = (value: unknown, fallback: unknown): number => {
  try {
    return Buffer.byteLength(JSON.stringify(value ?? fallback), 'utf8');
  } catch {
    return 0;
  }
};

const applyStorageUsageDelta = async (
  userId: number,
  deltaBytes: number,
  context: string,
): Promise<void> => {
  if (!Number.isFinite(deltaBytes) || deltaBytes === 0) return;
  const syncService = getSyncService();
  try {
    if (deltaBytes > 0) {
      await syncService.incrementStorageUsage(userId, deltaBytes);
    } else {
      await syncService.decrementStorageUsage(userId, Math.abs(deltaBytes));
    }
  } catch (err) {
    // Counter write failed AFTER the data write committed. The cached
    // storage_used_bytes is now stale (low for increments, high for
    // decrements). Mark the user for forced reconcile so the next quota
    // check self-heals rather than waiting for daily cleanup.
    syncService.markStorageNeedsReconcile(userId);
    Logger.warn(
      `[user:${userId}] Failed to update storage usage cache ${context}: ${errorMessage(err)}; marked for forced reconcile`,
    );
  }
};

const sendQuotaExceededReply = (
  reply: FastifyReply,
  body: {
    storageUsedBytes: number;
    storageQuotaBytes: number;
    autoCleanupAttempted: boolean;
    cleanupStats?: {
      freedBytes: number;
      deletedRestorePoints: number;
      deletedOps: number;
    };
  },
): FastifyReply =>
  reply.status(413).send({
    error: 'Storage quota exceeded',
    errorCode: SYNC_ERROR_CODES.STORAGE_QUOTA_EXCEEDED,
    ...body,
  });

type ExistingSyncImport = {
  id: string;
  clientId: string;
  serverSeq: number;
};

/**
 * Look up an existing full-state op for the user.
 *
 * When `incomingOpId` is provided, try an exact id match first so an
 * idempotent retry (`existing.id === incomingOpId`) is detected deterministically
 * even when multiple full-state ops exist for the user (e.g. an old SYNC_IMPORT
 * plus a later BACKUP_IMPORT). The fallback orders by `serverSeq DESC` so the
 * 409 path consistently reports the most recent restore point instead of
 * whatever Postgres happens to return.
 */
const findExistingSyncImport = async (
  userId: number,
  incomingOpId?: string,
): Promise<ExistingSyncImport | null> => {
  if (incomingOpId) {
    const exact = await prisma.operation.findUnique({
      where: { id: incomingOpId },
      select: {
        id: true,
        userId: true,
        clientId: true,
        serverSeq: true,
        opType: true,
      },
    });
    if (
      exact &&
      exact.userId === userId &&
      (exact.opType === 'SYNC_IMPORT' ||
        exact.opType === 'BACKUP_IMPORT' ||
        exact.opType === 'REPAIR')
    ) {
      return { id: exact.id, clientId: exact.clientId, serverSeq: exact.serverSeq };
    }
  }
  return prisma.operation.findFirst({
    where: {
      userId,
      opType: { in: ['SYNC_IMPORT', 'BACKUP_IMPORT', 'REPAIR'] },
    },
    orderBy: { serverSeq: 'desc' },
    select: { id: true, clientId: true, serverSeq: true },
  });
};

/**
 * True when an incoming snapshot upload is a retry of the existing import —
 * the client has reused the same `opId`, so the previous attempt was already
 * persisted server-side and we should respond with idempotent success
 * instead of a 409 SYNC_IMPORT_EXISTS. Returning failure here would force a
 * client whose response was dropped by the network into the "download and
 * merge" path that the 409 normally triggers.
 */
const isIdempotentSyncImportRetry = (
  existingImport: ExistingSyncImport,
  incomingOpId: string | undefined,
): boolean => Boolean(incomingOpId) && existingImport.id === incomingOpId;

const sendSyncImportExistsReply = (
  reply: FastifyReply,
  userId: number,
  clientId: string,
  existingImport: ExistingSyncImport,
): FastifyReply => {
  Logger.warn(
    `[user:${userId}] Rejecting duplicate SYNC_IMPORT from client ${clientId}. ` +
      `Existing import from client ${existingImport.clientId} (id: ${existingImport.id}). ` +
      `Client should download and merge instead.`,
  );
  return reply.status(409).send({
    error: 'SYNC_IMPORT_EXISTS',
    errorCode: 'SYNC_IMPORT_EXISTS',
    message:
      'A SYNC_IMPORT already exists. Download existing data and upload your changes as regular operations.',
    existingImportId: existingImport.id,
  });
};

type CompressedJsonBodyParseFailure = Extract<
  CompressedJsonBodyParseResult,
  { ok: false }
>;

interface CompressedBodyFailureLogOptions {
  payloadLabel: 'upload' | 'snapshot';
  decompressFailureLabel: 'ops upload' | 'snapshot';
  maxCompressedSize: number;
  maxDecompressedSize: number;
}

const sendCompressedBodyParseFailure = (
  reply: FastifyReply,
  userId: number,
  failure: CompressedJsonBodyParseFailure,
  options: CompressedBodyFailureLogOptions,
): FastifyReply => {
  if (failure.reason === 'compressed-payload-too-large') {
    Logger.warn(
      `[user:${userId}] Compressed ${options.payloadLabel} too large: ${failure.compressedSize} bytes (max ${options.maxCompressedSize})`,
    );
  } else if (failure.reason === 'decompressed-payload-too-large') {
    Logger.warn(
      `[user:${userId}] Decompressed ${options.payloadLabel} too large: ${failure.decompressedSize} bytes (max ${options.maxDecompressedSize})`,
    );
  } else if (failure.reason === 'decompress-failed') {
    Logger.warn(
      `[user:${userId}] Failed to decompress ${options.decompressFailureLabel}: ${errorMessage(failure.cause)}`,
    );
  } else if (failure.reason === 'invalid-json') {
    Logger.warn(
      `[user:${userId}] Decompressed ${options.decompressFailureLabel} is not valid JSON: ${errorMessage(failure.cause)}`,
    );
  }

  return reply.status(failure.statusCode).send({ error: failure.error });
};

/**
 * Check storage quota, recalculate if stale, and auto-cleanup if needed.
 * @returns `true` if quota is OK (caller can proceed), `false` if reply was sent with 413 error.
 */
async function enforceStorageQuota(
  userId: number,
  storageDeltaBytes: number,
  reply: FastifyReply,
): Promise<boolean> {
  const syncService = getSyncService();
  let quotaCheck = await syncService.checkStorageQuota(userId, storageDeltaBytes);
  if (quotaCheck.allowed) return true;

  // Cache miss path only — reconcile once before resorting to destructive
  // cleanup. Safe to run the slow scan here because this branch only fires for
  // users actually near quota (rare). The DoS came from running this on every
  // upload success, not on quota misses. Also guards against pre-deploy stale
  // counters where the old code's pg_column_size SUM left an inflated value.
  Logger.info(
    `[user:${userId}] Quota cache miss (cached: ${quotaCheck.currentUsage}/${quotaCheck.quota}). Reconciling before cleanup...`,
  );
  try {
    await syncService.updateStorageUsage(userId);
    quotaCheck = await syncService.checkStorageQuota(userId, storageDeltaBytes);
    if (quotaCheck.allowed) {
      Logger.info(
        `[user:${userId}] Quota OK after reconcile: ${quotaCheck.currentUsage}/${quotaCheck.quota}`,
      );
      return true;
    }
  } catch (err) {
    Logger.warn(
      `[user:${userId}] Reconcile failed, proceeding with cleanup: ${errorMessage(err)}`,
    );
  }

  Logger.warn(
    `[user:${userId}] Storage quota exceeded: ${quotaCheck.currentUsage}/${quotaCheck.quota} bytes. Attempting auto-cleanup...`,
  );

  // Iteratively delete old data until we have enough space
  const cleanupResult = await syncService.freeStorageForUpload(userId, storageDeltaBytes);

  if (cleanupResult.success) {
    Logger.info(
      `[user:${userId}] Auto-cleanup freed ${Math.round(cleanupResult.freedBytes / 1024)}KB ` +
        `(${cleanupResult.deletedRestorePoints} restore points, ${cleanupResult.deletedOps} ops)`,
    );
    return true;
  }

  // Truly out of space - return error
  const finalQuota = await syncService.checkStorageQuota(userId, storageDeltaBytes);
  Logger.warn(
    `[user:${userId}] Storage quota still exceeded after cleanup: ${finalQuota.currentUsage}/${finalQuota.quota} bytes`,
  );
  sendQuotaExceededReply(reply, {
    storageUsedBytes: finalQuota.currentUsage,
    storageQuotaBytes: finalQuota.quota,
    autoCleanupAttempted: true,
    cleanupStats: {
      freedBytes: cleanupResult.freedBytes,
      deletedRestorePoints: cleanupResult.deletedRestorePoints,
      deletedOps: cleanupResult.deletedOps,
    },
  });
  return false;
}

async function enforceCleanSlateStorageQuota(
  userId: number,
  finalStorageBytes: number,
  reply: FastifyReply,
): Promise<boolean> {
  const syncService = getSyncService();
  const storageInfo = await syncService.getStorageInfo(userId);
  if (finalStorageBytes <= storageInfo.storageQuotaBytes) return true;

  Logger.warn(
    `[user:${userId}] Clean-slate snapshot exceeds quota: ` +
      `${finalStorageBytes}/${storageInfo.storageQuotaBytes} bytes`,
  );
  sendQuotaExceededReply(reply, {
    storageUsedBytes: 0,
    storageQuotaBytes: storageInfo.storageQuotaBytes,
    autoCleanupAttempted: false,
  });
  return false;
}

export const syncRoutes = async (fastify: FastifyInstance): Promise<void> => {
  // Add content type parser for gzip-encoded JSON
  // This allows clients to send compressed request bodies with Content-Encoding: gzip
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req, body: Buffer, done) => {
      // B10: normalize Content-Encoding so RFC-valid values like ' Gzip ' or
      // arrays still hit the gzip branch.
      const encoding = normalizeContentEncoding(req.headers['content-encoding']);
      // W9: reject layered or non-gzip encodings with 415 Unsupported Media
      // Type so clients (and operators) get a clear error rather than a
      // misleading 400 invalid-json when we try to JSON.parse gzip bytes.
      if (encoding.layered || (encoding.value !== '' && encoding.value !== 'gzip')) {
        const err = new Error(
          `Unsupported Content-Encoding: ${encoding.value || 'identity (with separators)'}. ` +
            `Only single-token 'gzip' or identity is accepted.`,
        ) as Error & { statusCode?: number };
        err.statusCode = 415;
        done(err, undefined);
        return;
      }
      if (encoding.value === 'gzip') {
        // Return raw buffer for gzip - will be decompressed in route handler
        done(null, body);
      } else {
        // Parse JSON normally for uncompressed requests
        try {
          // Handle empty body (e.g., DELETE requests)
          if (body.length === 0) {
            done(null, undefined);
            return;
          }
          const json = JSON.parse(body.toString('utf-8'));
          done(null, json);
        } catch (err) {
          done(err as Error, undefined);
        }
      }
    },
  );

  // All sync routes require authentication
  fastify.addHook('preHandler', authenticate);

  // POST /api/sync/ops - Upload operations
  fastify.post<{ Body: UploadOpsRequest }>(
    '/ops',
    {
      // Cap raw request body at the base64 envelope of the binary gzip limit.
      // `parseCompressedJsonBody` still enforces MAX_COMPRESSED_SIZE_OPS
      // against decoded gzip bytes.
      bodyLimit: MAX_RAW_BODY_SIZE_OPS,
      preParsing: createRawBodyLimitPreParsingHook(
        MAX_COMPRESSED_SIZE_OPS,
        MAX_RAW_BODY_SIZE_OPS,
      ),
      config: {
        rateLimit: {
          max: 100,
          timeWindow: '1 minute',
        },
      },
    },
    async (req: FastifyRequest<{ Body: UploadOpsRequest }>, reply: FastifyReply) => {
      try {
        const userId = getAuthUser(req).userId;

        // Support gzip-encoded uploads to save bandwidth.
        // B10: use the normalizing helper so RFC-valid mixed-case / padded
        // values match. Layered encodings are rejected by the parser.
        let body: unknown = req.body;

        if (isSingleTokenGzipEncoding(req.headers['content-encoding'])) {
          const contentTransferEncoding = req.headers['content-transfer-encoding'] as
            | string
            | undefined;
          const compressedBodyResult = await parseCompressedJsonBody(
            req.body,
            contentTransferEncoding,
            {
              maxCompressedSize: MAX_COMPRESSED_SIZE_OPS,
              maxDecompressedSize: MAX_DECOMPRESSED_SIZE_OPS,
            },
          );

          if (!compressedBodyResult.ok) {
            return sendCompressedBodyParseFailure(reply, userId, compressedBodyResult, {
              payloadLabel: 'upload',
              decompressFailureLabel: 'ops upload',
              maxCompressedSize: MAX_COMPRESSED_SIZE_OPS,
              maxDecompressedSize: MAX_DECOMPRESSED_SIZE_OPS,
            });
          }

          body = compressedBodyResult.body;
          Logger.debug(
            `[user:${userId}] Ops upload decompressed: ${compressedBodyResult.compressedSize} -> ${compressedBodyResult.decompressedSize} bytes (base64: ${compressedBodyResult.isBase64})`,
          );
        }

        // Validate request body
        const parseResult = SuperSyncUploadOpsRequestSchema.safeParse(body);
        if (!parseResult.success) {
          Logger.warn(
            `[user:${userId}] Upload validation failed`,
            parseResult.error.issues,
          );
          return reply
            .status(400)
            .send(createValidationErrorResponse(parseResult.error.issues));
        }

        const { ops, clientId, lastKnownServerSeq, requestId, isCleanSlate } =
          parseResult.data;
        const syncService = getSyncService();

        Logger.info(
          `[user:${userId}] Upload: ${ops.length} ops from client ${clientId.slice(0, 8)}...`,
        );

        // Rate limit check BEFORE deduplication to prevent bypass
        // (attacker could retry with same requestId to skip rate limiting)
        if (syncService.isRateLimited(userId)) {
          Logger.audit({
            event: 'RATE_LIMITED',
            userId,
            clientId,
            errorCode: SYNC_ERROR_CODES.RATE_LIMITED,
            opsCount: ops.length,
          });
          return reply.status(429).send({
            error: 'Rate limited',
            errorCode: SYNC_ERROR_CODES.RATE_LIMITED,
          });
        }

        // Check for duplicate request (client retry) BEFORE quota check
        // This ensures retries after successful uploads don't fail with 413
        // if the original upload pushed the user over quota
        if (requestId) {
          const cachedResults = syncService.checkOpsRequestDedup(userId, requestId);
          if (cachedResults) {
            Logger.info(
              `[user:${userId}] Returning cached results for request ${requestId}`,
            );

            // IMPORTANT: Recompute piggybacked ops using the retry request's lastKnownServerSeq.
            // The original response may have contained newOps that the client missed if the
            // network dropped the response. By using the CURRENT request's lastKnownServerSeq,
            // we ensure the client gets all ops it hasn't seen yet.
            let newOps: ServerOperation[] | undefined;
            let latestSeq: number;
            let hasMorePiggyback = false;
            const PIGGYBACK_LIMIT = 500;

            if (lastKnownServerSeq !== undefined) {
              const opsResult = await syncService.getOpsSinceWithSeq(
                userId,
                lastKnownServerSeq,
                clientId,
                PIGGYBACK_LIMIT,
                false,
              );
              newOps = opsResult.ops;
              latestSeq = opsResult.latestSeq;

              // Check if there are more ops beyond what we piggybacked
              if (newOps.length === PIGGYBACK_LIMIT) {
                const lastPiggybackSeq = newOps[newOps.length - 1].serverSeq;
                hasMorePiggyback = lastPiggybackSeq < latestSeq;
              }

              if (newOps.length > 0) {
                Logger.info(
                  `[user:${userId}] Dedup request: piggybacking ${newOps.length} ops (since seq ${lastKnownServerSeq})` +
                    (hasMorePiggyback ? ` (has more)` : ''),
                );
              }
            } else {
              latestSeq = await syncService.getLatestSeq(userId);
            }

            return reply.send({
              results: cachedResults,
              newOps: newOps?.length ? newOps : undefined,
              latestSeq,
              deduplicated: true,
              ...(hasMorePiggyback ? { hasMorePiggyback: true } : {}),
            } as UploadOpsResponse & { deduplicated: boolean });
          }
        }

        const results = await syncService.runWithStorageUsageLock<UploadResult[] | null>(
          userId,
          async () => {
            // Check storage quota before processing (after dedup to allow retries).
            // Account using the same per-op payload+vectorClock measure that the
            // post-accept counter increment uses, so the gate and the increment
            // cannot disagree on what "size" means.
            const typedOpsForGate = ops as unknown as Operation[];
            const { bytes: estimatedDelta, fallback: gateFallback } =
              computeOpsStorageBytes(typedOpsForGate);
            if (gateFallback > 0) {
              Logger.warn(
                `computeOpsStorageBytes: ${gateFallback}/${typedOpsForGate.length} unserializable op(s) ` +
                  `charged at APPROX_BYTES_PER_OP for user=${userId} (gate)`,
              );
            }
            const quotaOk = await enforceStorageQuota(userId, estimatedDelta, reply);
            if (!quotaOk) return null;

            // Process operations - cast to Operation[] since Zod validates the structure.
            // `uploadOps` now writes `users.storage_used_bytes` atomically inside
            // its own `$transaction` (see B3 / wave-1 commit 9af17e460e), so the
            // route MUST NOT also apply a post-commit delta — that would
            // double-count the same accepted ops.
            const uploadResults = await syncService.uploadOps(
              userId,
              clientId,
              ops as unknown as Operation[],
              isCleanSlate,
            );

            return uploadResults;
          },
        );
        if (!results) return;

        // Cache results for deduplication if requestId was provided
        if (requestId) {
          syncService.cacheOpsRequestResults(userId, requestId, results);
        }

        const accepted = results.filter((r) => r.accepted).length;
        const rejected = results.filter((r) => !r.accepted).length;
        Logger.info(
          `[user:${userId}] Upload result: ${accepted} accepted, ${rejected} rejected`,
        );

        if (rejected > 0) {
          Logger.debug(
            `[user:${userId}] Rejected ops:`,
            results.filter((r) => !r.accepted),
          );
        }

        // Optionally include new ops from other clients (with atomic latestSeq read)
        let newOps: ServerOperation[] | undefined;
        let latestSeq: number;
        let hasMorePiggyback = false;
        const PIGGYBACK_LIMIT = 500;

        if (lastKnownServerSeq !== undefined) {
          // Use atomic read to get ops and latestSeq together
          const opsResult = await syncService.getOpsSinceWithSeq(
            userId,
            lastKnownServerSeq,
            clientId,
            PIGGYBACK_LIMIT,
            false,
          );
          newOps = opsResult.ops;
          latestSeq = opsResult.latestSeq;

          // Check if there are more ops beyond what we piggybacked
          // This happens when we hit the limit AND there are more ops on the server
          if (newOps.length === PIGGYBACK_LIMIT) {
            const lastPiggybackSeq = newOps[newOps.length - 1].serverSeq;
            hasMorePiggyback = lastPiggybackSeq < latestSeq;
            if (hasMorePiggyback) {
              Logger.info(
                `[user:${userId}] Piggybacking ${newOps.length} ops (has more: ${hasMorePiggyback}, ` +
                  `lastPiggybackSeq=${lastPiggybackSeq}, latestSeq=${latestSeq})`,
              );
            }
          }

          if (newOps.length > 0 && !hasMorePiggyback) {
            Logger.info(
              `[user:${userId}] Piggybacking ${newOps.length} ops (since seq ${lastKnownServerSeq})`,
            );
          }
        } else {
          latestSeq = await syncService.getLatestSeq(userId);
        }

        const response: UploadOpsResponse = {
          results,
          newOps: newOps && newOps.length > 0 ? newOps : undefined,
          latestSeq,
          ...(hasMorePiggyback ? { hasMorePiggyback: true } : {}),
        };

        // Notify other connected clients about new ops (fire-and-forget)
        if (accepted > 0) {
          getWsConnectionService().notifyNewOps(userId, clientId, latestSeq);
        }

        return reply.send(response);
      } catch (err) {
        Logger.error(`Upload ops error: ${errorMessage(err)}`);
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  // GET /api/sync/ops - Download operations
  fastify.get<{
    Querystring: { sinceSeq: string; limit?: string; excludeClient?: string };
  }>(
    '/ops',
    {
      config: {
        rateLimit: {
          max: 200,
          timeWindow: '1 minute',
        },
      },
    },
    async (
      req: FastifyRequest<{
        Querystring: { sinceSeq: string; limit?: string; excludeClient?: string };
      }>,
      reply: FastifyReply,
    ) => {
      try {
        const userId = getAuthUser(req).userId;

        // Validate query params
        const parseResult = SuperSyncDownloadOpsQuerySchema.safeParse(req.query);
        if (!parseResult.success) {
          Logger.warn(
            `[user:${userId}] Download validation failed`,
            parseResult.error.issues,
          );
          return reply
            .status(400)
            .send(createValidationErrorResponse(parseResult.error.issues));
        }

        const { sinceSeq, limit = 500, excludeClient } = parseResult.data;
        const syncService = getSyncService();

        Logger.debug(
          `[user:${userId}] Download request: sinceSeq=${sinceSeq}, limit=${limit}`,
        );

        const maxLimit = Math.min(limit, 1000);

        // Use atomic read to get ops and latestSeq in one transaction
        // This prevents race conditions where new ops arrive between the two reads
        const { ops, latestSeq, gapDetected, latestSnapshotSeq, snapshotVectorClock } =
          await syncService.getOpsSinceWithSeq(
            userId,
            sinceSeq,
            excludeClient,
            maxLimit + 1,
          );

        const hasMore = ops.length > maxLimit;
        if (hasMore) ops.pop();

        if (gapDetected) {
          Logger.warn(
            `[user:${userId}] Download: gap detected, client should resync from snapshot`,
          );
        }

        Logger.info(
          `[user:${userId}] Download: ${ops.length} ops ` +
            `(sinceSeq=${sinceSeq}, latestSeq=${latestSeq}, hasMore=${hasMore}, gap=${gapDetected}` +
            `${latestSnapshotSeq ? `, snapshotSeq=${latestSnapshotSeq}` : ''})`,
        );

        const response: DownloadOpsResponse = {
          ops,
          hasMore,
          latestSeq,
          gapDetected: gapDetected || undefined, // Only include if true
          latestSnapshotSeq, // Optimization: tells client where effective state starts
          snapshotVectorClock, // Aggregated clock from skipped ops for conflict resolution
          serverTime: Date.now(), // For client clock drift detection
        };

        return reply.send(response);
      } catch (err) {
        Logger.error(`Download ops error: ${errorMessage(err)}`);
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  // GET /api/sync/snapshot - Get full state snapshot
  // generateSnapshot() handles caching internally via sequence-based freshness:
  // returns cached snapshot if up-to-date, only replays ops when new ones exist.
  // Rate limited: Snapshot generation is CPU-intensive (can replay up to 100k ops)
  fastify.get(
    '/snapshot',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '5 minutes',
        },
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const userId = getAuthUser(req).userId;
        const syncService = getSyncService();

        Logger.info(`[user:${userId}] Snapshot requested`);
        // B5: Cap cache growth at the user's remaining quota so a client
        // already at/near quota cannot use GET /snapshot to keep growing
        // `snapshotData`. Uses the cheap cached counter — if it's stale-high
        // we may skip a cache write that would have fit; the snapshot itself
        // is still returned to the client either way. The post-write hook
        // keeps the counter consistent with what actually landed on disk.
        const storageInfo = await syncService.getStorageInfo(userId);
        const remainingQuota = Math.max(
          0,
          storageInfo.storageQuotaBytes - storageInfo.storageUsedBytes,
        );
        // Keep the storage counter in sync with snapshotData rewrites; without
        // this hook GET /snapshot can grow up to MAX_SNAPSHOT_SIZE_BYTES of
        // cached data with no quota accounting.
        const snapshot = await syncService.generateSnapshot(
          userId,
          (deltaBytes) =>
            applyStorageUsageDelta(userId, deltaBytes, 'after generateSnapshot'),
          remainingQuota,
        );
        Logger.info(`[user:${userId}] Snapshot ready (seq=${snapshot.serverSeq})`);
        return reply.send(snapshot as SnapshotResponse);
      } catch (err) {
        if (err instanceof EncryptedOpsNotSupportedError) {
          Logger.info(
            `[user:${getAuthUser(req).userId}] Snapshot blocked due to encrypted ops (count=${err.encryptedOpCount})`,
          );
          return reply.status(400).send({
            error: ENCRYPTED_OPS_CLIENT_MESSAGE,
            errorCode: SYNC_ERROR_CODES.ENCRYPTED_OPS_NOT_SUPPORTED,
          });
        }

        Logger.error(`Get snapshot error: ${errorMessage(err)}`);
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  // POST /api/sync/snapshot - Upload full state
  // Supports gzip-compressed request bodies via Content-Encoding: gzip header
  // B8: per-user rate limit — uploads are expensive (up to 30MB body,
  // `prepareSnapshotCache` zlib + JSON.stringify, full-state op replay).
  // 10/15 min matches the other write-heavy operations (DELETE /data,
  // /restore/:seq) so burst-uploads can't pin a worker.
  fastify.post<{ Body: unknown }>(
    '/snapshot',
    {
      bodyLimit: MAX_RAW_BODY_SIZE_SNAPSHOT,
      preParsing: createRawBodyLimitPreParsingHook(
        MAX_COMPRESSED_SIZE_SNAPSHOT,
        MAX_RAW_BODY_SIZE_SNAPSHOT,
      ),
      config: {
        // B8: snapshot uploads are heavy (full state replay + cache write).
        // Match the backup/repair-import budget.
        rateLimit: {
          max: 10,
          timeWindow: '15 minutes',
        },
      },
    },
    async (req: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
      try {
        const userId = getAuthUser(req).userId;

        // Handle gzip-compressed request body.
        // B10: use the normalizing helper so RFC-valid mixed-case / padded
        // values match. Layered encodings are rejected by the parser.
        let body: unknown = req.body;

        if (isSingleTokenGzipEncoding(req.headers['content-encoding'])) {
          const contentTransferEncoding = req.headers['content-transfer-encoding'] as
            | string
            | undefined;
          const compressedBodyResult = await parseCompressedJsonBody(
            req.body,
            contentTransferEncoding,
            {
              maxCompressedSize: MAX_COMPRESSED_SIZE_SNAPSHOT,
              maxDecompressedSize: MAX_DECOMPRESSED_SIZE_SNAPSHOT,
            },
          );

          if (!compressedBodyResult.ok) {
            return sendCompressedBodyParseFailure(reply, userId, compressedBodyResult, {
              payloadLabel: 'snapshot',
              decompressFailureLabel: 'snapshot',
              maxCompressedSize: MAX_COMPRESSED_SIZE_SNAPSHOT,
              maxDecompressedSize: MAX_DECOMPRESSED_SIZE_SNAPSHOT,
            });
          }

          body = compressedBodyResult.body;
          Logger.debug(
            `[user:${userId}] Snapshot decompressed: ${compressedBodyResult.compressedSize} -> ${compressedBodyResult.decompressedSize} bytes (base64: ${compressedBodyResult.isBase64})`,
          );
        }

        // Validate request body
        const parseResult = SuperSyncUploadSnapshotRequestSchema.safeParse(body);
        if (!parseResult.success) {
          Logger.warn(
            `[user:${userId}] Snapshot upload validation failed`,
            parseResult.error.issues,
          );
          return reply
            .status(400)
            .send(createValidationErrorResponse(parseResult.error.issues));
        }

        const {
          state,
          clientId,
          reason,
          vectorClock,
          schemaVersion,
          isPayloadEncrypted,
          opId,
          isCleanSlate,
          snapshotOpType,
          syncImportReason,
          requestId,
        } = parseResult.data;
        const syncService = getSyncService();

        if (requestId) {
          const cachedResponse = syncService.checkSnapshotRequestDedup(userId, requestId);
          if (cachedResponse) {
            Logger.info(
              `[user:${userId}] Returning cached snapshot result for request ${requestId}`,
            );
            return reply.send(cachedResponse);
          }
        }

        // Cheap pre-quota gate BEFORE prepareSnapshotCache so quota-exhausted
        // clients can't burn CPU on JSON.stringify + zlib.gzipSync. Uses only
        // the cached counter; if it says we're already at quota, reconcile
        // once before rejecting — a stale-high counter would otherwise lock
        // out a user whose new snapshot would actually shrink storage. Skip
        // for clean-slate which wipes existing usage.
        if (!isCleanSlate) {
          let cachedInfo = await syncService.getStorageInfo(userId);
          if (cachedInfo.storageUsedBytes >= cachedInfo.storageQuotaBytes) {
            try {
              await syncService.updateStorageUsage(userId);
              cachedInfo = await syncService.getStorageInfo(userId);
            } catch (err) {
              Logger.warn(
                `[user:${userId}] Snapshot pre-gate reconcile failed: ${errorMessage(err)}`,
              );
            }
            if (cachedInfo.storageUsedBytes >= cachedInfo.storageQuotaBytes) {
              return sendQuotaExceededReply(reply, {
                storageUsedBytes: cachedInfo.storageUsedBytes,
                storageQuotaBytes: cachedInfo.storageQuotaBytes,
                autoCleanupAttempted: false,
              });
            }
          }
        }

        // Reject duplicate SYNC_IMPORT before we acquire the per-user lock — a
        // duplicate rejection is cheap (one indexed lookup) and skipping the
        // lock lets concurrent legitimate clients keep moving.
        // Exceptions that bypass this check:
        // - 'recovery': Explicit backup restore or repair (user action)
        // - 'migration': Legacy data migration (should be allowed to override)
        // - 'isCleanSlate': Password change or explicit clean slate request
        // Only 'initial' (first-time server migration) should be rejected if one exists.
        if (reason === 'initial' && !isCleanSlate) {
          const existingImport = await findExistingSyncImport(userId, opId);

          if (existingImport) {
            if (isIdempotentSyncImportRetry(existingImport, opId)) {
              Logger.info(
                `[user:${userId}] Idempotent SYNC_IMPORT retry from client ${clientId} ` +
                  `for existing import seq=${existingImport.serverSeq}`,
              );
              return reply.send({
                accepted: true,
                serverSeq: existingImport.serverSeq,
              } satisfies SnapshotDedupResponse);
            }
            return sendSyncImportExistsReply(reply, userId, clientId, existingImport);
          }
        }

        // Create a SYNC_IMPORT operation
        // Use the correct NgRx action type so the operation can be replayed on other clients
        // FIX: Use client's opId if provided to prevent ID mismatch bugs
        // When client doesn't send opId (legacy clients), fall back to server-generated UUID
        const op = {
          id: opId ?? uuidv7(),
          clientId,
          actionType: '[SP_ALL] Load(import) all data',
          opType: (snapshotOpType ?? 'SYNC_IMPORT') as
            | 'SYNC_IMPORT'
            | 'BACKUP_IMPORT'
            | 'REPAIR',
          entityType: 'ALL',
          payload: state,
          vectorClock,
          timestamp: Date.now(),
          schemaVersion: schemaVersion ?? 1,
          isPayloadEncrypted: isPayloadEncrypted ?? false,
          syncImportReason,
        };

        const preparedSnapshot = await syncService.prepareSnapshotCache(state);
        const estimatedOpStorageBytes =
          preparedSnapshot.stateBytes + computeJsonStorageBytes(op.vectorClock, {});

        const result = await syncService.runWithStorageUsageLock<UploadResult | null>(
          userId,
          async () => {
            if (reason === 'initial' && !isCleanSlate) {
              const existingImport = await findExistingSyncImport(userId, opId);

              if (existingImport) {
                if (isIdempotentSyncImportRetry(existingImport, opId)) {
                  Logger.info(
                    `[user:${userId}] Idempotent SYNC_IMPORT retry from client ${clientId} ` +
                      `(in-lock) for existing import seq=${existingImport.serverSeq}`,
                  );
                  reply.send({
                    accepted: true,
                    serverSeq: existingImport.serverSeq,
                  } satisfies SnapshotDedupResponse);
                  return null;
                }
                sendSyncImportExistsReply(reply, userId, clientId, existingImport);
                return null;
              }
            }

            // Check storage quota before processing. For clean-slate uploads, use a
            // zero-current-usage baseline because uploadOps will wipe existing data
            // and reset storageUsedBytes inside its transaction. For regular
            // snapshots, include the operation payload plus the cached snapshot
            // replacement delta; checking only the request body can under-count by
            // nearly 2x because the server stores both the op and snapshot cache.
            if (isCleanSlate) {
              const finalStorageBytes =
                estimatedOpStorageBytes +
                (preparedSnapshot.cacheable ? preparedSnapshot.bytes : 0);
              const quotaOk = await enforceCleanSlateStorageQuota(
                userId,
                finalStorageBytes,
                reply,
              );
              if (!quotaOk) return null;
            } else {
              // Encrypted ops never use the server snapshot cache (server can't
              // decrypt), so the cache delta is exactly zero for them. For
              // unencrypted ops, the eventual cacheSnapshot call either writes
              // the new blob (delta = newBytes - previousBytes) or clears the
              // stale cache when the snapshot is too large to cache
              // (delta = -previousBytes). Both deltas accurately reflect the
              // on-disk change because the op-row is always counted via
              // estimatedOpStorageBytes.
              let estimatedSnapshotCacheDelta = 0;
              if (!op.isPayloadEncrypted) {
                const previousSnapshotBytes =
                  await syncService.getCachedSnapshotBytes(userId);
                estimatedSnapshotCacheDelta = preparedSnapshot.cacheable
                  ? preparedSnapshot.bytes - previousSnapshotBytes
                  : -previousSnapshotBytes;
              }
              const additionalBytes =
                estimatedOpStorageBytes + estimatedSnapshotCacheDelta;
              const quotaOk = await enforceStorageQuota(userId, additionalBytes, reply);
              if (!quotaOk) return null;
            }

            const results = await syncService.uploadOps(
              userId,
              clientId,
              [op],
              isCleanSlate,
            );
            const uploadResult = results[0];

            if (uploadResult.accepted && uploadResult.serverSeq !== undefined) {
              // Cache the snapshot — but only if the payload is server-replayable.
              // Encrypted snapshots remain available as ops but can't back
              // server-side restore, so we skip caching their blob.
              const cacheResult = await syncService.cacheSnapshotIfReplayable(
                userId,
                state,
                uploadResult.serverSeq,
                op.isPayloadEncrypted,
                preparedSnapshot,
              );
              // The op-row portion (payload + vectorClock) is now accounted
              // inside `uploadOps`'s `$transaction` (B3 / wave-1 commit
              // 9af17e460e). Apply only the snapshot-cache delta here —
              // `cacheResult` is null for encrypted snapshots (no cache) and
              // has `deltaBytes = 0` when the race was lost.
              const cacheDeltaBytes = cacheResult?.deltaBytes ?? 0;
              if (cacheDeltaBytes !== 0) {
                await applyStorageUsageDelta(
                  userId,
                  cacheDeltaBytes,
                  'after snapshot cache write',
                );
              }
            }

            return uploadResult;
          },
        );
        if (!result) return;

        // Idempotent retry: if uploadOps saw the same opId already on disk,
        // the previous attempt actually succeeded; the client just lost the
        // response. Surface the original serverSeq as success instead of a
        // confusing DUPLICATE_OPERATION rejection. (The SYNC_IMPORT_EXISTS
        // pre-check handles `reason='initial'`; this branch covers BACKUP_IMPORT
        // and REPAIR uploads, which bypass that pre-check.)
        let finalResult: UploadResult = result;
        if (
          !result.accepted &&
          result.errorCode === SYNC_ERROR_CODES.DUPLICATE_OPERATION &&
          opId
        ) {
          // Defensive userId filter: `isSameDuplicateOperation` already enforces
          // ownership before processOperation returns DUPLICATE_OPERATION, so a
          // cross-tenant id collision can't reach this branch today. The guard
          // keeps the route's idempotency conversion correct even if that
          // upstream invariant ever changes.
          const existingOp = await prisma.operation.findFirst({
            where: { id: opId, userId },
            select: { serverSeq: true },
          });
          if (existingOp) {
            Logger.info(
              `[user:${userId}] Idempotent snapshot retry from client ${clientId} ` +
                `for existing opId=${opId} (serverSeq=${existingOp.serverSeq})`,
            );
            finalResult = {
              opId,
              accepted: true,
              serverSeq: existingOp.serverSeq,
            };
          }
        }

        Logger.info(`Snapshot uploaded for user ${userId}, reason: ${reason}`);

        // Notify other connected clients about snapshot upload (fire-and-forget)
        if (finalResult.accepted && finalResult.serverSeq !== undefined) {
          getWsConnectionService().notifyNewOps(userId, clientId, finalResult.serverSeq);
        }

        const responseBody: SnapshotDedupResponse = {
          accepted: finalResult.accepted,
          serverSeq: finalResult.serverSeq,
          error: finalResult.error,
        };
        // Skip caching when the result is a residual DUPLICATE_OPERATION (the
        // existing-op lookup just above failed) so a concurrent retry that
        // lost the insert race cannot overwrite the winner's success entry.
        if (requestId && finalResult.errorCode !== SYNC_ERROR_CODES.DUPLICATE_OPERATION) {
          syncService.cacheSnapshotRequestResult(userId, requestId, responseBody);
        }

        return reply.send(responseBody);
      } catch (err) {
        Logger.error(`Upload snapshot error: ${errorMessage(err)}`);
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  // GET /api/sync/status - Get sync status
  fastify.get(
    '/status',
    {
      config: {
        rateLimit: {
          max: 60,
          timeWindow: '1 minute',
        },
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const userId = getAuthUser(req).userId;
        const syncService = getSyncService();

        const [latestSeq, devicesOnline, snapshotGeneratedAt, storageInfo] =
          await Promise.all([
            syncService.getLatestSeq(userId),
            syncService.getOnlineDeviceCount(userId),
            syncService.getCachedSnapshotGeneratedAt(userId),
            syncService.getStorageInfo(userId),
          ]);
        const snapshotAge =
          snapshotGeneratedAt !== null ? Date.now() - snapshotGeneratedAt : undefined;

        Logger.debug(
          `[user:${userId}] Status: seq=${latestSeq}, devices=${devicesOnline}`,
        );

        const response: SyncStatusResponse = {
          latestSeq,
          devicesOnline,
          snapshotAge,
          storageUsedBytes: storageInfo.storageUsedBytes,
          storageQuotaBytes: storageInfo.storageQuotaBytes,
        };

        return reply.send(response);
      } catch (err) {
        Logger.error(`Get status error: ${errorMessage(err)}`);
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  // DELETE /api/sync/data - Delete all sync data for user
  // Used for encryption password changes
  fastify.delete(
    '/data',
    {
      config: {
        rateLimit: {
          max: 3,
          timeWindow: '15 minutes',
        },
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const userId = getAuthUser(req).userId;
        const syncService = getSyncService();

        Logger.info(`[user:${userId}] DELETE ALL DATA requested`);

        await syncService.deleteAllUserData(userId);

        Logger.audit({
          event: 'USER_DATA_DELETED',
          userId,
        });

        return reply.send({ success: true });
      } catch (err) {
        Logger.error(`Delete user data error: ${errorMessage(err)}`);
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  // GET /api/sync/restore-points - List available restore points
  fastify.get<{
    Querystring: { limit?: string };
  }>(
    '/restore-points',
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 minute',
        },
      },
    },
    async (req, reply) => {
      try {
        const userId = getAuthUser(req).userId;
        const syncService = getSyncService();
        const limit = req.query.limit ? parseInt(req.query.limit, 10) : 30;

        if (isNaN(limit) || limit < 1 || limit > 100) {
          return reply.status(400).send({
            error: 'Invalid limit parameter (must be 1-100)',
          });
        }

        Logger.debug(`[user:${userId}] Restore points requested (limit=${limit})`);

        const restorePoints = await syncService.getRestorePoints(userId, limit);

        Logger.info(`[user:${userId}] Returning ${restorePoints.length} restore points`);

        return reply.send({ restorePoints });
      } catch (err) {
        Logger.error(`Get restore points error: ${errorMessage(err)}`);
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  // GET /api/sync/restore/:serverSeq - Get state snapshot at specific serverSeq
  // Rate limited: Snapshot generation is CPU-intensive
  fastify.get<{
    Params: { serverSeq: string };
  }>(
    '/restore/:serverSeq',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '5 minutes',
        },
      },
    },
    async (req, reply) => {
      try {
        const userId = getAuthUser(req).userId;
        const syncService = getSyncService();
        const targetSeq = parseInt(req.params.serverSeq, 10);

        if (isNaN(targetSeq) || targetSeq < 1) {
          return reply.status(400).send({
            error: 'Invalid serverSeq parameter (must be a positive integer)',
          });
        }

        Logger.info(`[user:${userId}] Restore snapshot requested at seq=${targetSeq}`);

        const snapshot = await syncService.generateSnapshotAtSeq(userId, targetSeq);

        Logger.info(`[user:${userId}] Restore snapshot generated at seq=${targetSeq}`);

        return reply.send(snapshot);
      } catch (err) {
        // Handle encrypted ops error - this is a known limitation, not a server error
        if (err instanceof EncryptedOpsNotSupportedError) {
          Logger.info(
            `[user:${getAuthUser(req).userId}] Restore blocked due to encrypted ops (count=${err.encryptedOpCount})`,
          );
          return reply.status(400).send({
            error: ENCRYPTED_OPS_CLIENT_MESSAGE,
            errorCode: SYNC_ERROR_CODES.ENCRYPTED_OPS_NOT_SUPPORTED,
          });
        }
        const message = errorMessage(err);
        if (
          message.includes('exceeds latest sequence') ||
          message.includes('must be at least')
        ) {
          Logger.warn(
            `[user:${getAuthUser(req).userId}] Invalid restore request: ${message}`,
          );
          return reply.status(400).send({ error: message });
        }
        Logger.error(`Get restore snapshot error: ${message}`);
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );
};
