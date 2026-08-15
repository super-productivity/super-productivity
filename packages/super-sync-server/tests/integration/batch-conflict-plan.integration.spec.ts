/**
 * Plan guard for the batch conflict lookups on a REAL PostgreSQL — production's major
 * version, not PGlite's.
 *
 * WHY THIS EXISTS SEPARATELY FROM batch-conflict-plan.pglite.spec.ts. That spec is the
 * primary guard and covers far more shapes (fan-out, wide arrays, dirty pending list),
 * but it runs on PGlite, which is PG18. Production is PG 16.x, and the two planners
 * genuinely disagree about THIS query: the same array-branch join is a nested loop on
 * PGlite and a hash join on PG 16.14, which is why `rowsTouched` rather than
 * `Rows Removed by Join Filter` is the primary signal over there. So "the plan is fine"
 * was, until this file, only ever asserted on a version nobody runs. CI already provides
 * a `postgres:16-alpine` service for the integration suite; this spends it on the one
 * assertion PGlite cannot make.
 *
 * WHAT #9503 ACTUALLY WAS. `(entity_ids && $arr OR entity_id = ANY($arr))` spans the
 * entity_ids GIN and the (user_id, entity_type, entity_id, server_seq) btree. The planner
 * abandons both and slice-scans the btree, discarding the probed user's whole
 * (user_id, entity_type) slice for a batch that matches nothing. On production that ran
 * twice per upload inside the transaction and was cancelled by `statement_timeout` every
 * 5-12 minutes.
 *
 * THE SEED IS THE WHOLE TEST — do not shrink it. The degeneracy is a STATISTICS trap, not
 * a row-count one, and it only appears when `n_distinct(user_id)` is large: under
 * `force_generic_plan` the planner cannot see the bound user id, so it estimates
 * `user_id = $n` at ntuples/n_distinct. With ~20k distinct users that estimate is ~2 rows
 * while the real slice is OWN_OPS/8 = 2500, and the btree looks irresistible. Seeded with
 * two or three users instead, the estimate is ACCURATE, PG 16.14 correctly picks a
 * BitmapOr over both indexes, the old form runs in half a millisecond and this file
 * proves nothing. That was measured, not reasoned: three smaller seeds all failed to
 * reproduce before the user population was raised. Hence the CANARY test below — if the
 * old form ever stops mis-planning here, the seed has stopped reproducing #9503 and the
 * other assertions are vacuous, which is a FAILURE, not a pass.
 *
 * Prerequisites, as for the other *.integration.spec.ts files: a real PostgreSQL with the
 * schema applied (`prisma db push`) and DATABASE_URL set; skipped entirely when unset.
 *
 *   DATABASE_URL=postgresql://... npx vitest run --config vitest.integration.config.ts \
 *     tests/integration/batch-conflict-plan.integration.spec.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import {
  detectConflictForEntities,
  prefetchLatestEntityOpsForBatch,
} from '../../src/sync/conflict';
import {
  explainGeneric,
  type ExplainRunner,
  type Measured,
} from '../explain-plan.helper';
import type { Operation } from '../../src/sync/sync.types';

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDb = DATABASE_URL ? describe : describe.skip;

/** Reserved high range so this never collides with other specs' fixtures. */
const USER_ID_BASE = 990_000;
const OWN_USER_ID = USER_ID_BASE;
const OTHER_USERS = 20_000;
const OWN_OPS = 20_000;
/** One full batch: CONFLICT_DETECTION_ENTITY_BATCH_SIZE, so exactly one statement runs. */
const PROBE_SIZE = 100;
/** Spread so the btree slice is OWN_OPS/8 — big enough to be obvious when scanned. */
const ENTITY_TYPES = [
  'TASK',
  'PROJECT',
  'TAG',
  'NOTE',
  'BOARD',
  'GLOBAL_CONFIG',
  'SIMPLE_COUNTER',
  'TASK_REPEAT_CFG',
];

const GIN_INDEX = 'operations_entity_ids_gin';
const BTREE_INDEX = 'operations_user_id_entity_type_entity_id_server_seq_idx';

