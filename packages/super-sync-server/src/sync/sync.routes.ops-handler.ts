import { FastifyReply, FastifyRequest } from 'fastify';
import { SuperSyncUploadOpsRequestSchema } from '@sp/shared-schema';
import { getAuthUser } from '../middleware';
import { Logger } from '../logger';
import { getSyncService } from './sync.service';
import { getWsConnectionService } from './services/websocket-connection.service';
import {
  Operation,
  ServerOperation,
  SYNC_ERROR_CODES,
  UploadOpsRequest,
  UploadOpsResponse,
  UploadResult,
} from './sync.types';
import {
  isSingleTokenGzipEncoding,
  parseCompressedJsonBody,
} from './compressed-body-parser';
import {
  createValidationErrorResponse,
  errorMessage,
  MAX_COMPRESSED_SIZE_OPS,
  MAX_DECOMPRESSED_SIZE_OPS,
  MAX_OPS_PER_BATCH,
  sendCompressedBodyParseFailure,
} from './sync.routes.payload';
import {
  computeOpsStorageBytes,
  enforceStorageQuota,
  getRawOpsCount,
  sendOpsBatchTooLargeReply,
} from './sync.routes.quota';

export const uploadOpsHandler = async (
  req: FastifyRequest<{ Body: UploadOpsRequest }>,
  reply: FastifyReply,
): Promise<FastifyReply | void> => {
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

    const rawOpsCount = getRawOpsCount(body);
    if (rawOpsCount !== null && rawOpsCount > MAX_OPS_PER_BATCH) {
      return sendOpsBatchTooLargeReply(reply, userId, rawOpsCount);
    }

    // Validate request body
    const parseResult = SuperSyncUploadOpsRequestSchema.safeParse(body);
    if (!parseResult.success) {
      Logger.warn(`[user:${userId}] Upload validation failed`, parseResult.error.issues);
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
        Logger.info(`[user:${userId}] Returning cached results for request ${requestId}`);

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
};
