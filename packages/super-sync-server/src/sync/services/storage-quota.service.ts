/**
 * StorageQuotaService - Handles storage quota calculations and checks
 *
 * Extracted from SyncService for better separation of concerns.
 * This service handles storage usage tracking and quota enforcement.
 *
 * Note: Complex cleanup/freeing operations remain in SyncService as they
 * orchestrate multiple operations including deleting restore points.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { prisma } from '../../db';

/**
 * Default storage quota per user in bytes (100MB).
 */
const DEFAULT_STORAGE_QUOTA_BYTES = 100 * 1024 * 1024;

export class StorageQuotaService {
  /**
   * Per-user in-process mutex for storage usage mutation windows.
   *
   * This service is documented as single-instance. Within that constraint, the
   * mutex prevents exact reconciles from racing with the two-phase upload path
   * (persist operation, then update the advisory counter). Without this, a slow
   * reconcile can overwrite or double-count concurrent upload deltas.
   */
  private storageUsageLocks: Map<number, Promise<void>> = new Map();
  private storageUsageLockContext = new AsyncLocalStorage<Set<number>>();

  /**
   * Per-user in-flight reconcile promises. When multiple concurrent requests
   * for the same user hit the quota cache-miss path, only the first triggers
   * the slow SUM(pg_column_size) scan; the rest await the same promise. Cap
   * the number of duplicate full-table scans under a retry storm. Sequential
   * calls are unaffected (entry is deleted in `finally` before resolve).
   */
  private inflightReconciles: Map<number, Promise<void>> = new Map();

  /**
   * Per-user "exact reconcile required" markers. Set when a post-write counter
   * delta fails to persist (counter is now stale-low). The next quota check
   * for that user forces a `updateStorageUsage` scan before answering so the
   * drift self-heals instead of waiting for daily cleanup.
   */
  private forcedReconciles: Set<number> = new Set();

