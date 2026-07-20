import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { detectConflictForEntity } from '../src/sync/conflict';
import type { Operation } from '../src/sync/sync.types';

/**
 * Production incident regression: the single-entity conflict lookup scanned a
 * user's ENTIRE operation history on every upload of a not-yet-seen entity.
 *
 * detectConflictForEntity used to match the entity with one Prisma filter —
 * `OR: [{ entityId }, { entityIds: { has: entityId } }]` + `orderBy serverSeq desc`
 * — which Postgres receives as
 *
 *   ... WHERE user_id=$1 AND entity_type=$2
 *         AND (entity_id=$3 OR entity_ids @> $4)
 *       ORDER BY server_seq DESC LIMIT 1
 *
 * The OR spans two different indexes (the (user_id, entity_type, entity_id,
 * server_seq) btree and the entity_ids GIN) and GIN cannot supply server_seq
 * ordering, so the planner may abandon both index paths and walk (user_id,
 * server_seq) BACKWARDS applying the OR as a filter, betting the LIMIT 1 resolves
 * early. For an entity with no matching rows — the first-ever op for a new task,
 * the single most common upload — the bet loses and it reads the whole history.
 *
 * Live evidence (sync.super-productivity.com): 47 backends stuck on exactly this
 * query, longest running 75 minutes, wait_event=DataFileRead, 61/66 connections
 * active → Prisma pool exhaustion → all uploads AND downloads failing. Every index
 * was valid; this was never a missing-index problem.
 *
 * WHAT DECIDES THE BET — READ THIS BEFORE RE-TESTING (measured below, and the
 * reason the previous "the planner uses a BitmapOr + sort" comment looked true):
 * the planner only takes the backward walk when it has NO array-element statistics
 * for entity_ids. With none it falls back to a default `@>` selectivity (0.5%) and
 * estimates ~150 of 30_000 rows match, so LIMIT 1 looks like it exits after ~200
 * rows. Populate entity_ids on even 6 rows in 30_000 and ANALYZE, and the estimate
 * drops to ~1 row, the walk prices itself out, and BitmapOr wins.
 *
 * That is not an exotic state — it is the deployed one. `entity_ids` was added by
 * migration 20260613000000 with NO backfill (forward-only, see schema.prisma), and
 * getStoredEntityIds stores [] for every single-entity op, i.e. the vast majority.
 * Statistics are also TABLE-wide, not per-user: if ANALYZE's sample happens to
 * contain no non-empty array, EVERY user's uploads degenerate at once, which is why
 * this detonates suddenly rather than degrading gradually.
 *
 * So the seed below leaves entity_ids empty on every row on purpose. Do not
 * "improve" it by populating the column — that silently disarms this regression.
 *
 * This spec runs the REAL detectConflictForEntity against in-process Postgres
 * (PGlite — no Docker, no DATABASE_URL) through a tx shim that renders each Prisma
 * call as the SQL Prisma emits, EXPLAIN (ANALYZE, BUFFERS)-ing every one and summing
 * what they touched. Reverting the split in conflict.ts makes the shim emit the old
 * OR query again and the row/block budgets below blow out by ~100x.
 */

const SEEDED_OPS = 30_000;
const USER_ID = 1;

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

type PlanStats = { blocks: number; rowsFiltered: number; sql: string[] };
type PlanNode = Record<string, unknown>;

const newStats = (): PlanStats => ({ blocks: 0, rowsFiltered: 0, sql: [] });

const accumulatePlan = (node: PlanNode, stats: PlanStats, nodes: string[]): void => {
  stats.blocks +=
    ((node['Shared Hit Blocks'] as number) ?? 0) +
    ((node['Shared Read Blocks'] as number) ?? 0);
  stats.rowsFiltered += (node['Rows Removed by Filter'] as number) ?? 0;
  nodes.push(
    `${node['Node Type']}${node['Scan Direction'] ? ' ' + node['Scan Direction'] : ''}` +
      `${node['Index Name'] ? ' on ' + node['Index Name'] : ''}`,
  );
  for (const child of (node.Plans as PlanNode[]) ?? []) {
    accumulatePlan(child, stats, nodes);
  }
};

