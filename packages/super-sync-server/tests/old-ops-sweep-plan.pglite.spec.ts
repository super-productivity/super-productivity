import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { explainGeneric } from './explain-plan.helper';

/**
 * What does the old-ops sweep's batch selection actually scan?
 *
 * #9692: the daily sweep died on `prisma.operation.findMany()` with PostgreSQL
 * 57014 (`statement_timeout`, 60 s at database level). The obvious reading is
 * that `take: limit` bounds the work — it does not. `take` bounds the rows
 * RETURNED; the scan walks the user's `server_seq` range heap-filtering
 * `received_at` and stops only when it has collected `limit` matches OR run out
 * of rows. So the cost is driven by MATCH DENSITY, not by `take`, and lowering
 * the batch size cannot help the sparse case at all.
 *
 * This spec measures three shapes, because the answer decides the fix:
 *   - dense         — every row below the boundary is deletable. `LIMIT` bites.
 *   - sparse        — the whole history is inside the 45-day retention window,
 *     so nothing is deletable. `LIMIT` never fills and the scan runs to the end
 *     of the user's slice.
 *   - staleBoundary — the mirror image: the whole history is OUTSIDE retention,
 *     but the only causal full-state op is an ancient import, so `protectedFromSeq`
 *     is tiny and almost nothing is deletable anyway.
 *
 * The last two exist to stop a plausible non-fix. `ORDER BY server_seq` pins the
 * planner to the (user_id, server_seq) btree, where `received_at < cutoff` can
 * only be a heap filter — so the natural-looking repair is to order by
 * `received_at` instead and let the existing (user_id, received_at) index bound
 * the scan. Measured on these fixtures, that swaps which cohort suffers rather
 * than fixing anything:
 *
 *              server_seq order          received_at order
 *   sparse     20000 filtered / 223 blk  0 filtered /   2 blk
 *   stale      0 filtered /   3 blk      19996 filtered / 247 blk
 *
 * Whichever column the sort picks becomes the index's range bound and the OTHER
 * predicate degrades to a heap filter, so exactly one cohort always runs away.
 * A real fix must bound the SCANNED RANGE itself — a `server_seq` window
 * (`serverSeq >= lo AND serverSeq < min(lo + W, protectedFromSeq)`), which is
 * bounded regardless of match density because the range is explicit rather than
 * discovered. The sparse expectation below pins a DEFECT, not a desired
 * property — a real fix flips it. The staleBoundary expectation is the opposite:
 * a GUARD on behaviour that is already correct, so that a "fix" which merely
 * moves the cost from one cohort to the other fails here instead of looking
 * like progress.
 *
 * MEASURE WITH `force_generic_plan`, NEVER WITH LITERALS — the reasoning lives
 * with the harness in explain-plan.helper.ts. Prisma sends parameterised
 * prepared statements, and a generic plan cannot see the parameter values, which
 * is exactly what makes the planner unable to tell the two cases apart.
 *
 * FIDELITY LIMIT: PGlite is not the production cluster (different major version)
 * and reports every block as a cache hit, so block counts here cannot model the
 * ~9.5 ms cold random reads that turn a large scan into a 60 s statement. The
 * planner-independent signal is `rowsTouched` + `rowsFiltered`.
 */

const CREATE_TABLE = `
  CREATE TABLE operations (
    id                      text PRIMARY KEY,
    user_id                 integer NOT NULL,
    client_id               text NOT NULL,
    -- integer, NOT bigint: production maps serverSeq as Prisma Int.
    server_seq              integer NOT NULL,
    op_type                 text NOT NULL,
    -- bigint: production stores receivedAt as Prisma BigInt (epoch ms).
    received_at             bigint NOT NULL
  );
`;

// A deliberate SUBSET of prisma/schema.prisma + the migrations: the two btrees
// this query can ride, plus the partial full-state index the boundary lookups
// use (present so the planner sees the same choice set, not because this
// statement can use it). Production also has (user_id, client_id), the
// entity btree and the entity_ids GIN; no predicate here can use them.
const CREATE_INDEXES = `
  CREATE UNIQUE INDEX operations_user_id_server_seq_key
    ON operations (user_id, server_seq);
  CREATE INDEX operations_user_id_received_at_idx
    ON operations (user_id, received_at);
  CREATE INDEX operations_user_id_full_state_server_seq_idx
    ON operations (user_id, server_seq)
    WHERE op_type IN ('SYNC_IMPORT', 'BACKUP_IMPORT', 'REPAIR');
`;

/** The SQL Prisma emits for deleteOldSyncedOpsBatch's `doomedOps` findMany. */
const DOOMED_OPS_SQL = `
  SELECT "operations"."id"
  FROM "operations"
  WHERE ("operations"."user_id" = $1
     AND "operations"."server_seq" < $2
     AND "operations"."received_at" < $3)
  ORDER BY "operations"."server_seq" ASC
  LIMIT $4
`;

const INSERT_COLS =
  'INSERT INTO operations (id,user_id,client_id,server_seq,op_type,received_at)';
