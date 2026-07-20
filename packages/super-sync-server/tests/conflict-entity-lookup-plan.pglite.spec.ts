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
 * prepared statements, so production runs a GENERIC plan that cannot see parameter
 * values; EXPLAIN with literal constants yields a CUSTOM plan nobody receives. This
 * file once tested with literals and that blind spot passed two designs that were
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
 *    production plan node-for-node and every regression below lands ~400x over budget.
 *
 * REMAINING FIDELITY LIMIT: PGlite is not the production cluster. It has no btree_gin,
 * so the composite (user_id, entity_ids) index proposed in conflict.ts as the fix for
 * the shared-literal-id scan cannot be evaluated here at all.
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
    server_seq     bigint NOT NULL,
    action_type    text NOT NULL,
    entity_type    text NOT NULL,
    entity_id      text,
    entity_ids     text[] NOT NULL DEFAULT '{}',
    schema_version integer NOT NULL DEFAULT 1,
    vector_clock   jsonb NOT NULL
  );
`;

// Index set mirrors prisma/schema.prisma + the migrations: 0_init (the
// (user_id, server_seq) unique the backward walk rides on), 20260511000000 (the
// entity btree) and 20260613000001 (the entity_ids GIN).
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

/**
 * The array branch as conflict.ts issues it, with positional params in tagged-template
 * order. Used only by the raw-shape comparisons below; the end-to-end tests reconstruct
 * this from the real template instead, so the two are cross-checked against each other.
 */
const ARRAY_BRANCH_SQL = `
  WITH cand AS MATERIALIZED (
    SELECT user_id, entity_type, server_seq
    FROM operations
    WHERE entity_ids @> ARRAY[$1]::text[]
  )
  SELECT MAX(server_seq)::int AS "maxSeq"
  FROM cand
  WHERE user_id = $2 AND entity_type = $3`;

type PlanStats = {
  blocks: number;
  rowsFiltered: number;
  sql: string[];
  rawSql: string[];
};
type PlanNode = Record<string, unknown>;
type Measured = { blocks: number; rowsFiltered: number; nodes: string };

const newStats = (): PlanStats => ({ blocks: 0, rowsFiltered: 0, sql: [], rawSql: [] });

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
// Measured on this seed: the array branch reads 2 blocks and the scalar 3, filtering
// nothing. Every regression form below reads 806 blocks and filters 2500 — the probed
// user's whole TASK slice — so one budget separates them by ~400x. Budgets are the
// metric, not plan names: plan shapes are row-count and version dependent, "how much
// did it actually read" is not.
const MAX_BLOCKS = 100;

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

    // Index after the bulk load, then ANALYZE so the planner works from real
    // statistics rather than defaults on an unanalyzed table.
    await db.exec(CREATE_INDEXES);
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

  it('sends the array branch as a MATERIALIZED CTE', async () => {
    // A text guard on top of the behavioural budget test below: the budget proves the
    // keyword's EFFECT, this pins its presence so a removal is never silent even if a
    // future seed stops reproducing the mis-plan.
    const stats = newStats();

    await detectConflictForEntity(
      USER_ID,
      incomingOp('task-brand-new'),
      'task-brand-new',
      makeMeasuringTx(db, stats) as never,
    );

    expect(stats.rawSql).toHaveLength(1);
    expect(stats.rawSql[0]).toContain('AS MATERIALIZED');
    expect(stats.rawSql[0]).not.toContain('NOT MATERIALIZED');
    // The outer user boundary must stay outside the CTE.
    expect(stats.rawSql[0]).toMatch(/FROM cand\s+WHERE user_id =/);
  });

  /**
   * EVERY assertion here runs under `force_generic_plan`. Testing these shapes with
   * literal constants — which this block used to do — is what let two broken designs
   * through: both planned beautifully as custom plans and read the whole slice as
   * generic ones.
   */
  describe('raw query shapes under force_generic_plan (what production actually gets)', () => {
    const MISSING = 'task-brand-new';
    const ARRAY_ARGS = [MISSING, USER_ID, 'TASK'];
    const SLICE_ARGS = [USER_ID, 'TASK', MISSING];

    it('the shipped CTE stays bounded and reaches GIN, never the entity btree', async () => {
      // The load-bearing claim. Inside the CTE the only predicate is
      // `entity_ids @> ...`, so the composite btree has no usable leading column and
      // GIN is the only index available AT ANY COST ESTIMATE — this is structural,
      // not a costing accident, which is why it survives generic planning.
      const array = await explainGeneric(db, ARRAY_BRANCH_SQL, ARRAY_ARGS);

      expectWithinBudget(array);
      expect(array.nodes).toContain('operations_entity_ids_gin');
      expect(array.nodes).not.toContain(
        'operations_user_id_entity_type_entity_id_server_seq_idx',
      );
      expect(array.nodes).not.toContain('Backward');
    });

    it('the scalar branch stays bounded on its own composite btree', async () => {
      const scalar = await explainGeneric(
        db,
        `SELECT server_seq FROM operations
           WHERE user_id = $1 AND entity_type = $2 AND entity_id = $3
           ORDER BY server_seq DESC LIMIT 1`,
        SLICE_ARGS,
      );

      expectWithinBudget(scalar);
    });

    /**
     * Every form that has been proposed, shipped or "simplified" into over the life of
     * this query. All four abandon GIN under generic planning and read the probed
     * user's whole entity_type slice; the budget catches each one.
     */
    const REGRESSION_SHAPES: Array<{ name: string; sql: string; args: unknown[] }> = [
      {
        name: 'the CTE with AS MATERIALIZED dropped (inlining hands back the btree)',
        sql: `
          WITH cand AS (
            SELECT user_id, entity_type, server_seq
            FROM operations
            WHERE entity_ids @> ARRAY[$1]::text[]
          )
          SELECT MAX(server_seq)::int AS "maxSeq"
          FROM cand
          WHERE user_id = $2 AND entity_type = $3`,
        args: ARRAY_ARGS,
      },
      {
        name: 'the flat MAX form (the natural "why is there a CTE?" simplification)',
        sql: `SELECT MAX(server_seq)::int AS "maxSeq" FROM operations
              WHERE user_id = $1 AND entity_type = $2
                AND entity_ids @> ARRAY[$3]::text[]`,
        args: SLICE_ARGS,
      },
      {
        name: "Prisma's aggregate({ _max }) form (MAX(...) FROM (... OFFSET 0))",
        sql: `SELECT MAX(server_seq)::int AS "maxSeq" FROM (
                SELECT server_seq FROM operations
                WHERE user_id = $1 AND entity_type = $2
                  AND entity_ids @> ARRAY[$3]::text[]
                OFFSET 0
              ) sub`,
        args: SLICE_ARGS,
      },
      {
        name: 'the OLD combined OR + LIMIT 1 (the outage)',
        sql: `SELECT server_seq FROM operations
              WHERE user_id = $1 AND entity_type = $2
                AND (entity_id = $3 OR entity_ids @> ARRAY[$3]::text[])
              ORDER BY server_seq DESC LIMIT 1`,
        args: SLICE_ARGS,
      },
      {
        name: 'the NAIVE array-only fix (GIN still cannot order)',
        sql: `SELECT server_seq FROM operations
              WHERE user_id = $1 AND entity_type = $2
                AND entity_ids @> ARRAY[$3]::text[]
              ORDER BY server_seq DESC LIMIT 1`,
        args: SLICE_ARGS,
      },
    ];

    it.each(REGRESSION_SHAPES)('blows the budget: $name', async ({ sql, args }) => {
      const regressed = await explainGeneric(db, sql, args);

      // Not "worse than the CTE" but "over the budget the shipped query is measured
      // against", so this fails for the same reason the end-to-end tests would.
      expect(regressed.blocks).toBeGreaterThan(MAX_BLOCKS);
      // It read and discarded the probed user's whole entity_type slice.
      expect(regressed.rowsFiltered).toBe(OWN_OPS / ENTITY_TYPES.length);
      expect(regressed.nodes).toContain(
        'operations_user_id_entity_type_entity_id_server_seq_idx',
      );
    });
  });
});

describe('detectConflictForEntity behaviour is unchanged by the query split (PGlite)', () => {
  let db: PGlite;

  const TIME_DELTA_ACTION = '[TimeTracking] Sync time spent';
  const OTHER_USER_ID = 7;

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
    await seed({
      id: 'op-modern-misc',
      serverSeq: 11,
      clientId: 'other',
      entityId: 'misc',
      entityType: 'GLOBAL_CONFIG',
      schemaVersion: 2,
      vectorClock: { other: 2 },
    });

    expect(
      (await detect('tasks-v2-only', { entityType: 'GLOBAL_CONFIG' })).hasConflict,
    ).toBe(false);
  });
});
