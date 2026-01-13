import { describe, it, expect, beforeEach, vi } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { Prisma } from '@prisma/client';
import { testState, resetTestState } from './sync.service.test-state';

// Mock the database module with Prisma mocks
vi.mock('../src/db', async () => {
  const { testState: state } = await import('./sync.service.test-state');
  const { Prisma: PrismaModule } = await import('@prisma/client');

  const createTxMock = () => ({
    operation: {
      create: vi.fn().mockImplementation(async (args: any) => {
        if (state.operations.has(args.data.id)) {
          throw new PrismaModule.PrismaClientKnownRequestError(
            'Unique constraint failed',
            {
              code: 'P2002',
              clientVersion: '5.0.0',
            },
          );
        }
        state.serverSeqCounter++;
        const op = {
          ...args.data,
          serverSeq: state.serverSeqCounter,
          receivedAt: BigInt(Date.now()),
        };
        state.operations.set(args.data.id, op);
        return op;
      }),
      findFirst: vi.fn().mockImplementation(async (args: any) => {
        if (args.where?.id) {
          return state.operations.get(args.where.id) || null;
        }
        if (args.where?.entityId && args.where?.entityType) {
          const ops = Array.from(state.operations.values())
            .filter(
              (op: any) =>
                op.userId === args.where.userId &&
                op.entityId === args.where.entityId &&
                op.entityType === args.where.entityType,
            )
            .sort((a: any, b: any) => b.serverSeq - a.serverSeq);
          return ops[0] || null;
        }
        return null;
      }),
      findMany: vi.fn().mockImplementation(async (args: any) => {
        const ops = Array.from(state.operations.values());
        return ops
          .filter((op: any) => {
            if (args.where?.userId !== undefined && args.where.userId !== op.userId)
              return false;
            if (
              args.where?.serverSeq?.gt !== undefined &&
              op.serverSeq <= args.where.serverSeq.gt
            )
              return false;
            if (args.where?.clientId?.not && op.clientId === args.where.clientId.not)
              return false;
            return true;
          })
          .sort((a: any, b: any) => a.serverSeq - b.serverSeq)
          .slice(0, args.take || 500);
      }),
      findUnique: vi.fn().mockImplementation(async (args: any) => {
        if (args.where?.id) {
          return state.operations.get(args.where.id) || null;
        }
        return null;
      }),
    },
    userSyncState: {
      findUnique: vi.fn().mockImplementation(async (args: any) => {
        return state.userSyncStates.get(args.where.userId) || null;
      }),
      upsert: vi.fn().mockImplementation(async (args: any) => {
        const existing = state.userSyncStates.get(args.where.userId);
        const result = existing
          ? { ...existing, ...args.update }
          : { userId: args.where.userId, ...args.create };
        state.userSyncStates.set(args.where.userId, result);
        return result;
      }),
      update: vi.fn().mockImplementation(async (args: any) => {
        const existing = state.userSyncStates.get(args.where.userId);
        if (existing) {
          const updated = { ...existing };
          for (const [key, value] of Object.entries(args.data)) {
            if (typeof value === 'object' && value !== null && 'increment' in value) {
              updated[key] =
                (existing[key] || 0) + (value as { increment: number }).increment;
            } else {
              updated[key] = value;
            }
          }
          state.userSyncStates.set(args.where.userId, updated);
          return updated;
        }
        return null;
      }),
    },
    syncDevice: {
      upsert: vi.fn().mockImplementation(async (args: any) => {
        const key = `${args.where.userId_clientId.userId}:${args.where.userId_clientId.clientId}`;
        const result = {
          ...args.create,
          ...args.update,
          userId: args.where.userId_clientId.userId,
          clientId: args.where.userId_clientId.clientId,
        };
        state.syncDevices.set(key, result);
        return result;
      }),
    },
    user: {
      findUnique: vi.fn().mockImplementation(async (args: any) => {
        return state.users.get(args.where.id) || null;
      }),
    },
  });

  return {
    prisma: {
      $transaction: vi
        .fn()
        .mockImplementation(async (callback: any) => callback(createTxMock())),
      userSyncState: {
        findUnique: vi.fn().mockImplementation(async (args: any) => {
          return state.userSyncStates.get(args.where.userId) || null;
        }),
      },
      operation: {
        findMany: vi.fn().mockImplementation(async (args: any) => {
          const ops = Array.from(state.operations.values());
          return ops
            .filter((op: any) => {
              if (args.where?.userId !== undefined && args.where.userId !== op.userId)
                return false;
              if (
                args.where?.serverSeq?.gt !== undefined &&
                op.serverSeq <= args.where.serverSeq.gt
              )
                return false;
              if (args.where?.clientId?.not && op.clientId === args.where.clientId.not)
                return false;
              return true;
            })
            .sort((a: any, b: any) => a.serverSeq - b.serverSeq)
            .slice(0, args.take || 500);
        }),
        aggregate: vi.fn().mockImplementation(async (args: any) => {
          const ops = Array.from(state.operations.values()).filter(
            (op: any) => args.where?.userId === op.userId,
          );
          if (ops.length === 0) return { _max: { serverSeq: null } };
          const seqs = ops.map((op: any) => op.serverSeq);
          return { _max: { serverSeq: Math.max(...seqs) } };
        }),
        findUnique: vi.fn().mockImplementation(async (args: any) => {
          if (args.where?.id) {
            return state.operations.get(args.where.id) || null;
          }
          return null;
        }),
      },
    },
  };
});