  async runWithStorageUsageLock<T>(userId: number, fn: () => Promise<T>): Promise<T> {
    const activeLocks = this.storageUsageLockContext.getStore();
    if (activeLocks?.has(userId)) {
      return fn();
    }

    const previous = this.storageUsageLocks.get(userId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.catch(() => undefined).then(() => current);
    this.storageUsageLocks.set(userId, queued);

    await previous.catch(() => undefined);

    const nextLocks = new Set(activeLocks ?? []);
    nextLocks.add(userId);

    try {
      return await this.storageUsageLockContext.run(nextLocks, fn);
    } finally {
      release();
      if (this.storageUsageLocks.get(userId) === queued) {
        this.storageUsageLocks.delete(userId);
      }
    }
  }

  /**
   * Calculate actual storage usage for a user by summing on-disk payload sizes.
   *
   * SLOW PATH — DO NOT CALL PER REQUEST. SUM(pg_column_size(payload)) forces
   * PostgreSQL to detoast every payload for the user (TOAST table reads),
   * which on active users takes minutes and saturates disk I/O. Reserved for:
   *   1. Quota-cache reconciliation, run at most once per quota-cleanup event
   *      (rare per user) — see SyncService.freeStorageForUpload.
   *   2. Offline / admin reconciliation scripts.
   * Hot-path tracking uses incrementStorageUsage / decrementStorageUsage with
   * deltas computed locally on the Node side.
   *
   * KNOWN BYTE-COUNTING MISMATCH (tracked for follow-up):
   * `pg_column_size` returns the TOAST-compressed on-disk size, while the
   * hot-path delta (sync.routes.ts `computeOpsStorageBytes`) uses
   * `Buffer.byteLength(JSON.stringify(...))` — the uncompressed UTF-8 length.
   * For large compressible JSONB payloads (~2KB+) the compressed size can be
   * substantially smaller, so a reconcile can shrink a counter that was
   * incremented with the larger uncompressed numbers, making the quota
   * artificially generous after each reconcile.
   *
   * A no-DoS fix is to add a `payload_bytes` column populated at insert time
   * with the uncompressed length and SUM that column here. That is a schema
   * migration and is outside the scope of this service-only file; switching
   * to `octet_length(payload::text)` in-place would re-detoast every row and
   * resurrect the original disk-I/O DoS that pg_column_size also caused (see
   * sync.const.ts `APPROX_BYTES_PER_OP`).
   */
  async calculateStorageUsage(userId: number): Promise<{
    operationsBytes: number;
    snapshotBytes: number;
    totalBytes: number;
  }> {
    const opsResult = await prisma.$queryRaw<[{ total: bigint | null }]>`
      SELECT COALESCE(SUM(pg_column_size(payload) + pg_column_size(vector_clock)), 0) as total
      FROM operations WHERE user_id = ${userId}
    `;

    const snapshotResult = await prisma.userSyncState.findUnique({
      where: { userId },
      select: { snapshotData: true },
    });

    const operationsBytes = Number(opsResult[0]?.total ?? 0);
    const snapshotBytes = snapshotResult?.snapshotData?.length ?? 0;
    const totalBytes = operationsBytes + snapshotBytes;

    return {
      operationsBytes,
      snapshotBytes,
      totalBytes,
    };
  }

  /**
   * Atomically add `deltaBytes` to the cached storage usage. Called on every
   * accepted upload with a locally-computed payload size. No table scan.
   * Rejects non-finite / non-positive inputs so `BigInt(...)` never throws.
   */
  async incrementStorageUsage(userId: number, deltaBytes: number): Promise<void> {
    return this.runWithStorageUsageLock(userId, () =>
      this.incrementStorageUsageUnlocked(userId, deltaBytes),
    );
  }

  private async incrementStorageUsageUnlocked(
    userId: number,
    deltaBytes: number,
  ): Promise<void> {
    if (!Number.isFinite(deltaBytes) || deltaBytes <= 0) return;
    const delta = BigInt(Math.floor(deltaBytes));
    await prisma.user.update({
      where: { id: userId },
      data: { storageUsedBytes: { increment: delta } },
    });
  }

  /**
   * Atomically subtract `deltaBytes` from the cached storage usage, clamped to
   * zero. Uses $executeRaw for the GREATEST(...) clamp — Prisma's `decrement`
   * has no underflow guard and the counter is approximate (advisory quota), so
   * the floor protects against negative drift from rough estimates.
   */
  async decrementStorageUsage(userId: number, deltaBytes: number): Promise<void> {
    return this.runWithStorageUsageLock(userId, () =>
      this.decrementStorageUsageUnlocked(userId, deltaBytes),
    );
  }

  private async decrementStorageUsageUnlocked(
    userId: number,
    deltaBytes: number,
  ): Promise<void> {
    if (!Number.isFinite(deltaBytes) || deltaBytes <= 0) return;
    const delta = BigInt(Math.floor(deltaBytes));
    await prisma.$executeRaw`
      UPDATE users
      SET storage_used_bytes = GREATEST(storage_used_bytes - ${delta}::bigint, 0::bigint)
      WHERE id = ${userId}
    `;
  }

  /**
   * Check if a user has quota available for additional storage.
   * Uses cached storageUsedBytes for performance. If the user has a forced
   * reconcile marker (counter known stale), runs `updateStorageUsage` first
   * so the answer is based on truth rather than drift.
   */
  async checkStorageQuota(
    userId: number,
    additionalBytes: number,
  ): Promise<{ allowed: boolean; currentUsage: number; quota: number }> {
    if (this.forcedReconciles.has(userId)) {
      try {
        await this.updateStorageUsage(userId);
      } catch {
        // Fall through to the (still drifted) cached read; better to answer
        // optimistically than to fail the request.
      }
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { storageQuotaBytes: true, storageUsedBytes: true },
    });

    const quota = Number(user?.storageQuotaBytes ?? DEFAULT_STORAGE_QUOTA_BYTES);
    const currentUsage = Number(user?.storageUsedBytes ?? 0);

    return {
      allowed: currentUsage + additionalBytes <= quota,
      currentUsage,
      quota,
    };
  }

