/**
 * StorageQuotaService - Handles storage quota calculations and checks
 *
 * Extracted from SyncService for better separation of concerns.
 * This service handles storage usage tracking and quota enforcement.
 *
 * Cleanup/freeing operations live here because they mutate quota accounting
 * and reconcile the cached storage counter.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { prisma } from '../../db';
import { Logger } from '../../logger';
import { parsePositiveIntegerEnv } from '../../util/env';
import { APPROX_BYTES_PER_OP } from '../sync.const';
import {
  agedPrefixCausalFullStateSql,
  CAUSAL_FULL_STATE_OPERATION_WHERE,
} from '../sync.types';

/**
 * Default storage quota per user in bytes (100MB).
 */
const DEFAULT_STORAGE_QUOTA_BYTES = 100 * 1024 * 1024;

/**
 * Quota applied to accounts created from now on, overridable per deployment.
 *
 * A self-hoster running this on their own disk has no reason to inherit our hosted
 * service's 100 MB budget, and until this existed the only way to change it was an
 * `UPDATE users SET storage_quota_bytes` against Postgres. This sets what NEW rows get;
 * existing accounts keep the value already stored on their row, so raising it does not
 * retroactively widen anyone's quota. The column is NOT NULL (schema.prisma), so the `??`
 * fallbacks at the read sites fire only when the user row itself is missing.
 */
export const getDefaultStorageQuotaBytes = (): number =>
  parsePositiveIntegerEnv(
    'SUPERSYNC_DEFAULT_STORAGE_QUOTA_BYTES',
    DEFAULT_STORAGE_QUOTA_BYTES,
  );
// serverSeq WINDOW WIDTH per DELETE statement, which also caps the rows it can
// delete (server_seq is unique per user) — see deleteOldSyncedOpsBatch.
const OLD_OPS_CLEANUP_DELETE_BATCH_SIZE = 5_000;
const OLD_OPS_CLEANUP_MAX_DELETED_PER_RUN = 25_000;
// Operator-DoS guardrail: the window width caps the index entries one DELETE
// statement can touch — exactly the bound that keeps a statement inside the
// 60s statement_timeout. Cap so misconfiguration can't unwind it.
const OLD_OPS_CLEANUP_DELETE_BATCH_SIZE_MAX = 50_000;
const OLD_OPS_CLEANUP_MAX_DELETED_PER_RUN_MAX = 1_000_000;
/**
 * Consecutive per-candidate failures that end a sweep. Per-user containment must not turn a
 * SYSTEMIC fault into a fleet-long run of statement_timeouts (see the loop for why).
 */
const MAX_CONSECUTIVE_CANDIDATE_FAILURES = 10;

const getOldOpsCleanupDeleteBatchSize = (): number =>
  parsePositiveIntegerEnv(
    'OLD_OPS_CLEANUP_DELETE_BATCH_SIZE',
    OLD_OPS_CLEANUP_DELETE_BATCH_SIZE,
    OLD_OPS_CLEANUP_DELETE_BATCH_SIZE_MAX,
  );

/**
 * `0` disables the old-ops sweep entirely — the operator brake.
 *
 * This deletion is irreversible (hard DELETE, no tombstone) and runs by
 * default 10s after boot, so an operator who sees the dry-run gate's numbers
 * and does not like them needs a way to stop it that does not involve patching
 * the image. `parsePositiveIntegerEnv` rejects 0 and falls back to the default,
 * which would silently mean "25 000" — the opposite of the intent — so the
 * disable case is decoded before delegating. Reuses this knob rather than
 * adding a second setting: "delete at most 0 rows per run" already reads as off.
 */
