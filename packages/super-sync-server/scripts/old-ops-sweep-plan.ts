/**
 * The old-ops sweep's per-user plan, expressed as one set-based query.
 *
 * Lives outside `dry-run-old-ops-sweep.ts` so the integration suite can run the
 * gate's own SQL against the same rows the real sweep just processed and assert
 * the two agree (`tests/integration/old-ops-sweep.integration.spec.ts`). A
 * second copy of this SQL inside the spec would drift from the gate silently,
 * and a gate nothing checks is a gate nobody should trust: its whole job is to
 * predict what `StorageQuotaService.deleteOldSyncedOpsForAllUsers` will do
 * before the destructive run.
 */
import { Prisma, PrismaClient } from '@prisma/client';

/** Whichever client the caller already holds — monitoring's or `src/db`'s. */
type RawQueryClient = Pick<PrismaClient, '$queryRaw'>;

// Must stay in lockstep with CAUSAL_FULL_STATE_OPERATION_WHERE
// (src/sync/sync.types.ts) — the predicate that authorizes deletion.
export const causalFullStateSql = (alias: string): Prisma.Sql =>
  Prisma.raw(`(
    ${alias}.op_type IN ('SYNC_IMPORT', 'BACKUP_IMPORT')
    OR (${alias}.op_type = 'REPAIR' AND ${alias}.repair_base_server_seq IS NOT NULL)
  )`);

export interface PerUserRow {
  user_id: number;
  op_count: bigint;
  last_received_at: bigint;
  last_snapshot_seq: number | null;
  has_snapshot_blob: boolean;
  any_causal_seq: number | null;
  has_legacy_repair: boolean;
  has_plaintext_rows: boolean;
  was_capped: boolean;
  protected_from_seq: number | null;
  would_delete: bigint;
  fresh_prefix: bigint;
  retained_from_boundary: bigint;
}

/** PostgreSQL returns the count/aggregate columns as int8. */
export const toNum = (v: bigint | number): number => Number(v);

/**
 * A boundary at or below seq 1 authorizes nothing: there is no superseded
 * prefix beneath the very first operation.
 */
export const isPrunable = (r: PerUserRow): boolean =>
  r.protected_from_seq !== null && r.protected_from_seq > 1;

/**
 * The users the sweep would actually touch. A prefix is pruned whole or not at
 * all — see `StorageQuotaService.deleteOldSyncedOpsForAllUsers` for why — so a
 * prefix still holding an op inside retention is skipped rather than pruned
 * around. Mirror that here or the gate over-reports what the sweep deletes.
 */
export const affectedUsers = (rows: PerUserRow[]): PerUserRow[] =>
  rows.filter(
    (r) => isPrunable(r) && toNum(r.fresh_prefix) === 0 && toNum(r.would_delete) > 0,
  );

/**
 * Per-user view of what the sweep would do, for every user holding operations.
 *
 * Boundary resolution mirrors production (storage-quota.service.ts): the newest
 * causal full-state op with server_seq > 1 authorizes pruning; while a cached
 * snapshot blob exists the boundary may not pass last_snapshot_seq and drops to
 * the newest causal full-state op at or below that cursor. If its prefix has
 * recent operations, use the newest causal boundary at or before the lowest
 * recent sequence instead (#9962); a boundary itself may still be recent. The
 * latest_full_state_seq marker is not consulted (stale for ~90% of users, no
 * backfill in #8973).
 */
