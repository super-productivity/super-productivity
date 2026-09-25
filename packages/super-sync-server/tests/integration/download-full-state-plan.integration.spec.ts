/**
 * Plan guard for the SYNC DOWNLOAD's latest-full-state lookup, on a REAL PostgreSQL.
 *
 * WHAT WENT WRONG. `getOpsSinceWithSeq` (operation-download.service.ts) opens every
 * download by finding the newest causal full-state op at or below the transaction's
 * `latestSeq`, so it can fast-forward past superseded history. It runs on BOTH sync verbs
 * — `GET /api/sync/ops` and the `POST /api/sync/ops` piggyback — so it is a user-facing
 * hot path, not a background job. In production it was cancelled at the 60s
 * `statement_timeout` for users whose history contains no causal full-state op: the plan
 * walked their entire `(user_id, server_seq)` range, re-checking `op_type` on the HEAP
 * for every row, and never found an early exit.
 *
 * WHY THE INDEX ALONE DID NOT FIX IT. Migration 20260829000000 added
 * `operations_user_id_causal_full_state_server_seq_idx`, whose predicate is exactly this
 * query's. But Prisma sends `op_type` as BIND PARAMETERS, and `operator_predicate_proof`
 * needs `Const` nodes: a `Param` fails every branch (predtest.c), so `predOK` is false and
 * the partial index is unreachable under a generic plan.
 *
 * That migration argued the cost margin keeps such statements on custom plans. It does for
 * the fleet-wide sweep (generic 982,701 vs custom 22,844) and NOT here, for a reason the
 * migration's reasoning omits: `choose_custom_plan` compares `generic_cost` against the
 * average custom cost PLUS a synthetic planning charge of
 * `1000 * cpu_operator_cost * (nrelations + 1)` — 5.00 for a single-table query
 * (plancache.c, `cached_plan_cost`; the charge is a fixed constant, NOT measured planning
 * time). Production measured custom 1.94 against generic 4.85, so 1.94 + 5.00 = 6.94 lost
 * to 4.85 and the statement went generic at execution 6. It is not marginal: the custom
 * `Limit` cannot cost below its own 0.29 startup, so avg_custom >= 5.29 > 4.85 for EVERY
 * parameter value, on every pooled connection, always.
 *
 * THE FIX THIS FILE PINS is `latestCausalFullStateSql` (sync.types.ts): the same query with
 * the three op_type values as SQL LITERALS, which makes `predOK` provable in a generic plan
 * too. The first test asserts that property directly, because it is invisible in the
 * result — a parameterized version returns identical rows and passes every behavioural
 * test in the suite while walking the whole history.
 *
 * MEASURED WITH `force_generic_plan`, which is the faithful mode here (see
 * explain-plan.helper.ts): under `plan_cache_mode = auto` this statement provably ends up
 * generic, so the generic plan IS production's plan. That is the opposite of the sibling
 * old-ops-boundary-plan spec, whose statement stays custom and is measured as such.
 *
 * THE PARTIAL INDEXES ARE CREATED BY THIS SPEC, not by the schema: Prisma has no
 * partial-index syntax, so they live only in raw migrations and a `prisma db push`
 * database — which is how CI provisions — has neither (#9192).
 *
 *   DATABASE_URL=postgresql://... npx vitest run --config vitest.integration.config.ts \
 *     tests/integration/download-full-state-plan.integration.spec.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { explainGeneric, type ExplainRunner } from '../explain-plan.helper';
import { createIndexFromMigration } from '../migration-index.helper';
import {
  CAUSAL_FULL_STATE_OPERATION_WHERE,
  latestCausalFullStateSql,
} from '../../src/sync/sync.types';

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDb = DATABASE_URL ? describe : describe.skip;

const NOW = 1_760_000_000_000;

/** Ordinary tenants, half of them carrying a causal import. Enough that the heavy user's
 *  rows are scattered across the heap rather than clustered, as in production. */
const USER_COUNT = 300;
const OPS_PER_USER = 40;
const IMPORT_SEQ = 10;

/**
 * The user the degraded plan is catastrophic for: a long history and NO causal full-state
 * op, so a backward walk filtering `op_type` never terminates early and reads every one of
 * their rows. Production's equivalent cohort is self-reinforcing — the retention sweep only
 * prunes users who HAVE a causal boundary, so exactly these users' histories grow without
 * bound.
 */
const HEAVY_USER_ID = 1;
const HEAVY_OPS = 20_000;

/** Above every seeded server_seq, so the `server_seq <= $2` bound excludes nothing and the
 *  measurement is of the predicate alone. */
