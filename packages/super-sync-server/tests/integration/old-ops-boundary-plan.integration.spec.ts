/**
 * Plan guard for the old-ops sweep's fleet-wide BOUNDARY SCAN, on a REAL PostgreSQL —
 * production's major version, not PGlite's.
 *
 * WHAT WENT WRONG. `deleteOldSyncedOpsForAllUsers` opens with one fleet-wide `groupBy`
 * that computes every user's causal boundary:
 *
 *   SELECT user_id, MAX(server_seq) FROM operations
 *   WHERE server_seq > 1 AND <CAUSAL_FULL_STATE_OPERATION_WHERE>
 *   GROUP BY user_id
 *
 * It is the ONLY statement in that function outside the per-candidate `try`, so its
 * failure is not one user's skip — it is the whole fleet's retention pass. On 2026-08-29
 * it was cancelled at the 60s `statement_timeout` (57014) and the sweep pruned nothing:
 * an ERROR line with no accompanying "removed N", the exact signature `cleanup.ts` logs
 * unconditionally to make visible. The sibling specs pin the PROBE
 * (old-ops-probe-plan) and the DELETE batches (old-ops-delete-plan); this statement — the
 * one that actually aborted the sweep — had no plan guard at all.
 *
 * WHY IT WAS SLOW. Production measured the index side at 2.5ms / 92 buffers and the
 * Bitmap Heap Scan at 33,728ms / 3,930 heap blocks: ~100% of the runtime is random heap
 * access, because `op_type` and `repair_base_server_seq` are not in the broad partial
 * index and the residual Filter costs one heap visit per candidate row. At the host's
 * ~150 IOPS those blocks are ~24s of pure I/O, which is why the statement sat BISTABLE
 * around the 60s cap — 33.7s with a half-warm cache, over the cap whenever an autovacuum
 * was competing for the same disk. So the budget that matters here is HEAP FETCHES, not
 * wall time and not `blocks` (a warm page is a hit and hides the whole problem).
 *
 * WHY `INCLUDE` WAS NOT THE FIX, which is what this file's first test really pins.
 * `predicate_implied_by` cannot prove `(A OR B) => op_type IN (3-set)`: predtest.c's rule
 * for a disjunctive predicate is "the clause implies SOME ONE disjunct", and a clause that
 * is itself an OR needs case analysis the prover does not do. So no index-only path is
 * generated at all and the only route into the broad index is `generate_bitmap_or_paths`
 * splitting the OR into two provable arms — the duplicated `BitmapOr` in the production
 * plan, the same index scanned twice and OR'd with itself. A Bitmap Heap Scan discards the
 * index tuple, so INCLUDE columns are unreachable by construction. Migration
 * 20260829000000 instead gives the index the causal predicate VERBATIM, so
 * `create_indexscan_plan` drops the whole OR as implied-by-predicate and `server_seq`
 * answers what is left as a key column.
 *
 * MEASURED UNDER force_custom_plan — deliberately, and this file is the exception to
 * explain-plan.helper.ts's "never measure the custom plan" rule. A PARTIAL index is
 * unreachable under a generic plan at all: with `Param` nodes there are no `Const`s for
 * `operator_predicate_proof`, so `predOK` is false for every partial index on this table.
 * Production measured custom = BitmapOr cost 22,844 against generic = Parallel Seq Scan
 * cost 982,701, and `choose_custom_plan` adopts the generic plan only when its cost is
 * STRICTLY BELOW the average custom cost — a 43x margin that pins this statement on custom
 * plans. That margin is a load-bearing assumption rather than a detail, so the third test
 * asserts it directly. If it ever inverts, CI fails instead of production.
 *
 * THE MARGIN DOES NOT GENERALISE, and migration 20260829000000's comment reads as though
 * it does. The average custom cost includes a synthetic planning charge of
 * `1000 * cpu_operator_cost * (nrelations + 1)` = 5.00 for a single-table query
 * (plancache.c, `cached_plan_cost`) — a fixed constant, not measured planning time. It is
 * noise against 22,844 and decisive for a cheap statement: the sync download's
 * latest-full-state lookup shares this predicate, planned at 1.94 against a generic 4.85,
 * and went generic unconditionally. That is why it now ships literals; see
 * download-full-state-plan.integration.spec.ts.
 *
 * THE PARTIAL INDEXES ARE CREATED BY THIS SPEC, not by the schema. Prisma has no
 * partial-index syntax, so both live only in raw migrations and a `prisma db push`
 * database has NEITHER (#9192) — which is how CI provisions
 * (supersync-server-tests.yml), so dropping them again in `afterAll` restores the exact
 * starting state. Their DDL is READ OUT OF the migration files rather than copied, so
 * this file cannot drift into measuring a world that does not ship.
 *
 * Prerequisites, as for the other *.integration.spec.ts files: a real PostgreSQL with the
 * schema applied (`prisma db push`) and DATABASE_URL set; skipped entirely when unset.
 *
 *   DATABASE_URL=postgresql://... npx vitest run --config vitest.integration.config.ts \
 *     tests/integration/old-ops-boundary-plan.integration.spec.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  explainCustom,
  explainGeneric,
  type ExplainRunner,
  type Measured,
} from '../explain-plan.helper';
import { CAUSAL_FULL_STATE_OPERATION_WHERE } from '../../src/sync/sync.types';
import { createIndexFromMigration } from '../migration-index.helper';

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDb = DATABASE_URL ? describe : describe.skip;

const NOW = 1_760_000_000_000;

/**
 * Large enough that the fleet-wide aggregate is a real aggregate. Production groups 2,933
 * users out of ~11.5k; a handful of users would make every candidate plan look cheap and
 * the file would prove nothing.
 */
