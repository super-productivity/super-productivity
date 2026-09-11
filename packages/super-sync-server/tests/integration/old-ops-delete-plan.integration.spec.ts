/**
 * Plan guard for the old-ops sweep's DELETE batches, on a REAL PostgreSQL —
 * production's major version, not PGlite's.
 *
 * WHAT WENT WRONG (#9692). The sweep's per-batch row selection was DISCOVERED:
 *
 *   findMany({ where: { userId, serverSeq: { lt: boundary }, receivedAt: { lt: cutoff } },
 *              orderBy: { serverSeq: 'asc' }, take: batchSize })
 *
 * `take` bounds the rows RETURNED, not the rows SCANNED: the scan walks the
 * user's prefix down `(user_id, server_seq)` until the LIMIT fills, and
 * production found three independent ways for it never to fill in time:
 *
 *   1. LOW MATCH DENSITY — few rows below the boundary are older than the
 *      cutoff, so the scan heap-filters the whole prefix (the "mirror
 *      pathology": 4x the block cost of the fully-deletable case, measured in
 *      the issue).
 *   2. DEAD TUPLES — a prefix already deleted by quota recovery keeps its
 *      index entries until vacuum, and autovacuum's default 20% scale factor
 *      is ~1.7M dead rows on production's table, i.e. months. The scan visits
 *      every entry and returns nothing: measured 88s / 6,787 cold pages on
 *      production (user 2215), 57014 at the 60s statement_timeout.
 *   3. COLD I/O — even at 100% density, a 5,000-row batch is ~5,000 random
 *      heap fetches to check `received_at`; ~48s at the host's measured
 *      ~9.5ms cold reads. (Not reproduced here — it is (1)/(2) arithmetic,
 *      not a plan property.)
 *
 * THE FIX IS A STATED RANGE. The batch is now one DELETE over a two-sided
 * serverSeq window, `[lo, min(lo + W, boundary))`. The index entries one
 * statement can touch are capped by the window width regardless of match
 * density, tuple liveness, or plan choice — the range is stated, not
 * discovered. This file measures exactly that cap against the two scan-shaped
 * pathologies above.
 *
 * ASSERTIONS ARE PLANNER-INDEPENDENT ON PURPOSE: buffers for the dead cohort
 * (dead entries emit no rows — `Rows Removed by Filter` reads 0 and the whole
 * cost is I/O) and filtered-row counts for the mirror cohort. Nothing pins an
 * index name: if the planner ever picks a plan that un-bounds the window, the
 * budget assertions are what fail, which is the regression that matters.
 * Measured under force_generic_plan via PREPARE/EXECUTE — what Prisma's
 * prepared statements actually get — see explain-plan.helper.ts.
 *
 * THE SEED IS THE WHOLE TEST — as in old-ops-probe-plan.integration.spec.ts,
 * USER_COUNT keeps the generic `user_id = $1` estimate wrong the way
 * production's is, and the CANARY pins that the discovered shape is still
 * catastrophic on this seed. If the canary goes cheap, the seed has stopped
 * reproducing production and every budget below is vacuous.
 *
 * Prerequisites: a real PostgreSQL with the schema applied (`prisma db push`)
 * and DATABASE_URL set; skipped entirely when unset.
 *
 *   DATABASE_URL=postgresql://... npx vitest run --config vitest.integration.config.ts \
 *     tests/integration/old-ops-delete-plan.integration.spec.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  explainGeneric,
  type ExplainRunner,
  type Measured,
} from '../explain-plan.helper';

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDb = DATABASE_URL ? describe : describe.skip;

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 1_760_000_000_000;
const CUTOFF = NOW - 45 * DAY_MS;

/** Keeps the generic `user_id = $1` estimate far below the real slice size. */
const USER_COUNT = 2_000;
/** Depth of each measured user's history. */
const HISTORY = 30_000;
/** The stated window width under test (production default is 5,000). */
const WINDOW = 1_000;
const BOUNDARY_SEQ = HISTORY + 1;

/**
 * The shapes under test, hand-written for the same reason as the probe spec:
 * the sweep issues them through the Prisma model API, so there is no
 * production `Prisma.sql` to render. DISCOVERED_SQL is the pre-#9692 batch
 * selection verbatim; STATED_SQL is `deleteOldSyncedOpsBatch`'s DELETE — keep
 * both in sync with storage-quota.service.ts.
 */