const MAX_SEQ = 1_000_000;

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
 * One scrambled INSERT, which is load-bearing rather than tidy: written in user order the
 * heavy user's rows would share heap pages and the canary's walk would look cheap. In
 * production every tenant's concurrent writes interleave, and `ORDER BY md5(...)` restores
 * that.
 */
const SEED_SQL = `INSERT INTO "operations" (
     "id","user_id","client_id","server_seq","action_type","op_type","entity_type",
     "entity_id","payload","vector_clock","schema_version","client_timestamp",
     "received_at","repair_base_server_seq"
   )
   SELECT * FROM (
     SELECT 'op-' || u || '-' || g AS id, u AS user_id, 'c-' || u AS client_id,
            g AS server_seq, 'ADD' AS action_type,
            CASE WHEN g = ${IMPORT_SEQ} AND u % 2 = 0 THEN 'SYNC_IMPORT' ELSE 'CRT' END
              AS op_type,
            'TASK' AS entity_type, 'e' || g AS entity_id, '{}'::jsonb AS payload,
            '{}'::jsonb AS vector_clock, 1 AS schema_version,
            ${NOW}::bigint AS client_timestamp, ${NOW}::bigint AS received_at,
            NULL::int AS repair_base_server_seq
     FROM generate_series(2, ${USER_COUNT}) u, generate_series(1, ${OPS_PER_USER}) g
     UNION ALL
     SELECT 'heavy-' || g, ${HEAVY_USER_ID}, 'c-heavy', g, 'ADD', 'CRT',
            'TASK', 'e' || g, '{}'::jsonb, '{}'::jsonb, 1,
            ${NOW}::bigint, ${NOW}::bigint, NULL::int
     FROM generate_series(1, ${HEAVY_OPS}) g
   ) rows
   ORDER BY md5(id)`;

const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL ?? '' } } });

const runnerFor = (tx: Prisma.TransactionClient): ExplainRunner => ({
  exec: (sql) => tx.$executeRawUnsafe(sql),
  query: async (sql) => ({
    rows: (await tx.$queryRawUnsafe(sql)) as Array<Record<string, unknown>>,
  }),
});

/** The statement production sends, taken from the exported builder rather than mirrored,
 *  so a change to the query reaches this spec without anyone editing it. */
const shipped = (userId: number): Prisma.Sql => latestCausalFullStateSql(userId, MAX_SEQ);

/**
 * The PRE-FIX statement, captured from Prisma itself. Hand-writing it would prove nothing:
 * the whole claim is about what Prisma emits, and only Prisma can be trusted to say.
 * Assigned in `beforeAll`.
 */
let legacySql = '';
let legacyParams: unknown[] = [];