const USER_COUNT = 2_000;
/** Ops per user. USER_COUNT x OPS_PER_USER rows have to span enough heap pages that the
 *  canary's scattered fetches are visibly catastrophic — see the CANARY test. */
const OPS_PER_USER = 30;
/** Every user's causal import lands here; every user's REPAIR here. Both > 1, so neither
 *  is excluded by the sweep's `server_seq > 1` (which skips users whose only boundary is
 *  the initial import at seq 1). */
const IMPORT_SEQ = 10;
const REPAIR_SEQ = 20;

/**
 * Production's shape: 3,162 causal rows, 651 legacy REPAIRs discarded by the Filter, 2,933
 * groups. Reproduced here as one import per user plus a REPAIR for every user, of which
 * every 4th carries NO base cursor and must be excluded.
 */
const LEGACY_REPAIR_USERS = USER_COUNT / 4;
const CAUSAL_ROWS = USER_COUNT + (USER_COUNT - LEGACY_REPAIR_USERS);

/**
 * The unvacuumed tail. Production is 9.1M rows against this fixture's 60k, and the gap
 * that actually matters is NOT the row count — it is that a freshly-VACUUMed fixture has a
 * perfect visibility map and production never does. `20260828000003` holds the insert
 * scale factor at 0.02, so between vacuums up to ~172k freshly-inserted rows sit on pages
 * the map does not mark all-visible, and an index-only scan pays one heap fetch per
 * EMITTED tuple on such a page (measured for the fresh-prefix probe in #9791).
 *
 * That cost is bounded by RECENT CAUSAL rows, not by table size, and this is the number
 * that says so: the tail is overwhelmingly ordinary ops, and a full-state op is rare.
 */
const TAIL_OPS = 2_000;
const TAIL_CAUSAL = 5;

const CAUSAL_IDX = 'operations_user_id_causal_full_state_server_seq_idx';
const BROAD_IDX = 'operations_user_id_full_state_server_seq_idx';

const CREATE_BROAD_IDX = createIndexFromMigration(
  '20260512000000_add_full_state_sequence_index_drop_redundant_indexes',
  BROAD_IDX,
);
const CREATE_CAUSAL_IDX = createIndexFromMigration(
  '20260829000000_add_causal_full_state_index',
  CAUSAL_IDX,
);

