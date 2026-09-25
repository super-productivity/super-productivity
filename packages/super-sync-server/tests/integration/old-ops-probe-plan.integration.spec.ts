/**
 * Plan guard for the old-ops sweep's fresh-prefix probe, on a REAL PostgreSQL —
 * production's major version, not PGlite's.
 *
 * WHAT WENT WRONG. `deleteOldSyncedOpsForAllUsers` asks, once per candidate, "does this
 * user still hold an op below the causal boundary but inside the retention window?"
 *
 *   findFirst({ where: { userId, serverSeq: { lt }, receivedAt: { gte } },
 *               orderBy: { receivedAt: 'asc' }, select: { serverSeq: true } })
 *
 * The predicate is a 2D range and NO index answers both sides as search bounds, so one
 * side is always a residual Filter and there are two candidate plans:
 *
 *   A  operations_user_id_received_at_idx   — bounded by the RETENTION WINDOW
 *   B  operations_user_id_server_seq_key    — bounded by the user's ENTIRE AGED PREFIX
 *
 * (A is the LEGACY 2-col index. The schema has since replaced it with the covering
 * 3-col form — see the COVERING_IDX note below for how this file measures both worlds.)
 *
 * B is what hit the 60s `statement_timeout` (57014) on production, and because the throw
 * escaped the per-candidate loop it cost the WHOLE FLEET its nightly retention pass. B is
 * worst precisely on the deepest histories — the cohort the sweep exists to prune — so it
 * degrades every day it fails.
 *
 * WHY IT WAS A COIN FLIP, WHICH IS THE ACTUAL DEFECT. Without the ORDER BY, A and B are
 * not merely close: with both indexes grown organically by the same inserts (production,
 * and the original form of this seed) PostgreSQL 16 costs them BIT-IDENTICALLY (both
 * `0.29..32.17 rows=2`), because under a generic plan each is "equality on user_id plus
 * one range with default selectivity". Measured, A touches 9 buffers and B touches
 * 60,329 — a ~6700x difference the cost model cannot see at all. Which one you get is
 * settled by tie-breaking no version promises to keep stable, so the same statement can
 * be instant on one server and fatal on another, or flip after a REINDEX. The second test
 * below pins that tie, because the tie IS the bug. (This harness now REBUILDS the legacy
 * index — see LEGACY_DDL — and a CREATE INDEX packs pages tighter than organic growth,
 * so the two costs land a percent or two apart here rather than byte-equal; that gap is
 * physical-stat noise, and the test asserts it stays inside noise.)
 *
 * SO THE CANDIDATES ARE MEASURED ONE AT A TIME, each with the other's index dropped inside
 * a rolled-back transaction, and no test asserts which one an unordered EXPLAIN returns.
 * That return is the flip itself, and it really does differ between machines: the seed
 * below yields the window index on one PostgreSQL 16 install and the prefix index on
 * GitHub Actions' 16.15. Reading it as "the candidate the planner chose" is how the first
 * version of this file came to fail CI while asserting something true.
 *
 * WHAT THE ORDER BY DOES. It is not a hint and it does not "prefer" A. It changes the
 * problem so the candidates stop being equivalent: A already emits `received_at` order
 * under an equality qual on `user_id`, so it sorts for free AND keeps LIMIT-1 pushdown
 * (cost 16.23), while B must add a blocking Sort over the whole matching set, losing the
 * early exit (cost 30.86). An exact tie becomes a ~2x margin and the coin flip is gone.
 * The ordering is also free of SEMANTIC risk: the probe asks only whether such a row
 * EXISTS, so which qualifying row comes back cannot change the sweep's decision.
 *
 * MEASURED UNDER force_generic_plan. Prisma sends prepared statements, so the plan is
 * built with the parameter values invisible — which is what makes the candidates tie in
 * the first place. `EXPLAIN` with literals shows a different, healthier world and would
 * hide this entirely. See explain-plan.helper.ts.
 *
 * THE SEED IS THE WHOLE TEST — do not shrink it. Under `force_generic_plan` the planner
 * estimates `user_id = $1` at ntuples/n_distinct, so a two-user seed makes that estimate
 * accurate, both candidates look cheap, and the file proves nothing. Production has ~11.5k
 * users. Hence USER_COUNT, and hence the CANARY: if B ever stops being catastrophic on
 * this seed, the seed has stopped reproducing production and every other assertion here is
 * vacuous — which is a FAILURE, not a pass.
 *
 * Prerequisites, as for the other *.integration.spec.ts files: a real PostgreSQL with the
 * schema applied (`prisma db push`) and DATABASE_URL set; skipped entirely when unset.
 *
 *   DATABASE_URL=postgresql://... npx vitest run --config vitest.integration.config.ts \
 *     tests/integration/old-ops-probe-plan.integration.spec.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { agedPrefixCausalFullStateSql } from '../../src/sync/sync.types';
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

/**
 * Large enough that `n_distinct(user_id)` makes the generic estimate for `user_id = $1`
 * far smaller than the real slice — the statistics trap that produces the tie.
 */
