#!/usr/bin/env tsx
/**
 * Read-only dry run of the daily old-ops sweep
 * (`StorageQuotaService.deleteOldSyncedOpsForAllUsers`).
 *
 * Mirrors the production deletion logic in set-based SQL and reports, without
 * writing anything, exactly what the next sweep would delete on THIS database:
 *   - per-user prune boundary: the newest CAUSAL full-state op in the
 *     operation stream (#9688 — no snapshot cursor required), capped at
 *     `lastSnapshotSeq` while a cached snapshot BLOB still exists
 *   - would-delete counts and the retained base + tail, with users whose
 *     prefix is not fully aged out skipped whole (as production does)
 *   - safety checks that must come back clean before trusting the sweep
 *   - the residual unreachable cohort (no causal boundary above seq 1),
 *     segmented by history shape × dormancy × plaintext-vs-encrypted so the
 *     remaining #9688 directions (checkpoint cadence, eradication-plan
 *     dormant deletion) can be sized
 *
 * Run on the server host (uses DATABASE_URL like the monitoring scripts):
 *   npm run dry-run-old-ops-sweep:dev
 * Large tables may need a longer statement budget:
 *   MONITOR_STATEMENT_TIMEOUT_MS=1800000 npm run dry-run-old-ops-sweep:dev
 *
 * Exits non-zero when a safety check fails — in that case do NOT trust the
 * sweep on this database before understanding why.
 */
import { Prisma } from '@prisma/client';
import { prisma, disconnectDb, reportMonitoringError } from './monitoring-db';
import {
  affectedUsers,
  causalFullStateSql,
  fetchOldOpsSweepPlan,
  isPrunable,
  toNum as n,
  type PerUserRow,
} from './old-ops-sweep-plan';
import { RETENTION_MS } from '../src/sync/sync.types';

const TOP_N = 25;
const DEFAULT_DAILY_BUDGET = 25_000;
const VERIFY_CHUNK = 1000;

// This runs for minutes on a large table with no output otherwise; the phase
// timings are the operator's only signal that the gate is progressing.
const startedAt = Date.now();
const logPhase = (msg: string): void => {
  const elapsedS = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`[${elapsedS}s] ${msg}`);
};

/**
 * Independent re-verification: for each (userId, boundarySeq) pair, the
 * boundary must be a surviving causal full-state op. Deliberately NOT derived
 * from the main CTE — a translation bug there cannot hide here.
 */
const findBadBoundaries = async (
  pairs: { userId: number; seq: number }[],
): Promise<number[]> => {
  const bad: number[] = [];
  for (let i = 0; i < pairs.length; i += VERIFY_CHUNK) {
    const chunk = pairs.slice(i, i + VERIFY_CHUNK);
    const values = Prisma.join(
      chunk.map((p) => Prisma.sql`(${p.userId}::int, ${p.seq}::int)`),
    );
    const rows = await prisma.$queryRaw<{ user_id: number }[]>`
      SELECT b.user_id
      FROM (VALUES ${values}) AS b(user_id, seq)
      WHERE NOT EXISTS (
        SELECT 1 FROM operations o
        WHERE o.user_id = b.user_id
          AND o.server_seq = b.seq
          AND ${causalFullStateSql('o')}
      )
    `;
    bad.push(...rows.map((r) => r.user_id));
  }
  return bad;
};

/** Residual-cohort bucket for a user the sweep cannot reach. */
const residualCategory = (r: PerUserRow): string => {
  if (r.was_capped) {
    return 'snapshot-capped (cached blob blocks newer boundary)';
  }
  if (r.any_causal_seq === null) {
    return r.has_legacy_repair ? 'legacy-REPAIR-only' : 'no full-state op at all';
  }
  return 'initial import at seq 1 only';
};