const getOldOpsCleanupMaxDeletedPerRun = (): number =>
  process.env.OLD_OPS_CLEANUP_MAX_DELETED_PER_RUN?.trim() === '0'
    ? 0
    : parsePositiveIntegerEnv(
        'OLD_OPS_CLEANUP_MAX_DELETED_PER_RUN',
        OLD_OPS_CLEANUP_MAX_DELETED_PER_RUN,
        OLD_OPS_CLEANUP_MAX_DELETED_PER_RUN_MAX,
      );

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
   * the exact SUM(payload_bytes) reconcile; the rest await the same promise.
   * Sequential calls are unaffected (entry is deleted in `finally` before resolve).
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
   * Calculate actual storage usage for a user by summing the write-time byte
   * counters on operation rows plus the cached snapshot blob length.
   *
   * SLOW PATH — DO NOT CALL PER REQUEST. Even without detoasting JSONB payloads,
   * this still scans one user's operation rows and is reserved for:
   *   1. Quota-cache reconciliation, run at most once per quota-cleanup event
   *      (rare per user) — see SyncService.freeStorageForUpload.
   *   2. Offline / admin reconciliation scripts.
   * Hot-path tracking uses incrementStorageUsage / decrementStorageUsage with
   * deltas computed locally on the Node side.
   *
   * Rows with payload_bytes=0 are pre-backfill rows. They must not be counted
   * as zero bytes: that would let a reconcile lower the cached counter below
   * actual usage. The CASE WHEN fallback only touches unbackfilled rows, so
   * once the one-time backfill completes this remains a cheap SUM.
   *
   * `hasUnbackfilledRows` is computed in the same single scan via BOOL_OR.
   * Callers (notably `updateStorageUsage`) treat the SUM as approximate when
   * this flag is true, because the fallback's UTF-8 length differs by single
   * bytes from the JS-side `computeOpStorageBytes` value used by the hot-path
   * counter. Skipping the `users.storage_used_bytes` write while unbackfilled
   * rows exist preserves the exact incremental counter.
   */
  async calculateStorageUsage(userId: number): Promise<{
    operationsBytes: number;
    snapshotBytes: number;
    totalBytes: number;
    hasUnbackfilledRows: boolean;
  }> {
    const usageResult = await prisma.$queryRaw<
      [
        {
          operations_bytes: bigint | null;
          snapshot_bytes: number | bigint | null;
          has_unbackfilled?: boolean | null;
        },
      ]
    >`
      SELECT
        ops.operations_bytes,
        ops.has_unbackfilled,
        COALESCE(
          (
            SELECT octet_length(snapshot_data)
            FROM user_sync_state
            WHERE user_id = ${userId}
          ),
          0
        )::bigint AS snapshot_bytes
      FROM (
        SELECT
          COALESCE(
            SUM(
              CASE
                WHEN payload_bytes > 0 THEN payload_bytes
                ELSE octet_length(payload::text)::bigint +
                     octet_length(vector_clock::text)::bigint
              END
            ),
            0
          )::bigint AS operations_bytes,
          COALESCE(BOOL_OR(payload_bytes = 0), false) AS has_unbackfilled
        FROM operations
        WHERE user_id = ${userId}
      ) AS ops
    `;

    const operationsBytes = Number(usageResult[0]?.operations_bytes ?? 0);
    const snapshotBytes = Number(usageResult[0]?.snapshot_bytes ?? 0);
    const totalBytes = operationsBytes + snapshotBytes;
    const hasUnbackfilledRows = Boolean(usageResult[0]?.has_unbackfilled ?? false);

    return {
      operationsBytes,
      snapshotBytes,
      totalBytes,
      hasUnbackfilledRows,
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

    const quota = Number(user?.storageQuotaBytes ?? getDefaultStorageQuotaBytes());
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
      const { totalBytes, hasUnbackfilledRows } =
        await this.calculateStorageUsage(userId);
      if (hasUnbackfilledRows) {
        // Pre-backfill rows make the SUM approximate (CASE-WHEN fallback uses
        // postgres-side text length, not JS-side computeOpStorageBytes). Writing
        // an approximate value here would replace the exact incrementally
        // maintained counter — drift in either direction. Leave the forced
        // reconcile marker so a post-backfill call self-heals.
        Logger.warn(
          `[user:${userId}] Skipping storage usage reconcile: payload_bytes backfill incomplete for this user.`,
        );
        return;
      }
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
      const { totalBytes, hasUnbackfilledRows } =
        await this.calculateStorageUsage(userId);
      if (hasUnbackfilledRows) {
        Logger.warn(
          `[user:${userId}] Skipping storage usage reconcile: payload_bytes backfill incomplete for this user.`,
        );
        return;
      }
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

  async deleteOldSyncedOpsForAllUsers(
    cutoffTime: number,
  ): Promise<{ totalDeleted: number; affectedUserIds: number[] }> {
    // Checked before the fleet-wide groupBy below, so a disabled sweep costs
    // nothing rather than scanning `operations` and then deleting nothing.
    const deleteBudget = getOldOpsCleanupMaxDeletedPerRun();
    if (deleteBudget <= 0) {
      Logger.warn(
        'Cleanup [old-ops]: disabled via OLD_OPS_CLEANUP_MAX_DELETED_PER_RUN=0; ' +
          'no operations were pruned and old ops will accumulate until it is re-enabled.',
      );
      return { totalDeleted: 0, affectedUserIds: [] };
    }

    // Deletion is authorized by the newest CAUSAL full-state op in the user's
    // operation stream (SYNC_IMPORT / BACKUP_IMPORT / causal REPAIR) — the
    // same op the download path fast-forwards every client past
    // (operation-download.service.ts) and the op `_resolveExpectedFirstSeq`
    // accepts as a leading-gap replay base after pruning. No snapshot cursor
    // is required (#9688): under the mandatory-E2EE gate encrypted payloads
    // are never cached, so `lastSnapshotSeq` can no longer advance for anyone
    // — gating on it would exempt the entire fleet from retention forever.
    //
    // The `latestFullStateSeq` marker is deliberately NOT consulted: it is
    // stale for ~90% of users (no backfill in #8973) and could point at a
    // legacy REPAIR. The groupBy below computes the true causal maximum in
    // one query, so there is nothing to validate.
    //
    // `serverSeq: { gt: 1 }` skips users whose only boundary is the initial
    // import at seq 1 — nothing exists below it, so they can never authorize
    // a deletion (the stuck-snapshot cohort until a newer checkpoint lands).
    //
    // Fleet-wide, so it leans on the partial index
    // `operations_user_id_full_state_server_seq_idx` (raw migration — Prisma
    // has no partial-index syntax, see #9192). Databases provisioned with
    // `prisma db push` never got it and will seq-scan `operations` here.
    const boundaries = await prisma.operation.groupBy({
      by: ['userId'],
      where: {
        serverSeq: { gt: 1 },
        ...CAUSAL_FULL_STATE_OPERATION_WHERE,
      },
      _max: { serverSeq: true },
    });

    // Rows that still hold a cached snapshot BLOB — the only ones the cap
    // below applies to. Keyed on `snapshotData`, not on `lastSnapshotSeq`,
    // because `generateSnapshotAtSeq` uses the cached base only when the blob
    // is present (snapshot-generation.service.ts). Keying on the cursor would
    // keep capping rows whose blob is already gone: the E2EE eradication plan
    // nulls `snapshot_data` alone, so those users would stay exempt from
    // retention forever — the exact #9688 failure this change removes. Reading
    // this cohort (rather than an `IN` list of every candidate) also keeps the
    // read bounded and shrinking as eradication proceeds.
    const states = await prisma.userSyncState.findMany({
      where: { snapshotData: { not: null } },
      select: { userId: true, lastSnapshotSeq: true, snapshotAt: true },
    });
    const stateByUserId = new Map(states.map((s) => [s.userId, s]));

    // S1: deterministic order, so a run that exhausts its budget resumes from
    // a stable point instead of an arbitrary one. Cached-snapshot holders sort
    // by snapshotAt (stalest first); everyone else — under the mandatory-E2EE
    // gate that is the whole fleet, since encrypted payloads are never cached
    // — sorts to -1 and drains in userId order.
    const candidates = boundaries
      .map((b) => {
        const state = stateByUserId.get(b.userId);
        return {
          userId: b.userId,
          causalBoundarySeq: b._max.serverSeq ?? 0,
          snapshotCap: state?.lastSnapshotSeq ?? 0,
          staleness: Number(state?.snapshotAt ?? -1),
        };
      })
      .sort((a, b) => a.staleness - b.staleness || a.userId - b.userId);

    let totalDeleted = 0;
    const affectedUserIds: number[] = [];
    const deleteBatchSize = getOldOpsCleanupDeleteBatchSize();
    let remainingDeleteBudget = deleteBudget;
    let cappedUsersWithoutReplayBase = 0;
    // Every reason the sweep declines a candidate is counted and reported.
    // #9688 was exactly a fleet-wide exemption from retention that nobody
    // could see; a silent skip re-creates that blind spot in narrower form.
    // A fresh prefix is skipped only when no older causal checkpoint can
    // protect a wholly aged prefix either.
    let skippedFreshPrefix = 0;
    let skippedBoundaryAtOne = 0;
    let drainFailures = 0;
    let candidateFailures = 0;
    let consecutiveCandidateFailures = 0;

    for (const candidate of candidates) {
      if (remainingDeleteBudget <= 0) break;
      // Containment below turns one user's failure into a skip, which removes the only
      // thing that used to stop a SYSTEMIC failure: a dead pool or a fleet-wide cold cache
      // makes EVERY candidate fail, and a skipped candidate consumes no delete budget, so
      // the loop would run the whole fleet at up to a full statement_timeout each.
      // cleanup.ts schedules this on a bare setInterval with no re-entrancy guard, so a
      // sweep that outran 24h would overlap itself. Consecutive, not total: isolated bad
      // users must not abort a run that is otherwise making progress.
      if (consecutiveCandidateFailures >= MAX_CONSECUTIVE_CANDIDATE_FAILURES) {
        Logger.error(
          'Cleanup [old-ops]: abandoned the run after ' +
            `${MAX_CONSECUTIVE_CANDIDATE_FAILURES} consecutive candidate failures — ` +
            'this looks systemic (pool, cold cache, statement_timeout), not per-user.',
        );
        break;
      }

      let candidateFailed = false;
      try {
        // Snapshot AGE is deliberately not a gate (see #9670): safety comes from
        // the causal boundary plus the receivedAt cutoff, not snapshot recency.
        //
        // But while a cached-snapshot CURSOR exists (legacy plaintext cohort),
        // the boundary must not pass it: `generateSnapshotAtSeq` replays the
        // cached base forward through (lastSnapshotSeq, targetSeq], so pruning
        // above the cursor would break historical restore points that are still
        // servable. The cap resolves to the newest causal full-state op at or
        // below the cursor, and lifts once the E2EE eradication sweep clears
        // the cached snapshot fields.
        const { snapshotCap } = candidate;
        let protectedFromSeq = candidate.causalBoundarySeq;
        if (snapshotCap > 0 && protectedFromSeq > snapshotCap) {
          const cappedFullStateOp = await prisma.operation.findFirst({
            where: {
              userId: candidate.userId,
              serverSeq: { lte: snapshotCap },
              // Legacy REPAIR rows carry no causal base cursor, so they must
              // never authorize history pruning
              // (see CAUSAL_FULL_STATE_OPERATION_WHERE).
              ...CAUSAL_FULL_STATE_OPERATION_WHERE,
            },
            orderBy: { serverSeq: 'desc' },
            select: { serverSeq: true },
          });
          if (!cappedFullStateOp) {
            cappedUsersWithoutReplayBase++;
            continue;
          }
          protectedFromSeq = cappedFullStateOp.serverSeq;
        }

        if (protectedFromSeq <= 1) {
          skippedBoundaryAtOne++;
          continue;
        }

        // Prune the prefix whole, or not at all. Deletion filters on `receivedAt
        // < cutoffTime` as well as `serverSeq < protectedFromSeq`, so a prefix
        // holding one op newer than the cutoff would be pruned around it and
        // leave a plain delta as the lowest surviving row. Replay then breaks:
        // `_resolveExpectedFirstSeq` (op-replay.ts) tolerates a leading gap ONLY
        // when the lowest surviving op is a causal full-state op that resets
        // state — otherwise it throws SNAPSHOT_REPLAY_INCOMPLETE, which the
        // restore route surfaces as a 500. Try an older causal boundary before
        // skipping the user (#9962), so frequent checkpoints cannot strand an
        // older complete prefix. This sweep never NEWLY breaks the
        // invariant that path documents ("the surviving lowest-seq op is
        // guaranteed to be a full-state op"). Costs retention lag, never
        // over-deletion. Note the invariant is not globally true: quota
        // recovery's deleteOldestRestorePointAndOps deletes up to a restore
        // point and can leave a delta lowest — pre-existing, tracked separately.
        //
        // `orderBy: receivedAt` is load-bearing, not cosmetic. The predicate is a
        // 2D range (`server_seq <` AND `received_at >=`) and no index answers both
        // as search bounds, so one of them is always a filter and the planner is
        // free to pick which. Down `(user_id, server_seq)` a NO answer walks the
        // user's ENTIRE prefix — the deepest histories, which is precisely the
        // cohort this sweep exists to prune, so it fails worst where it matters
        // most and gets worse every day it fails.
        //
        // And the planner could not tell the two apart: MEASURED on PG 16 under
        // force_generic_plan (which is what Prisma's prepared statements get), the
        // two candidates cost BIT-IDENTICALLY — `0.29..32.17 rows=2` each — because
        // both are "equality on user_id plus one range at default selectivity", while
        // one touches 9 buffers and the other 60,329. A tie is settled by internals
        // no version promises to keep stable, so the same statement is instant on one
        // server and fatal on another. That coin flip, not a mis-costing, is the bug.
        //
        // Ordering by receivedAt does not pin the `(user_id, received_at)` path and is
        // not a hint; it removes the tie. That index already emits receivedAt order
        // under an equality qual on user_id, so it sorts for free AND keeps LIMIT-1
        // pushdown (16.23), while `(user_id, server_seq)` must add a blocking Sort and
        // lose the early exit (30.86) — a ~2x margin where there was none. Its NO
        // answer is then bounded by the user's ops inside the retention window: not
        // free — a heavy user's window is still thousands of rows, each costing a heap
        // fetch because server_seq is not in that index — but bounded by activity
        // rather than history depth, which is what makes it stop growing. The full fix
        // is a covering `(user_id, received_at, server_seq)` index (index-only scan,
        // ordering free); left out here because that is a migration on a multi-GB
        // table, not a code change.
        //
        // Guarded by tests/integration/old-ops-probe-plan.integration.spec.ts, which
        // measures all of the above against a real PostgreSQL. Mocked Prisma cannot
        // see any of it: delete this orderBy and every unit test still passes.
        //
        // The obvious O(log n) rewrite — take the newest op below the boundary and
        // compare its receivedAt — is REJECTED: it assumes receivedAt rises with
        // serverSeq, and concurrent uploads for one user can invert them. The
        // delete filters on receivedAt as well, so a missed fresh op would not be
        // deleted; it would be left as the lowest surviving row, a plain delta,
        // which is the SNAPSHOT_REPLAY_INCOMPLETE state this probe exists to
        // prevent. Exact semantics over a faster plan.
        const freshOpBelowBoundary = await prisma.operation.findFirst({
          where: {
            userId: candidate.userId,
            serverSeq: { lt: protectedFromSeq },
            receivedAt: { gte: BigInt(cutoffTime) },
          },
          orderBy: { receivedAt: 'asc' },
          select: { serverSeq: true },
        });
        if (freshOpBelowBoundary) {
          const [olderBoundary] = await prisma.$queryRaw<{ server_seq: number }[]>(
            agedPrefixCausalFullStateSql(
              candidate.userId,
              protectedFromSeq,
              BigInt(cutoffTime),
            ),
          );
          if (!olderBoundary) {
            skippedFreshPrefix++;
            continue;
          }
          protectedFromSeq = olderBoundary.server_seq;
        }

        // Drain this user to completion. The budget gates which users we
        // START, never where we stop inside one: windows advance ascending by
        // serverSeq, so cutting a user off mid-prefix deletes ops 1..k and
        // leaves a plain delta at k+1 as the lowest surviving row — the exact
        // state the fresh-op probe above rejects, and one that makes every
        // restore target 500 with SNAPSHOT_REPLAY_INCOMPLETE until a later run
        // finishes the prefix. Overshoot is bounded by one user's backlog and
        // costs a longer run; a truncated prefix costs that user their restore.
        //
        // The prefix is walked in STATED serverSeq windows of deleteBatchSize —
        // see deleteOldSyncedOpsBatch for why the range must be stated rather
        // than discovered. An empty window proves nothing about the rest of the
        // prefix (already pruned, or emptied concurrently by quota recovery),
        // so the walk always runs to the boundary; a window over an already
        // pruned range costs a few index pages.
        //
        // One user's DB error must not cost the rest of the fleet a day of
        // retention, so the drain is scoped: log, count, move to the next user.
        // A throw mid-drain still leaves that user's prefix truncated — the
        // windows are separate committed statements, not one transaction — and
        // the next run repairs it, since the surviving prefix ops are still
        // older than the (by then later) cutoff.
        let userDeleted = 0;
        try {
          for (let lo = 1; lo < protectedFromSeq; lo += deleteBatchSize) {
            const hi = Math.min(lo + deleteBatchSize, protectedFromSeq);
            const deletedCount = await this.deleteOldSyncedOpsBatch(
              candidate.userId,
              lo,
              hi,
              cutoffTime,
            );
            if (deletedCount === 0) continue;

            // Mark on the *first* deleting window (not after the loop) so that
            // if a later window throws, the counter still self-heals. Without
            // this, window-1 commits would leave the counter stale-high until the
            // next daily pass or process restart.
            //
            // Deliberately leave storageUsedBytes stale-high here. A count-based
            // approximate decrement can undercount users with many tiny ops and
            // let them bypass quota indefinitely. The marker tells the next
            // request to run an exact reconcile so drift self-heals.
            //
            // NOTE: the marker is in-memory (process-local). A persistent
            // `users.storage_needs_reconcile` column would survive restarts; see
            // TODO below.
            // TODO: persist the reconcile marker in a DB column so it survives
            // restarts of a single-instance deployment and works correctly across
            // a multi-instance deployment behind a load balancer.
            if (userDeleted === 0) {
              affectedUserIds.push(candidate.userId);
              this.markNeedsReconcile(candidate.userId);
            }

            userDeleted += deletedCount;
            totalDeleted += deletedCount;
            // May go negative — the outer loop's budget check then stops the run
            // before starting another user.
            remainingDeleteBudget -= deletedCount;
          }
        } catch (error) {
          drainFailures++;
          Logger.error(
            `Cleanup [old-ops]: drain failed for user ${candidate.userId} ` +
              `(boundary ${protectedFromSeq}, ${userDeleted} ops deleted before the ` +
              `error); their prefix may be truncated until the next run: ${error}`,
          );
        }
      } catch (error) {
        // Scoped to ONE candidate on purpose. Every statement in this body reads or
        // writes a single user's history and can fail on that user alone (a
        // `statement_timeout` on a deep prefix is what production hit). Unscoped, the
        // throw escaped the loop, aborted the whole sweep, and — because `candidates`
        // is deterministically ordered — the same user re-blocked it every night while
        // every user behind them silently kept their full history: a fleet-wide
        // retention outage reported as one log line. Wrapping the whole body rather
        // than each query keeps that true for anything added here later. The drain's
        // own catch is nested inside and does not rethrow, so it still reports the
        // distinct 'prefix may be truncated' case before this one is reached.
        candidateFailed = true;
        candidateFailures++;
        Logger.error(
          `Cleanup [old-ops]: user ${candidate.userId} was skipped; their history was ` +
            `left intact and the run continued: ${error}`,
        );
      } finally {
        // `finally`, not the end of the `try`: the body reaches `continue` on three
        // ordinary skip paths (snapshot-capped with no replay base, boundary at seq 1,
        // fresh prefix) and those are successes that must clear the streak.
        consecutiveCandidateFailures = candidateFailed
          ? consecutiveCandidateFailures + 1
          : 0;
      }
    }

    if (cappedUsersWithoutReplayBase > 0) {
      Logger.warn(
        `Cleanup [old-ops]: skipped ${cappedUsersWithoutReplayBase} snapshot-capped user(s) ` +
          'without a causal full-state op at or below their snapshot cursor; ' +
          'their operation histories were left intact.',
      );
    }

    if (skippedFreshPrefix > 0 || skippedBoundaryAtOne > 0) {
      Logger.info(
        `Cleanup [old-ops]: retained ${skippedFreshPrefix} user(s) whose prefix still ` +
          `holds an op inside retention and ${skippedBoundaryAtOne} whose boundary is at ` +
          'seq 1; both are expected, but a fresh-prefix count that never falls means ' +
          'those users are permanently exempt from retention.',
      );
    }

    if (drainFailures > 0) {
      Logger.warn(
        `Cleanup [old-ops]: ${drainFailures} user(s) failed mid-drain and were skipped; ` +
          'the run continued for the remaining users.',
      );
    }

    if (candidateFailures > 0) {
      Logger.warn(
        `Cleanup [old-ops]: ${candidateFailures} user(s) threw before their drain and were ` +
          'skipped. A count that never falls means those users are permanently exempt ' +
          'from retention — check for a statement_timeout on a deep prefix.',
      );
    }

    if (remainingDeleteBudget <= 0) {
      Logger.warn(
        `Cleanup [old-ops]: per-run budget exhausted after ${totalDeleted} ops ` +
          `(the last user drained past the budget so their prefix stayed whole); ` +
          `some users may still have retained old ops. ` +
          `Raise OLD_OPS_CLEANUP_MAX_DELETED_PER_RUN if this happens repeatedly.`,
      );
    }

    return { totalDeleted, affectedUserIds };
  }

  /**
   * Delete one serverSeq WINDOW of the user's aged prefix: rows in
   * `[windowStart, windowEnd)` that are also older than the cutoff.
   *
   * The window is STATED, never discovered. The previous shape —
   * `findMany({ serverSeq: { lt: boundary }, take: limit })` feeding a
   * `deleteMany` by id — bounded the rows RETURNED but not the rows SCANNED,
   * and production found three independent ways for that scan to blow the 60s
   * `statement_timeout` (#9692):
   *   1. low match density: when few rows below the boundary are older than
   *      the cutoff, the LIMIT never fills and the scan heap-filters the
   *      user's whole prefix (measured: 4x the block cost while deleting
   *      nothing);
   *   2. cold I/O: even at 100% density, `take: 5000` is ~5000 random heap
   *      fetches to check `received_at` — ~48s at the host's measured ~9.5ms
   *      cold reads;
   *   3. dead tuples: a prefix already deleted by quota recovery leaves its
   *      index entries behind until vacuum, and the scan visits every one —
   *      measured 88s / 6,787 cold pages to return zero rows. (How long that
   *      backlog survives is an autovacuum scale factor, tuned per-table in
   *      20260828000003; the measurement above predates it.)
   * A two-sided `serverSeq` range caps the index entries a statement can touch
   * at the window width regardless of match density, tuple liveness, or plan
   * choice, so none of the three can recur. `server_seq` is unique per user,
   * so the width also caps the rows deleted per statement — no `take`, no id
   * round-trip, one statement instead of two.
   *
   * Returns the rows that actually left the table — a window can legitimately
   * delete zero (already pruned, or emptied concurrently by quota recovery,
   * which holds `runWithStorageUsageLock`; this sweep does not) and the caller
   * just advances to the next window.
   */
  private async deleteOldSyncedOpsBatch(
    userId: number,
    windowStart: number,
    windowEnd: number,
    cutoffTime: number,
  ): Promise<number> {
    const result = await prisma.operation.deleteMany({
      where: {
        userId,
        serverSeq: { gte: windowStart, lt: windowEnd },
        // Not redundant with the caller's fresh-op probe: a concurrent
        // deleteAllUserData / clean slate resets lastSeq to 0, so the user's
        // re-import reuses low seq numbers. Only this filter stops a stale
        // protectedFromSeq from shredding that brand-new history.
        receivedAt: { lt: BigInt(cutoffTime) },
      },
    });
    return result.count;
  }

  /**
   * Delete oldest restore point and all operations before it to free up storage.
   * Used when storage quota is exceeded to make room for new uploads.
   *
   * Strategy:
   * - If 2+ restore points: Delete oldest restore point AND all ops with serverSeq <= its seq
   * - If 1 restore point: Delete all ops with serverSeq < its seq (keep the restore point)
   * - If 0 restore points: Nothing to delete, return failure
   *
   * @returns Object with deletedCount, approximate freedBytes, and success flag
   */
  async deleteOldestRestorePointAndOps(
    userId: number,
  ): Promise<{ deletedCount: number; freedBytes: number; success: boolean }> {
    // Find all restore points (full-state operations) ordered by serverSeq ASC
    const restorePoints = await prisma.operation.findMany({
      where: {
        userId,
        ...CAUSAL_FULL_STATE_OPERATION_WHERE,
      },
      orderBy: { serverSeq: 'asc' },
      select: { serverSeq: true, opType: true },
      take: 2,
    });

    if (restorePoints.length === 0) {
      Logger.warn(`[user:${userId}] No restore points found, cannot free storage`);
      return { deletedCount: 0, freedBytes: 0, success: false };
    }

    const oldestRestorePoint = restorePoints[0];
    let deleteUpToSeq: number;

    if (restorePoints.length >= 2) {
      // Delete the oldest restore point AND all ops up to and including it
      deleteUpToSeq = oldestRestorePoint.serverSeq;
      Logger.info(
        `[user:${userId}] Deleting oldest restore point (seq=${deleteUpToSeq}) and all ops before it`,
      );
    } else {
      // Only one restore point - delete all ops BEFORE it, but keep the restore point
      deleteUpToSeq = oldestRestorePoint.serverSeq - 1;
      Logger.info(
        `[user:${userId}] Keeping single restore point (seq=${oldestRestorePoint.serverSeq}), deleting ops before it`,
      );
    }

    if (deleteUpToSeq < 1) {
      Logger.info(`[user:${userId}] No ops to delete (deleteUpToSeq=${deleteUpToSeq})`);
      return { deletedCount: 0, freedBytes: 0, success: false };
    }

    // Full-state ops (SYNC_IMPORT/BACKUP_IMPORT/REPAIR) can be up to 20MB each,
    // so the APPROX_BYTES_PER_OP=1024 fallback used for delta ops would undercount
    // by ~20000x and leave the cached counter permanently low if a reconcile
    // failure later rolls back to that figure. Use the write-time payload_bytes
    // value so cleanup accounting matches quota reconciliation without
    // detoasting JSONB payloads.
    const fullStateRows = await prisma.$queryRaw<
      Array<{ exact_bytes: bigint | null; full_state_count: bigint }>
    >`
      SELECT
        COALESCE(SUM(payload_bytes), 0) AS exact_bytes,
        COUNT(*)::bigint AS full_state_count
      FROM operations
      WHERE user_id = ${userId}
        AND server_seq <= ${deleteUpToSeq}
        AND op_type IN ('SYNC_IMPORT', 'BACKUP_IMPORT', 'REPAIR')
    `;
    const fullStateExactBytes = Number(fullStateRows[0]?.exact_bytes ?? 0);
    const fullStateCount = Number(fullStateRows[0]?.full_state_count ?? 0);

    // Delete the operations
    const result = await prisma.operation.deleteMany({
      where: {
        userId,
        serverSeq: { lte: deleteUpToSeq },
      },
    });

    // freedBytes is split: exact size for the 0-1 restore-point rows just
    // measured (catches the 20MB-ish payloads that the APPROX_BYTES_PER_OP
    // approximation undercounts by ~20000x), plus the approximate
    // count*APPROX_BYTES_PER_OP for the remaining delta ops (median 150-300B
    // — modest over-estimate so the cleanup loop progresses without scanning
    // every delta payload). Reconciled to exact value once at the end of
    // freeStorageForUpload via a single updateStorageUsage call.
    const deltaOpsCount = Math.max(0, result.count - fullStateCount);
    const freedBytes = fullStateExactBytes + deltaOpsCount * APPROX_BYTES_PER_OP;

    if (result.count > 0) {
      // Clear stale snapshot cache if it references deleted operations
      const cachedRow = await prisma.userSyncState.findUnique({
        where: { userId },
        select: { lastSnapshotSeq: true },
      });

      if (cachedRow?.lastSnapshotSeq && cachedRow.lastSnapshotSeq <= deleteUpToSeq) {
        await prisma.userSyncState.update({
          where: { userId },
          data: {
            snapshotData: null,
            lastSnapshotSeq: null,
            snapshotAt: null,
          },
        });
        Logger.info(
          `[user:${userId}] Cleared stale snapshot cache (was at seq ${cachedRow.lastSnapshotSeq}, deleted up to ${deleteUpToSeq})`,
        );
      }

      // Decrement counter by the approximate freed bytes so freeStorageForUpload
      // can detect progress. Final accuracy is restored by the single
      // updateStorageUsage call at the end of freeStorageForUpload.
      await this.decrementStorageUsage(userId, freedBytes);
      Logger.info(
        `[user:${userId}] Deleted ${result.count} ops (approx freed ~${Math.round(freedBytes / 1024)}KB)`,
      );
    }

    return {
      deletedCount: result.count,
      freedBytes,
      success: result.count > 0,
    };
  }

  /**
   * Iteratively delete old restore points and operations until enough storage
   * space is available for the requested upload. Always keeps at least one
   * restore point and all operations after it (minimum valid sync state).
   *
   * @param userId - User ID
   * @param requiredBytes - Number of bytes needed for the upload
   * @returns Object with success status and cleanup statistics
   */
  async freeStorageForUpload(
    userId: number,
    requiredBytes: number,
  ): Promise<{
    success: boolean;
    freedBytes: number;
    deletedRestorePoints: number;
    deletedOps: number;
  }> {
    let totalFreedBytes = 0;
    let deletedRestorePoints = 0;
    let totalDeletedOps = 0;

    const MAX_CLEANUP_ITERATIONS = 50;
    let iterations = 0;

    // Reconcile the approximate counter once at the end via a single
    // calculateStorageUsage scan. Slow but bounded to a single user per
    // quota-cleanup event (not per upload like the previous regression).
    //
    // If reconcile fails we must NOT leave the counter at its post-decrement
    // (artificially low) value — that would let the user bypass quota until
    // the next successful reconcile. Roll the optimistic decrement back so the
    // counter returns to its pre-cleanup state (which was correctly tracked by
    // incremental upload deltas).
    const reconcileCounter = async (): Promise<boolean> => {
      try {
        await this.updateStorageUsage(userId);
        return true;
      } catch (err) {
        Logger.warn(
          `[user:${userId}] Failed to reconcile storage usage after cleanup: ${
            (err as Error).message
          }`,
        );
        return false;
      }
    };
    const reconcileOrRollback = async (): Promise<void> => {
      const ok = await reconcileCounter();
      if (!ok && totalFreedBytes > 0) {
        try {
          await this.incrementStorageUsage(userId, totalFreedBytes);
          Logger.warn(
            `[user:${userId}] Rolled back ${totalFreedBytes} bytes of optimistic cleanup decrement after reconcile failure`,
          );
        } catch (err) {
          Logger.error(
            `[user:${userId}] Failed to roll back cleanup decrement: ${
              (err as Error).message
            }`,
          );
        }
      }
    };

    // Keep trying until we have enough space or hit minimum
    while (iterations < MAX_CLEANUP_ITERATIONS) {
      iterations++;

      // Check if we now have enough space. The cached counter may have been
      // moved by approximate count*const deletes, so verify once with the exact
      // reconciled counter before declaring success.
      const quotaCheck = await this.checkStorageQuota(userId, requiredBytes);
      if (quotaCheck.allowed) {
        // On the success-path we want fresh truth, but if reconcile fails we
        // also want the rollback (otherwise we'd be making the success
        // decision against an artificially-low counter).
        await reconcileOrRollback();
        const reconciledQuotaCheck = await this.checkStorageQuota(userId, requiredBytes);
        if (reconciledQuotaCheck.allowed) {
          return {
            success: true,
            freedBytes: totalFreedBytes,
            deletedRestorePoints,
            deletedOps: totalDeletedOps,
          };
        }
        Logger.warn(
          `[user:${userId}] Storage still exceeded after exact reconcile: ` +
            `${reconciledQuotaCheck.currentUsage}/${reconciledQuotaCheck.quota} bytes`,
        );
      }

      // Only need to know whether at least two restore points remain.
      const restorePoints = await prisma.operation.findMany({
        where: {
          userId,
          ...CAUSAL_FULL_STATE_OPERATION_WHERE,
        },
        orderBy: { serverSeq: 'asc' },
        select: { serverSeq: true },
        take: 2,
      });

      // Minimum: 1 restore point + all ops after it
      // If we only have 1 or fewer restore points, we can't delete any more
      if (restorePoints.length <= 1) {
        Logger.warn(
          `[user:${userId}] Cannot free more storage: only ${restorePoints.length} restore point(s) remaining`,
        );
        await reconcileOrRollback();
        return {
          success: false,
          freedBytes: totalFreedBytes,
          deletedRestorePoints,
          deletedOps: totalDeletedOps,
        };
      }

      // Delete oldest restore point + all ops before it
      const result = await this.deleteOldestRestorePointAndOps(userId);
      if (!result.success) {
        await reconcileOrRollback();
        return {
          success: false,
          freedBytes: totalFreedBytes,
          deletedRestorePoints,
          deletedOps: totalDeletedOps,
        };
      }

      totalFreedBytes += result.freedBytes;
      deletedRestorePoints++;
      totalDeletedOps += result.deletedCount;

      Logger.info(
        `[user:${userId}] Auto-cleanup iteration: freed ${Math.round(result.freedBytes / 1024)}KB, ` +
          `${restorePoints.length - 1} restore point(s) remaining in current cleanup window`,
      );
    }

    // Exhausted max iterations without freeing enough space
    Logger.warn(
      `[user:${userId}] Storage cleanup exceeded max iterations (${MAX_CLEANUP_ITERATIONS})`,
    );
    await reconcileOrRollback();
    return {
      success: false,
      freedBytes: totalFreedBytes,
      deletedRestorePoints,
      deletedOps: totalDeletedOps,
    };
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
      storageQuotaBytes: Number(user?.storageQuotaBytes ?? getDefaultStorageQuotaBytes()),
    };
  }
}