const USER_COUNT = 2_000;
/** The deep aged prefix the sweep would prune. All of it sits BELOW the boundary. */
const AGED_PREFIX = 30_000;
/** Recent activity, all ABOVE the boundary, so the honest answer for that user is NO. */
const WINDOW_OPS = 200;
const BOUNDARY_SEQ = AGED_PREFIX + 1;
/**
 * The heavy-activity cohort (production's user 5002 shape): a small aged
 * prefix, then a season of activity — every probe walks the whole window for
 * its NO answer. Five such users' probes were cancelled at the 60s
 * statement_timeout in the 2026-08-27 production run.
 */
const HEAVY_AGED_PREFIX = 1_000;
const HEAVY_FRESH_OPS = 20_000;
const HEAVY_BOUNDARY_SEQ = HEAVY_AGED_PREFIX + 1;

/**
 * The schema's window index is now the COVERING 3-col form (#9692 follow-up):
 * server_seq trails, so the probe's `server_seq < $2` is answered from the
 * index tuple and a NO answer qualifies for an index-only scan. The LEGACY
 * 2-col form is what the tie tests below document — it is the world every
 * not-yet-migrated install still runs (the migration is CONCURRENTLY DDL on a
 * multi-GB table, so self-hosters lag), and the ORDER BY's tie-break is what
 * protects exactly those installs. Legacy measurements recreate that index
 * inside a rolled-back transaction; nothing here assumes it exists on disk.
 */
const COVERING_IDX = 'operations_user_id_received_at_server_seq_idx';
const LEGACY_WINDOW_IDX = 'operations_user_id_received_at_idx';
const PREFIX_IDX = 'operations_user_id_server_seq_key';

/**
 * The two shapes under test. Hand-written rather than captured, because the sweep issues
 * this through the Prisma model API (not a tagged template), so there is no production
 * `Prisma.sql` to render. Keep the WHERE identical to storage-quota.service.ts's probe —
 * `orderBy` is the ONLY difference between them, which is the entire point.
 */
const WHERE_CLAUSE = `FROM "operations"
   WHERE "user_id" = $1 AND "server_seq" < $2 AND "received_at" >= $3`;
const ORDERED_SQL = `SELECT "server_seq" ${WHERE_CLAUSE} ORDER BY "received_at" ASC LIMIT 1`;
const UNORDERED_SQL = `SELECT "server_seq" ${WHERE_CLAUSE} LIMIT 1`;

/**
 * Same index, same window, but it EMITS every row instead of discarding them in
 * the access method — which is the only way an index-only scan reaches the
 * visibility-map check. SYNTHETIC: no query in src/ has this shape (see the
 * test that uses it), so treat it as the mechanism behind migration
 * 20260828000003's rationale, not as a production plan. Both columns are in the
 * covering index, so it stays index-only.
 */
const WINDOW_COUNT_SQL = `SELECT count(*) FROM "operations"
   WHERE "user_id" = $1 AND "received_at" >= $2`;

/** Rows the visibility map has NOT marked all-visible, as tuples. */
const STALE_VM_OPS = 2_000;

/**
 * One user's ops as a single INSERT ... SELECT. Module scope rather than inside
 * `beforeAll` because the visibility-map test writes a second batch mid-run, and
 * a divergent second seeder would compare two different row shapes.
 */