const main = async (): Promise<void> => {
  const cutoff = BigInt(Date.now() - RETENTION_MS);

  logPhase('computing per-user prune boundaries and would-delete counts…');
  const perUser = await fetchOldOpsSweepPlan(prisma, cutoff);
  logPhase(`boundaries + counts done (${perUser.length} users with operations)`);

  const prunable = perUser.filter(isPrunable);
  const residual = perUser.filter((r) => !isPrunable(r));
  const affected = affectedUsers(perUser);
  const totalWouldDelete = affected.reduce((sum, r) => sum + n(r.would_delete), 0);

  // Safety check 1: boundary must be a surviving causal full-state op —
  // re-verified independently for every user the sweep would actually touch.
  logPhase(`re-verifying ${affected.length} boundaries against the table…`);
  const badBoundaryUsers = await findBadBoundaries(
    affected.map((r) => ({
      userId: r.user_id,
      // non-null: prunable filtered on it
      seq: r.protected_from_seq as number,
    })),
  );

  // Safety check 2: while a cached snapshot blob exists, the boundary may
  // never exceed its cursor — pruning above it would eat into the cached
  // snapshot's replay tail (the restore path).
  //
  // Be honest about what this can and cannot catch. Re-reading from
  // user_sync_state does NOT make it independent: `protected_from_seq` is
  // itself derived with this same `snapshot_data IS NOT NULL AND
  // last_snapshot_seq > 0` predicate, so for any affected user the comparison
  // holds by construction and prints OK. What it does catch is a LIVE RACE —
  // this query runs in a separate transaction from the plan query, so it fires
  // if quota recovery moved a boundary underneath the plan. It is not a
  // verification that the gate mirrors production; only the drift detector in
  // tests/integration/old-ops-sweep.integration.spec.ts checks that, and
  // nothing enforces the `causalFullStateSql` ↔ CAUSAL_FULL_STATE_OPERATION_WHERE
  // lockstep that both sides depend on.
  const blobCursors = await prisma.$queryRaw<
    { user_id: number; last_snapshot_seq: number }[]
  >`
    SELECT user_id, last_snapshot_seq
    FROM user_sync_state
    WHERE snapshot_data IS NOT NULL AND last_snapshot_seq > 0
  `;
  const cursorByUserId = new Map(
    blobCursors.map((r) => [r.user_id, r.last_snapshot_seq]),
  );
  const tailViolations = affected.filter((r) => {
    const cursor = cursorByUserId.get(r.user_id);
    return cursor !== undefined && (r.protected_from_seq as number) > cursor;
  });

  console.log('\n=== Old-ops sweep dry run (read-only) ===');
  console.log(`cutoff: received_at < ${new Date(Number(cutoff)).toISOString()}`);
  const totalOps = perUser.reduce((sum, r) => sum + n(r.op_count), 0);
  console.log(`operations table total:            ${totalOps}`);
  console.log(`users holding operations:          ${perUser.length}`);
  console.log(`  with a causal prune boundary:     ${prunable.length}`);
  console.log(
    `    boundary capped by snapshot:    ${prunable.filter((r) => r.was_capped).length}`,
  );
  console.log(
    `    skipped, prefix not fully aged:  ` +
      `${prunable.filter((r) => n(r.fresh_prefix) > 0).length}`,
  );
  console.log(`  unreachable (no usable boundary): ${residual.length}`);
  console.log(`total rows the sweep would delete: ${totalWouldDelete}`);
  console.log(
    `  ≈ ${Math.ceil(totalWouldDelete / DEFAULT_DAILY_BUDGET)} daily runs at the ` +
      `default ${DEFAULT_DAILY_BUDGET}/run budget (OLD_OPS_CLEANUP_MAX_DELETED_PER_RUN)`,
  );

  const top = [...affected]
    .sort((a, b) => n(b.would_delete) - n(a.would_delete))
    .slice(0, TOP_N)
    .map((r) => ({
      user_id: r.user_id,
      boundary_seq: r.protected_from_seq,
      would_delete: n(r.would_delete),
      base_plus_tail_kept: n(r.retained_from_boundary),
      capped: r.was_capped,
    }));
  console.log(`\nTop ${top.length} users by would-delete:`);
  console.table(top);

  // Residual cohort segmentation (#9688): category × dormancy × encryption.
  // Dormant = no op received within the retention window (device rows for
  // these users were already pruned by deleteStaleDevices, so max received_at
  // is the only remaining activity signal). Plaintext-holding accounts are
  // the e2ee-legacy-data-eradication-plan's deletion candidates; encrypted-
  // only active accounts are the checkpoint-cadence (direction 2) audience.
  const segments = new Map<string, { users: number; ops: number }>();
  for (const r of residual) {
    const key = [
      residualCategory(r),
      r.last_received_at < cutoff ? 'dormant' : 'active',
      r.has_plaintext_rows ? 'holds plaintext' : 'encrypted-only',
    ].join(' | ');
    const seg = segments.get(key) ?? { users: 0, ops: 0 };
    seg.users++;
    seg.ops += n(r.op_count);
    segments.set(key, seg);
  }
  const residualOps = residual.reduce((sum, r) => sum + n(r.op_count), 0);
  console.log(
    `\nUnreachable residual cohort: ${residual.length} users holding ${residualOps} ops.` +
      `\nSegments (category | activity | payload):`,
  );
  console.table(
    [...segments.entries()]
      .sort((a, b) => b[1].ops - a[1].ops)
      .map(([segment, v]) => ({ segment, users: v.users, ops: v.ops })),
  );

  const topResidual = [...residual]
    .sort((a, b) => n(b.op_count) - n(a.op_count))
    .slice(0, TOP_N)
    .map((r) => ({
      user_id: r.user_id,
      op_count: n(r.op_count),
      category: residualCategory(r),
      dormant: r.last_received_at < cutoff,
      holds_plaintext: r.has_plaintext_rows,
    }));
  console.log(`\nTop ${topResidual.length} unreachable users by op count:`);
  console.table(topResidual);

  console.log('\n=== Safety checks ===');
  console.log(
    `boundary is a surviving causal full-state op: ` +
      (badBoundaryUsers.length === 0
        ? 'OK'
        : `VIOLATED for users ${badBoundaryUsers.join(', ')}`),
  );
  console.log(
    `boundary <= lastSnapshotSeq where a cached snapshot blob exists: ` +
      (tailViolations.length === 0
        ? 'OK'
        : `VIOLATED for users ${tailViolations.map((r) => r.user_id).join(', ')}`),
  );

  if (badBoundaryUsers.length + tailViolations.length > 0) {
    console.error(
      `\nSafety check(s) failed — do not trust the sweep on this database ` +
        `before understanding why.`,
    );
    process.exitCode = 1;
  } else {
    console.log('\nAll safety checks passed.');
  }
};

main()
  .catch((err) => {
    reportMonitoringError('Dry run failed:', err);
    process.exitCode = 1;
  })
  .finally(() => disconnectDb());