const DISCOVERED_SQL = `SELECT "id" FROM "operations"
   WHERE "user_id" = $1 AND "server_seq" < $2 AND "received_at" < $3
   ORDER BY "server_seq" ASC LIMIT $4`;
const STATED_SQL = `DELETE FROM "operations"
   WHERE "user_id" = $1 AND "server_seq" >= $2 AND "server_seq" < $3 AND "received_at" < $4`;

const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL ?? '' } } });

const runnerFor = (tx: Prisma.TransactionClient): ExplainRunner => ({
  exec: (sql) => tx.$executeRawUnsafe(sql),
  query: async (sql) => ({
    rows: (await tx.$queryRawUnsafe(sql)) as Array<Record<string, unknown>>,
  }),
});

const ROLLBACK_SENTINEL = 'rollback-after-measuring';

/**
 * EXPLAIN ANALYZE EXECUTES the statement, and STATED_SQL is a DELETE, so every
 * measurement runs inside a transaction that is rolled back via the sentinel
 * throw — the only way to make Prisma roll an interactive transaction back.
 * That keeps the seed intact for the following tests, so measurement ORDER
 * only matters through the index kill-bit side effect noted at the call sites.
 */
const measureRolledBack = async (
  sql: string,
  params: readonly unknown[],
): Promise<Measured> => {
  let captured: Measured | undefined;
  try {
    await prisma.$transaction(async (tx) => {
      captured = await explainGeneric(runnerFor(tx), sql, params);
      throw new Error(ROLLBACK_SENTINEL);
    });
  } catch (error) {
    if ((error as Error)?.message !== ROLLBACK_SENTINEL) throw error;
  }
  if (!captured) throw new Error('the plan was never captured');
  return captured;
};