const seedOps = (
  userId: number,
  fromSeq: number,
  count: number,
  receivedAt: string,
): string =>
  `INSERT INTO "operations" (
     "id","user_id","client_id","server_seq","action_type","op_type","entity_type",
     "entity_id","payload","vector_clock","schema_version","client_timestamp","received_at"
   )
   SELECT '${userId}-' || (${fromSeq} + g - 1), ${userId}, 'c-${userId}',
          ${fromSeq} + g - 1, 'ADD', 'CRT', 'TASK', 'e' || (${fromSeq} + g - 1),
          '{}'::jsonb, '{}'::jsonb, 1, ${NOW}, ${receivedAt}
   FROM generate_series(1, ${count}) g`;

const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL ?? '' } } });

const runnerFor = (tx: Prisma.TransactionClient): ExplainRunner => ({
  exec: (sql) => tx.$executeRawUnsafe(sql),
  query: async (sql) => ({
    rows: (await tx.$queryRawUnsafe(sql)) as Array<Record<string, unknown>>,
  }),
});

type Plan = {
  /** Rows the plan actually walked: emitted PLUS discarded by a Filter. */
  examined: number;
  /** Root-node shared hit+read blocks — the I/O signal for heap-fetch claims. */
  blocks: number;
  /** Tuples whose page the visibility map did NOT mark all-visible. */
  heapFetches: number;
  estimatedCost: number;
  nodes: string;
};

const toPlan = (m: Measured): Plan => ({
  // ROWS EXAMINED, not `rowsTouched` alone. `rowsTouched` is Actual Rows x Loops — what a
  // node EMITS — and a NO answer emits zero down BOTH candidates, so on its own it cannot
  // tell them apart. The entire cost of the bad plan lands in `Rows Removed by Filter`.
  examined: m.rowsTouched + m.rowsFiltered + m.rowsJoinFiltered,
  blocks: m.blocks,
  heapFetches: m.heapFetches,
  estimatedCost: m.estimatedCost,
  nodes: m.nodes,
});

/**
 * PREPARE/EXECUTE is SESSION state and Prisma's pool hands out a connection per query, so
 * the EXPLAIN would otherwise land on a different backend than the PREPARE. One
 * interactive transaction pins a single connection.
 */
const measure = async (sql: string, params: readonly unknown[]): Promise<Plan> =>
  prisma.$transaction(async (tx) =>
    toPlan(await explainGeneric(runnerFor(tx), sql, params)),
  );

const ROLLBACK_SENTINEL = 'rollback-after-measuring';

/**
 * Runs `ddl` statements, measures, then forces a rollback. DDL is transactional in
 * PostgreSQL, so dropping or creating indexes and then rolling back leaves the schema
 * untouched; throwing is the only way to make Prisma roll an interactive transaction
 * back.
 *
 * This is how the file compares candidates without a hint extension (`pg_hint_plan` is
 * not installed on production, and installing it to test what production does would
 * defeat the purpose) AND how it re-enters the pre-migration legacy world.
 *
 * Every index name here is a plain index rather than a constraint-backed one —
 * `@@unique` renders as `CREATE UNIQUE INDEX` in 0_init and under `prisma db push`
 * alike — so a bare `DROP INDEX` reaches any of them.
 */
const measureUnderDdl = async (
  ddl: readonly string[],
  sql: string,
  params: readonly unknown[],
): Promise<Plan> => {
  let captured: Plan | undefined;
  try {
    await prisma.$transaction(
      async (tx) => {
        for (const statement of ddl) await tx.$executeRawUnsafe(statement);
        captured = toPlan(await explainGeneric(runnerFor(tx), sql, params));
        throw new Error(ROLLBACK_SENTINEL);
      },
      // In-txn CREATE INDEX over the whole seed takes longer than the 5s default.
      { timeout: 60_000 },
    );
  } catch (error) {
    if ((error as Error)?.message !== ROLLBACK_SENTINEL) throw error;
  }
  if (!captured) throw new Error('the plan under the DDL variant was never captured');
  return captured;
};

/**
 * Planner settings rather than DDL, but `measureUnderDdl` is the seam that runs
 * statements inside the measured transaction and rolls them back — SET LOCAL
 * dies with it, so nothing leaks into the tests that follow.
 */
