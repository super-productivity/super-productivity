import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { detectConflictForEntity } from '../src/sync/conflict';
import { isEntityArrayBranchQuery } from './sync.service.test-state';
import type { Operation } from '../src/sync/sync.types';

/**
 * Production incident regression: the single-entity conflict lookup read a user's
 * entire (user_id, entity_type) slice on every upload of a not-yet-seen entity.
 * The mechanism, the rejected alternatives and the isolation caveat are documented
 * once, at detectConflictForEntity in src/sync/conflict.ts — not repeated here.
 *
 * This spec runs the REAL detectConflictForEntity against in-process Postgres
 * (PGlite — no Docker, no DATABASE_URL) through a tx shim that renders each Prisma
 * call as the SQL Prisma emits and EXPLAINs it. The array branch is NOT rebuilt from
 * a constant: the shim reconstructs it from the actual tagged-template text, so the
 * SQL under test is byte-for-byte what conflict.ts sends. That is what lets a change
 * to the aggregate (MAX -> MIN), the fence (dropping MATERIALIZED) or the CTE shape
 * fail here instead of passing against a stale copy.
 *
 * MEASURE WITH `force_generic_plan`, NEVER WITH LITERALS. Prisma sends parameterized
 * prepared statements; under the default `auto` Postgres plans the first ~5 executions as
 * CUSTOM, then compares the generic cost against the average custom cost and MAY switch to
 * a generic plan — a cost comparison, not an automatic switch, so a statement can stay on
 * custom plans indefinitely. THIS one was observed going generic on production, and a
 * generic plan cannot see parameter values, so that is the mode this file covers.
 * Production also serves custom plans and this file does NOT cover them (a
 * custom-plan-only regression is possible; see the rejected `server_seq >` narrowing in
 * conflict.ts). `EXPLAIN` with literal constants is a third thing again, and is the trap:
 * this file once tested that way and the blind spot passed two designs that were
 * catastrophic in production. EVERYTHING here — including the shim — goes through
 * explainGeneric. If you add a shape, use explainGeneric.
 *
 * WHY THE SEED SHAPE IS WHAT IT IS — do not "simplify" it:
 *
 *  - entity_ids stays '{}' on EVERY row. The planner only mis-plans when it has no
 *    array-element statistics for entity_ids, falling back to a default `@>`
 *    selectivity. That is the DEPLOYED state: entity_ids was added by migration
 *    20260613000000 with no backfill, and getStoredEntityIds stores [] for every
 *    single-entity op. Populating the column here silently disarms the regression.
 *  - MANY users and MANY entity types. This is the load-bearing part. With one user
 *    and one entity_type the GIN estimate (which scales with the whole table) and the
 *    btree-slice estimate (N / (users x entity_types)) cover the SAME rows, so GIN
 *    always wins on cost and no regression is detectable. That degenerate shape is
 *    why this suite could not catch the outage. At 20k rows for the probed user plus
 *    20k spread over ~20k other users across 8 entity types, PGlite reproduces the
 *    SHAPE of the production mis-plan (same nodes, same discarded-row signature) and
 *    the regression lands ~2.7x over the block budget — 816 against MAX_BLOCKS 300.
 *    Node-for-node identity with production is NOT claimed; see the fidelity limit
 *    below.
 *  - THE INDEXES ARE CREATED BEFORE THE ROWS. This is not cosmetic ordering. Building
 *    the GIN after a bulk load produces a compact, pending-list-free index, and the
 *    array branch then measures 2 blocks — a number production only sees right after a
 *    vacuum. In production the index pre-exists and rows arrive one op at a time, so
 *    inserts land in the GIN pending list (fastupdate defaults to on) which `@>` must
 *    scan linearly: same data, same query, 140 blocks and a 14x larger index (1120 kB
 *    vs 72 kB). VACUUM flushes the pending list and restores 2 blocks, so the real cost
 *    OSCILLATES across the autovacuum cycle. This suite therefore seeds in production
 *    order and never vacuums, measuring the dirty end of that cycle rather than the
 *    freshly-vacuumed end — but 140 is NOT a ceiling: the pending list is bounded by
 *    gin_pending_list_limit (4MB default), not by anything in this seed, so a
 *    production write burst can be worse. The budget below is calibrated to catch the
 *    mis-plan, NOT to certify a maximum. Setting fastupdate=off stops new entries
 *    queueing — it does not flush what is already pending, which still needs a VACUUM —
 *    and so removes the oscillation going forward.
 *
 * REMAINING FIDELITY LIMIT: PGlite is not the production cluster — different major
 * version, and it reports every block as a cache hit, so these counts cannot model
 * cold-cache I/O.
 */