  /**
   * Recompute the cached storage usage from scratch via calculateStorageUsage.
   * Same slow-path warning applies — see calculateStorageUsage.
   *
   * Concurrent calls for the same user dedupe to a single in-flight scan; see
   * `inflightReconciles`. Sequential callers (e.g. the cleanup loop inside
   * `freeStorageForUpload`) still get fresh results because the lock is
   * cleared in `finally` before the awaiter resolves.
   */
  async updateStorageUsage(userId: number): Promise<void> {
    // If we already hold the per-user lock (reentrant call from inside a
    // request that took the lock), skip the inflightReconciles dedupe map.
    // Otherwise we could await a promise registered by a non-reentrant caller
    // that is itself queued behind our own lock → deadlock.
    const inLock = this.storageUsageLockContext.getStore()?.has(userId);
    if (inLock) {
      const { totalBytes } = await this.calculateStorageUsage(userId);
      await prisma.user.update({
        where: { id: userId },
        data: { storageUsedBytes: BigInt(totalBytes) },
      });
      this.forcedReconciles.delete(userId);
      return;
    }

    const existing = this.inflightReconciles.get(userId);
    if (existing) return existing;

    const promise = this.runWithStorageUsageLock(userId, async () => {
      const { totalBytes } = await this.calculateStorageUsage(userId);
      await prisma.user.update({
        where: { id: userId },
        data: { storageUsedBytes: BigInt(totalBytes) },
      });
      this.forcedReconciles.delete(userId);
    });
    this.inflightReconciles.set(userId, promise);
    try {
      return await promise;
    } finally {
      if (this.inflightReconciles.get(userId) === promise) {
        this.inflightReconciles.delete(userId);
      }
    }
  }

  /**
   * Mark a user as needing an exact reconcile before their next quota check.
   * Called when a post-write counter delta fails to persist (silent drift).
   */
  markNeedsReconcile(userId: number): void {
    this.forcedReconciles.add(userId);
  }

  /**
   * Whether the user has a pending forced reconcile (set by markNeedsReconcile,
   * cleared by a successful `updateStorageUsage`).
   */
  needsReconcile(userId: number): boolean {
    return this.forcedReconciles.has(userId);
  }

  /**
   * Clear per-user in-memory state. Call when user data is wiped (clean-slate,
   * account deletion) so stale references do not leak or trigger spurious work:
   *   - `inflightReconciles`: a stale rejected promise would block future
   *     reconciles via the dedupe map.
   *   - `forcedReconciles`: a stale marker would force an unnecessary scan on
   *     the next quota check after the wipe.
   * Do NOT delete `storageUsageLocks[userId]` here: the chain is identity-
   * guarded and self-deletes on drain (see `runWithStorageUsageLock`'s
   * `finally`). Removing the head while a follower is queued behind it would
   * let a fresh caller see no `previous` and start a concurrent chain that
   * races the in-flight one on the counter.
   * `storageUsageLockContext` is per-async-context (AsyncLocalStorage), not
   * per-user state — nothing to clear there.
   */
  clearForUser(userId: number): void {
    this.inflightReconciles.delete(userId);
    this.forcedReconciles.delete(userId);
  }

  /**
   * Get storage quota and usage for a user.
   * Used by status endpoint.
   */
  async getStorageInfo(userId: number): Promise<{
    storageUsedBytes: number;
    storageQuotaBytes: number;
  }> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { storageQuotaBytes: true, storageUsedBytes: true },
    });

    return {
      storageUsedBytes: Number(user?.storageUsedBytes ?? 0),
      storageQuotaBytes: Number(user?.storageQuotaBytes ?? DEFAULT_STORAGE_QUOTA_BYTES),
    };
  }
}