/** The pathological input from #9503: a full batch of entities that match nothing. */
const brandNewIds = (): string[] =>
  Array.from({ length: PROBE_SIZE }, (_, i) => `plan-brand-new-${i}`);

const incomingOp = (): Operation =>
  ({
    id: 'op-incoming',
    clientId: 'uploader',
    actionType: '[Task] Update',
    opType: 'UPD',
    entityType: 'TASK',
    vectorClock: { uploader: 1 },
    timestamp: 1,
    schemaVersion: 1,
  }) as unknown as Operation;

/**
 * PREPARE/EXECUTE is SESSION state, and Prisma's pool hands out connections per query, so
 * the EXPLAIN would land on a different backend than the PREPARE. Every probe therefore
 * runs inside one interactive transaction, which pins a single connection.
 */
const runnerFor = (tx: Prisma.TransactionClient): ExplainRunner => ({
  exec: (sql) => tx.$executeRawUnsafe(sql),
  query: async (sql) => ({
    rows: (await tx.$queryRawUnsafe(sql)) as Array<Record<string, unknown>>,
  }),
});

/** Renders the PRODUCTION tagged template through the real `Prisma.sql`, EXPLAINs it, */
/** then executes it so the caller still gets its rows. Mirrors the PGlite sibling. */
const makeExplainingTx = (
  tx: Prisma.TransactionClient,
  measured: Measured[],
): Prisma.TransactionClient => {
  const runner = runnerFor(tx);
  const adapter = {
    $queryRaw: async <T>(
      strings: TemplateStringsArray,
      ...values: Array<Prisma.Sql | Prisma.Sql['values'][number]>
    ): Promise<T> => {
      const query = Prisma.sql(strings, ...values);
      measured.push(await explainGeneric(runner, query.text, query.values));
      return (await tx.$queryRawUnsafe(query.text, ...query.values)) as T;
    },
    operation: {
      findFirst: async (): Promise<null> => {
        throw new Error('unexpected legacy-misc findFirst in a plan probe');
      },
    },
  };
  return adapter as unknown as Prisma.TransactionClient;
};