const OWN_OPS = 20_000;
const OTHER_OPS = 20_000;
const USER_ID = 1;
/** Entity types are spread across the seed so the btree slice is N/(users x types). */
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
/** seq % ENTITY_TYPES.length === 0 => 'TASK', so this row is in the probed slice. */
const DEEP_ENTITY_SEQ = 16;

const CREATE_TABLE = `
  CREATE TABLE operations (
    id             text PRIMARY KEY,
    user_id        integer NOT NULL,
    client_id      text NOT NULL,
    -- integer, NOT bigint: production maps serverSeq as Prisma Int, so this matches the
    -- deployed column type. It is a FIDELITY fix and nothing more — it does not make
    -- dropping the production ::int cast catchable, because over an integer column MAX()
    -- already returns integer and the cast is a no-op either way.
    server_seq     integer NOT NULL,
    action_type    text NOT NULL,
    entity_type    text NOT NULL,
    entity_id      text,
    entity_ids     text[] NOT NULL DEFAULT '{}',
    schema_version integer NOT NULL DEFAULT 1,
    vector_clock   jsonb NOT NULL
  );
`;

// A deliberate SUBSET of prisma/schema.prisma + the migrations — the three indexes this
// lookup can actually ride: 0_init (the (user_id, server_seq) unique the backward walk
// rides on), 20260511000000 (the entity btree) and 20260613000001 (the entity_ids GIN).
// Production also has a PK on id plus (user_id, client_id) and (user_id, received_at)
// btrees; they are left out because no predicate here can use them. Add them if a new
// shape could.
const CREATE_INDEXES = `
  CREATE UNIQUE INDEX operations_user_id_server_seq_key
    ON operations (user_id, server_seq);
  CREATE INDEX operations_user_id_entity_type_entity_id_server_seq_idx
    ON operations (user_id, entity_type, entity_id, server_seq);
  CREATE INDEX operations_entity_ids_gin ON operations USING GIN (entity_ids);
`;

const INSERT_COLS =
  'id,user_id,client_id,server_seq,action_type,entity_type,entity_id,entity_ids,' +
  'schema_version,vector_clock';

type PlanStats = {
  blocks: number;
  rowsFiltered: number;
  sql: string[];
  rawSql: string[];
  /** Plan node types + index names, per measured query, parallel to `sql`. */
  nodes: string[];
};
type PlanNode = Record<string, unknown>;
type Measured = { blocks: number; rowsFiltered: number; nodes: string };

const newStats = (): PlanStats => ({
  blocks: 0,
  rowsFiltered: 0,
  sql: [],
  rawSql: [],
  nodes: [],
});

/**
 * Walks the plan tree for node names and filtered-row counts.
 *
 * Blocks are deliberately NOT summed here: `Shared Hit/Read Blocks` are CUMULATIVE,
 * so a parent already includes everything its children read. Summing every node
 * double-counts the same buffers once per level of nesting, inflating deep plans
 * (the CTE form nests one level deeper than the flat one) and biasing the budgets
 * against the new code. The ROOT node's value is the true total.
 */
const accumulatePlan = (node: PlanNode, stats: PlanStats, nodes: string[]): void => {
  stats.rowsFiltered += (node['Rows Removed by Filter'] as number) ?? 0;
  nodes.push(
    `${node['Node Type']}${node['Scan Direction'] ? ' ' + node['Scan Direction'] : ''}` +
      `${node['Index Name'] ? ' on ' + node['Index Name'] : ''}`,
  );
  for (const child of (node.Plans as PlanNode[]) ?? []) {
    accumulatePlan(child, stats, nodes);
  }
};

const rootBlocks = (node: PlanNode): number =>
  ((node['Shared Hit Blocks'] as number) ?? 0) +
  ((node['Shared Read Blocks'] as number) ?? 0);