const INSERT_CHUNK = 5_000;
const OPS_PER_USER = 20_000;
const OTHER_USERS = 8;
const DENSE_USER = 1;
const SPARSE_USER = 2;
const STALE_BOUNDARY_USER = 3;
/** An ancient SYNC_IMPORT is this user's only causal full-state op. */
const STALE_BOUNDARY_SEQ = 5;
/** Production default, `OLD_OPS_CLEANUP_DELETE_BATCH_SIZE`. */
const BATCH_LIMIT = 5_000;
const NOW = 1_760_000_000_000;
const CUTOFF = NOW - 45 * 24 * 60 * 60 * 1000;

describe('old-ops sweep batch selection — what LIMIT actually bounds', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(CREATE_TABLE);
    await db.exec(CREATE_INDEXES);

    const insert = async (
      userId: number,
      count: number,
      receivedAt: (i: number) => number,
    ): Promise<void> => {
      const rows: string[] = [];
      const flush = async (): Promise<void> => {
        if (!rows.length) return;
        await db.exec(`${INSERT_COLS} VALUES ${rows.join(',')}`);
        rows.length = 0;
      };
      for (let i = 1; i <= count; i++) {
        rows.push(
          `('op-${userId}-${i}',${userId},'c${userId}',${i},'CRT',${receivedAt(i)})`,
        );
        if (rows.length === INSERT_CHUNK) await flush();
      }
      await flush();
    };

    // `received_at` rises with `server_seq`, as production assigns them: both come
    // from the same per-user serialized upload transaction. That monotonicity is
    // the property that decides whether (user_id, received_at) can serve as a
    // RANGE bound, so a constant-per-user fixture could not tell the two
    // candidate orderings apart.
    //
    // Dense: every op predates the retention cutoff, so every one is deletable.
    await insert(DENSE_USER, OPS_PER_USER, (i) => CUTOFF - OPS_PER_USER + i - 1);
    // Sparse: an active user whose whole history is inside retention. The sweep
    // still visits them — they have a snapshot and a causal boundary — and finds
    // nothing to delete.
    await insert(SPARSE_USER, OPS_PER_USER, (i) => CUTOFF + i);
    // Stale boundary: every op predates the cutoff, so `received_at` bounds
    // nothing — but `protectedFromSeq` is ancient, so almost nothing may be
    // deleted. The exact inverse of `sparse`, and the reason an ordering swap
    // is not a fix.
    await insert(STALE_BOUNDARY_USER, OPS_PER_USER, (i) => CUTOFF - OPS_PER_USER + i - 1);
    // Other tenants, so the (user_id, ...) slices are not the whole table.
    for (let u = 4; u < 4 + OTHER_USERS; u++) {
      await insert(u, 2_000, (i) => CUTOFF - i);
    }
    await db.exec('ANALYZE operations');
    // Explicit, like the sibling plan specs: seeding a fresh PGlite instance
    // races the 10s vitest default when several of them boot in parallel.
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it('bounds the scan by LIMIT when every candidate row is deletable', async () => {
    const measured = await explainGeneric(db, DOOMED_OPS_SQL, [
      DENSE_USER,
      OPS_PER_USER + 1,
      CUTOFF,
      BATCH_LIMIT,
    ]);

    // Every row scanned is a match, so the scan stops at the limit.
    expect(measured.rowsTouched).toBeLessThanOrEqual(BATCH_LIMIT * 2);
    expect(measured.rowsFiltered).toBeLessThanOrEqual(BATCH_LIMIT);
  });

  it('DEFECT: does NOT bound the scan when nothing below the boundary is deletable', async () => {
    const measured = await explainGeneric(db, DOOMED_OPS_SQL, [
      SPARSE_USER,
      OPS_PER_USER + 1,
      CUTOFF,
      BATCH_LIMIT,
    ]);

    // Zero rows returned, yet the scan walked the user's entire slice: `take`
    // cannot stop a scan that never accumulates a match. This is why lowering
    // OLD_OPS_CLEANUP_DELETE_BATCH_SIZE is not a fix on its own.
    expect(measured.rowsTouched).toBe(0);
    expect(measured.rowsFiltered).toBeGreaterThan(BATCH_LIMIT * 2);
  });

  it('GUARD: stays bounded when the replay boundary is ancient', async () => {
    const measured = await explainGeneric(db, DOOMED_OPS_SQL, [
      STALE_BOUNDARY_USER,
      STALE_BOUNDARY_SEQ,
      CUTOFF,
      BATCH_LIMIT,
    ]);

    // The mirror of the case above, and the one an `ORDER BY received_at` fix
    // would make worse rather than better: here `received_at < cutoff` matches
    // everything and `server_seq < protectedFromSeq` is what rejects the rows.
    // Under the current ordering this case is cheap; do not "fix" the sparse
    // case by moving the cost here. Both must be bounded, which takes an
    // explicit scanned range — see the header.
    // x2: rowsTouched sums the Limit and Index Scan nodes, as in the dense case.
    expect(measured.rowsTouched).toBeLessThanOrEqual(STALE_BOUNDARY_SEQ * 2);
    expect(measured.rowsFiltered).toBe(0);
  });
});
