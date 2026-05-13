/**
 * SnapshotService - Handles snapshot generation and restore points
 *
 * Extracted from SyncService for better separation of concerns.
 * This service handles snapshot caching, generation, and restore points.
 *
 * CRITICAL: FIX 1.7 - Uses in-memory locks to prevent concurrent snapshot
 * generation for the same user. This prevents duplicate expensive computation.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { Logger } from '../../logger';
import {
  CURRENT_SCHEMA_VERSION,
  migrateState,
  migrateOperation,
  stateNeedsMigration,
  type OperationLike,
} from '@sp/shared-schema';
import { Operation } from '../sync.types';
import { ALLOWED_ENTITY_TYPES } from './validation.service';
import { gunzipAsync, gzipAsync } from '../gzip';

/**
 * Maximum operations to process during snapshot generation.
 * Prevents memory exhaustion for users with excessive operation history.
 */
const MAX_OPS_FOR_SNAPSHOT = 100000;

/**
 * Maximum compressed snapshot size in bytes (50MB).
 * Prevents storage exhaustion from excessively large snapshots.
 * Exported so route-level quota gates can size the worst-case write.
 */
export const MAX_SNAPSHOT_SIZE_BYTES = 50 * 1024 * 1024;

/**
 * Maximum decompressed snapshot size in bytes (100MB).
 * Prevents zip bombs from exhausting memory when reading cached snapshots.
 */
const MAX_SNAPSHOT_DECOMPRESSED_BYTES = 100 * 1024 * 1024;

/**
 * Maximum state size during replay (100MB).
 * Prevents memory exhaustion from malicious or corrupted data.
 */
const MAX_REPLAY_STATE_SIZE_BYTES = 100 * 1024 * 1024;

/**
 * How often to check state size during replay (every N operations).
 */
const REPLAY_SIZE_CHECK_INTERVAL = 1000;

/**
 * Reject these as property keys when applying user-supplied ids to the
 * replayed state object. Assigning to `state[key]` with one of these names
 * triggers a prototype-mutating setter (`__proto__`) or replaces an
 * inherited slot (`constructor`/`prototype`).
 */
const isUnsafeEntityKey = (key: string): boolean =>
  key === '__proto__' || key === 'constructor' || key === 'prototype';

const encryptedOpsNotSupportedMessage = (encryptedOpCount: number): string =>
  `ENCRYPTED_OPS_NOT_SUPPORTED: Cannot generate snapshot - ${encryptedOpCount} operations have encrypted payloads. ` +
  `Server-side restore is not available when E2E encryption is enabled. ` +
  `Alternative: Use the client app's "Sync Now" button which can decrypt and restore locally.`;

/**
 * Typed error thrown when snapshot generation hits encrypted ops the server
 * cannot decrypt. Route handlers should `instanceof`-check this instead of
 * substring-matching the message, and must NOT echo `message` back to the
 * client — it contains the encrypted-op count (data-volume side-channel).
 */
export class EncryptedOpsNotSupportedError extends Error {
  readonly encryptedOpCount: number;
  constructor(encryptedOpCount: number) {
    super(encryptedOpsNotSupportedMessage(encryptedOpCount));
    this.name = 'EncryptedOpsNotSupportedError';
    this.encryptedOpCount = encryptedOpCount;
  }
}

const REPLAY_OPERATION_SELECT = {
  id: true,
  serverSeq: true,
  opType: true,
  entityType: true,
  entityId: true,
  payload: true,
  schemaVersion: true,
  isPayloadEncrypted: true,
} as const;

type ReplayOperationRow = {
  id: string;
  serverSeq: number;
  opType: string;
  entityType: string;
  entityId: string | null;
  payload: unknown;
  schemaVersion: number;
  isPayloadEncrypted: boolean;
};

const assertContiguousReplayBatch = (
  ops: ReplayOperationRow[],
  expectedFirstSeq: number,
  targetSeq: number,
): void => {
  if (ops.length === 0) {
    throw new Error(
      `SNAPSHOT_REPLAY_INCOMPLETE: Missing operations from seq ${expectedFirstSeq} to ${targetSeq}.`,
    );
  }

  let expectedSeq = expectedFirstSeq;
  for (const op of ops) {
    if (op.serverSeq !== expectedSeq) {
      throw new Error(
        `SNAPSHOT_REPLAY_INCOMPLETE: Expected seq ${expectedSeq} but got ${op.serverSeq} while replaying to seq ${targetSeq}.`,
      );
    }
    expectedSeq++;
  }
};

export interface SnapshotResult {
  state: unknown;
  serverSeq: number;
  generatedAt: number;
  schemaVersion: number;
}

export interface RestorePoint {
  serverSeq: number;
  timestamp: number;
  type: 'SYNC_IMPORT' | 'BACKUP_IMPORT' | 'REPAIR';
  clientId: string;
  description?: string;
}

export interface PreparedSnapshotCache {
  data: Buffer;
  bytes: number;
  stateBytes: number;
  cacheable: boolean;
}