const IOS_ONLY_SETTINGS = [
  'SET LOCAL enable_seqscan = off',
  'SET LOCAL enable_bitmapscan = off',
] as const;

/**
 * An ordinary hour of this user's traffic, written into the window and left
 * unvacuumed. Sequences stay above the boundary so the probe's honest answer is
 * still NO. Scrambled for the same reason the seed is (see beforeAll).
 */
const seedUnvacuumedWindowBatch = async (
  userId: number,
  fromSeq: number,
  count: number,
): Promise<void> => {
  await prisma.$executeRawUnsafe(
    `${seedOps(userId, fromSeq, count, `${CUTOFF} + g * 1000`)} ORDER BY md5(g::text)`,
  );
  // ANALYZE and not VACUUM, deliberately: it refreshes the planner's statistics
  // while leaving the visibility map untouched, isolating the map as the only
  // variable that changed.
  await prisma.$executeRawUnsafe('ANALYZE "operations"');
};

/** Heap pages the visibility map has not marked all-visible. */
const notAllVisiblePages = async (): Promise<number> => {
  const rows = await prisma.$queryRawUnsafe<Array<{ deficit: number }>>(
    `SELECT (relpages - relallvisible)::int AS deficit
       FROM pg_class WHERE relname = 'operations'`,
  );
  return rows[0]?.deficit ?? 0;
};

/**
 * The pre-migration world: covering index gone, legacy 2-col window index present.
 * The tie the file documents lives HERE — the covering index would break it by
 * width alone, so measuring the tie against today's schema would be measuring
 * nothing (see the header note on LEGACY_WINDOW_IDX for why the legacy world
 * still matters).
 */
const LEGACY_DDL = [
  `DROP INDEX ${COVERING_IDX}`,
  `CREATE INDEX ${LEGACY_WINDOW_IDX} ON "operations"("user_id", "received_at")`,
] as const;

const measureLegacy = (sql: string, params: readonly unknown[]): Promise<Plan> =>
  measureUnderDdl(LEGACY_DDL, sql, params);

/** Legacy candidate A alone — the 2-col window index is what serves `user_id`. */
const measureLegacyWindowCandidate = (
  sql: string,
  params: readonly unknown[],
): Promise<Plan> =>
  measureUnderDdl([...LEGACY_DDL, `DROP INDEX ${PREFIX_IDX}`], sql, params);

/** Legacy candidate B alone — the plan the planner had when no window index existed. */
const measureLegacyPrefixCandidate = (
  sql: string,
  params: readonly unknown[],
): Promise<Plan> => measureUnderDdl([`DROP INDEX ${COVERING_IDX}`], sql, params);

