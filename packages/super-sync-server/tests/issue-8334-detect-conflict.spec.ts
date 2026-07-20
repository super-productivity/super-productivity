import { describe, expect, it } from 'vitest';
import { detectConflict, getStoredEntityIds } from '../src/sync/conflict';
import { isEntityArrayBranchQuery } from './sync.service.test-state';
import type { Operation } from '../src/sync/sync.types';

/**
 * Unit-level regression for #8334's single-entity lookup path
 * (detectConflict → detectConflictForEntity). It exercises the REAL function
 * against a tx mock modelling how production persists ops: multi-entity ops carry
 * the full entity_ids array, single-entity ops store []. detectConflictForEntity
 * matches an entity with a scalar `entityId` lookup plus a separate raw-SQL
 * max-serverSeq lookup over `entity_ids`, which the mock below reproduces.
 *
 * The batch lookup paths (raw unnest SQL) are validated separately against real
 * Postgres semantics and in conflict-detection.spec.ts.
 */
type StoredRow = {
  userId: number;
  entityType: string;
  entityId: string | null;
  entityIds: string[];
  clientId: string;
  serverSeq: number;
  vectorClock: Record<string, number>;
  /**
   * REQUIRED, not optional, on purpose. detectConflictForEntity reads
   * existingOp.actionType to let two CONCURRENT time-tracking deltas merge instead of
   * conflicting. A row shape that can omit it makes actionType silently `undefined` on
   * the array branch, which is exactly how that merge gets lost without a red test.
   * The merge itself is covered against real Postgres in
   * conflict-entity-lookup-plan.pglite.spec.ts; this only keeps the mock honest.
   */
  actionType: string;
};

// detectConflictForEntity issues the scalar and array halves as two separately
// indexed queries (a single OR + ORDER BY ... LIMIT 1 degenerated into a full
// history scan and took production down — see the PERF note in conflict.ts).
// This mock mirrors that three-call shape and throws on the old OR filter so a
// silent revert cannot pass here.
const makeTx = (rows: StoredRow[]): any => {
  const scoped = (where: any): StoredRow[] =>
    rows.filter((r) => r.userId === where.userId && r.entityType === where.entityType);
  return {
    operation: {
      // Scalar branch: where { userId, entityType, entityId }, orderBy serverSeq desc.
      findFirst: async ({ where }: any) => {
        if (where.OR) {
          throw new Error('detectConflictForEntity must not use a combined OR filter');
        }
        return (
          scoped(where)
            .filter((r) => r.entityId === where.entityId)
            .sort((a, b) => b.serverSeq - a.serverSeq)[0] ?? null
        );
      },
      // Winning array-branch row, fetched by the (user_id, server_seq) unique key.
      // Honours `select` so that dropping a column from the production query — most
      // consequentially actionType, see StoredRow — actually changes what this returns.
      findUnique: async ({ where, select }: any) => {
        const { userId, serverSeq } = where.userId_serverSeq;
        const row = rows.find((r) => r.userId === userId && r.serverSeq === serverSeq);
        if (!row) return null;
        if (!select) return row;
        return Object.fromEntries(
          Object.entries(select)
            .filter(([, isSelected]) => isSelected)
            .map(([key]) => {
              if (!(key in row)) {
                throw new Error(`Mock row has no column "${key}"`);
              }
              return [key, row[key as keyof StoredRow]];
            }),
        );
      },
    },
    // Array branch: MAX(server_seq) over `entity_ids @> ARRAY[id]`, issued as raw
    // SQL (a MATERIALIZED CTE) so the planner is forced onto the GIN index.
    $queryRaw: async (strings: TemplateStringsArray, ...params: unknown[]) => {
      if (!isEntityArrayBranchQuery(strings)) {
        throw new Error(`Unexpected raw query: ${strings.join('?')}`);
      }
      const [entityId, userId, entityType] = params as [string, number, string];
      const seqs = rows
        .filter(
          (r) =>
            r.userId === userId &&
            r.entityType === entityType &&
            r.entityIds.includes(entityId),
        )
        .map((r) => r.serverSeq);
      return [{ maxSeq: seqs.length ? Math.max(...seqs) : null }];
    },
  };
};

const staleOp = (entityId: string): Operation =>
  ({
    id: 'op-b',
    clientId: 'B',
    actionType: 'UPDATE_TASK',
    opType: 'UPD',
    entityType: 'TASK',
    entityId,
    vectorClock: { B: 1 },
    timestamp: 1,
    schemaVersion: 1,
  }) as unknown as Operation;

const multiEntityRow: StoredRow = {
  userId: 1,
  entityType: 'TASK',
  actionType: 'UPDATE_TASK',
  entityId: 'task-1',
  entityIds: ['task-1', 'task-2'],
  clientId: 'A',
  serverSeq: 1,
  vectorClock: { A: 1 },
};

describe('#8334 detectConflict single-entity path', () => {
  it('rejects a stale write to a NON-FIRST entity of a stored multi-entity op', async () => {
    const result = await detectConflict(1, staleOp('task-2'), makeTx([multiEntityRow]));
    expect(result.hasConflict).toBe(true);
  });

  it('still rejects a stale write to the first/scalar entity', async () => {
    const result = await detectConflict(1, staleOp('task-1'), makeTx([multiEntityRow]));
    expect(result.hasConflict).toBe(true);
  });

  it('finds a pre-migration single-entity row via the scalar fallback', async () => {
    const oldRow: StoredRow = {
      userId: 1,
      entityType: 'TASK',
      actionType: 'UPDATE_TASK',
      entityId: 'task-3',
      entityIds: [], // pre-migration: empty array, only scalar persisted
      clientId: 'A',
      serverSeq: 1,
      vectorClock: { A: 1 },
    };
    const result = await detectConflict(1, staleOp('task-3'), makeTx([oldRow]));
    expect(result.hasConflict).toBe(true);
  });

  it('does not flag an unrelated entity', async () => {
    const result = await detectConflict(1, staleOp('task-9'), makeTx([multiEntityRow]));
    expect(result.hasConflict).toBe(false);
  });
});

describe('#8334 getStoredEntityIds', () => {
  const op = (over: Partial<Operation>): Operation => over as unknown as Operation;

  it('stores [] for a single-entity op (covered by the scalar)', () => {
    expect(getStoredEntityIds(op({ entityId: 'task-1' }))).toEqual([]);
    expect(getStoredEntityIds(op({ entityId: 'task-1', entityIds: ['task-1'] }))).toEqual(
      [],
    );
  });

  it('stores the full set for a multi-entity op', () => {
    expect(
      getStoredEntityIds(op({ entityId: 'task-1', entityIds: ['task-1', 'task-2'] })),
    ).toEqual(['task-1', 'task-2']);
  });

  it('stores [] for an entity-less op', () => {
    expect(getStoredEntityIds(op({}))).toEqual([]);
  });

  it('stores the id when a batch op dedups to one value that differs from entityId', () => {
    // The server does not enforce entityId === entityIds[0]; without this the
    // entity would be invisible to conflict lookups (#8334).
    expect(
      getStoredEntityIds(op({ entityId: 'task-Z', entityIds: ['task-A', 'task-A'] })),
    ).toEqual(['task-A']);
  });
});