describeWithDb('Old-ops delete-batch plan (PostgreSQL)', () => {
  /** Whole history deleted-but-unvacuumed — production's user 2215. */
  let deadUserId = 0;
  /** Whole history inside retention — the issue's "mirror pathology" cohort. */
  let freshUserId = 0;
  /** Whole history aged and live — the cohort the sweep exists for. */
  let agedUserId = 0;

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "operations", "users" RESTART IDENTITY CASCADE',
    );
    // No vacuum may run mid-spec: the dead cohort IS unvacuumed index entries,
    // and on a 30k-row table autovacuum would fire within its 60s naptime —
    // unlike production, where the 20% scale factor keeps it away for months.
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "operations" SET (autovacuum_enabled = off)',
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "users" ("email") SELECT 'plan-' || g || '@test.invalid' FROM generate_series(1, ${USER_COUNT}) g`,
    );
    const ids = await prisma.$queryRawUnsafe<Array<{ id: number }>>(
      'SELECT id FROM "users" ORDER BY id LIMIT 3',
    );
    deadUserId = ids[0].id;
    freshUserId = ids[1].id;
    agedUserId = ids[2].id;

    const seedOps = (userId: number, count: number, receivedAt: string): string =>
      `INSERT INTO "operations" (
         "id","user_id","client_id","server_seq","action_type","op_type","entity_type",
         "entity_id","payload","vector_clock","schema_version","client_timestamp","received_at"
       )
       SELECT '${userId}-' || g, ${userId}, 'c-${userId}', g, 'ADD', 'CRT', 'TASK', 'e' || g,
              '{}'::jsonb, '{}'::jsonb, 1, ${NOW}, ${receivedAt}
       FROM generate_series(1, ${count}) g`;

    // `+ 1 - g`, not `- g`: the newest aged row must land strictly below the
    // cutoff or the aged cohorts stop being fully deletable.
    const agedReceivedAt = `${CUTOFF} - (${HISTORY} + 1 - g) * 1000`;
    await prisma.$executeRawUnsafe(seedOps(deadUserId, HISTORY, agedReceivedAt));
    await prisma.$executeRawUnsafe(seedOps(freshUserId, HISTORY, `${CUTOFF} + g * 1000`));
    await prisma.$executeRawUnsafe(seedOps(agedUserId, HISTORY, agedReceivedAt));

    // n_distinct(user_id) is what mis-sizes the generic estimate; the
    // population has to be real even though only three users are measured.
    await prisma.$executeRawUnsafe(
      `INSERT INTO "operations" (
         "id","user_id","client_id","server_seq","action_type","op_type","entity_type",
         "entity_id","payload","vector_clock","schema_version","client_timestamp","received_at"
       )
       SELECT 'bulk-' || u || '-' || g, u, 'c-' || u, g, 'ADD', 'CRT', 'TASK', 'e' || g,
              '{}'::jsonb, '{}'::jsonb, 1, ${NOW}, ${CUTOFF} - g * 1000
       FROM generate_series(4, ${USER_COUNT}) u, generate_series(1, 5) g`,
    );

    // ANALYZE BEFORE the delete below: production's statistics also predate
    // the quota-recovery deletion, which is part of why the planner walks in.
    await prisma.$executeRawUnsafe('ANALYZE "operations"');

    // Now make the dead user dead: a COMMITTED delete of the whole prefix,
    // with autovacuum off, leaves every index entry pointing at a dead tuple —
    // production's post-quota-recovery state.
    await prisma.$executeRawUnsafe(
      `DELETE FROM "operations" WHERE "user_id" = ${deadUserId}`,
    );
  }, 180_000);

  afterAll(async () => {
    await prisma.$executeRawUnsafe('ALTER TABLE "operations" RESET (autovacuum_enabled)');
    await prisma.$executeRawUnsafe(
      'TRUNCATE "operations", "users" RESTART IDENTITY CASCADE',
    );
    await prisma.$disconnect();
  });

  it('CANARY + fix, dead-tuple cohort: the discovered scan pays the whole dead prefix, the stated window does not', async () => {
    // Windowed DELETE first: it visits (and kill-bit marks) only the first
    // WINDOW entries, so measuring it before the canary leaves the canary's
    // remaining ~29k dead entries unkilled. The reverse order would let the
    // canary's full scan mark everything and hand the window a pre-cleaned
    // index — measuring the healing, not the bound.
    const stated = await measureRolledBack(STATED_SQL, [
      deadUserId,
      1,
      1 + WINDOW,
      CUTOFF,
    ]);
    const discovered = await measureRolledBack(DISCOVERED_SQL, [
      deadUserId,
      BOUNDARY_SEQ,
      CUTOFF,
      WINDOW,
    ]);

    // Dead entries emit no rows and are removed by no filter, so row counters
    // read ~0 down both shapes — production's plan showed rows=0 with no
    // 'Rows Removed by Filter' line at 6,787 pages. Buffers are the signal.
    expect(discovered.rowsTouched).toBe(0);
    expect(stated.rowsTouched).toBe(0);
    // CANARY: the discovered shape still walks the entire dead prefix on this
    // seed. If this goes cheap, the seed no longer reproduces #9692 and the
    // budget below proves nothing.
    expect(discovered.blocks).toBeGreaterThan(stated.blocks * 8);
    // The actual claim: the window caps the statement's I/O near the window
    // width — HISTORY/WINDOW is 30x here — instead of the history depth.
    expect(stated.blocks).toBeLessThan(discovered.blocks / 8);
  });

  it('mirror cohort (history inside retention): filtered rows are capped by the window, not the history', async () => {
    const discovered = await measureRolledBack(DISCOVERED_SQL, [
      freshUserId,
      BOUNDARY_SEQ,
      CUTOFF,
      WINDOW,
    ]);
    const stated = await measureRolledBack(STATED_SQL, [
      freshUserId,
      1,
      1 + WINDOW,
      CUTOFF,
    ]);

    // CANARY: with nothing deletable the LIMIT never fills and the discovered
    // scan heap-filters the whole history (the issue's 4x measurement).
    expect(discovered.rowsFiltered).toBeGreaterThanOrEqual(HISTORY * 0.9);
    // The window can only ever examine WINDOW entries, whatever their density.
    expect(stated.rowsFiltered).toBeLessThanOrEqual(WINDOW);
    expect(stated.blocks).toBeLessThan(discovered.blocks / 8);
  });

  it('deletable cohort: one window deletes exactly the window width', async () => {
    const stated = await measureRolledBack(STATED_SQL, [
      agedUserId,
      1,
      1 + WINDOW,
      CUTOFF,
    ]);

    // The scan feeding ModifyTable emits exactly the window's rows — the width
    // caps deletions per statement (server_seq is unique per user), which is
    // what lets the drain call this in a loop without a `take`.
    expect(stated.rowsTouched).toBe(WINDOW);
    expect(stated.rowsFiltered).toBe(0);
  });
});
