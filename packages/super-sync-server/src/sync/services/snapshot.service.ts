/**
 * SnapshotService - Handles snapshot generation and restore points
 *
 * Extracted from SyncService for better separation of concerns.
 * This service handles snapshot caching, generation, and restore points.
 *
 * CRITICAL: FIX 1.7 - Uses in-memory locks to prevent concurrent snapshot
 * generation for the same user. This prevents duplicate expensive computation.
 */
import { CURRENT_SCHEMA_VERSION } from '@sp/shared-schema';
import { prisma } from '../../db';
import { Logger } from '../../logger';
import { gunzipAsync, gzipAsync } from '../gzip';
import type { SnapshotResult } from '../sync.types';
import {
  MAX_SNAPSHOT_DECOMPRESSED_BYTES,
  MAX_SNAPSHOT_SIZE_BYTES,
  SnapshotGenerationService,
} from './snapshot-generation.service';

export { EncryptedOpsNotSupportedError } from '../op-replay';
export { MAX_SNAPSHOT_SIZE_BYTES } from './snapshot-generation.service';
export type { SnapshotResult };

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
  private snapshotGenerationService = new SnapshotGenerationService();

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
   * Return cached snapshot timestamp without loading the snapshot blob.
   * Status polling only needs snapshot age; reading, gunzipping, and parsing
   * snapshotData there can turn a cheap endpoint into a large CPU/memory hit.
   */
  async getCachedSnapshotGeneratedAt(userId: number): Promise<number | null> {
    const row = await prisma.userSyncState.findUnique({
      where: { userId },
      select: { snapshotAt: true },
    });

    return row?.snapshotAt != null ? Number(row.snapshotAt) : null;
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
    const promise = this.snapshotGenerationService.generateSnapshot(
      userId,
      onCacheDelta,
      maxCacheBytes,
    );
    this.snapshotGenerationLocks.set(userId, promise);

    try {
      return await promise;
    } finally {
      // Clean up lock when done (whether success or failure)
      this.snapshotGenerationLocks.delete(userId);
    }
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
    return this.snapshotGenerationService.generateSnapshotAtSeq(userId, targetSeq);
  }
}