export const fetchOldOpsSweepPlan = (
  client: RawQueryClient,
  cutoff: bigint,
): Promise<PerUserRow[]> =>
  client.$queryRaw<PerUserRow[]>`
    WITH per_user AS (
      SELECT
        o.user_id,
        count(*) AS op_count,
        max(o.received_at) AS last_received_at,
        min(o.server_seq) FILTER (WHERE o.received_at >= ${cutoff}) AS first_fresh_seq,
        max(o.server_seq) FILTER (
          WHERE o.server_seq > 1 AND ${causalFullStateSql('o')}
        ) AS causal_boundary_seq,
        max(o.server_seq) FILTER (WHERE ${causalFullStateSql('o')}) AS any_causal_seq,
        bool_or(o.op_type = 'REPAIR' AND o.repair_base_server_seq IS NULL)
          AS has_legacy_repair,
        bool_or(o.is_payload_encrypted IS NOT TRUE) AS has_plaintext_rows
      FROM operations o
      GROUP BY o.user_id
    ),
    joined AS (
      -- snapshot_data IS NOT NULL reads the null bitmap only, so the blob is
      -- never detoasted here.
      SELECT p.*, s.last_snapshot_seq, s.snapshot_data IS NOT NULL AS has_snapshot_blob
      FROM per_user p
      LEFT JOIN user_sync_state s ON s.user_id = p.user_id
    ),
    capped AS (
      -- Keyed on the cached BLOB, not the cursor — same reason production is
      -- (storage-quota.service.ts): a cursor left behind by the E2EE
      -- eradication sweep must not keep capping a user forever.
      SELECT
        j.*,
        -- last_snapshot_seq > 0 mirrors production's snapshotCap > 0 check
        -- (storage-quota.service.ts). Without it a blob row with a 0 cursor
        -- reads as capped-and-unreachable here while the sweep would prune
        -- it — a gate must never under-report a real deletion.
        COALESCE(
          j.has_snapshot_blob
            AND j.last_snapshot_seq > 0
            AND j.causal_boundary_seq > j.last_snapshot_seq,
          false
        ) AS was_capped
      FROM joined j
    ),
    -- Resolve the cached-blob cap once before the retention fallback.
    snapshot_resolved AS MATERIALIZED (
      SELECT
        c.*,
        CASE WHEN c.was_capped THEN (
          SELECT max(o.server_seq) FROM operations o
          WHERE o.user_id = c.user_id
            AND o.server_seq <= c.last_snapshot_seq
            AND ${causalFullStateSql('o')}
        ) ELSE c.causal_boundary_seq END AS protected_from_seq
      FROM capped c
    ),
    resolved AS MATERIALIZED (
      SELECT s.*,
        CASE WHEN s.first_fresh_seq < s.protected_from_seq THEN COALESCE((
          SELECT max(o.server_seq) FROM operations o
          WHERE o.user_id = s.user_id
            AND o.server_seq > 1
            AND o.server_seq <= s.first_fresh_seq
            AND ${causalFullStateSql('o')}
        ), s.protected_from_seq) ELSE s.protected_from_seq END AS aged_boundary_seq
      FROM snapshot_resolved s
    ),
    -- Only the prefix ranges are joined, so retained_from_boundary can be
    -- derived from op_count and the largest of the three ranges is never
    -- scanned. Note this does NOT pin a plan: Postgres may still execute the
    -- join as a per-user nested loop. If the gate is slow on a large table,
    -- EXPLAIN it rather than trusting the shape.
    counts AS (
      SELECT
        r.user_id,
        count(*) FILTER (WHERE o.received_at < ${cutoff}) AS would_delete,
        count(*) FILTER (WHERE o.received_at >= ${cutoff}) AS fresh_prefix
      FROM operations o
      JOIN resolved r
        ON r.user_id = o.user_id
        AND r.aged_boundary_seq > 1
        AND o.server_seq < r.aged_boundary_seq
      GROUP BY r.user_id
    )
    SELECT
      r.user_id,
      r.op_count,
      r.last_received_at,
      r.last_snapshot_seq,
      r.has_snapshot_blob,
      r.any_causal_seq,
      r.has_legacy_repair,
      r.has_plaintext_rows,
      r.was_capped,
      r.aged_boundary_seq AS protected_from_seq,
      -- No CASE needed: the counts join filters protected_from_seq > 1, so a
      -- non-prunable user has no row there and COALESCE already yields 0.
      COALESCE(ct.would_delete, 0) AS would_delete,
      COALESCE(ct.fresh_prefix, 0) AS fresh_prefix,
      -- This one DOES need the CASE — op_count - 0 - 0 is op_count, not 0.
      CASE WHEN r.aged_boundary_seq > 1
        THEN r.op_count - COALESCE(ct.would_delete, 0) - COALESCE(ct.fresh_prefix, 0)
        ELSE 0 END AS retained_from_boundary
    FROM resolved r
    LEFT JOIN counts ct ON ct.user_id = r.user_id
  `;