export interface CacheSnapshotResult {
  cached: boolean;
  bytesWritten: number;
  previousBytes: number;
  deltaBytes: number;
}

export class SnapshotService {
  /**
   * FIX 1.7: In-memory lock to prevent concurrent snapshot generation for the same user.
   * Maps userId to a Promise that resolves when generation completes.
   * Concurrent requests wait for the existing generation and reuse its result.
   */
  private snapshotGenerationLocks: Map<number, Promise<SnapshotResult>> = new Map();

  /**
   * Clear any cached state for a user (e.g., when user data is deleted).
   */
  clearForUser(userId: number): void {
    this.snapshotGenerationLocks.delete(userId);
  }

  /**
   * Serialize + gzip a snapshot off the event loop. Returns the prepared blob
   * plus byte accounting needed by quota tracking.
   */
  async prepareSnapshotCache(state: unknown): Promise<PreparedSnapshotCache> {
    const serialized = JSON.stringify(state);
    const data = await gzipAsync(Buffer.from(serialized, 'utf-8'));
    return {
      data,
      bytes: data.length,
      stateBytes: Buffer.byteLength(serialized, 'utf8'),
      cacheable: data.length <= MAX_SNAPSHOT_SIZE_BYTES,
    };
  }

  async getCachedSnapshotBytes(userId: number): Promise<number> {
    const result = await prisma.$queryRaw<[{ bytes: number | bigint | null }]>`
      SELECT COALESCE(octet_length(snapshot_data), 0) as bytes
      FROM user_sync_state WHERE user_id = ${userId}
    `;
    return Number(result[0]?.bytes ?? 0);
  }

  /**
   * Get cached snapshot for a user.
   */
  async getCachedSnapshot(userId: number): Promise<SnapshotResult | null> {
    const row = await prisma.userSyncState.findUnique({
      where: { userId },
      select: {
        snapshotData: true,
        lastSnapshotSeq: true,
        snapshotAt: true,
        snapshotSchemaVersion: true,
      },
    });

    if (!row?.snapshotData) return null;

    try {
      const decompressed = (
        await gunzipAsync(row.snapshotData, {
          maxOutputLength: MAX_SNAPSHOT_DECOMPRESSED_BYTES,
        })
      ).toString('utf-8');
      return {
        state: JSON.parse(decompressed),
        serverSeq: row.lastSnapshotSeq ?? 0,
        generatedAt: Number(row.snapshotAt) ?? 0,
        schemaVersion: row.snapshotSchemaVersion ?? 1,
      };
    } catch (err) {
      // Without this clear the same error would be logged on every cache read
      // until a new snapshot is generated.
      Logger.error(
        `[user:${userId}] Failed to decompress cached snapshot, invalidating: ${(err as Error).message}`,
      );
      await this._invalidateCachedSnapshot(userId);
      return null;
    }
  }

