import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { SuperSyncDownloadOpsQuerySchema } from '@sp/shared-schema';
import { authenticate, getAuthUser } from '../middleware';
import { getSyncService } from './sync.service';
import { Logger } from '../logger';
import {
  UploadOpsRequest,
  DownloadOpsResponse,
  SnapshotResponse,
  SyncStatusResponse,
  SYNC_ERROR_CODES,
} from './sync.types';
import { normalizeContentEncoding } from './compressed-body-parser';
import { EncryptedOpsNotSupportedError } from './services/snapshot.service';
import {
  createRawBodyLimitPreParsingHook,
  createValidationErrorResponse,
  ENCRYPTED_OPS_CLIENT_MESSAGE,
  errorMessage,
  MAX_COMPRESSED_SIZE_OPS,
  MAX_COMPRESSED_SIZE_SNAPSHOT,
  MAX_RAW_BODY_SIZE_OPS,
  MAX_RAW_BODY_SIZE_SNAPSHOT,
} from './sync.routes.payload';
import { applyStorageUsageDelta } from './sync.routes.quota';
import { uploadOpsHandler } from './sync.routes.ops-handler';
import { uploadSnapshotHandler } from './sync.routes.snapshot-handler';

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
    uploadOpsHandler,
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
    uploadSnapshotHandler,
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
