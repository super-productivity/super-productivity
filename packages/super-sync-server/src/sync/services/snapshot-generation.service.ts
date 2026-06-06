import { Prisma } from '@prisma/client';
import {
  CURRENT_SCHEMA_VERSION,
  migrateState,
  stateNeedsMigration,
} from '@sp/shared-schema';
import { prisma } from '../../db';
import { Logger } from '../../logger';
import { gunzipAsync, gzipAsync } from '../gzip';
import type { SnapshotResult } from '../sync.types';
import {
  _resolveExpectedFirstSeq,
  assertContiguousReplayBatch,
  EncryptedOpsNotSupportedError,
  replayOpsToState,
} from '../op-replay';

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
export const MAX_SNAPSHOT_DECOMPRESSED_BYTES = 100 * 1024 * 1024;

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

export class SnapshotGenerationService {
  /**
   * Internal implementation of snapshot generation.
   * Called only when no concurrent generation is in progress.
   *
   * If the cache was rewritten the byte delta is captured in `cacheDelta` and
   * applied AFTER the transaction commits via the optional `onCacheDelta`
   * callback. This keeps the slow counter update out of the snapshot
   * transaction window while letting storage accounting self-heal.
   */
  async generateSnapshot(
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
          const expectedFirstSeq = _resolveExpectedFirstSeq(
            batchOps,
            currentSeq,
            startSeq,
            latestSeq,
          );
          assertContiguousReplayBatch(batchOps, expectedFirstSeq, latestSeq);

          // Replay ops
          state = replayOpsToState(batchOps, state);

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

          const expectedFirstSeq = _resolveExpectedFirstSeq(
            batchOps,
            currentSeq,
            startSeq,
            targetSeq,
          );
          assertContiguousReplayBatch(batchOps, expectedFirstSeq, targetSeq);

          state = replayOpsToState(batchOps, state);
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
}
