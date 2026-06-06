import { FastifyReply, FastifyRequest } from 'fastify';
import { uuidv7 } from 'uuidv7';
import { SuperSyncUploadSnapshotRequestSchema } from '@sp/shared-schema';
import { prisma } from '../db';
import { Logger } from '../logger';
import { getAuthUser } from '../middleware';
import { getSyncService } from './sync.service';
import { getWsConnectionService } from './services/websocket-connection.service';
import { SYNC_ERROR_CODES, UploadResult } from './sync.types';
import {
  isSingleTokenGzipEncoding,
  parseCompressedJsonBody,
} from './compressed-body-parser';
import type { SnapshotDedupResponse } from './services';
import {
  createValidationErrorResponse,
  errorMessage,
  MAX_COMPRESSED_SIZE_SNAPSHOT,
  MAX_DECOMPRESSED_SIZE_SNAPSHOT,
  sendCompressedBodyParseFailure,
} from './sync.routes.payload';
import {
  applyStorageUsageDelta,
  computeJsonStorageBytes,
  enforceCleanSlateStorageQuota,
  enforceStorageQuota,
  findExistingSyncImport,
  isIdempotentSyncImportRetry,
  sendQuotaExceededReply,
  sendSyncImportExistsReply,
} from './sync.routes.quota';

export const uploadSnapshotHandler = async (
  req: FastifyRequest<{ Body: unknown }>,
  reply: FastifyReply,
): Promise<FastifyReply | void> => {
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

    const snapshotRequest = parseResult.data as typeof parseResult.data & {
      requestId?: string;
    };
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
    } = snapshotRequest;
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
          const additionalBytes = estimatedOpStorageBytes + estimatedSnapshotCacheDelta;
          const quotaOk = await enforceStorageQuota(userId, additionalBytes, reply);
          if (!quotaOk) return null;
        }

        const results = await syncService.uploadOps(userId, clientId, [op], isCleanSlate);
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
};