/**
 * The statement under test is CAPTURED FROM PRISMA, not written here.
 *
 * The sweep issues it through `prisma.operation.groupBy` (not a tagged template), so a
 * spec that wants to measure the real thing has to make Prisma emit it and read the query
 * log. An earlier version of this file hand-wrote a mirror instead, and the mirror was
 * wrong in a way review would not catch: Prisma appends `OFFSET $5` and schema-qualifies
 * every column. The OFFSET folds away under a custom plan — but "the difference happened
 * not to matter this time" is exactly the reasoning a captured statement makes
 * unnecessary. A mirror can also drift silently the moment the `where` in
 * storage-quota.service.ts changes; this cannot.
 *
 * Assigned in `beforeAll`, so every helper below reads it at call time.
 */
/** Generous: the race resolves the instant the event lands, so this is only a floor
 * under the error message, never a cost the passing path pays. */
const CAPTURE_TIMEOUT_MS = 10_000;

let boundarySql = '';
let boundaryParams: unknown[] = [];

/**
 * Runs the sweep's OWN `groupBy` against a logging client and returns what Postgres
 * received. The `where` is spread from CAUSAL_FULL_STATE_OPERATION_WHERE exactly as
 * `deleteOldSyncedOpsForAllUsers` spreads it, so importing the constant is the point:
 * a change to the causal predicate reaches this spec without anyone editing it.
 */
