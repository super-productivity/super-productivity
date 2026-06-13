import { describe, expect, it } from 'vitest';
import { detectConflict } from '../src/sync/conflict';
import type { Operation } from '../src/sync/sync.types';

/**
 * Unit-level regression for #8334's single-entity lookup path
 * (detectConflict → detectConflictForEntity). It exercises the REAL function
 * against a tx mock that models how production now persists ops: one row per op
 * carrying entity_id = entityIds[0] AND the full entity_ids array. The mock's
 * findFirst mirrors the Prisma `OR: [{entityId}, {entityIds:{has}}]` filter.
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
    // detectConflictForEntity runs two ordered LIMIT-1 lookups:
    //   scalar branch → where { userId, entityType, entityId }
    //   array branch  → where { userId, entityType, entityIds: { has } }
    findFirst: async ({ where }: any) => {
      const matches =
        where.entityId !== undefined
          ? (r: StoredRow) => r.entityId === where.entityId
          : (r: StoredRow) => r.entityIds.includes(where.entityIds.has);
      return (
        rows
          .filter(
            (r) =>
              r.userId === where.userId &&
              r.entityType === where.entityType &&
              matches(r),
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