describeWithDb('Batch conflict lookup plans (real PostgreSQL)', () => {
  let prisma: PrismaClient;

  const cleanup = async (): Promise<void> => {
    // operations cascade from users (Operation.user has onDelete: Cascade).
    await prisma.$executeRawUnsafe(`DELETE FROM users WHERE id >= ${USER_ID_BASE}`);
  };

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
    await prisma.$connect();
    await cleanup();

    // Production runs with fastupdate off (migration 20260720000000), but `prisma db push`
    // — what CI and the documented manual setup use — never applies that raw migration, so
    // the index would otherwise be left on the default `on`. Set it BEFORE the rows exist,
    // as production did, so nothing lands in a pending list and the plan is the one
    // production gets rather than a pending-list artefact.
    await prisma.$executeRawUnsafe(`ALTER INDEX "${GIN_INDEX}" SET (fastupdate = off)`);

    await prisma.$executeRawUnsafe(`
      INSERT INTO users (id, email)
      SELECT ${USER_ID_BASE} + g, 'plan-guard-' || g || '@test.local'
      FROM generate_series(0, ${OTHER_USERS}) g
    `);

    const typeExpr = `(ARRAY[${ENTITY_TYPES.map((t) => `'${t}'`).join(',')}])[1 + (g % ${ENTITY_TYPES.length})]`;
    const cols = `id, user_id, client_id, server_seq, action_type, op_type, entity_type,
                  entity_id, entity_ids, payload, vector_clock, schema_version,
                  client_timestamp, received_at`;

    // The probed user's own history: one big per-user slice.
    await prisma.$executeRawUnsafe(`
      INSERT INTO operations (${cols})
      SELECT 'plan-own-' || g, ${OWN_USER_ID}, 'seed-client', g, '[Task] Update', 'UPD',
             ${typeExpr}, 'task-' || g,
             CASE WHEN g % 10 = 0 THEN ARRAY['task-' || g, 'co-' || g] ELSE '{}'::text[] END,
             '{}'::jsonb, ('{"seed-client":' || g || '}')::jsonb, 1, 0, 0
      FROM generate_series(1, ${OWN_OPS}) g
    `);

    // A comparable population under ~20k DIFFERENT users. This is the load-bearing part:
    // it is what makes n_distinct(user_id) large and the generic-plan estimate wrong.
    await prisma.$executeRawUnsafe(`
      INSERT INTO operations (${cols})
      SELECT 'plan-other-' || g, ${USER_ID_BASE} + g, 'seed-other', g, '[Task] Update', 'UPD',
             ${typeExpr}, 'otask-' || g,
             CASE WHEN g % 10 = 0 THEN ARRAY['otask-' || g, 'oco-' || g] ELSE '{}'::text[] END,
             '{}'::jsonb, ('{"seed-other":' || g || '}')::jsonb, 1, 0, 0
      FROM generate_series(1, ${OTHER_USERS}) g
    `);

    // Statistics are the point of this fixture, so they must be real.
    await prisma.$executeRawUnsafe('ANALYZE operations');
  }, 300_000);

  afterAll(async () => {
    if (!prisma) return;
    await cleanup();
    // Leave the index as `prisma db push` created it, so this file cannot change how any
    // other spec plans.
    await prisma.$executeRawUnsafe(`ALTER INDEX "${GIN_INDEX}" RESET (fastupdate)`);
    await prisma.$disconnect();
  }, 120_000);

  /**
   * A plan that rides NEITHER index usefully is exactly the #9503 mis-plan, so requiring
   * both — plus zero rows discarded by a filter — fails it structurally, without pinning a
   * number a planner change can move.
   */
  const expectNoSliceScan = (measured: Measured): void => {
    expect(measured.rowsFiltered).toBe(0);
    expect(measured.nodes).not.toContain('Seq Scan');
    expect(measured.nodes).toContain(GIN_INDEX);
    expect(measured.nodes).toContain(BTREE_INDEX);
  };

  it('CANARY: the pre-#9503 OR form still mis-plans on this seed', async () => {
    // Without this, a planner or seed change could silently make every assertion below
    // vacuous — they would pass on a query that was never expensive here in the first
    // place. This is the shape conflict.ts USED to send.
    const ids = brandNewIds();
    const measured = await prisma.$transaction(async (tx) =>
      explainGeneric(
        runnerFor(tx),
        `SELECT DISTINCT ON (eid) eid, o.client_id, o.action_type, o.vector_clock
         FROM operations o
         CROSS JOIN LATERAL unnest(
           o.entity_ids || CASE WHEN o.entity_id IS NULL THEN '{}'::text[]
                                ELSE ARRAY[o.entity_id] END) AS eid
         WHERE o.user_id = $2 AND o.entity_type = $3
           AND (o.entity_ids && $1 OR o.entity_id = ANY($1)) AND eid = ANY($1)
         ORDER BY eid, o.server_seq DESC`,
        [ids, OWN_USER_ID, 'TASK'],
      ),
    );

    // The whole (user_id, entity_type) slice, read and thrown away for a probe that
    // matches nothing. OWN_OPS/8 = 2500; asserted loosely so autovacuum timing cannot
    // flake it.
    expect(measured.rowsFiltered).toBeGreaterThan(1_000);
  }, 120_000);

  it('detectConflictForEntities does not scan the slice on an all-new batch', async () => {
    const measured: Measured[] = [];
    const result = await prisma.$transaction(async (tx) =>
      detectConflictForEntities(
        OWN_USER_ID,
        incomingOp(),
        brandNewIds(),
        makeExplainingTx(tx, measured),
      ),
    );

    expect(result.hasConflict).toBe(false);
    expect(measured).toHaveLength(1);
    expectNoSliceScan(measured[0]);
  }, 120_000);

  it('prefetchLatestEntityOpsForBatch does not scan the slice on an all-new batch', async () => {
    const measured: Measured[] = [];
    const pairs = brandNewIds().map((entityId) => ({ entityType: 'TASK', entityId }));
    const latest = await prisma.$transaction(async (tx) =>
      prefetchLatestEntityOpsForBatch(OWN_USER_ID, pairs, makeExplainingTx(tx, measured)),
    );

    expect(latest.size).toBe(0);
    expect(measured).toHaveLength(1);
    expectNoSliceScan(measured[0]);
  }, 120_000);
});
