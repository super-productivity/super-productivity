import { describe, expect, it } from 'vitest';
import { detectConflict, getStoredEntityIds } from '../src/sync/conflict';
import type { Operation } from '../src/sync/sync.types';

/**
 * Unit-level regression for #8334's single-entity lookup path
 * (detectConflict → detectConflictForEntity). It exercises the REAL function
 * against a tx mock modelling how production persists ops: multi-entity ops carry
 * the full entity_ids array, single-entity ops store []. detectConflictForEntity
 * matches an entity via a Prisma `OR: [{entityId}, {entityIds:{has}}]` filter,
 * which the mock's findFirst reproduces.
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
};

const makeTx = (rows: StoredRow[]): any => ({
  operation: {
    // Mirrors: where { userId, entityType, OR: [{entityId:X}, {entityIds:{has:X}}] }
    findFirst: async ({ where }: any) => {
      const target =
        where.OR.find((c: any) => 'entityId' in c)?.entityId ??
        where.OR.find((c: any) => c.entityIds?.has !== undefined)?.entityIds?.has;
      return (
        rows
          .filter(
            (r) =>
              r.userId === where.userId &&
              r.entityType === where.entityType &&
              (r.entityId === target || r.entityIds.includes(target)),
          )
          .sort((a, b) => b.serverSeq - a.serverSeq)[0] ?? null
      );
    },
  },
});

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