import { initSyncService, getSyncService } from '../src/sync/sync.service';
import { Operation, SYNC_ERROR_CODES, VectorClock } from '../src/sync/sync.types';

describe('Conflict Detection', () => {
  const userId = 1;
  const clientA = 'client-a';
  const clientB = 'client-b';

  const createOp = (overrides: Partial<Operation> & { entityId: string }): Operation => ({
    id: uuidv7(),
    clientId: clientA,
    actionType: 'UPDATE_TASK',
    opType: 'UPD',
    entityType: 'TASK',
    payload: { title: 'Updated' },
    vectorClock: {},
    timestamp: Date.now(),
    schemaVersion: 1,
    ...overrides,
  });

  beforeEach(() => {
    resetTestState();

    // Add test user
    testState.users.set(userId, {
      id: userId,
      email: 'test@test.com',
      storageQuotaBytes: BigInt(100 * 1024 * 1024),
      storageUsedBytes: BigInt(0),
    });

    vi.clearAllMocks();
    initSyncService();
  });

  describe('Vector Clock Comparison', () => {
    it('should accept operation when incoming clock is GREATER_THAN existing', async () => {
      const service = getSyncService();
      const entityId = 'task-1';

      // First op from client A with clock {a: 1}
      const op1 = createOp({
        entityId,
        clientId: clientA,
        vectorClock: { [clientA]: 1 },
        opType: 'CRT',
      });
      const result1 = await service.uploadOps(userId, clientA, [op1]);
      expect(result1[0].accepted).toBe(true);

      // Second op from client A with clock {a: 2} - GREATER_THAN {a: 1}
      const op2 = createOp({
        entityId,
        clientId: clientA,
        vectorClock: { [clientA]: 2 },
      });
      const result2 = await service.uploadOps(userId, clientA, [op2]);
      expect(result2[0].accepted).toBe(true);
    });

    it('should reject operation when incoming clock is LESS_THAN existing (stale)', async () => {
      const service = getSyncService();
      const entityId = 'task-1';

      // First op with clock {a: 2}
      const op1 = createOp({
        entityId,
        clientId: clientA,
        vectorClock: { [clientA]: 2 },
        opType: 'CRT',
      });
      const result1 = await service.uploadOps(userId, clientA, [op1]);
      expect(result1[0].accepted).toBe(true);

      // Second op with clock {a: 1} - LESS_THAN {a: 2} (stale)
      const op2 = createOp({
        entityId,
        clientId: clientB,
        vectorClock: { [clientA]: 1 },
      });
      const result2 = await service.uploadOps(userId, clientB, [op2]);
      expect(result2[0].accepted).toBe(false);
      expect(result2[0].errorCode).toBe(SYNC_ERROR_CODES.CONFLICT_STALE);
      expect(result2[0].error).toContain('Stale operation');
    });

    it('should reject operation when clocks are CONCURRENT', async () => {
      const service = getSyncService();
      const entityId = 'task-1';

      // First op from client A with clock {a: 1}
      const op1 = createOp({
        entityId,
        clientId: clientA,
        vectorClock: { [clientA]: 1 },
        opType: 'CRT',
      });
      const result1 = await service.uploadOps(userId, clientA, [op1]);
      expect(result1[0].accepted).toBe(true);

      // Second op from client B with clock {b: 1} - CONCURRENT with {a: 1}
      const op2 = createOp({
        entityId,
        clientId: clientB,
        vectorClock: { [clientB]: 1 },
      });
      const result2 = await service.uploadOps(userId, clientB, [op2]);
      expect(result2[0].accepted).toBe(false);
      expect(result2[0].errorCode).toBe(SYNC_ERROR_CODES.CONFLICT_CONCURRENT);
      expect(result2[0].error).toContain('Concurrent modification');
    });

    it('should accept operation when clocks are EQUAL from same client (retry)', async () => {
      const service = getSyncService();
      const entityId = 'task-1';

      // First op
      const op1 = createOp({
        entityId,
        clientId: clientA,
        vectorClock: { [clientA]: 1 },
        opType: 'CRT',
      });
      const result1 = await service.uploadOps(userId, clientA, [op1]);
      expect(result1[0].accepted).toBe(true);

      // Second op with EQUAL clock from SAME client
      const op2 = createOp({
        entityId,
        clientId: clientA,
        vectorClock: { [clientA]: 1 },
      });
      const result2 = await service.uploadOps(userId, clientA, [op2]);
      expect(result2[0].accepted).toBe(true);
    });

    it('should reject operation when clocks are EQUAL from different client (suspicious reuse)', async () => {
      const service = getSyncService();
      const entityId = 'task-1';

      // First op from client A
      const op1 = createOp({
        entityId,
        clientId: clientA,
        vectorClock: { [clientA]: 1 },
        opType: 'CRT',
      });
      const result1 = await service.uploadOps(userId, clientA, [op1]);
      expect(result1[0].accepted).toBe(true);

      // Second op from client B with EQUAL clock - rejected as suspicious
      const op2 = createOp({
        entityId,
        clientId: clientB,
        vectorClock: { [clientA]: 1 },
      });
      const result2 = await service.uploadOps(userId, clientB, [op2]);
      expect(result2[0].accepted).toBe(false);
      expect(result2[0].error).toContain('Equal vector clocks from different clients');
    });
  });

  describe('Conflict Bypass Rules', () => {
    it('should bypass conflict detection for SYNC_IMPORT operations', async () => {
      const service = getSyncService();
      const entityId = 'task-1';

      // First op
      const op1 = createOp({
        entityId,
        clientId: clientA,
        vectorClock: { [clientA]: 1 },
        opType: 'CRT',
      });
      await service.uploadOps(userId, clientA, [op1]);

      // SYNC_IMPORT with stale clock should still be accepted
      const op2 = createOp({
        entityId,
        clientId: clientB,
        vectorClock: {},
        opType: 'SYNC_IMPORT',
        entityType: 'ALL',
      });
      const result = await service.uploadOps(userId, clientB, [op2]);
      expect(result[0].accepted).toBe(true);
    });

    it('should bypass conflict detection for BACKUP_IMPORT operations', async () => {
      const service = getSyncService();
      const entityId = 'task-1';

      // First op
      const op1 = createOp({
        entityId,
        clientId: clientA,
        vectorClock: { [clientA]: 1 },
        opType: 'CRT',
      });
      await service.uploadOps(userId, clientA, [op1]);

      // BACKUP_IMPORT with conflicting clock should still be accepted
      const op2 = createOp({
        entityId,
        clientId: clientB,
        vectorClock: { [clientB]: 1 },
        opType: 'BACKUP_IMPORT',
        entityType: 'ALL',
      });
      const result = await service.uploadOps(userId, clientB, [op2]);
      expect(result[0].accepted).toBe(true);
    });

    it('should bypass conflict detection for REPAIR operations', async () => {
      const service = getSyncService();
      const entityId = 'task-1';

      // First op
      const op1 = createOp({
        entityId,
        clientId: clientA,
        vectorClock: { [clientA]: 1 },
        opType: 'CRT',
      });
      await service.uploadOps(userId, clientA, [op1]);

      // REPAIR with stale clock should still be accepted
      const op2 = createOp({
        entityId,
        clientId: clientB,
        vectorClock: {},
        opType: 'REPAIR',
        entityType: 'RECOVERY',
      });
      const result = await service.uploadOps(userId, clientB, [op2]);
      expect(result[0].accepted).toBe(true);
    });

    it('should skip conflict detection when operation has bulk entityType ALL', async () => {
      const service = getSyncService();

      // First op on specific entity
      const op1 = createOp({
        entityId: 'task-1',
        clientId: clientA,
        vectorClock: { [clientA]: 1 },
        opType: 'CRT',
      });
      await service.uploadOps(userId, clientA, [op1]);

      // Bulk entityType 'ALL' should bypass conflict detection (no entityId required)
      const op2: Operation = {
        id: uuidv7(),
        clientId: clientB,
        actionType: 'BATCH_UPDATE',
        opType: 'BATCH',
        entityType: 'ALL', // Bulk entity types don't require entityId
        payload: { entities: {} },
        vectorClock: { [clientB]: 1 },
        timestamp: Date.now(),
        schemaVersion: 1,
      };
      const result = await service.uploadOps(userId, clientB, [op2]);
      expect(result[0].accepted).toBe(true);
    });
  });

  describe('Complex Vector Clock Scenarios', () => {
    it('should handle multi-device clock progression correctly', async () => {
      const service = getSyncService();
      const entityId = 'task-1';
      const clientC = 'client-c';

      // Client A creates with {a: 1}
      const op1 = createOp({
        entityId,
        clientId: clientA,
        vectorClock: { [clientA]: 1 },
        opType: 'CRT',
      });
      expect((await service.uploadOps(userId, clientA, [op1]))[0].accepted).toBe(true);

      // Client B updates knowing A's change: {a: 1, b: 1}
      const op2 = createOp({
        entityId,
        clientId: clientB,
        vectorClock: { [clientA]: 1, [clientB]: 1 },
      });
      expect((await service.uploadOps(userId, clientB, [op2]))[0].accepted).toBe(true);

      // Client C updates knowing both: {a: 1, b: 1, c: 1}
      const op3 = createOp({
        entityId,
        clientId: clientC,
        vectorClock: { [clientA]: 1, [clientB]: 1, [clientC]: 1 },
      });
      expect((await service.uploadOps(userId, clientC, [op3]))[0].accepted).toBe(true);

      // Client A tries to update with stale clock {a: 2} (doesn't know about B, C)
      const op4 = createOp({
        entityId,
        clientId: clientA,
        vectorClock: { [clientA]: 2 },
      });
      const result = await service.uploadOps(userId, clientA, [op4]);
      expect(result[0].accepted).toBe(false);
      expect(result[0].errorCode).toBe(SYNC_ERROR_CODES.CONFLICT_CONCURRENT);
    });

    it('should handle rapid sequential updates from same client', async () => {
      const service = getSyncService();
      const entityId = 'task-1';

      // Sequential updates from same client should all succeed
      for (let i = 1; i <= 10; i++) {
        const op = createOp({
          entityId,
          clientId: clientA,
          vectorClock: { [clientA]: i },
          opType: i === 1 ? 'CRT' : 'UPD',
        });
        const result = await service.uploadOps(userId, clientA, [op]);
        expect(result[0].accepted).toBe(true);
        expect(result[0].serverSeq).toBe(i);
      }
    });

    it('should detect conflict for deleted entity being updated', async () => {
      const service = getSyncService();
      const entityId = 'task-1';

      // Create
      const op1 = createOp({
        entityId,
        clientId: clientA,
        vectorClock: { [clientA]: 1 },
        opType: 'CRT',
      });
      await service.uploadOps(userId, clientA, [op1]);

      // Delete
      const op2 = createOp({
        entityId,
        clientId: clientA,
        vectorClock: { [clientA]: 2 },
        opType: 'DEL',
        payload: {},
      });
      await service.uploadOps(userId, clientA, [op2]);

      // Client B tries to update with concurrent clock (doesn't know about delete)
      const op3 = createOp({
        entityId,
        clientId: clientB,
        vectorClock: { [clientA]: 1, [clientB]: 1 },
      });
      const result = await service.uploadOps(userId, clientB, [op3]);
      expect(result[0].accepted).toBe(false);
      expect(result[0].errorCode).toBe(SYNC_ERROR_CODES.CONFLICT_CONCURRENT);
    });
  });

  describe('Entity Type Isolation', () => {
    it('should not conflict operations on different entities of same type', async () => {
      const service = getSyncService();

      // Op on task-1
      const op1 = createOp({
        entityId: 'task-1',
        clientId: clientA,
        vectorClock: { [clientA]: 1 },
        opType: 'CRT',
      });
      await service.uploadOps(userId, clientA, [op1]);

      // Op on task-2 with same clock should succeed (different entity)
      const op2 = createOp({
        entityId: 'task-2',
        clientId: clientB,
        vectorClock: { [clientA]: 1 },
        opType: 'CRT',
      });
      const result = await service.uploadOps(userId, clientB, [op2]);
      expect(result[0].accepted).toBe(true);
    });

    it('should not conflict operations on different entity types with same ID', async () => {
      const service = getSyncService();
      const entityId = 'entity-1';

      // Create a TASK with this ID
      const op1 = createOp({
        entityId,
        entityType: 'TASK',
        clientId: clientA,
        vectorClock: { [clientA]: 1 },
        opType: 'CRT',
      });
      await service.uploadOps(userId, clientA, [op1]);

      // Create a PROJECT with same ID and concurrent clock should succeed
      const op2 = createOp({
        entityId,
        entityType: 'PROJECT',
        clientId: clientB,
        vectorClock: { [clientB]: 1 },
        opType: 'CRT',
      });
      const result = await service.uploadOps(userId, clientB, [op2]);
      expect(result[0].accepted).toBe(true);
    });
  });

  describe('User Isolation', () => {
    it('should not conflict operations from different users', async () => {
      const service = getSyncService();
      const entityId = 'task-1';
      const userId2 = 2;

      // Create second user
      testState.users.set(userId2, {
        id: userId2,
        email: 'test2@test.com',
        storageQuotaBytes: BigInt(100 * 1024 * 1024),
        storageUsedBytes: BigInt(0),
      });

      // User 1 creates task
      const op1 = createOp({
        entityId,
        clientId: clientA,
        vectorClock: { [clientA]: 1 },
        opType: 'CRT',
      });
      await service.uploadOps(userId, clientA, [op1]);

      // User 2 creates task with same ID - should succeed (different user)
      const op2 = createOp({
        entityId,
        clientId: clientB,
        vectorClock: { [clientB]: 1 },
        opType: 'CRT',
      });
      const result = await service.uploadOps(userId2, clientB, [op2]);
      expect(result[0].accepted).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty vector clocks gracefully', async () => {
      const service = getSyncService();
      const entityId = 'task-1';

      // First op with empty clock
      const op1 = createOp({
        entityId,
        clientId: clientA,
        vectorClock: {},
        opType: 'CRT',
      });
      const result1 = await service.uploadOps(userId, clientA, [op1]);
      expect(result1[0].accepted).toBe(true);

      // Second op with empty clock from different client - rejected as EQUAL from different client
      const op2 = createOp({
        entityId,
        clientId: clientB,
        vectorClock: {},
      });
      const result2 = await service.uploadOps(userId, clientB, [op2]);
      expect(result2[0].accepted).toBe(false);
      expect(result2[0].error).toContain('Equal vector clocks from different clients');
    });

    it('should handle very large vector clocks', async () => {
      const service = getSyncService();
      const entityId = 'task-1';

      // Create clock with many entries (under the 100 limit)
      const largeClock: VectorClock = {};
      for (let i = 0; i < 50; i++) {
        largeClock[`client-${i}`] = i + 1;
      }

      const op1 = createOp({
        entityId,
        clientId: clientA,
        vectorClock: largeClock,
        opType: 'CRT',
      });
      const result = await service.uploadOps(userId, clientA, [op1]);
      expect(result[0].accepted).toBe(true);

      // Verify the clock was stored correctly
      const ops = await service.getOpsSince(userId, 0);
      expect(ops[0].op.vectorClock).toEqual(largeClock);
    });

    it('should handle first operation on entity (no existing op to conflict with)', async () => {
      const service = getSyncService();

      // First ever operation - no conflict possible
      const op = createOp({
        entityId: 'brand-new-task',
        clientId: clientA,
        vectorClock: { [clientA]: 1 },
        opType: 'CRT',
      });
      const result = await service.uploadOps(userId, clientA, [op]);
      expect(result[0].accepted).toBe(true);
    });
  });
});