const captureBoundaryStatement = async (): Promise<void> => {
  const seen: Array<{ query: string; params: string }> = [];
  const logging = new PrismaClient({
    datasources: { db: { url: DATABASE_URL ?? '' } },
    log: [{ emit: 'event', level: 'query' }],
  });

  // The query event is emitted asynchronously, AFTER the groupBy call resolves, so the
  // capture has to wait for it. Waiting for the event itself rather than sleeping a fixed
  // interval: a sleep is simultaneously too slow (it always pays its full cost) and too
  // fragile (a loaded CI box can miss any interval short enough to be worth paying).
  let arrived: (() => void) | undefined;
  const captured = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  (
    logging as unknown as {
      $on: (event: 'query', cb: (e: { query: string; params: string }) => void) => void;
    }
  ).$on('query', (e) => {
    seen.push({ query: e.query, params: e.params });
    if (e.query.includes('repair_base_server_seq')) arrived?.();
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await logging.operation.groupBy({
      by: ['userId'],
      where: { serverSeq: { gt: 1 }, ...CAUSAL_FULL_STATE_OPERATION_WHERE },
      _max: { serverSeq: true },
    });
    await Promise.race([
      captured,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, CAPTURE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    await logging.$disconnect();
  }

  const statement = seen.find((entry) => entry.query.includes('repair_base_server_seq'));
  if (!statement) {
    throw new Error(
      `the boundary groupBy was not captured within ${CAPTURE_TIMEOUT_MS}ms; saw ` +
        `${seen.length} statements. Prisma may have stopped emitting query events, or ` +
        "the sweep's where-clause changed.",
    );
  }
  boundarySql = statement.query;
  boundaryParams = JSON.parse(statement.params) as unknown[];
};

/**
 * Every row in ONE scrambled INSERT, which is load-bearing rather than tidy. Full-state
 * rows written as a separate trailing batch would land on consecutive heap pages, the
 * bitmap heap scan would fetch a few dozen blocks instead of hundreds, and the canary
 * would pass while measuring nothing. Production interleaves every tenant's concurrent
 * writes, so a user's full-state ops virtually never share a page — `ORDER BY md5(...)`
 * restores that.
 */
const SEED_SQL = `INSERT INTO "operations" (
     "id","user_id","client_id","server_seq","action_type","op_type","entity_type",
     "entity_id","payload","vector_clock","schema_version","client_timestamp",
     "received_at","repair_base_server_seq"
   )
   SELECT 'op-' || u || '-' || g, u, 'c-' || u, g, 'ADD',
          CASE WHEN g = ${IMPORT_SEQ} THEN 'SYNC_IMPORT'
               WHEN g = ${REPAIR_SEQ} THEN 'REPAIR'
               ELSE 'CRT' END,
          'TASK', 'e' || g, '{}'::jsonb, '{}'::jsonb, 1, ${NOW}, ${NOW} - g * 1000,
          CASE WHEN g = ${REPAIR_SEQ} AND u % 4 <> 0 THEN 5 ELSE NULL END
   FROM generate_series(1, ${USER_COUNT}) u, generate_series(1, ${OPS_PER_USER}) g
   ORDER BY md5((u * 1000 + g)::text)`;

/**
 * Appends a fresh, uncommitted tail. Run inside the measuring transaction the rows are
 * never marked all-visible — no vacuum can reach an open transaction's tuples — which is
 * exactly the state production's table is in for most of the day.
 */
const TAIL_SQL = `INSERT INTO "operations" (
     "id","user_id","client_id","server_seq","action_type","op_type","entity_type",
     "entity_id","payload","vector_clock","schema_version","client_timestamp",
     "received_at","repair_base_server_seq"
   )
   SELECT 'tail-' || t, ((t - 1) % ${USER_COUNT}) + 1, 'c-tail', ${OPS_PER_USER} + t, 'ADD',
          CASE WHEN t <= ${TAIL_CAUSAL} THEN 'SYNC_IMPORT' ELSE 'CRT' END,
          'TASK', 'e' || t, '{}'::jsonb, '{}'::jsonb, 1, ${NOW}, ${NOW}, NULL
   FROM generate_series(1, ${TAIL_OPS}) t`;

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
  /** Root-node shared hit+read blocks. */
  blocks: number;
  /** Tuples whose page the visibility map did NOT mark all-visible. THE budget here. */
  heapFetches: number;
  rowsFiltered: number;
  estimatedCost: number;
  nodes: string;
};

const toPlan = (m: Measured): Plan => ({
  examined: m.rowsTouched + m.rowsFiltered + m.rowsJoinFiltered,
  blocks: m.blocks,
  heapFetches: m.heapFetches,
  rowsFiltered: m.rowsFiltered,
  estimatedCost: m.estimatedCost,
  nodes: m.nodes,
});

/**
 * PREPARE/EXECUTE is SESSION state and Prisma's pool hands out a connection per query, so
 * the EXPLAIN would otherwise land on a different backend than the PREPARE. One
 * interactive transaction pins a single connection.
 */
const measureCustom = async (): Promise<Plan> =>
  prisma.$transaction(async (tx) =>
    toPlan(await explainCustom(runnerFor(tx), boundarySql, boundaryParams)),
  );

const measureGeneric = async (): Promise<Plan> =>
  prisma.$transaction(async (tx) =>
    toPlan(await explainGeneric(runnerFor(tx), boundarySql, boundaryParams)),
  );

const ROLLBACK_SENTINEL = 'rollback-after-measuring';

/**
 * Runs `setup`, hands the transaction to `observe`, then forces a rollback. Both DDL and
 * writes are transactional in PostgreSQL, so dropping an index or appending rows and
 * rolling back leaves the fixture untouched; throwing is the only way to make Prisma roll
 * an interactive transaction back.
 *
 * The rollback is what makes the fixture reusable across variants, and for the tail
 * variant it is also the MECHANISM: tuples written by a transaction that never commits
 * cannot be marked all-visible by any vacuum, which is the state being measured.
 */
const inRolledBackTx = async <T>(
  setup: readonly string[],
  observe: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> => {
  let captured: { value: T } | undefined;
  try {
    await prisma.$transaction(
      async (tx) => {
        for (const statement of setup) await tx.$executeRawUnsafe(statement);
        captured = { value: await observe(tx) };
        throw new Error(ROLLBACK_SENTINEL);
      },
      { timeout: 60_000 },
    );
  } catch (error) {
    if ((error as Error)?.message !== ROLLBACK_SENTINEL) throw error;
  }
  if (!captured) throw new Error('the rolled-back variant produced no observation');
  return captured.value;
};

const measureCustomAfter = (setup: readonly string[]): Promise<Plan> =>
  inRolledBackTx(setup, async (tx) =>
    toPlan(await explainCustom(runnerFor(tx), boundarySql, boundaryParams)),
  );

type BoundaryRow = Record<string, unknown>;

/** The boundary query's ANSWER, not its plan. */
const boundaryRowsAfter = (setup: readonly string[]): Promise<BoundaryRow[]> =>
  inRolledBackTx(setup, (tx) =>
    tx.$queryRawUnsafe<BoundaryRow[]>(boundarySql, ...boundaryParams),
  );

/**
 * Column names come from Prisma's own SELECT list (`MAX(...)` renders as `max`), so a
 * shape change here means the captured statement changed — worth a loud failure rather
 * than a silent `NaN` that would make the comparison below pass on nothing.
 */
const boundaryOf = (row: BoundaryRow): [number, number] => {
  if (row.user_id === undefined || row.max === undefined) {
    throw new Error(`unexpected boundary row shape: ${JSON.stringify(Object.keys(row))}`);
  }
  return [Number(row.user_id), Number(row.max)];
};

const asComparable = (rows: BoundaryRow[]): string =>
  JSON.stringify(rows.map(boundaryOf).sort((a, b) => a[0] - b[0]));

describeWithDb('Old-ops boundary scan plan (PostgreSQL)', () => {
  beforeAll(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "operations", "users" RESTART IDENTITY CASCADE',
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "users" ("email") SELECT 'boundary-' || g || '@test.invalid' FROM generate_series(1, ${USER_COUNT}) g`,
    );
    await prisma.$executeRawUnsafe(SEED_SQL);
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS ${BROAD_IDX}`);
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS ${CAUSAL_IDX}`);
    await prisma.$executeRawUnsafe(CREATE_BROAD_IDX);
    await prisma.$executeRawUnsafe(CREATE_CAUSAL_IDX);
    // VACUUM, not just ANALYZE: `Heap Fetches: 0` is a claim about the VISIBILITY MAP,
    // which only vacuum populates. ANALYZE rides along because the planner otherwise
    // works from empty statistics.
    await prisma.$executeRawUnsafe('VACUUM (ANALYZE) "operations"');

    await captureBoundaryStatement();

    // Assert the FIXTURE, not the arithmetic above: if these counts drift, every budget
    // below silently stops meaning what its comment says.
    const rows = await prisma.$queryRawUnsafe<Array<{ causal: bigint; legacy: bigint }>>(
      `SELECT
         count(*) FILTER (
           WHERE op_type IN ('SYNC_IMPORT','BACKUP_IMPORT')
              OR (op_type = 'REPAIR' AND repair_base_server_seq IS NOT NULL)
         ) AS causal,
         count(*) FILTER (
           WHERE op_type = 'REPAIR' AND repair_base_server_seq IS NULL
         ) AS legacy
       FROM "operations"`,
    );
    if (Number(rows[0].causal) !== CAUSAL_ROWS) {
      throw new Error(
        `seed is wrong: ${rows[0].causal} causal rows, expected ${CAUSAL_ROWS}`,
      );
    }
    if (Number(rows[0].legacy) !== LEGACY_REPAIR_USERS) {
      throw new Error(
        `seed is wrong: ${rows[0].legacy} legacy REPAIRs, expected ${LEGACY_REPAIR_USERS}`,
      );
    }
  }, 180_000);

  afterAll(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "operations", "users" RESTART IDENTITY CASCADE',
    );
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS ${CAUSAL_IDX}`);
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS ${BROAD_IDX}`);
    await prisma.$disconnect();
  });

  it('answers the boundary scan without touching the heap', async () => {
    const plan = await measureCustom();

    // Measuring what the sweep SENDS, not a paraphrase of it. This one marker is the
    // whole claim — the clause the partial index has to be proven against. Prisma-isms
    // like the trailing `OFFSET 0` are deliberately NOT asserted: they are artifacts of
    // a client version, so pinning them turns a dependency bump into a red build in the
    // one file whose value is that its failures are real.
    expect(boundarySql).toContain('repair_base_server_seq" IS NOT NULL');

    // THE budget. `blocks` cannot carry this claim: a heap page still in shared_buffers
    // is a hit, so a fully degraded scan reads cheap here and is catastrophic on a
    // production host where that page is cold — which is exactly how this statement
    // measured 33.7s on one run and blew a 60s cap on another.
    expect(plan.heapFetches).toBe(0);
    // Every causal row is emitted; nothing is discarded by a residual Filter, because the
    // OR is dropped as implied-by-predicate rather than re-checked per row.
    expect(plan.rowsFiltered).toBe(0);
    // `examined` sums Actual Rows over the WHOLE tree (see explain-plan.helper.ts), so a
    // scan-plus-aggregate plan reports the causal rows AND one row per group. Asserting
    // the exact total is deliberate: a plan that grows a node — a Gather, a re-check, a
    // second scan of the same index — changes this number, and that is a regression this
    // file should catch rather than tolerate.
    expect(plan.examined).toBe(CAUSAL_ROWS + USER_COUNT);
    // Scales with full-state rows, not with the table: this is the causal index's own
    // page count and nothing else (measured 12 on PG 16.15, against the canary's 1,099).
    // Loose enough to survive different page packing, tight enough that a plan which
    // starts touching the heap again cannot pass.
    expect(plan.blocks).toBeLessThan(50);
  });

  it('CANARY: without the causal index the same query is heap-bound', async () => {
    const degraded = await measureCustomAfter([`DROP INDEX ${CAUSAL_IDX}`]);

    // The pre-migration world: the broad index cannot answer `repair_base_server_seq`, so
    // every candidate row costs a heap visit and the legacy REPAIRs are discarded only
    // after being fetched. If this ever goes cheap, the SEED has stopped reproducing
    // production and the first test is vacuous — which is a FAILURE, not a pass.
    expect(degraded.rowsFiltered).toBe(LEGACY_REPAIR_USERS);
    expect(degraded.blocks).toBeGreaterThan(300);
    expect(degraded.blocks).toBeGreaterThan(10 * (await measureCustom()).blocks);
  });

  it('stays index-only against an unvacuumed tail', async () => {
    const tail = await measureCustomAfter([TAIL_SQL]);

    // The bridge from this 60k fixture to production's 9.1M rows. `Heap Fetches: 0` in the
    // first test is measured right after a VACUUM, which production's table never is —
    // so on its own that number would be a best case dressed up as a budget.
    //
    // The exact count is the point: the whole tail lands on pages the visibility map
    // cannot mark (the transaction is still open), yet only the CAUSAL few cost a
    // fetch, because the partial index does not contain the rest. Map decay therefore
    // costs this statement in proportion to RECENT full-state ops — a handful a day —
    // and not in proportion to the table, which is what makes the win survive at scale.
    expect(tail.heapFetches).toBe(TAIL_CAUSAL);
    expect(tail.blocks).toBeLessThan(50);
  });

  it('returns the same boundaries with and without the causal index', async () => {
    // The plan budgets above would all pass for a query that returns the WRONG rows. The
    // sweep authorizes deletions from these boundaries, so the index has to be provably
    // invisible in the answer, not just cheaper: same users, same MAX(server_seq).
    const withIndex = await boundaryRowsAfter([]);
    const withoutIndex = await boundaryRowsAfter([`DROP INDEX ${CAUSAL_IDX}`]);

    expect(withIndex).toHaveLength(USER_COUNT);
    expect(asComparable(withIndex)).toBe(asComparable(withoutIndex));
    // Not vacuous: every user's boundary is the REPAIR where one counts and the import
    // otherwise, so a predicate that let legacy REPAIRs through would move these numbers.
    const boundaries = new Set(withIndex.map((r) => boundaryOf(r)[1]));
    expect([...boundaries].sort((a, b) => a - b)).toEqual([IMPORT_SEQ, REPAIR_SEQ]);
  });

  it('pins the custom-plan margin the fix depends on', async () => {
    const custom = await measureCustom();
    const generic = await measureGeneric();

    // A partial index is unreachable under a generic plan: with `Param` nodes there are no
    // `Const`s for operator_predicate_proof, so predOK is false for BOTH partial indexes
    // and the planner is left with a sequential scan.
    expect(generic.nodes).toContain('Seq Scan');
    expect(custom.nodes).not.toContain('Seq Scan');

    // The load-bearing assumption, stated as an assertion. `choose_custom_plan` adopts the
    // generic plan only when its cost is strictly below the average custom cost PLUS a
    // 5.00 planning charge; production measured 982,701 against 22,844. A margin this wide
    // is why the SWEEP can rely on a custom plan without a $queryRaw. It is specific to
    // this statement's cost, not a property of the predicate: the download path's lookup
    // is cheap enough that the same charge decides against it, so that one ships literals.
    // If this inverts, the sweep needs them too.
    expect(generic.estimatedCost).toBeGreaterThan(5 * custom.estimatedCost);
  });
});