const toSqlLiteral = (value: unknown): string => {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (Array.isArray(value)) {
    return `ARRAY[${value.map(toSqlLiteral).join(',')}]::text[]`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
};

/**
 * EXPLAIN through PREPARE/EXECUTE under `force_generic_plan` — the ONLY faithful way
 * to see what production gets. The params are rendered as literals for EXECUTE, but
 * the PLAN is built at PREPARE time with the values invisible, which is exactly the
 * situation Prisma puts Postgres in.
 */
let preparedCounterId = 0;
const explainGeneric = async (
  db: PGlite,
  sql: string,
  params: readonly unknown[],
): Promise<Measured> => {
  const name = `plan_probe_${preparedCounterId++}`;
  const args = params.map(toSqlLiteral).join(', ');
  await db.exec(`SET plan_cache_mode = force_generic_plan`);
  await db.exec(`PREPARE ${name} AS ${sql}`);
  try {
    const res = await db.query<Record<string, unknown>>(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) EXECUTE ${name}${args ? `(${args})` : ''}`,
    );
    const plan = (res.rows[0]['QUERY PLAN'] as PlanNode[])[0].Plan as PlanNode;
    const stats = newStats();
    const nodes: string[] = [];
    accumulatePlan(plan, stats, nodes);
    return {
      blocks: rootBlocks(plan),
      rowsFiltered: stats.rowsFiltered,
      nodes: nodes.join(' -> '),
    };
  } finally {
    await db.exec(`DEALLOCATE ${name}`);
    await db.exec(`SET plan_cache_mode = auto`);
  }
};

const incomingOp = (
  entityId: string,
  overrides: Partial<Record<string, unknown>> = {},
): Operation =>
  ({
    id: 'op-incoming',
    clientId: 'uploader',
    actionType: '[Task] Update',
    opType: 'UPD',
    entityType: 'TASK',
    entityId,
    vectorClock: { uploader: 1 },
    timestamp: 1,
    schemaVersion: 1,
    ...overrides,
  }) as unknown as Operation;

/** Column list per Prisma `select` key. An unmapped key must fail loudly, not vanish. */
const COLUMN_SQL: Record<string, string> = {
  actionType: 'action_type AS "actionType"',
  clientId: 'client_id AS "clientId"',
  vectorClock: 'vector_clock AS "vectorClock"',
  serverSeq: 'server_seq AS "serverSeq"',
  entityId: 'entity_id AS "entityId"',
  entityType: 'entity_type AS "entityType"',
};

/**
 * Honouring `select` is load-bearing, not cosmetic: conflict.ts reads
 * existingOp.actionType to let concurrent time-tracking deltas merge. A shim that
 * always returned every column would keep passing if actionType were dropped from
 * the array-branch select, which is a silent rejection of tracked time.
 */
const selectCols = (select?: Record<string, boolean>): string => {
  if (!select) return Object.values(COLUMN_SQL).join(', ');
  const cols = Object.entries(select)
    .filter(([, isSelected]) => isSelected)
    .map(([key]) => {
      const col = COLUMN_SQL[key];
      if (!col) throw new Error(`Shim has no column mapping for select key "${key}"`);
      return col;
    });
  if (cols.length === 0) throw new Error('Shim received an empty select');
  return cols.join(', ');
};

/**
 * Renders the Prisma calls detectConflictForEntity makes as the SQL Prisma emits,
 * EXPLAIN-ing each one into `stats`. It deliberately also renders the OLD combined
 * OR filter: reverting the fix must fail this spec on the BUDGET (proving the plan
 * degenerated), not on an unsupported-shape error.
 */
const makeMeasuringTx = (db: PGlite, stats: PlanStats): unknown => {
  // Prisma renders `entityIds: { has: x }` as `entity_ids @> ARRAY[x]`.
  const renderConditions = (where: Record<string, any>, params: unknown[]): string[] => {
    const push = (value: unknown): string => `$${params.push(value)}`;
    const conds: string[] = [];
    if (where.userId !== undefined) conds.push(`user_id = ${push(where.userId)}`);
    if (where.entityType !== undefined) {
      conds.push(`entity_type = ${push(where.entityType)}`);
    }
    if (where.entityId !== undefined) conds.push(`entity_id = ${push(where.entityId)}`);
    if (where.entityIds?.has !== undefined) {
      conds.push(`entity_ids @> ARRAY[${push(where.entityIds.has)}]::text[]`);
    }
    if (where.schemaVersion?.lt !== undefined) {
      conds.push(`schema_version < ${push(where.schemaVersion.lt)}`);
    }
    if (Array.isArray(where.OR)) {
      const alternatives = where.OR.map(
        (alt: Record<string, any>) =>
          renderConditions(alt, params).join(' AND ') || 'TRUE',
      );
      conds.push(`(${alternatives.join(' OR ')})`);
    }
    return conds;
  };

  const runMeasured = async (
    sql: string,
    params: unknown[],
  ): Promise<Record<string, unknown>[]> => {
    const measured = await explainGeneric(db, sql, params);
    stats.blocks += measured.blocks;
    stats.rowsFiltered += measured.rowsFiltered;
    stats.sql.push(sql);
    stats.nodes.push(measured.nodes);
    return (await db.query<Record<string, unknown>>(sql, params)).rows;
  };

  const normalize = (row?: Record<string, unknown>): Record<string, unknown> | null => {
    if (!row) return null;
    return 'serverSeq' in row ? { ...row, serverSeq: Number(row.serverSeq) } : row;
  };

  return {
    operation: {
      findFirst: async (args: Record<string, any>) => {
        const params: unknown[] = [];
        const conds = renderConditions(args.where, params);
        const order =
          args.orderBy?.serverSeq === 'desc'
            ? 'ORDER BY server_seq DESC'
            : args.orderBy?.serverSeq === 'asc'
              ? 'ORDER BY server_seq ASC'
              : '';
        const rows = await runMeasured(
          `SELECT ${selectCols(args.select)} FROM operations` +
            ` WHERE ${conds.join(' AND ')} ${order} LIMIT 1`,
          params,
        );
        return normalize(rows[0]);
      },
      findUnique: async (args: Record<string, any>) => {
        const { userId, serverSeq } = args.where.userId_serverSeq;
        const rows = await runMeasured(
          `SELECT ${selectCols(args.select)} FROM operations` +
            ` WHERE user_id = $1 AND server_seq = $2 LIMIT 1`,
          [userId, serverSeq],
        );
        return normalize(rows[0]);
      },
    },
    // Array branch. Rebuilt from the REAL tagged template — the literal text
    // conflict.ts sends, with `$n` substituted in template order — so the aggregate,
    // the MATERIALIZED fence and the CTE structure are all under test here rather
    // than compared against a copy that can drift.
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      if (!isEntityArrayBranchQuery(strings)) {
        throw new Error(`Unexpected raw query: ${strings.join('?')}`);
      }
      const sql = strings.reduce(
        (acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ''),
        '',
      );
      stats.rawSql.push(sql);
      const rows = await runMeasured(sql, values);
      const max = rows[0]?.maxSeq;
      return [{ maxSeq: max === null || max === undefined ? null : Number(max) }];
    },
  };
};

// Post-fix both branches are index lookups bounded by actually-matching rows.
// Measured on this seed, seeded in production order: the array branch reads 140 blocks
// (GIN pending list — see the header) and the scalar 3, both filtering NOTHING. The
// regression form pinned by the CANARY below — the combined OR that caused the outage —
// reads 816 blocks and filters 2500, the probed user's whole TASK slice. (The other
// broken shapes named in conflict.ts degrade the same way, but only this one is
// measured here.)
//
// `rowsFiltered === 0` is the load-bearing assertion; the budget is the backstop. The
// filtered count is the regression's actual signature — "read the user's history and
// threw it away" — and it is scale-free, so it keeps its meaning if the seed changes.
// The block budget is NOT scale-free: it sits ~2x above the measured 143 and only ~2.7x
// below the regression's 816, a margin that holds only for THIS seed's
// user/entity-type ratio. (The wider ~5.7x is regression-to-measured, not
// regression-to-budget — the real headroom is the smaller number.) If
// you change the seed, re-derive it — and the canary test below exists to fail loudly if
// the seed ever stops reproducing the mis-plan at all.
const MAX_BLOCKS = 300;

const expectWithinBudget = (measured: { blocks: number; rowsFiltered: number }): void => {
  expect(measured.rowsFiltered).toBe(0);
  expect(measured.blocks).toBeLessThan(MAX_BLOCKS);
};

describe('detectConflictForEntity does not scan the history (PGlite)', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await db.waitReady;
    await db.exec(CREATE_TABLE);
    // BEFORE the rows, as in production — see the header note. Building the GIN after
    // the load yields a pending-list-free index that measures 2 blocks instead of 140.
    await db.exec(CREATE_INDEXES);

    // entity_ids stays '{}' on EVERY row — see the header note. Populating it here
    // gives the planner array statistics and disarms the regression.
    let rows: string[] = [];
    const flush = async (): Promise<void> => {
      if (rows.length === 0) return;
      await db.exec(`INSERT INTO operations (${INSERT_COLS}) VALUES ${rows.join(',')}`);
      rows = [];
    };
    const entityTypeFor = (n: number): string => ENTITY_TYPES[n % ENTITY_TYPES.length];

    for (let seq = 1; seq <= OWN_OPS; seq++) {
      rows.push(
        `('op-${seq}', ${USER_ID}, 'seed-client', ${seq}, '[Task] Update',` +
          ` '${entityTypeFor(seq)}', 'task-${seq}', '{}', 1, '{"seed-client":${seq}}')`,
      );
      if (rows.length === 1000) await flush();
    }
    // A second population of comparable size spread over ~20k OTHER users, so the
    // per-user btree slice is a small fraction of the table the GIN estimate sees.
    for (let i = 1; i <= OTHER_OPS; i++) {
      rows.push(
        `('other-${i}', ${1000 + i}, 'seed-other', ${i}, '[Task] Update',` +
          ` '${entityTypeFor(i)}', 'otask-${i}', '{}', 1, '{"seed-other":${i}}')`,
      );
      if (rows.length === 1000) await flush();
    }
    await flush();

    // ANALYZE so the planner works from real statistics rather than defaults on an
    // unanalyzed table. Deliberately NOT VACUUM: that would flush the GIN pending list
    // and measure the freshly-vacuumed best case instead of the steady state.
    await db.exec('ANALYZE operations');
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it('reads a bounded amount for a BRAND-NEW entity (the incident case)', async () => {
    const stats = newStats();

    // The worst case and the common case at once: the first-ever op for a new task.
    // Nothing matches, so a LIMIT-1 backward walk never finds its early exit.
    const result = await detectConflictForEntity(
      USER_ID,
      incomingOp('task-brand-new'),
      'task-brand-new',
      makeMeasuringTx(db, stats) as never,
    );

    expect(result.hasConflict).toBe(false);
    expectWithinBudget(stats);

    // Asserted on the REAL template rather than a copy of it. Inside the CTE the only
    // predicate is `entity_ids @> ...`, so the composite btree has no usable leading
    // column and GIN is the only INDEX available at any cost estimate — that much is
    // structural, and it is why every regression form (inlining the CTE, flattening it,
    // reinstating the OR) reaches the btree instead and is caught here even if a future
    // seed stops blowing the budget.
    //
    // It does NOT prove GIN is forced: a sequential scan remains available at any time
    // and wins for an unselective id (a globally shared entity id does exactly that).
    // This pins the MEASURED plan for this seed, not a guarantee.
    expect(stats.rawSql).toHaveLength(1);
    const arrayBranchPlan = stats.nodes[stats.sql.indexOf(stats.rawSql[0])];
    expect(arrayBranchPlan).toContain('operations_entity_ids_gin');
    expect(arrayBranchPlan).not.toContain(
      'operations_user_id_entity_type_entity_id_server_seq_idx',
    );
    expect(arrayBranchPlan).not.toContain('Backward');
  });

  it('reads a bounded amount for an entity deep in the history', async () => {
    const stats = newStats();

    await detectConflictForEntity(
      USER_ID,
      incomingOp(`task-${DEEP_ENTITY_SEQ}`),
      `task-${DEEP_ENTITY_SEQ}`,
      makeMeasuringTx(db, stats) as never,
    );

    expectWithinBudget(stats);
  });

  /**
   * A CANARY, not a test of the source. It EXPLAINs a hardcoded copy of the OLD outage
   * query — a string that exists only here — so it responds to no change in conflict.ts
   * and proves nothing about the shipped code. Its one job is to prove that THIS SEED
   * still reproduces the mis-plan, which is what gives the budget above its meaning.
   *
   * That job is real: the budget is an absolute, and its detection power depends on the
   * seed's user/entity-type ratio. Shrink the seed, or collapse it toward one user and
   * one entity type, and the regression's cost falls below MAX_BLOCKS while every other
   * test in this file keeps passing — a suite that has silently stopped being able to
   * fail. This fails instead.
   *
   * It replaced five near-identical shapes (the inlined CTE, the flat MAX, Prisma's
   * aggregate form, the naive array-only fix, and this one). They were the same
   * hardcoded-string assertion five times over and responded to no source mutation,
   * while the shipped query's own budget and structural plan assertions above cover
   * those regressions where it counts — on the real SQL. Verified by mutation: inlining
   * the CTE in conflict.ts fails the two end-to-end budget tests, not this block.
   */
  it('CANARY: the seed still reproduces the mis-plan the budget is calibrated against', async () => {
    const regressed = await explainGeneric(
      db,
      `SELECT server_seq FROM operations
         WHERE user_id = $1 AND entity_type = $2
           AND (entity_id = $3 OR entity_ids @> ARRAY[$3]::text[])
         ORDER BY server_seq DESC LIMIT 1`,
      [USER_ID, 'TASK', 'task-brand-new'],
    );

    expect(regressed.blocks).toBeGreaterThan(MAX_BLOCKS);
    // It read and discarded the probed user's whole entity_type slice.
    expect(regressed.rowsFiltered).toBe(OWN_OPS / ENTITY_TYPES.length);
    expect(regressed.nodes).toContain(
      'operations_user_id_entity_type_entity_id_server_seq_idx',
    );
  });
});

describe('detectConflictForEntity behaviour is unchanged by the query split (PGlite)', () => {
  let db: PGlite;

  const TIME_DELTA_ACTION = '[TimeTracking] Sync time spent';
  const OTHER_USER_ID = 7;
  /** Own tenant, so the legacy-misc row seeded for USER_ID cannot mask the gate. */
  const POST_SPLIT_USER_ID = 8;

  const seed = async (op: {
    id: string;
    serverSeq: number;
    clientId: string;
    entityId: string | null;
    entityIds?: string[];
    entityType?: string;
    actionType?: string;
    schemaVersion?: number;
    userId?: number;
    vectorClock?: Record<string, number>;
  }): Promise<void> => {
    await db.query(
      `INSERT INTO operations (${INSERT_COLS})
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        op.id,
        op.userId ?? USER_ID,
        op.clientId,
        op.serverSeq,
        op.actionType ?? '[Task] Update',
        op.entityType ?? 'TASK',
        op.entityId,
        op.entityIds ?? [],
        op.schemaVersion ?? 1,
        JSON.stringify(op.vectorClock ?? { [op.clientId]: 1 }),
      ],
    );
  };

  const detect = (
    entityId: string,
    opOverrides: Partial<Record<string, unknown>> = {},
    userId: number = USER_ID,
  ): Promise<{ hasConflict: boolean }> =>
    detectConflictForEntity(
      userId,
      incomingOp(entityId, opOverrides),
      entityId,
      makeMeasuringTx(db, newStats()) as never,
    );

  beforeAll(async () => {
    db = new PGlite();
    await db.waitReady;
    await db.exec(CREATE_TABLE);
    await db.exec(CREATE_INDEXES);
  });

  afterAll(async () => {
    await db.close();
  });

  it('reports no conflict for an entity nothing has touched', async () => {
    expect((await detect('never-seen-entity')).hasConflict).toBe(false);
  });

  it('finds a stored multi-entity op via its NON-FIRST entity (#8334)', async () => {
    await seed({
      id: 'op-multi',
      serverSeq: 1,
      clientId: 'other',
      entityId: 'conflict-first',
      entityIds: ['conflict-first', 'conflict-second'],
    });

    // Concurrent clocks ({other:1} vs {uploader:1}). conflict-second is reachable
    // only through entity_ids, i.e. only via the array branch.
    expect((await detect('conflict-second')).hasConflict).toBe(true);
    expect((await detect('conflict-first')).hasConflict).toBe(true);
  });

  it('finds an op via its DIVERGENT scalar (not a member of its own entity_ids)', async () => {
    await seed({
      id: 'op-divergent',
      serverSeq: 2,
      clientId: 'other',
      entityId: 'divergent-scalar',
      entityIds: ['divergent-member'],
    });

    expect((await detect('divergent-scalar')).hasConflict).toBe(true);
    expect((await detect('divergent-member')).hasConflict).toBe(true);
  });

  it('does not re-fetch when both branches TIE on the same row', async () => {
    // A multi-entity op whose scalar entity_id is also a member of its entity_ids —
    // a real stored shape (getStoredEntityIds keeps the full set once length > 1).
    // Both branches then return the SAME server_seq, and because
    // @@unique([userId, serverSeq]) makes an equal server_seq the same row, the
    // findUnique would be pure waste. Pins "fetch only when it BEATS the scalar":
    // relaxing `>` to `>=` still returns the right answer, so only the round-trip
    // count can catch it — and this lookup runs twice per uploaded op.
    await seed({
      id: 'op-tie',
      serverSeq: 20,
      clientId: 'other',
      entityId: 'tie-entity',
      entityIds: ['tie-entity', 'tie-sibling'],
      vectorClock: { other: 1 },
    });

    const stats = newStats();
    const result = await detectConflictForEntity(
      USER_ID,
      incomingOp('tie-entity'),
      'tie-entity',
      makeMeasuringTx(db, stats) as never,
    );

    expect(result.hasConflict).toBe(true);
    // Scalar findFirst + array CTE. A third query means the tie triggered a fetch.
    expect(stats.sql).toHaveLength(2);
  });

  it('picks the ARRAY row when it has the higher server_seq', async () => {
    // Scalar row first, then a NEWER multi-entity row covering the same entity.
    // Pins the merge and the winning-row fetch: against the scalar row alone an
    // incoming {uploader:1} is EQUAL from the SAME client (a retry, no conflict),
    // so only picking the newer array row can produce a conflict here.
    await seed({
      id: 'op-older-scalar',
      serverSeq: 3,
      clientId: 'uploader',
      entityId: 'merge-entity',
      vectorClock: { uploader: 1 },
    });
    await seed({
      id: 'op-newer-array',
      serverSeq: 4,
      clientId: 'other',
      entityId: 'merge-other',
      entityIds: ['merge-other', 'merge-entity'],
      vectorClock: { other: 1 },
    });

    expect((await detect('merge-entity')).hasConflict).toBe(true);
  });

  it('keeps the SCALAR row when it has the higher server_seq', async () => {
    await seed({
      id: 'op-older-array',
      serverSeq: 5,
      clientId: 'other',
      entityId: 'reverse-other',
      entityIds: ['reverse-other', 'reverse-entity'],
      vectorClock: { other: 1 },
    });
    await seed({
      id: 'op-newer-scalar',
      serverSeq: 6,
      clientId: 'uploader',
      entityId: 'reverse-entity',
      vectorClock: { uploader: 1 },
    });

    // Newer scalar row is an EQUAL clock from the SAME client (a retry) → accepted.
    // Picking the older array row instead would wrongly report a conflict.
    expect((await detect('reverse-entity')).hasConflict).toBe(false);
  });

  it('takes the NEWEST of several SCALAR matches, not the oldest', async () => {
    // Every other case here gives an entity at most one scalar row, which makes the
    // scalar branch's `orderBy: { serverSeq: 'desc' }` unobservable: asc and desc return
    // the same row. Flipping it to 'asc' passed the whole server suite. That is a silent
    // data-loss bug, not a style issue — conflict detection would compare the incoming
    // clock against a STALE one, so an op that is a clean successor of the OLD state but
    // CONCURRENT with the current one is accepted and overwrites a remote edit.
    //
    // Two scalar rows for one entity, chosen so the verdict differs by row:
    //   vs seq 31 {cC:5} -> CONCURRENT (incoming has cA/cB, stored has cC) -> conflict
    //   vs seq 30 {cB:1} -> GREATER_THAN (incoming is a clean successor)   -> accepted
    await seed({
      id: 'op-scalar-older',
      serverSeq: 30,
      clientId: 'cB',
      entityId: 'scalar-order-entity',
      vectorClock: { cB: 1 },
    });
    await seed({
      id: 'op-scalar-newer',
      serverSeq: 31,
      clientId: 'cC',
      entityId: 'scalar-order-entity',
      vectorClock: { cC: 5 },
    });

    expect(
      (await detect('scalar-order-entity', { vectorClock: { cA: 1, cB: 1 } }))
        .hasConflict,
    ).toBe(true);
  });

  it('takes the NEWEST of several array-branch matches, not the oldest', async () => {
    // Two stored ops mention the same entity via entity_ids. The aggregate must be
    // MAX: against the newer row the incoming clock is CONCURRENT (conflict), against
    // the older one it is GREATER_THAN (clean successor). MIN therefore accepts an op
    // that overwrites a concurrent remote edit — silently, with no error anywhere.
    await seed({
      id: 'op-max-older',
      serverSeq: 12,
      clientId: 'cB',
      entityId: 'max-primary',
      entityIds: ['max-primary', 'max-target'],
      vectorClock: { cB: 1 },
    });
    await seed({
      id: 'op-max-newer',
      serverSeq: 13,
      clientId: 'cC',
      entityId: 'max-primary',
      entityIds: ['max-primary', 'max-target'],
      vectorClock: { cC: 7 },
    });

    expect(
      (await detect('max-target', { vectorClock: { cA: 4, cB: 1 } })).hasConflict,
    ).toBe(true);
  });

  it('carries actionType from the ARRAY branch so concurrent time deltas still merge', async () => {
    // Timer deltas are additive and commute, so two CONCURRENT deltas must NOT be
    // reported as a conflict — resolveConflictForExistingOp only reaches that rule if
    // the stored row's actionType survives the array-branch select. Dropping
    // actionType there silently rejects tracked time, and only a delta routed through
    // the ARRAY branch (reachable via entity_ids, not the scalar) exercises it.
    await seed({
      id: 'op-delta-remote',
      serverSeq: 14,
      clientId: 'cB',
      actionType: TIME_DELTA_ACTION,
      entityId: 'delta-primary',
      entityIds: ['delta-primary', 'delta-target'],
      vectorClock: { cB: 5 },
    });

    const result = await detect('delta-target', {
      actionType: TIME_DELTA_ACTION,
      vectorClock: { cA: 3 },
    });

    expect(result.hasConflict).toBe(false);
  });

  it('scopes the array-branch row fetch to the REQUESTING user', async () => {
    // Every other case here runs as user 1, so a findUnique that ignored its userId
    // argument would be invisible. Under a different user the winning row is only
    // reachable when the point lookup is scoped correctly; otherwise it returns null,
    // the conflict disappears, and a concurrent remote edit is overwritten.
    await seed({
      userId: OTHER_USER_ID,
      id: 'op-other-user',
      serverSeq: 42,
      clientId: 'other',
      entityId: 'scoped-primary',
      entityIds: ['scoped-primary', 'scoped-target'],
      vectorClock: { other: 1 },
    });

    expect((await detect('scoped-target', {}, OTHER_USER_ID)).hasConflict).toBe(true);
  });

  // The CTE matches entity_ids across ALL users and types; only the OUTER user_id /
  // entity_type predicates restore isolation. Both were uncovered — replacing them with
  // typed tautologies left all 915 tests green. The failure is silent rather than empty
  // because server_seq is per-user: a leaked MAX still resolves to a REAL row of the
  // requesting user through the (user_id, server_seq) point lookup, so an unrelated op
  // becomes the conflict basis. Each case below seeds exactly that collision.
  it('does not take the array-branch MAX from ANOTHER user', async () => {
    await seed({
      userId: OTHER_USER_ID,
      id: 'op-cross-tenant',
      serverSeq: 9001,
      clientId: 'tenant-a',
      entityId: 'tenant-a-primary',
      entityIds: ['tenant-a-primary', 'cross-tenant-entity'],
      vectorClock: { 'tenant-a': 1 },
    });
    // Same server_seq under the REQUESTING user, unrelated entity, concurrent clock.
    // Reachable only if the CTE leaks the other tenant's sequence.
    await seed({
      id: 'op-decoy-same-seq',
      serverSeq: 9001,
      clientId: 'decoy',
      entityId: 'unrelated-to-the-probe',
      vectorClock: { decoy: 5 },
    });

    // USER_ID has never touched cross-tenant-entity, so nothing can conflict.
    expect((await detect('cross-tenant-entity')).hasConflict).toBe(false);
  });

  it('does not take the array-branch MAX from another ENTITY TYPE', async () => {
    // Same user and same entity id, but the only op carrying it is a PROJECT op while
    // the incoming op is a TASK. Dropping the entity_type predicate fetches this very
    // row (it belongs to USER_ID), and its concurrent clock invents a conflict.
    await seed({
      id: 'op-cross-type',
      serverSeq: 9002,
      clientId: 'other-type',
      entityType: 'PROJECT',
      entityId: 'proj-primary',
      entityIds: ['proj-primary', 'cross-type-entity'],
      vectorClock: { 'other-type': 9 },
    });

    expect((await detect('cross-type-entity')).hasConflict).toBe(false);
  });

  it('ignores a full-state op (entity_id NULL, entity_ids {}) without erroring', async () => {
    await seed({ id: 'op-full', serverSeq: 8, clientId: 'other', entityId: null });

    expect((await detect('some-entity-after-full-state')).hasConflict).toBe(false);
  });

  it('still consults the legacy GLOBAL_CONFIG:misc alias for tasks', async () => {
    // Pre-split (schema_version < 2) misc writes also carried what became
    // GLOBAL_CONFIG:tasks; that alias lookup must survive the query split.
    await seed({
      id: 'op-legacy-misc',
      serverSeq: 10,
      clientId: 'other',
      entityId: 'misc',
      entityType: 'GLOBAL_CONFIG',
      schemaVersion: 1,
      vectorClock: { other: 1 },
    });

    expect((await detect('tasks', { entityType: 'GLOBAL_CONFIG' })).hasConflict).toBe(
      true,
    );
  });

  it('does not alias a POST-split misc write onto tasks', async () => {
    // The alias is gated on the fixed v1→v2 split boundary; a v2+ misc write is
    // disjoint from tasks and must not fabricate a conflict.
    //
    // MUST probe exactly 'tasks'. detectConflictForEntity enters the legacy-misc branch
    // only for entityId === 'tasks', so probing any other id (this once read
    // 'tasks-v2-only') never reaches the gate and passes no matter what the gate does —
    // verified: breaking it to `lte` left all 915 tests green.
    //
    // Runs as its OWN user because the preceding test leaves a schema_version 1 misc row
    // for USER_ID in the shared table, which would legitimately alias and mask this.
    await seed({
      userId: POST_SPLIT_USER_ID,
      id: 'op-modern-misc',
      serverSeq: 11,
      clientId: 'other',
      entityId: 'misc',
      entityType: 'GLOBAL_CONFIG',
      schemaVersion: 2,
      vectorClock: { other: 2 },
    });

    expect(
      (await detect('tasks', { entityType: 'GLOBAL_CONFIG' }, POST_SPLIT_USER_ID))
        .hasConflict,
    ).toBe(false);
  });
});