const explainOn = async (
  db: PGlite,
  sql: string,
  params: unknown[],
): Promise<{ blocks: number; rowsFiltered: number; nodes: string }> => {
  const res = await db.query<Record<string, unknown>>(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`,
    params,
  );
  const plan = (res.rows[0]['QUERY PLAN'] as PlanNode[])[0].Plan as PlanNode;
  const stats = newStats();
  const nodes: string[] = [];
  accumulatePlan(plan, stats, nodes);
  return {
    blocks: stats.blocks,
    rowsFiltered: stats.rowsFiltered,
    nodes: nodes.join(' -> '),
  };
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

/**
 * Renders the Prisma calls detectConflictForEntity makes as the SQL Prisma emits,
 * EXPLAIN-ing each one into `stats`. It deliberately also renders the OLD combined
 * OR filter: reverting the fix must fail this spec on the row/block BUDGET (proving
 * the plan degenerated), not on an unsupported-shape error.
 */
const makeMeasuringTx = (db: PGlite, stats: PlanStats): unknown => {
  const SELECT_COLS =
    'action_type AS "actionType", client_id AS "clientId", ' +
    'vector_clock AS "vectorClock", server_seq AS "serverSeq"';

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
    const measured = await explainOn(db, sql, params);
    stats.blocks += measured.blocks;
    stats.rowsFiltered += measured.rowsFiltered;
    stats.sql.push(sql);
    return (await db.query<Record<string, unknown>>(sql, params)).rows;
  };

  const normalize = (row?: Record<string, unknown>): Record<string, unknown> | null =>
    row ? { ...row, serverSeq: Number(row.serverSeq) } : null;

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
          `SELECT ${SELECT_COLS} FROM operations WHERE ${conds.join(' AND ')} ${order} LIMIT 1`,
          params,
        );
        return normalize(rows[0]);
      },
      // Prisma compiles aggregate() to MAX() over a `SELECT ... OFFSET 0` subquery.
      // That OFFSET is the planner fence that keeps this on the GIN bitmap path.
      aggregate: async (args: Record<string, any>) => {
        const params: unknown[] = [];
        const conds = renderConditions(args.where, params);
        const rows = await runMeasured(
          `SELECT MAX(server_seq) AS max FROM (SELECT server_seq FROM operations ` +
            `WHERE ${conds.join(' AND ')} OFFSET 0) sub`,
          params,
        );
        const max = rows[0]?.max;
        return {
          _max: { serverSeq: max === null || max === undefined ? null : Number(max) },
        };
      },
      findUnique: async (args: Record<string, any>) => {
        const { userId, serverSeq } = args.where.userId_serverSeq;
        const rows = await runMeasured(
          `SELECT ${SELECT_COLS} FROM operations WHERE user_id = $1 AND server_seq = $2 LIMIT 1`,
          [userId, serverSeq],
        );
        return normalize(rows[0]);
      },
    },
  };
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
    for (let seq = 1; seq <= SEEDED_OPS; seq++) {
      rows.push(
        `('op-${seq}', ${USER_ID}, 'seed-client', ${seq}, '[Task] Update', 'TASK',` +
          ` 'task-${seq}', '{}', 1, '{"seed-client":${seq}}')`,
      );
      if (rows.length === 1000) {
        await db.exec(`INSERT INTO operations (${INSERT_COLS}) VALUES ${rows.join(',')}`);
        rows = [];
      }
    }

    // Index after the bulk load, then ANALYZE so the planner works from real
    // statistics rather than defaults on an unanalyzed table.
    await db.exec(CREATE_INDEXES);
    await db.exec('ANALYZE operations');
  }, 60_000);

  afterAll(async () => {
    await db.close();
  });

  // Post-fix both branches are index lookups that match nothing: 0 rows filtered,
  // ~12 blocks, flat in history size. The old single-OR query filters all 30_000
  // rows across ~1366 blocks and grows linearly (measured 22x at 5k ops, 114x at
  // 30k, 191x at 50k). Budgets are the metric, not plan names — plan shapes are
  // row-count and version dependent, "how much did it actually read" is not.
  const MAX_ROWS_FILTERED = SEEDED_OPS / 100;
  const MAX_BLOCKS = 100;

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
    expect(stats.rowsFiltered).toBeLessThan(MAX_ROWS_FILTERED);
    expect(stats.blocks).toBeLessThan(MAX_BLOCKS);
  });

  it('reads a bounded amount for an entity deep in the history', async () => {
    const stats = newStats();

    await detectConflictForEntity(
      USER_ID,
      incomingOp('task-17'),
      'task-17',
      makeMeasuringTx(db, stats) as never,
    );

    expect(stats.rowsFiltered).toBeLessThan(MAX_ROWS_FILTERED);
    expect(stats.blocks).toBeLessThan(MAX_BLOCKS);
  });

  describe('raw query shapes (the EXPLAIN recipe, runnable against real Postgres)', () => {
    const MISSING = 'task-brand-new';

    it('OLD combined OR + LIMIT 1 degenerates into a full backward walk', async () => {
      const old = await explainOn(
        db,
        `SELECT server_seq FROM operations
           WHERE user_id = $1 AND entity_type = $2
             AND (entity_id = $3 OR entity_ids @> ARRAY[$3]::text[])
           ORDER BY server_seq DESC LIMIT 1`,
        [USER_ID, 'TASK', MISSING],
      );

      // The incident, reproduced: every row read and discarded.
      expect(old.rowsFiltered).toBe(SEEDED_OPS);
      expect(old.nodes).toContain('Backward');
    });

    it('the NAIVE array-only fix reintroduces the same walk (do not "simplify" to this)', async () => {
      // `findFirst({ entityIds: { has }, orderBy: { serverSeq: 'desc' } })`. GIN still
      // cannot order, so the planner makes the same losing bet. This is why the array
      // branch in conflict.ts is an aggregate and must stay one.
      const naive = await explainOn(
        db,
        `SELECT server_seq FROM operations
           WHERE user_id = $1 AND entity_type = $2 AND entity_ids @> ARRAY[$3]::text[]
           ORDER BY server_seq DESC LIMIT 1`,
        [USER_ID, 'TASK', MISSING],
      );

      expect(naive.rowsFiltered).toBe(SEEDED_OPS);
      expect(naive.nodes).toContain('Backward');
    });

    it('the split lookups each stay bounded by actually-matching rows', async () => {
      const scalar = await explainOn(
        db,
        `SELECT server_seq FROM operations
           WHERE user_id = $1 AND entity_type = $2 AND entity_id = $3
           ORDER BY server_seq DESC LIMIT 1`,
        [USER_ID, 'TASK', MISSING],
      );
      // The OFFSET 0 fence is deliberate — it forbids the LIMIT-driven walk.
      const array = await explainOn(
        db,
        `SELECT MAX(server_seq) FROM (SELECT server_seq FROM operations
           WHERE user_id = $1 AND entity_type = $2 AND entity_ids @> ARRAY[$3]::text[]
           OFFSET 0) sub`,
        [USER_ID, 'TASK', MISSING],
      );

      expect(scalar.rowsFiltered).toBe(0);
      expect(array.rowsFiltered).toBe(0);
      expect(scalar.blocks + array.blocks).toBeLessThan(MAX_BLOCKS);
    });
  });
});

describe('detectConflictForEntity behaviour is unchanged by the query split (PGlite)', () => {
  let db: PGlite;

  const seed = async (op: {
    id: string;
    serverSeq: number;
    clientId: string;
    entityId: string | null;
    entityIds?: string[];
    entityType?: string;
    schemaVersion?: number;
    vectorClock?: Record<string, number>;
  }): Promise<void> => {
    await db.query(
      `INSERT INTO operations (${INSERT_COLS})
       VALUES ($1,${USER_ID},$2,$3,'[Task] Update',$4,$5,$6,$7,$8)`,
      [
        op.id,
        op.clientId,
        op.serverSeq,
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
  ): Promise<{ hasConflict: boolean }> =>
    detectConflictForEntity(
      USER_ID,
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

  it('ignores a full-state op (entity_id NULL, entity_ids {}) without erroring', async () => {
    await seed({ id: 'op-full', serverSeq: 7, clientId: 'other', entityId: null });

    expect((await detect('some-entity-after-full-state')).hasConflict).toBe(false);
  });

  it('still consults the legacy GLOBAL_CONFIG:misc alias for tasks', async () => {
    // Pre-split (schema_version < 2) misc writes also carried what became
    // GLOBAL_CONFIG:tasks; that alias lookup must survive the query split.
    await seed({
      id: 'op-legacy-misc',
      serverSeq: 8,
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
      serverSeq: 9,
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