describeWithDb('Old-ops fresh-prefix probe plan (PostgreSQL)', () => {
  /** The deep-prefix user: the cohort the sweep exists to prune, and the one that timed out. */
  let deepUserId = 0;
  /** A user whose prefix DOES hold an in-window op — the `skippedFreshPrefix` answer. */
  let freshUserId = 0;
  /** The heavy-activity cohort — see HEAVY_AGED_PREFIX. */
  let heavyUserId = 0;

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "operations", "users" RESTART IDENTITY CASCADE',
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "users" ("email") SELECT 'plan-' || g || '@test.invalid' FROM generate_series(1, ${USER_COUNT}) g`,
    );
    const ids = await prisma.$queryRawUnsafe<Array<{ id: number }>>(
      'SELECT id FROM "users" ORDER BY id LIMIT 3',
    );
    deepUserId = ids[0].id;
    freshUserId = ids[1].id;
    heavyUserId = ids[2].id;

    // Deep user: a long AGED prefix, then recent activity strictly ABOVE the boundary.
    // `+ 1 - g` and not `- g`: the newest aged row has to land strictly BELOW the cutoff,
    // or it satisfies `received_at >= $3`, the deep user's honest answer flips from NO to
    // YES, and every assertion here quietly stops meaning anything.
    await prisma.$executeRawUnsafe(
      seedOps(deepUserId, 1, AGED_PREFIX, `${CUTOFF} - (${AGED_PREFIX} + 1 - g) * 1000`),
    );
    await prisma.$executeRawUnsafe(
      seedOps(deepUserId, BOUNDARY_SEQ, WINDOW_OPS, `${CUTOFF} + g * 1000`),
    );

    // Fresh user: an in-window op sits BELOW the boundary, so the probe must answer YES.
    await prisma.$executeRawUnsafe(seedOps(freshUserId, 1, 100, `${CUTOFF} - g * 1000`));
    await prisma.$executeRawUnsafe(
      seedOps(freshUserId, 101, 200, `${CUTOFF} + g * 1000`),
    );

    // Heavy user: same shape as the deep user but inverted proportions — the NO
    // answer's cost is the WINDOW, and this window is a production-sized one.
    await prisma.$executeRawUnsafe(
      seedOps(
        heavyUserId,
        1,
        HEAVY_AGED_PREFIX,
        `${CUTOFF} - (${HEAVY_AGED_PREFIX} + 1 - g) * 1000`,
      ),
    );
    // The fresh window is inserted in SCRAMBLED physical order. Production pages
    // interleave every tenant's concurrent writes, so consecutive received_at entries
    // for ONE user virtually never share a heap page and each probe step is its own
    // random heap read — that per-op read is what timed out at 9.5ms cold I/O. A
    // single-tenant seed inserted in received_at order hides this completely: the
    // scan re-fetches the page it already holds, which ReleaseAndReadBuffer doesn't
    // even count as a buffer access, and the legacy plan measures ~50x cheaper than
    // production. Scrambling restores one page transition per fetched row.
    await prisma.$executeRawUnsafe(
      `${seedOps(
        heavyUserId,
        HEAVY_BOUNDARY_SEQ,
        HEAVY_FRESH_OPS,
        `${CUTOFF} + g * 1000`,
      )} ORDER BY md5(g::text)`,
    );

    // Every other user gets a handful of rows: n_distinct is what produces the tie, so the
    // population has to be real even though only three users are ever probed.
    await prisma.$executeRawUnsafe(
      `INSERT INTO "operations" (
         "id","user_id","client_id","server_seq","action_type","op_type","entity_type",
         "entity_id","payload","vector_clock","schema_version","client_timestamp","received_at"
       )
       SELECT 'bulk-' || u || '-' || g, u, 'c-' || u, g, 'ADD', 'CRT', 'TASK', 'e' || g,
              '{}'::jsonb, '{}'::jsonb, 1, ${NOW}, ${CUTOFF} - g * 1000
       FROM generate_series(4, ${USER_COUNT}) u, generate_series(1, 5) g`,
    );

    // VACUUM, not just ANALYZE: the index-only-scan claims below depend on the
    // visibility map, which only vacuum populates. (Production's steady state:
    // pages written since the last autovacuum still cost the IOS a heap check,
    // so the covering index bounds the NO answer by RECENT activity — strictly
    // tighter than the whole window, but not zero heap.) ANALYZE rides along
    // because the planner otherwise works from empty statistics.
    await prisma.$executeRawUnsafe('VACUUM (ANALYZE) "operations"');

    // The deep user's answer MUST be NO, or this file tests nothing. Assert the fixture
    // rather than trusting the arithmetic above.
    const hit = await prisma.operation.findFirst({
      where: {
        userId: deepUserId,
        serverSeq: { lt: BOUNDARY_SEQ },
        receivedAt: { gte: BigInt(CUTOFF) },
      },
      select: { serverSeq: true },
    });
    if (hit) {
      throw new Error(
        `seed is wrong: deep user answers YES at serverSeq ${hit.serverSeq}`,
      );
    }
    const heavyHit = await prisma.operation.findFirst({
      where: {
        userId: heavyUserId,
        serverSeq: { lt: HEAVY_BOUNDARY_SEQ },
        receivedAt: { gte: BigInt(CUTOFF) },
      },
      select: { serverSeq: true },
    });
    if (heavyHit) {
      throw new Error(
        `seed is wrong: heavy user answers YES at serverSeq ${heavyHit.serverSeq}`,
      );
    }
  }, 180_000);

  afterAll(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "operations", "users" RESTART IDENTITY CASCADE',
    );
    await prisma.$disconnect();
  });

  it('finds an older checkpoint without scanning the aged prefix (#9962)', async () => {
    const query = agedPrefixCausalFullStateSql(
      deepUserId,
      BOUNDARY_SEQ + WINDOW_OPS,
      BigInt(CUTOFF),
    );
    const plan = await measureUnderDdl(
      [
        `UPDATE operations SET op_type = 'REPAIR', repair_base_server_seq = server_seq - 1
         WHERE user_id = ${deepUserId} AND server_seq = ${BOUNDARY_SEQ}`,
        `CREATE INDEX IF NOT EXISTS operations_user_id_causal_full_state_server_seq_idx
         ON operations (user_id, server_seq)
         WHERE op_type IN ('SYNC_IMPORT', 'BACKUP_IMPORT')
           OR (op_type = 'REPAIR' AND repair_base_server_seq IS NOT NULL)`,
      ],
      query.text,
      query.values,
    );
    expect(plan.nodes).toContain(COVERING_IDX);
    expect(plan.nodes).toContain('operations_user_id_causal_full_state_server_seq_idx');
    expect(plan.examined).toBeLessThan(WINDOW_OPS * 5);
  });

  it('CANARY: the prefix-bound candidate is catastrophic on this seed', async () => {
    // If this ever comes back cheap, the seed has stopped reproducing production's shape
    // and every other assertion in this file is vacuous. Failing here is the point.
    const prefixCandidate = await measureLegacyPrefixCandidate(UNORDERED_SQL, [
      deepUserId,
      BOUNDARY_SEQ,
      CUTOFF,
    ]);

    expect(prefixCandidate.nodes).toContain(PREFIX_IDX);
    expect(prefixCandidate.examined).toBeGreaterThan(AGED_PREFIX / 2);
  });

  it('without the ORDER BY the candidates are cost-tied, so the choice is luck', async () => {
    // THIS IS THE DEFECT. Not "the planner prefers the wrong index" — it cannot tell the
    // two apart AT ALL, while one of them is orders of magnitude more expensive to run. A
    // tie is settled by internals no version promises to keep stable, so the same
    // statement can be instant here and fatal on the production server.
    //
    // BOTH CANDIDATES ARE MEASURED IN ISOLATION, and the plan the planner hands back is
    // deliberately not treated as one of them, because that hand-back IS the coin flip:
    // this exact seed returns the window index on one PostgreSQL 16 install and the prefix
    // index on GitHub Actions' 16.15, where reading the winner as "the cheap candidate"
    // made the ratio below 1 and failed the run. A spec that passes or fails by the very
    // luck it exists to document is measuring the luck, not the tie.
    const windowCandidate = await measureLegacyWindowCandidate(UNORDERED_SQL, [
      deepUserId,
      BOUNDARY_SEQ,
      CUTOFF,
    ]);
    const prefixCandidate = await measureLegacyPrefixCandidate(UNORDERED_SQL, [
      deepUserId,
      BOUNDARY_SEQ,
      CUTOFF,
    ]);

    expect(windowCandidate.nodes).toContain(LEGACY_WINDOW_IDX);
    expect(prefixCandidate.nodes).toContain(PREFIX_IDX);
    // Production's organically-grown pair costs BIT-IDENTICALLY (header). The harness
    // rebuilds the legacy index with CREATE INDEX, which packs its pages tighter, so the
    // costs land ~2% apart here — still physical-stat noise (a REINDEX moves it), while
    // the true-cost spread it hides is ~100x. Asserting a noise-sized bound keeps the
    // claim: the model cannot tell the candidates apart in any way that tracks reality.
    const costGap =
      Math.abs(prefixCandidate.estimatedCost - windowCandidate.estimatedCost) /
      windowCandidate.estimatedCost;
    expect(costGap).toBeLessThan(0.05);
    // ...and the near-tie is emphatically not benign: same predicted cost, ~100x the work.
    expect(
      prefixCandidate.examined / Math.max(windowCandidate.examined, 1),
    ).toBeGreaterThan(50);

    // The planner is choosing blind BETWEEN THESE TWO, at noise-tied cost — which is the
    // claim. Which of them comes back is not asserted, only that it is one of them: pin
    // the winner and this test starts failing on whichever machine loses the flip.
    const chosen = await measureLegacy(UNORDERED_SQL, [deepUserId, BOUNDARY_SEQ, CUTOFF]);
    expect(chosen.nodes).toMatch(new RegExp(`${LEGACY_WINDOW_IDX}|${PREFIX_IDX}`));
    expect(
      Math.abs(chosen.estimatedCost - windowCandidate.estimatedCost) /
        windowCandidate.estimatedCost,
    ).toBeLessThan(0.05);
  });

  it('the ORDER BY breaks that tie by making the prefix candidate pay a Sort', async () => {
    const chosen = await measureLegacy(ORDERED_SQL, [deepUserId, BOUNDARY_SEQ, CUTOFF]);
    const prefixCandidate = await measureLegacyPrefixCandidate(ORDERED_SQL, [
      deepUserId,
      BOUNDARY_SEQ,
      CUTOFF,
    ]);

    // The window index emits `received_at` order for free, so it keeps LIMIT-1 pushdown.
    // Asserting the WINNER is legitimate here and only here: the margin below is what took
    // the choice away from the tie-break, so there is no longer a flip to lose.
    expect(chosen.nodes).toContain(LEGACY_WINDOW_IDX);
    expect(chosen.nodes).not.toContain('Sort');
    // The prefix candidate cannot, so it must materialise and sort — losing the early exit
    // and, with it, the tie.
    expect(prefixCandidate.nodes).toContain('Sort');
    expect(prefixCandidate.estimatedCost).toBeGreaterThan(chosen.estimatedCost * 1.5);
  });

  it('bounds a NO answer by the retention window, not by history depth', async () => {
    const { examined, nodes } = await measure(ORDERED_SQL, [
      deepUserId,
      BOUNDARY_SEQ,
      CUTOFF,
    ]);

    expect(nodes).toContain(COVERING_IDX);
    expect(examined).toBeLessThanOrEqual(WINDOW_OPS * 2);
    // Bounded by recent activity rather than by depth is the whole claim: assert the RATIO
    // too, so the test keeps meaning the same thing if the seed sizes are ever retuned.
    expect(examined).toBeLessThan(AGED_PREFIX / 10);
  });

  it('the covering index answers a heavy NO from the index alone (#9692 follow-up)', async () => {
    // The heavy cohort is what the legacy index could NOT serve inside 60s in
    // production: an activity-bounded NO answer is still one random heap fetch
    // per fresh op just to evaluate `server_seq < $2`, because the 2-col index
    // does not carry server_seq. With server_seq trailing in the covering
    // index the same walk stays inside the index (heap checks only for
    // not-all-visible pages), so the cost collapses from heap pages to index
    // pages. Measured as blocks — `examined` is identical in both worlds and
    // cannot see this defect at all.
    const legacy = await measureLegacy(ORDERED_SQL, [
      heavyUserId,
      HEAVY_BOUNDARY_SEQ,
      CUTOFF,
    ]);
    const covering = await measure(ORDERED_SQL, [
      heavyUserId,
      HEAVY_BOUNDARY_SEQ,
      CUTOFF,
    ]);

    // CANARY half: the legacy plan must still be paying per-row heap I/O on
    // this seed, or the comparison below is vacuous.
    expect(legacy.nodes).toContain(LEGACY_WINDOW_IDX);
    expect(legacy.blocks).toBeGreaterThan(HEAVY_FRESH_OPS / 4);
    // The claim: index-only, and an order of magnitude fewer blocks.
    expect(covering.nodes).toContain('Index Only Scan');
    expect(covering.nodes).toContain(COVERING_IDX);
    expect(covering.blocks).toBeLessThan(legacy.blocks / 8);
  });

  it('answers the probe with zero heap fetches even when the visibility map is stale', async () => {
    // MEASURED, and the opposite of what motivated migration 20260828000003.
    //
    // `server_seq < $2` is the covering index's THIRD column, so the planner
    // puts it in the Index Cond rather than a Filter, and btree applies it in
    // `_bt_checkkeys` — BEFORE the index-only scan consults the visibility map.
    // A row above the boundary is discarded inside the access method and never
    // becomes a heap-visit candidate, so a NO answer emits nothing and fetches
    // nothing however far the map has decayed.
    //
    // That makes the covering index's saving UNCONDITIONAL for this query,
    // which is a stronger guarantee than "index-only while the map is fresh".
    // It also means this query must never be used to justify an autovacuum
    // change: the shape that actually pays is the sibling test below.
    const staleBatchSeqBase = HEAVY_AGED_PREFIX + HEAVY_FRESH_OPS + 1;
    const before = await notAllVisiblePages();
    await seedUnvacuumedWindowBatch(heavyUserId, staleBatchSeqBase, STALE_VM_OPS);

    try {
      const stale = await measure(ORDERED_SQL, [heavyUserId, HEAVY_BOUNDARY_SEQ, CUTOFF]);

      // The map really is degraded — otherwise the assertion below is vacuous.
      // Asserted as GROWTH, not as "> 0": a fully vacuumed table can still show
      // a one-page deficit, because the last partially-filled page is never
      // marked all-visible. The measured growth here is ~38 pages.
      expect((await notAllVisiblePages()) - before).toBeGreaterThan(10);
      expect(stale.nodes).toContain('Index Only Scan');
      expect(stale.nodes).toContain(COVERING_IDX);
      expect(stale.heapFetches).toBe(0);
    } finally {
      // In a `finally` so a failure here cannot leak stale rows into the next
      // test and silently change the number it measures.
      await prisma.$executeRawUnsafe('VACUUM "operations"');
    }
  }, 120_000);

  it('pays one heap fetch per unvacuumed tuple once the scan actually emits rows', async () => {
    // WHY MAP DECAY COSTS ANYTHING AT ALL — and the bound on when it does.
    // Decay is invisible to the probe above because that query discards its
    // rows in the access method. Only a tuple the scan EMITS reaches the map
    // check, so an emitting index-only scan is the one shape that pays.
    //
    // READ THIS BEFORE CITING IT AS A REGRESSION GUARD: it is a mechanism
    // demonstration, not a production reproduction. `SELECT count(*) ... WHERE
    // user_id = $1 AND received_at >= $2` appears nowhere in src/, and an audit
    // of every `operations` query found none that is both index-only-capable
    // and emits volume. It also needs the planner forced, since this fixture is
    // single-tenant. So it cannot fail because of a change to this codebase —
    // it exists to pin the mechanism the migration's rationale appeals to, and
    // to stop that rationale being restated as "the probe degrades" (it does
    // not; see the sibling test).
    //
    // Measured on postgres:16-alpine against this schema: 2,000 freshly
    // inserted unvacuumed rows produced ~2,014 heap fetches on the aggregate
    // below and 0 after a VACUUM. The exact count varies with page packing, so
    // the assertions are bounds, not equality.
    //
    // Heap Fetches is the signal, NOT blocks: every page here is in
    // shared_buffers, so the degraded scan still reads cheap on this machine.
    // On a host at ~9.5ms per cold random read each fetch is real I/O, which is
    // why the assertion is on the counter and not on a timing.
    const emitBatchSeqBase = HEAVY_AGED_PREFIX + HEAVY_FRESH_OPS + STALE_VM_OPS + 1;
    await seedUnvacuumedWindowBatch(heavyUserId, emitBatchSeqBase, STALE_VM_OPS);

    const stale = await measureUnderDdl(IOS_ONLY_SETTINGS, WINDOW_COUNT_SQL, [
      heavyUserId,
      CUTOFF,
    ]);

    expect(stale.nodes).toContain('Index Only Scan');
    expect(stale.nodes).toContain(COVERING_IDX);
    expect(stale.heapFetches).toBeGreaterThan(STALE_VM_OPS / 2);

    // And vacuum is what fixes it — the whole reason an autovacuum scale factor
    // is the right instrument. (Also restores shared state for the next test.)
    await prisma.$executeRawUnsafe('VACUUM "operations"');
    const revacuumed = await measureUnderDdl(IOS_ONLY_SETTINGS, WINDOW_COUNT_SQL, [
      heavyUserId,
      CUTOFF,
    ]);
    expect(revacuumed.heapFetches).toBeLessThan(stale.heapFetches / 10);
  }, 120_000);

  it('short-circuits a YES answer on the first row', async () => {
    // `asc` and not `desc`: the in-window ops most likely to sit BELOW the boundary are
    // the oldest ones in the window, so ascending stops earliest on this cohort.
    const { examined } = await measure(ORDERED_SQL, [freshUserId, 300, CUTOFF]);

    expect(examined).toBeLessThanOrEqual(2);
  });
});