  private async _invalidateCachedSnapshot(userId: number): Promise<void> {
    try {
      await prisma.userSyncState.update({
        where: { userId },
        data: {
          snapshotData: null,
          lastSnapshotSeq: null,
          snapshotAt: null,
          snapshotSchemaVersion: null,
        },
      });
    } catch (err) {
      // Row may have been deleted concurrently — best-effort cleanup.
      Logger.warn(
        `[user:${userId}] Failed to invalidate cached snapshot: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Cache a snapshot only when it's replayable by the server.
   * Encrypted payloads remain available as ops but cannot back snapshot
   * replay (server cannot decrypt). Owning this invariant here keeps HTTP
   * routes from having to remember the rule.
   */
  async cacheSnapshotIfReplayable(
    userId: number,
    state: unknown,
    serverSeq: number,
    isPayloadEncrypted: boolean,
    preparedSnapshot?: PreparedSnapshotCache,
  ): Promise<CacheSnapshotResult | null> {
    if (isPayloadEncrypted) return null;
    return this.cacheSnapshot(userId, state, serverSeq, preparedSnapshot);
  }

  /**
   * Cache a snapshot for a user.
   *
   * Guards against stale-overwrite races between concurrent uploads: only
   * writes when no row exists yet or the cached `lastSnapshotSeq` is older
   * than `serverSeq`. The op append itself is serialized by the DB; the cache
   * write is not, so without this guard a later request finishing first could
   * be clobbered by an earlier one.
   *
   * Returns byte accounting so callers can keep the storage usage counter in
   * sync with `snapshotData` writes. `deltaBytes` is 0 when nothing was
   * written (race lost) so storage accounting stays self-consistent.
   */
  async cacheSnapshot(
    userId: number,
    state: unknown,
    serverSeq: number,
    preparedSnapshot?: PreparedSnapshotCache,
  ): Promise<CacheSnapshotResult> {
    const now = Date.now();
    const prepared = preparedSnapshot ?? (await this.prepareSnapshotCache(state));
    const previousBytes = await this.getCachedSnapshotBytes(userId);

    if (!prepared.cacheable) {
      Logger.error(
        `[user:${userId}] Snapshot too large: ${prepared.bytes} bytes ` +
          `(max ${MAX_SNAPSHOT_SIZE_BYTES}). Clearing stale cache.`,
      );
      // Race-safe clear: only when our serverSeq is newer than what is
      // cached, so we don't clobber a smaller, still-valid snapshot that
      // won the race.
      let cleared = 0;
      if (previousBytes > 0) {
        const clearResult = await prisma.userSyncState.updateMany({
          where: {
            userId,
            OR: [{ lastSnapshotSeq: null }, { lastSnapshotSeq: { lt: serverSeq } }],
          },
          data: {
            snapshotData: null,
            lastSnapshotSeq: null,
            snapshotAt: null,
            snapshotSchemaVersion: null,
          },
        });
        cleared = clearResult.count;
      }
      return {
        cached: false,
        bytesWritten: 0,
        previousBytes,
        deltaBytes: cleared > 0 ? -previousBytes : 0,
      };
    }

    const data = {
      snapshotData: prepared.data,
      lastSnapshotSeq: serverSeq,
      snapshotAt: BigInt(now),
      snapshotSchemaVersion: CURRENT_SCHEMA_VERSION,
    };

    // Conditional update — does nothing when no row exists OR when cached
    // lastSnapshotSeq is already >= serverSeq.
    const updateResult = await prisma.userSyncState.updateMany({
      where: {
        userId,
        OR: [{ lastSnapshotSeq: null }, { lastSnapshotSeq: { lt: serverSeq } }],
      },
      data,
    });

    if (updateResult.count > 0) {
      return {
        cached: true,
        bytesWritten: prepared.bytes,
        previousBytes,
        deltaBytes: prepared.bytes - previousBytes,
      };
    }

    // Either no row exists yet (first-time-user path) or a newer snapshot
    // already won the race. Try a create — if a row was inserted between
    // the updateMany and now, the unique-userId constraint throws P2002
    // and we treat that as "newer snapshot won; nothing to do".
    try {
      await prisma.userSyncState.create({ data: { userId, ...data } });
      return {
        cached: true,
        bytesWritten: prepared.bytes,
        previousBytes,
        deltaBytes: prepared.bytes - previousBytes,
      };
    } catch (err) {
      if ((err as { code?: string }).code !== 'P2002') throw err;
      return { cached: false, bytesWritten: 0, previousBytes, deltaBytes: 0 };
    }
  }

  /**
   * Generate a snapshot for a user at the latest sequence.
   * Uses FIX 1.7 lock to prevent concurrent generation for the same user.
   *
   * `onCacheDelta` is invoked after the transaction commits with the byte
   * change applied to the `snapshotData` column when the cache was rewritten.
   * Callers should use it to keep the storage usage counter in sync with
   * on-disk reality — otherwise `GET /snapshot` can grow `snapshotData` by up
   * to ~MAX_SNAPSHOT_SIZE_BYTES without the counter noticing.
   *
   * `maxCacheBytes` (B5) caps how large the persisted cache blob may be.
   * When the freshly compressed snapshot would exceed this cap (typically set
   * to the user's remaining quota), the cache is NOT written but the in-memory
   * snapshot is still returned to the caller. Lets a user at quota still read
   * their state without growing on-disk storage further.
   */
  async generateSnapshot(
    userId: number,
    onCacheDelta?: (deltaBytes: number) => Promise<void>,
    maxCacheBytes?: number,
  ): Promise<SnapshotResult> {
    // FIX 1.7: Check if snapshot generation is already in progress for this user.
    // If so, wait for the existing generation and return its result.
    // This prevents duplicate expensive computation under concurrent requests.
    const existingPromise = this.snapshotGenerationLocks.get(userId);
    if (existingPromise) {
      Logger.info(`Waiting for existing snapshot generation for user ${userId}`);
      return existingPromise;
    }

    // Start new generation and store the promise
    const promise = this._generateSnapshotImpl(userId, onCacheDelta, maxCacheBytes);
    this.snapshotGenerationLocks.set(userId, promise);

    try {
      return await promise;
    } finally {
      // Clean up lock when done (whether success or failure)
      this.snapshotGenerationLocks.delete(userId);
    }
  }

  /**
   * Internal implementation of snapshot generation.
   * Called only when no concurrent generation is in progress.
   *
   * If the cache was rewritten the byte delta is captured in `cacheDelta` and
   * applied AFTER the transaction commits via the optional `onCacheDelta`
   * callback. This keeps the slow counter update out of the snapshot
   * transaction window while letting storage accounting self-heal.
   */
  private async _generateSnapshotImpl(
    userId: number,
    onCacheDelta?: (deltaBytes: number) => Promise<void>,
    maxCacheBytes?: number,
  ): Promise<SnapshotResult> {
    let cacheDelta = 0;
    const result = await prisma.$transaction(
      async (tx) => {
        // Get latest seq in this transaction
        const seqRow = await tx.userSyncState.findUnique({
          where: { userId },
          select: { lastSeq: true },
        });
        const latestSeq = seqRow?.lastSeq ?? 0;

        let state: Record<string, unknown> = {};
        let startSeq = 0;
        let snapshotSchemaVersion = CURRENT_SCHEMA_VERSION;

        // Try to get cached snapshot (need to fetch it inside tx for consistency?
        // Actually, we can fetch it. If it's old, we just replay more ops.)
        // Re-implementing getCachedSnapshot logic inside tx
        const cachedRow = await tx.userSyncState.findUnique({
          where: { userId },
          select: {
            snapshotData: true,
            lastSnapshotSeq: true,
            snapshotAt: true,
            snapshotSchemaVersion: true,
          },
        });

        if (cachedRow?.snapshotData) {
          try {
            const decompressed = (
              await gunzipAsync(cachedRow.snapshotData, {
                maxOutputLength: MAX_SNAPSHOT_DECOMPRESSED_BYTES,
              })
            ).toString('utf-8');
            state = JSON.parse(decompressed) as Record<string, unknown>;
            startSeq = cachedRow.lastSnapshotSeq ?? 0;
            snapshotSchemaVersion = cachedRow.snapshotSchemaVersion ?? 1;
          } catch (err) {
            // Ignore corrupted cache
          }
        }

        // Always validate that the cached base is not poisoned by encrypted
        // ops before serving it, including on the fast path — a legacy build
        // that didn't reject encrypted ops could have produced a poisoned
        // cache, and the fast path would serve it forever. The assertion is
        // a findFirst + count, which is cheap relative to skipping replay.
        await this._assertCachedSnapshotBaseReplayable(tx, userId, startSeq);

        // Fast path: cached snapshot is already at the latest seq AND in the
        // current schema version. No replay needed.
        if (
          startSeq >= latestSeq &&
          cachedRow?.snapshotData &&
          snapshotSchemaVersion === CURRENT_SCHEMA_VERSION
        ) {
          return {
            state,
            serverSeq: startSeq,
            generatedAt: Date.now(),
            schemaVersion: CURRENT_SCHEMA_VERSION,
          };
        }

        // Migrate snapshot if needed
        if (stateNeedsMigration(snapshotSchemaVersion, CURRENT_SCHEMA_VERSION)) {
          Logger.info(
            `[user:${userId}] Migrating snapshot from v${snapshotSchemaVersion} to v${CURRENT_SCHEMA_VERSION}`,
          );
          const migrationResult = migrateState(
            state,
            snapshotSchemaVersion,
            CURRENT_SCHEMA_VERSION,
          );
          if (!migrationResult.success) {
            throw new Error(`Snapshot migration failed: ${migrationResult.error}`);
          }
          state = migrationResult.data as Record<string, unknown>;
          snapshotSchemaVersion = CURRENT_SCHEMA_VERSION;
        }

        const totalOpsToProcess = latestSeq - startSeq;
        if (totalOpsToProcess > MAX_OPS_FOR_SNAPSHOT) {
          throw new Error(
            `Too many operations to process (${totalOpsToProcess}). ` +
              `Max: ${MAX_OPS_FOR_SNAPSHOT}.`,
          );
        }

        await this._assertNoEncryptedOps(tx, userId, startSeq, latestSeq);

        const BATCH_SIZE = 10000;
        let currentSeq = startSeq;
        let totalProcessed = 0;

        while (currentSeq < latestSeq) {
          const batchOps = await tx.operation.findMany({
            where: {
              userId,
              // Keep the replay aligned with the advertised snapshot sequence.
              serverSeq: { gt: currentSeq, lte: latestSeq },
            },
            orderBy: { serverSeq: 'asc' },
            take: BATCH_SIZE,
            select: REPLAY_OPERATION_SELECT,
          });

          // _resolveExpectedFirstSeq permits a leading gap when the first
          // surviving op is a full-state op (e.g. SYNC_IMPORT after a
          // clean-slate upload), because full-state ops reset state anyway.
          const expectedFirstSeq = this._resolveExpectedFirstSeq(
            batchOps,
            currentSeq,
            startSeq,
            latestSeq,
          );
          assertContiguousReplayBatch(batchOps, expectedFirstSeq, latestSeq);

          // Replay ops
          state = this.replayOpsToState(batchOps, state);

          currentSeq = batchOps[batchOps.length - 1].serverSeq;
          totalProcessed += batchOps.length;

          if (totalProcessed > MAX_OPS_FOR_SNAPSHOT) {
            throw new Error(
              `Too many operations processed (${totalProcessed}). ` +
                `Max: ${MAX_OPS_FOR_SNAPSHOT}.`,
            );
          }
        }

        const generatedAt = Date.now();

        // Cache the generated snapshot inline so it matches the returned state.
        // Race-safe write (same pattern as `cacheSnapshot`): a concurrent
        // upload may have advanced `lastSnapshotSeq` beyond our `latestSeq`
        // while we replayed under RepeatableRead. Conditional `updateMany`
        // only writes when our seq is newer; if no row exists yet (first-time
        // user), fall back to `create` and swallow P2002 if another writer
        // beat us to the insert. When the race is lost, `cacheDelta` MUST
        // stay 0 — otherwise `onCacheDelta` would over-credit storage by
        // `compressed.length - previousCachedBytes` even though nothing was
        // written.
        const previousCachedBytes = cachedRow?.snapshotData?.length ?? 0;
        const compressed = await gzipAsync(Buffer.from(JSON.stringify(state), 'utf-8'));
        // B5: enforce a quota-aware cap on cache growth. The hard
        // `MAX_SNAPSHOT_SIZE_BYTES` ceiling still applies; `maxCacheBytes`
        // (when provided) tightens it to the user's remaining quota plus the
        // previously-cached bytes (since rewriting reclaims them). When the
        // new blob would exceed this cap, skip the cache write — the snapshot
        // is still returned in-memory to the client.
        const effectiveCap =
          maxCacheBytes !== undefined
            ? Math.min(MAX_SNAPSHOT_SIZE_BYTES, maxCacheBytes + previousCachedBytes)
            : MAX_SNAPSHOT_SIZE_BYTES;
        const overHardCeiling = compressed.length > MAX_SNAPSHOT_SIZE_BYTES;
        if (compressed.length > effectiveCap) {
          Logger.info(
            `[user:${userId}] Skipping snapshot cache write: ` +
              `compressed ${compressed.length}B > cap ${effectiveCap}B` +
              (overHardCeiling
                ? ` (exceeds MAX_SNAPSHOT_SIZE_BYTES=${MAX_SNAPSHOT_SIZE_BYTES})`
                : ` (remaining quota window)`),
          );
        }
        // W4: when the regenerated blob exceeds the hard ceiling, mirror
        // `cacheSnapshot`'s clear-stale logic instead of leaving a poisoned
        // old blob in place. Race-safe: only clear when our seq is newer.
        if (overHardCeiling && previousCachedBytes > 0) {
          const clearResult = await tx.userSyncState.updateMany({
            where: {
              userId,
              OR: [{ lastSnapshotSeq: null }, { lastSnapshotSeq: { lt: latestSeq } }],
            },
            data: {
              snapshotData: null,
              lastSnapshotSeq: null,
              snapshotAt: null,
              snapshotSchemaVersion: null,
            },
          });
          if (clearResult.count > 0) {
            cacheDelta = -previousCachedBytes;
          }
        }
        if (compressed.length <= effectiveCap) {
          const cacheData = {
            snapshotData: compressed,
            lastSnapshotSeq: latestSeq,
            snapshotAt: BigInt(generatedAt),
            snapshotSchemaVersion: CURRENT_SCHEMA_VERSION,
          };
          const updateResult = await tx.userSyncState.updateMany({
            where: {
              userId,
              OR: [{ lastSnapshotSeq: null }, { lastSnapshotSeq: { lt: latestSeq } }],
            },
            data: cacheData,
          });
          if (updateResult.count > 0) {
            cacheDelta = compressed.length - previousCachedBytes;
          } else {
            // Either no row exists yet (first-time-user path) or a newer
            // snapshot already won the race. Try a create — if a row was
            // inserted concurrently, the unique-userId constraint throws
            // P2002 and we treat that as "newer snapshot won".
            try {
              await tx.userSyncState.create({ data: { userId, ...cacheData } });
              cacheDelta = compressed.length - previousCachedBytes;
            } catch (err) {
              if ((err as { code?: string }).code !== 'P2002') throw err;
              // cacheDelta stays 0: nothing was written.
            }
          }
        }

        return {
          state,
          serverSeq: latestSeq,
          generatedAt,
          schemaVersion: CURRENT_SCHEMA_VERSION,
        };
      },
      {
        timeout: 60000, // Snapshots can take time
        // Prevent races between `_assertNoEncryptedOps` / `_assertCachedSnapshotBaseReplayable`
        // and the subsequent `findMany` batches: a concurrent writer must not be able to
        // slip an encrypted op into the snapshot window after the guards have passed.
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      },
    );

    if (onCacheDelta && cacheDelta !== 0) {
      try {
        await onCacheDelta(cacheDelta);
      } catch (err) {
        Logger.warn(
          `[user:${userId}] generateSnapshot cache-delta hook failed: ${
            (err as Error).message
          }`,
        );
      }
    }

    return result;
  }

  /**
   * Get available restore points for a user.
   * Returns significant state-change operations (SYNC_IMPORT, BACKUP_IMPORT, REPAIR)
   * which represent complete snapshots of the application state.
   */
  async getRestorePoints(userId: number, limit: number = 30): Promise<RestorePoint[]> {
    // Query for full-state operations only
    const ops = await prisma.operation.findMany({
      where: {
        userId,
        opType: {
          in: ['SYNC_IMPORT', 'BACKUP_IMPORT', 'REPAIR'],
        },
      },
      orderBy: {
        serverSeq: 'desc',
      },
      take: limit,
      select: {
        serverSeq: true,
        clientId: true,
        opType: true,
        clientTimestamp: true,
      },
    });

    return ops.map((op) => ({
      serverSeq: op.serverSeq,
      timestamp: Number(op.clientTimestamp),
      type: op.opType as 'SYNC_IMPORT' | 'BACKUP_IMPORT' | 'REPAIR',
      clientId: op.clientId,
      description: this._getRestorePointDescription(
        op.opType as 'SYNC_IMPORT' | 'BACKUP_IMPORT' | 'REPAIR',
      ),
    }));
  }

  private _getRestorePointDescription(
    opType: 'SYNC_IMPORT' | 'BACKUP_IMPORT' | 'REPAIR',
  ): string {
    switch (opType) {
      case 'SYNC_IMPORT':
        return 'Full sync import';
      case 'BACKUP_IMPORT':
        return 'Backup restore';
      case 'REPAIR':
        return 'Auto-repair';
      default:
        return 'State snapshot';
    }
  }

  /**
   * Generate a snapshot at a specific serverSeq.
   * Replays operations from the beginning (or cached snapshot) up to targetSeq.
   */
  async generateSnapshotAtSeq(
    userId: number,
    targetSeq: number,
  ): Promise<{
    state: unknown;
    serverSeq: number;
    generatedAt: number;
  }> {
    return prisma.$transaction(
      async (tx) => {
        // Verify targetSeq is valid
        const maxSeqRow = await tx.userSyncState.findUnique({
          where: { userId },
          select: { lastSeq: true },
        });
        const maxSeq = maxSeqRow?.lastSeq ?? 0;

        if (targetSeq > maxSeq) {
          throw new Error(
            `Target sequence ${targetSeq} exceeds latest sequence ${maxSeq}`,
          );
        }

        if (targetSeq < 1) {
          throw new Error('Target sequence must be at least 1');
        }

        let state: Record<string, unknown> = {};
        let startSeq = 0;

        // Try to use cached snapshot as base if it's before targetSeq
        const cachedRow = await tx.userSyncState.findUnique({
          where: { userId },
          select: {
            snapshotData: true,
            lastSnapshotSeq: true,
            snapshotSchemaVersion: true,
          },
        });

        if (
          cachedRow?.snapshotData &&
          cachedRow.lastSnapshotSeq &&
          cachedRow.lastSnapshotSeq <= targetSeq
        ) {
          try {
            const decompressed = (
              await gunzipAsync(cachedRow.snapshotData, {
                maxOutputLength: MAX_SNAPSHOT_DECOMPRESSED_BYTES,
              })
            ).toString('utf-8');
            state = JSON.parse(decompressed) as Record<string, unknown>;
            startSeq = cachedRow.lastSnapshotSeq;

            // Migrate if needed
            const snapshotSchemaVersion = cachedRow.snapshotSchemaVersion ?? 1;
            if (stateNeedsMigration(snapshotSchemaVersion, CURRENT_SCHEMA_VERSION)) {
              const migrationResult = migrateState(
                state,
                snapshotSchemaVersion,
                CURRENT_SCHEMA_VERSION,
              );
              if (migrationResult.success) {
                state = migrationResult.data as Record<string, unknown>;
              }
            }
          } catch (err) {
            // Ignore corrupted cache, start from scratch
            Logger.warn(
              `[user:${userId}] Failed to use cached snapshot: ${(err as Error).message}`,
            );
          }
        }

        await this._assertCachedSnapshotBaseReplayable(tx, userId, startSeq);

        const totalOpsToProcess = targetSeq - startSeq;
        if (totalOpsToProcess > MAX_OPS_FOR_SNAPSHOT) {
          throw new Error(
            `Too many operations to process (${totalOpsToProcess}). ` +
              `Max: ${MAX_OPS_FOR_SNAPSHOT}.`,
          );
        }

        await this._assertNoEncryptedOps(tx, userId, startSeq, targetSeq);

        // Replay ops from startSeq to targetSeq
        const BATCH_SIZE = 10000;
        let currentSeq = startSeq;

        while (currentSeq < targetSeq) {
          const batchOps = await tx.operation.findMany({
            where: {
              userId,
              // Historical restore points replay only up to the requested sequence.
              serverSeq: { gt: currentSeq, lte: targetSeq },
            },
            orderBy: { serverSeq: 'asc' },
            take: BATCH_SIZE,
            select: REPLAY_OPERATION_SELECT,
          });

          const expectedFirstSeq = this._resolveExpectedFirstSeq(
            batchOps,
            currentSeq,
            startSeq,
            targetSeq,
          );
          assertContiguousReplayBatch(batchOps, expectedFirstSeq, targetSeq);

          state = this.replayOpsToState(batchOps, state);
          currentSeq = batchOps[batchOps.length - 1].serverSeq;
        }

        return {
          state,
          serverSeq: targetSeq,
          generatedAt: Date.now(),
        };
      },
      {
        timeout: 60000, // Snapshot generation can take time
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      },
    );
  }

  /**
   * Replay operations to build state.
   * Used internally by snapshot generation methods.
   */
  replayOpsToState(
    ops: ReplayOperationRow[],
    initialState: Record<string, unknown> = {},
  ): Record<string, unknown> {
    const state = { ...(initialState as Record<string, Record<string, unknown>>) };

    for (let i = 0; i < ops.length; i++) {
      const row = ops[i];

      // Server cannot decrypt E2E payloads. Snapshot callers reject encrypted
      // ranges upfront; this guard prevents accidental partial replays.
      if (row.isPayloadEncrypted) {
        throw new EncryptedOpsNotSupportedError(1);
      }

      // Periodically check state size to prevent memory exhaustion.
      // Measure in UTF-8 bytes (Buffer.byteLength) so the limit matches the
      // constant's documented unit — JSON.stringify(state).length counts
      // UTF-16 code units, which under-counts up to 4x for non-ASCII content.
      if (i > 0 && i % REPLAY_SIZE_CHECK_INTERVAL === 0) {
        const estimatedSize = Buffer.byteLength(JSON.stringify(state), 'utf8');
        if (estimatedSize > MAX_REPLAY_STATE_SIZE_BYTES) {
          throw new Error(
            `State too large during replay: ${Math.round(estimatedSize / 1024 / 1024)}MB ` +
              `(max: ${Math.round(MAX_REPLAY_STATE_SIZE_BYTES / 1024 / 1024)}MB)`,
          );
        }
      }

      let opType = row.opType as Operation['opType'];
      let entityType = row.entityType;
      let entityId = row.entityId;
      let payload = row.payload;

      const opSchemaVersion = row.schemaVersion ?? 1;

      // Prepare list of operations to process (may be expanded by migration)
      let opsToProcess: Array<{
        opType: string;
        entityType: string;
        entityId: string | null;
        payload: unknown;
      }> = [{ opType, entityType, entityId, payload }];

      if (opSchemaVersion < CURRENT_SCHEMA_VERSION) {
        const opLike: OperationLike = {
          id: row.id,
          opType,
          entityType,
          entityId: entityId ?? undefined,
          payload,
          schemaVersion: opSchemaVersion,
        };

        const migrationResult = migrateOperation(opLike, CURRENT_SCHEMA_VERSION);
        if (!migrationResult.success) {
          continue;
        }
        const migratedOp = migrationResult.data;
        if (!migratedOp) continue;

        // Handle array result (operation was split into multiple)
        if (Array.isArray(migratedOp)) {
          opsToProcess = migratedOp.map((op) => ({
            opType: op.opType,
            entityType: op.entityType,
            entityId: op.entityId ?? null,
            payload: op.payload,
          }));
        } else {
          opsToProcess = [
            {
              opType: migratedOp.opType,
              entityType: migratedOp.entityType,
              entityId: migratedOp.entityId ?? null,
              payload: migratedOp.payload,
            },
          ];
        }
      }

      // Process all operations (original or migrated)
      for (const opToProcess of opsToProcess) {
        const {
          opType: processOpType,
          entityType: processEntityType,
          entityId: processEntityId,
          payload: processPayload,
        } = opToProcess;

        // Handle full-state operations BEFORE entity type check.
        // These operations REPLACE the entire state (they represent a complete
        // snapshot of the app), so we must clear existing keys first —
        // otherwise stale entity types from a prior state survive a "reset"
        // and `_resolveExpectedFirstSeq`'s leading-gap acceptance becomes
        // incorrect (the gap is only safe if the full-state op truly resets).
        if (
          processOpType === 'SYNC_IMPORT' ||
          processOpType === 'BACKUP_IMPORT' ||
          processOpType === 'REPAIR'
        ) {
          const fullState =
            processPayload &&
            typeof processPayload === 'object' &&
            'appDataComplete' in processPayload
              ? (processPayload as { appDataComplete: unknown }).appDataComplete
              : processPayload;
          // A malformed full-state op (null/primitive payload) would silently
          // wipe state if we cleared first. Refuse to replay it — a corrupt
          // SYNC_IMPORT is invariant-breaking, not a no-op.
          if (!fullState || typeof fullState !== 'object') {
            throw new Error(
              `SNAPSHOT_REPLAY_INCOMPLETE: ${processOpType} op ${row.id} has non-object payload`,
            );
          }
          for (const key of Object.keys(state)) {
            delete state[key];
          }
          // Copy key-by-key (not Object.assign) so a malicious `__proto__`
          // key in the client-uploaded payload cannot pollute Object's
          // prototype via the `__proto__` setter. JSON.parse creates
          // `__proto__` as an own data property (no setter), but
          // Object.assign would then `state['__proto__'] = …`, which DOES
          // trigger the setter and pollute the prototype chain.
          const fullStateRecord = fullState as Record<string, unknown>;
          for (const key of Object.keys(fullStateRecord)) {
            if (isUnsafeEntityKey(key)) continue;
            state[key] = fullStateRecord[key] as Record<string, unknown>;
          }
          continue;
        }

        if (!ALLOWED_ENTITY_TYPES.has(processEntityType)) continue;

        if (!state[processEntityType]) {
          state[processEntityType] = {};
        }

        // Client-supplied id used as a property key. Bracket-assignment of
        // `__proto__` (or `constructor`/`prototype`) invokes the
        // `Object.prototype.__proto__` setter, which would swap the prototype
        // of the entity map and let malicious payload keys leak via the
        // prototype chain. Skip these keys entirely.
        if (processEntityId && isUnsafeEntityKey(processEntityId)) {
          continue;
        }
        switch (processOpType) {
          case 'CRT':
          case 'UPD':
            if (processEntityId) {
              state[processEntityType][processEntityId] = {
                ...(state[processEntityType][processEntityId] as Record<string, unknown>),
                ...(processPayload as Record<string, unknown>),
              };
            }
            break;
          case 'DEL':
            if (processEntityId) {
              delete state[processEntityType][processEntityId];
            }
            break;
          case 'MOV':
            if (processEntityId && processPayload) {
              state[processEntityType][processEntityId] = {
                ...(state[processEntityType][processEntityId] as Record<string, unknown>),
                ...(processPayload as Record<string, unknown>),
              };
            }
            break;
          case 'BATCH':
            if (processPayload && typeof processPayload === 'object') {
              const batchPayload = processPayload as Record<string, unknown>;
              if (batchPayload.entities && typeof batchPayload.entities === 'object') {
                const entities = batchPayload.entities as Record<string, unknown>;
                for (const [id, entity] of Object.entries(entities)) {
                  // Same prototype-pollution guard as the per-op entityId
                  // check: JSON.parse can produce `__proto__` as an own data
                  // property of `entities`, and `state[type][id] = …` with
                  // that id would trigger the setter.
                  if (isUnsafeEntityKey(id)) continue;
                  state[processEntityType][id] = {
                    ...(state[processEntityType][id] as Record<string, unknown>),
                    ...(entity as Record<string, unknown>),
                  };
                }
              } else if (processEntityId) {
                state[processEntityType][processEntityId] = {
                  ...(state[processEntityType][processEntityId] as Record<
                    string,
                    unknown
                  >),
                  ...batchPayload,
                };
              }
            }
            break;
        }
      }
    }
    return state;
  }

  private async _assertNoEncryptedOps(
    tx: Prisma.TransactionClient,
    userId: number,
    startSeq: number,
    targetSeq: number,
  ): Promise<void> {
    if (startSeq >= targetSeq) return;

    const encryptedOpCount = await tx.operation.count({
      where: {
        userId,
        serverSeq: { gt: startSeq, lte: targetSeq },
        isPayloadEncrypted: true,
      },
    });

    if (encryptedOpCount > 0) {
      throw new EncryptedOpsNotSupportedError(encryptedOpCount);
    }
  }

  private async _assertCachedSnapshotBaseReplayable(
    tx: Prisma.TransactionClient,
    userId: number,
    startSeq: number,
  ): Promise<void> {
    if (startSeq <= 0) return;

    const latestUnencryptedFullStateOp = await tx.operation.findFirst({
      where: {
        userId,
        serverSeq: { lte: startSeq },
        opType: { in: ['SYNC_IMPORT', 'BACKUP_IMPORT', 'REPAIR'] },
        isPayloadEncrypted: false,
      },
      orderBy: { serverSeq: 'desc' },
      select: { serverSeq: true },
    });

    const encryptedOpCount = await tx.operation.count({
      where: {
        userId,
        serverSeq: {
          gt: latestUnencryptedFullStateOp?.serverSeq ?? 0,
          lte: startSeq,
        },
        isPayloadEncrypted: true,
      },
    });

    if (encryptedOpCount > 0) {
      throw new EncryptedOpsNotSupportedError(encryptedOpCount);
    }
  }

  /**
   * Decide where contiguity checking should start for the current batch.
   *
   * The replay base may sit below the lowest op that physically exists, e.g.:
   *   - After a clean-slate upload (`sync.service.ts` preserves `lastSeq` but deletes ops).
   *   - After retention pruning (`deleteOldestRestorePointAndOps`) trimmed older ops.
   * In both cases the surviving lowest-seq op is guaranteed to be a full-state op
   * (SYNC_IMPORT / BACKUP_IMPORT / REPAIR) that resets state during replay. Accept
   * this leading gap only on the first batch and only when that invariant holds;
   * mid-stream gaps still indicate corruption and must throw.
   */
  private _resolveExpectedFirstSeq(
    batchOps: ReplayOperationRow[],
    currentSeq: number,
    startSeq: number,
    targetSeq: number,
  ): number {
    if (currentSeq !== startSeq || batchOps.length === 0) {
      return currentSeq + 1;
    }
    const firstOp = batchOps[0];
    if (firstOp.serverSeq <= currentSeq + 1) {
      return currentSeq + 1;
    }
    const isFullStateOp =
      firstOp.opType === 'SYNC_IMPORT' ||
      firstOp.opType === 'BACKUP_IMPORT' ||
      firstOp.opType === 'REPAIR';
    if (!isFullStateOp) {
      throw new Error(
        `SNAPSHOT_REPLAY_INCOMPLETE: Expected operation serverSeq ${currentSeq + 1} but got ${firstOp.serverSeq} while replaying to ${targetSeq}`,
      );
    }
    return firstOp.serverSeq;
  }
}
