import { FastifyReply, FastifyRequest } from 'fastify';
import { SuperSyncUploadOpsRequestSchema } from '@sp/shared-schema';
import { getAuthUser } from '../middleware';
import { Logger } from '../logger';
import { getSyncService } from './sync.service';
import { getWsConnectionService } from './services/websocket-connection.service';
import {
  createStateReplacementRequiredResults,
  Operation,
  ServerOperation,
  STATE_REPLACEMENT_REQUIRED_ERROR,
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
  sendE2eeRequiredReply,
  violatesE2eeGate,
} from './sync.routes.payload';
import {
  computeOpsStorageBytesExcludingUnstorableIds,
  enforceStorageQuota,
  getRawOpsCount,
  sendOpsBatchTooLargeReply,
} from './sync.routes.quota';
import { createOpsRequestFingerprint } from './services/request-deduplication.service';

const isStateReplacementFenceRejection = (results: UploadResult[]): boolean =>
  results.length > 0 &&
  results.every(
    (result) =>
      !result.accepted &&
      result.errorCode === SYNC_ERROR_CODES.INTERNAL_ERROR &&
      result.error === STATE_REPLACEMENT_REQUIRED_ERROR,
  );

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

    const { ops, clientId, lastKnownServerSeq, requestId } = parseResult.data;
    const syncService = getSyncService();

    Logger.info(
      `[user:${userId}] Upload: ${ops.length} ops from client ${clientId.slice(0, 8)}...`,
    );

    // Post-auth per-user fairness limit, separate from the route-level per-IP
    // backstop. Check BEFORE deduplication so requestId retries cannot bypass it.
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

    // Encrypted-only ingress gate: every op must be flagged encrypted and
    // carry the ciphertext transport shape. Reject the whole batch AFTER the
    // rate limit (floods stay cheap) but BEFORE fingerprinting, dedup, quota
    // work, and persistence, so a rejected upload leaves no server-side trace.
    if (ops.some(violatesE2eeGate)) {
      return sendE2eeRequiredReply(reply, userId, {
        clientId,
        surface: 'ops',
        opsCount: ops.length,
      });
    }

    // Compute the request fingerprint AFTER the rate-limit gate (a rate-limited
    // client must not burn CPU on it) and BEFORE any processing: uploadOps and
    // the quota prevalidation mutate the parsed ops (e.g. vector-clock
    // sanitizing/pruning), so hashing later would never match a retry's
    // pre-processing hash. Eager is as cheap as lazy here — every non-limited
    // requestId-bearing request needs the hash exactly once (either the dedup
    // check below or the post-upload cache write).
    const requestFingerprint = requestId
      ? createOpsRequestFingerprint(clientId, ops as unknown as Operation[])
      : undefined;

    // Check for duplicate request (client retry) BEFORE quota check
    // This ensures retries after successful uploads don't fail with 413
    // if the original upload pushed the user over quota
    if (requestId && requestFingerprint) {
      const cachedResults = syncService.checkOpsRequestDedup(
        userId,
        requestId,
        () => requestFingerprint,
      );
      if (cachedResults && lastKnownServerSeq !== undefined) {
        // IMPORTANT: Recompute piggybacked ops using the retry request's lastKnownServerSeq.
        // The original response may have contained newOps that the client missed if the
        // network dropped the response. By using the CURRENT request's lastKnownServerSeq,
        // we ensure the client gets all ops it hasn't seen yet.
        const opsResult = await syncService.getOpsSinceWithSeq(
          userId,
          lastKnownServerSeq,
          clientId,
          500,
          false,
        );
        const latestStateReplacementSeq =
          await syncService.getLatestStateReplacementSeq(userId);
        const cachedResultPredatesStateReplacement =
          latestStateReplacementSeq !== null &&
          (lastKnownServerSeq < latestStateReplacementSeq ||
            cachedResults.some(
              (result) =>
                result.accepted &&
                (result.serverSeq === undefined ||
                  result.serverSeq < latestStateReplacementSeq),
            ));
        if (cachedResultPredatesStateReplacement) {
          // The piggyback read comes first, so a replacement committed before
          // or during it is visible to this boundary read. A replacement that
          // commits later is beyond opsResult.latestSeq and will be downloaded
          // on the next sync.
          Logger.info(
            `[user:${userId}] Ignoring cached upload result from before the latest state replacement`,
          );
        } else {
          Logger.info(
            `[user:${userId}] Returning cached results for request ${requestId}`,
          );

          const newOps = opsResult.ops;
          const latestSeq = opsResult.latestSeq;
          let hasMorePiggyback = false;
          const PIGGYBACK_LIMIT = 500;

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

          return reply.send({
            results: cachedResults,
            newOps: newOps.length ? newOps : undefined,
            latestSeq,
            deduplicated: true,
            ...(hasMorePiggyback ? { hasMorePiggyback: true } : {}),
          } as UploadOpsResponse & { deduplicated: boolean });
        }
      } else if (cachedResults) {
        Logger.info(`[user:${userId}] Returning cached results for request ${requestId}`);

        const latestSeq = await syncService.getLatestSeq(userId);

        return reply.send({
          results: cachedResults,
          latestSeq,
          deduplicated: true,
        } as UploadOpsResponse & { deduplicated: boolean });
      }
    }

    const results = await syncService.runWithStorageUsageLock<UploadResult[] | null>(
      userId,
      async () => {
        // Check storage quota before processing (after dedup to allow retries).
        // Account using the same per-op payload+vectorClock measure that the
        // post-accept counter increment uses, so the gate and the increment
        // cannot disagree on what "size" means. Already-occupied IDs are
        // rejected by uploadOps and never written, so don't make quota cleanup
        // reserve space for them. Carry the occupied-ID snapshot through upload
        // so cleanup cannot make one of those IDs insertable mid-request.
        const typedOpsForGate = ops as unknown as Operation[];
        const validOpsForQuota = syncService.filterValidOpsForQuota(
          typedOpsForGate,
          clientId,
        );
        const {
          bytes: estimatedDelta,
          fallback: gateFallback,
          requestStartOccupiedIds,
        } = await computeOpsStorageBytesExcludingUnstorableIds(validOpsForQuota, (op) =>
          syncService.getPrevalidatedPayloadBytes(op),
        );
        if (gateFallback > 0) {
          Logger.warn(
            `computeOpsStorageBytes: ${gateFallback}/${validOpsForQuota.length} unserializable op(s) ` +
              `charged at APPROX_BYTES_PER_OP for user=${userId} (gate)`,
          );
        }
        const initialQuota = await syncService.checkStorageQuota(userId, estimatedDelta);
        if (!initialQuota.allowed && lastKnownServerSeq !== undefined) {
          const latestStateReplacementSeq =
            await syncService.getLatestStateReplacementSeq(userId);
          if (
            latestStateReplacementSeq !== null &&
            lastKnownServerSeq < latestStateReplacementSeq
          ) {
            return createStateReplacementRequiredResults(typedOpsForGate);
          }
        }
        const quotaOk =
          initialQuota.allowed ||
          (await enforceStorageQuota(userId, estimatedDelta, reply));
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
          undefined,
          requestStartOccupiedIds,
          undefined,
          false,
          lastKnownServerSeq,
        );

        return uploadResults;
      },
    );
    if (!results) return;
    const requiresStateReplacementDownload = isStateReplacementFenceRejection(results);

    // Cache results for deduplication if requestId was provided.
    // Skip caching transient INTERNAL_ERROR results: neither transaction
    // rollbacks nor state-replacement fence rejections committed this batch,
    // so deterministic-requestId retries must re-process. #8332
    if (
      requestId &&
      requestFingerprint &&
      !results.some((r) => r.errorCode === SYNC_ERROR_CODES.INTERNAL_ERROR)
    ) {
      syncService.cacheOpsRequestResults(userId, requestId, results, requestFingerprint);
    }

    const accepted = results.filter((r) => r.accepted).length;
    const rejected = results.filter((r) => !r.accepted).length;
    Logger.info(
      `[user:${userId}] Upload result: ${accepted} accepted, ${rejected} rejected`,
    );

    if (rejected > 0) {
      Logger.debug(
        `[user:${userId}] Rejected op error codes:`,
        results.filter((r) => !r.accepted).map((r) => r.errorCode ?? 'UNKNOWN'),
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
        // The replacement may share this client ID (for example a migration
        // snapshot). A fenced retry must receive the boundary before its local
        // cursor can advance, even though ordinary piggybacking excludes self.
        requiresStateReplacementDownload ? undefined : clientId,
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