const captureLegacyStatement = async (): Promise<void> => {
  const seen: Array<{ query: string; params: string }> = [];
  const logging = new PrismaClient({
    datasources: { db: { url: DATABASE_URL ?? '' } },
    log: [{ emit: 'event', level: 'query' }],
  });
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
    await logging.operation.findFirst({
      where: {
        userId: HEAVY_USER_ID,
        serverSeq: { lte: MAX_SEQ },
        ...CAUSAL_FULL_STATE_OPERATION_WHERE,
      },
      orderBy: { serverSeq: 'desc' },
      select: { serverSeq: true, clientId: true },
    });
    await Promise.race([
      captured,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 10_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    await logging.$disconnect();
  }

  const statement = seen.find((entry) => entry.query.includes('repair_base_server_seq'));
  if (!statement) {
    throw new Error('the pre-fix findFirst was not captured; Prisma stopped emitting');
  }
  legacySql = statement.query;
  legacyParams = JSON.parse(statement.params) as unknown[];
};

const measureGeneric = (
  sql: string,
  params: readonly unknown[],
): Promise<ReturnType<typeof explainGeneric> extends Promise<infer T> ? T : never> =>
  prisma.$transaction(async (tx) => explainGeneric(runnerFor(tx), sql, params));

describeWithDb('Sync download latest-full-state plan (PostgreSQL)', () => {
  beforeAll(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "operations", "users" RESTART IDENTITY CASCADE',
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "users" ("email") SELECT 'dl-' || g || '@test.invalid' FROM generate_series(1, ${USER_COUNT}) g`,
    );
    await prisma.$executeRawUnsafe(SEED_SQL);
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS ${BROAD_IDX}`);
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS ${CAUSAL_IDX}`);
    await prisma.$executeRawUnsafe(CREATE_BROAD_IDX);
    await prisma.$executeRawUnsafe(CREATE_CAUSAL_IDX);
    await prisma.$executeRawUnsafe('VACUUM (ANALYZE) "operations"');
    await captureLegacyStatement();

    const [{ heavy }] = await prisma.$queryRawUnsafe<Array<{ heavy: bigint }>>(
      `SELECT count(*) AS heavy FROM "operations" WHERE user_id = ${HEAVY_USER_ID}`,
    );
    if (Number(heavy) !== HEAVY_OPS) {
      throw new Error(
        `seed is wrong: heavy user has ${heavy} ops, expected ${HEAVY_OPS}`,
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

  it('sends the op_type values as literals, never as bind parameters', () => {
    const sql = shipped(HEAVY_USER_ID);

    // THE claim, and the one that is invisible in the result: a parameterized version
    // returns the same rows and passes every behavioural test in the suite. Only user_id
    // and the server_seq bound may be bound values.
    expect(sql.values).toEqual([HEAVY_USER_ID, MAX_SEQ]);
    expect(sql.text).toContain("'SYNC_IMPORT'");
    expect(sql.text).toContain("'BACKUP_IMPORT'");
    expect(sql.text).toContain("'REPAIR'");
    // No third placeholder: the op types are literals, not a third bound value.
    expect(sql.text).not.toContain('$3');
    // `.text` is the PostgreSQL rendering ($1, $2). `Prisma.Sql.sql` renders `?` for
    // MySQL and PostgreSQL cannot parse it — everything below feeds PREPARE, so the
    // distinction is load-bearing, not stylistic.
    expect(sql.text).toContain('$1');
    expect(sql.sql).toContain('?');
  });

  it('reaches the causal index under a GENERIC plan', async () => {
    const plan = await measureGeneric(
      shipped(HEAVY_USER_ID).text,
      shipped(HEAVY_USER_ID).values,
    );

    // Production's plan, because this statement provably never stays custom.
    expect(plan.nodes).toContain(CAUSAL_IDX);
    // The OR is dropped as implied-by-predicate rather than re-checked per row, so the
    // heavy user's 20k ops are never examined at all.
    expect(plan.rowsFiltered).toBe(0);
    expect(plan.blocks).toBeLessThan(20);
  });

  it('CANARY: the pre-fix parameterized form walks the whole history', async () => {
    const degraded = await measureGeneric(legacySql, legacyParams);

    // What shipped before `latestCausalFullStateSql`: no partial index is reachable, so
    // the planner walks (user_id, server_seq) backward and re-checks op_type on the heap.
    // If this ever goes cheap, the fix has stopped being load-bearing and the test above
    // is vacuous — which is a FAILURE, not a pass.
    expect(degraded.nodes).not.toContain(CAUSAL_IDX);
    expect(degraded.rowsFiltered).toBe(HEAVY_OPS);
    expect(degraded.blocks).toBeGreaterThan(
      50 *
        (await measureGeneric(shipped(HEAVY_USER_ID).text, shipped(HEAVY_USER_ID).values))
          .blocks,
    );
  });

  it('returns the same answer as the parameterized form', async () => {
    // The plan budgets above would all pass for a query returning the WRONG row, and this
    // one decides how far a download fast-forwards. Checked on a user who HAS a causal
    // import as well as the heavy user who has none.
    const withImport = USER_COUNT - (USER_COUNT % 2 === 0 ? 0 : 1);
    for (const userId of [HEAVY_USER_ID, withImport]) {
      const shippedRows = await prisma.$queryRaw<
        Array<{ server_seq: number; client_id: string }>
      >(shipped(userId));
      const prismaRow = await prisma.operation.findFirst({
        where: {
          userId,
          serverSeq: { lte: MAX_SEQ },
          ...CAUSAL_FULL_STATE_OPERATION_WHERE,
        },
        orderBy: { serverSeq: 'desc' },
        select: { serverSeq: true, clientId: true },
      });
      expect(shippedRows[0]?.server_seq ?? null).toBe(prismaRow?.serverSeq ?? null);
      expect(shippedRows[0]?.client_id ?? null).toBe(prismaRow?.clientId ?? null);
    }
    // Not vacuous: the heavy user must genuinely have no causal boundary, and the even
    // user must genuinely have one.
    expect((await prisma.$queryRaw<Array<unknown>>(shipped(HEAVY_USER_ID))).length).toBe(
      0,
    );
    expect((await prisma.$queryRaw<Array<unknown>>(shipped(withImport))).length).toBe(1);
  });
});
