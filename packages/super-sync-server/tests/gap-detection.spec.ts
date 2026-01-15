import { describe, it, expect, beforeEach, vi } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { testState, resetTestState } from './sync.service.test-state';
import { Operation } from '../src/sync/sync.types';

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
      aggregate: vi.fn().mockImplementation(async (args: any) => {
        const ops = Array.from(state.operations.values()).filter(
          (op: any) => args.where?.userId === op.userId,
        );
        if (ops.length === 0)
          return { _max: { serverSeq: null }, _min: { serverSeq: null } };
        const seqs = ops.map((op: any) => op.serverSeq);
        return {
          _max: { serverSeq: Math.max(...seqs) },
          _min: { serverSeq: Math.min(...seqs) },
        };
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
          if (ops.length === 0)
            return { _max: { serverSeq: null }, _min: { serverSeq: null } };
          const seqs = ops.map((op: any) => op.serverSeq);
          return {
            _max: { serverSeq: Math.max(...seqs) },
            _min: { serverSeq: Math.min(...seqs) },
          };
        }),
        deleteMany: vi.fn().mockImplementation(async () => ({ count: 0 })),
        findUnique: vi.fn().mockImplementation(async (args: any) => {
          if (args.where?.id) {
            return state.operations.get(args.where.id) || null;
          }
          return null;
        }),
      },
      syncDevice: {
        findMany: vi.fn().mockImplementation(async () => []),
      },
      user: {
        findUnique: vi.fn().mockImplementation(async (args: any) => {
          return state.users.get(args.where.id) || null;
        }),
      },
    },
  };
});

import { initSyncService, getSyncService } from '../src/sync/sync.service';

describe('Gap Detection', () => {
  const userId = 1;
  const clientA = 'client-a';
  const clientB = 'client-b';

  const createOp = (clientId: string, entityId: string): Operation => ({
    id: uuidv7(),
    clientId,
    actionType: 'ADD_TASK',
    opType: 'CRT',
    entityType: 'TASK',
    entityId,
    payload: { title: 'Test' },
    vectorClock: { [clientId]: 1 },
    timestamp: Date.now(),
    schemaVersion: 1,
  });

  beforeEach(() => {
    resetTestState();
    testState.users.set(userId, {
      id: userId,
      email: 'test@test.com',
      passwordHash: 'hash',
      isVerified: true,
      createdAt: new Date(),
    });
    initSyncService();
  });

  // Helper to delete operations from test state (simulates db cleanup)
  const deleteOperations = (filter: (op: any) => boolean) => {
    for (const [id, op] of testState.operations.entries()) {
      if (filter(op)) {
        testState.operations.delete(id);
      }
    }
  };

  describe('Basic Gap Detection', () => {
    it('should not detect gap on first sync (sinceSeq = 0)', async () => {
      const service = getSyncService();

      // Upload some operations
      const ops = [createOp(clientA, 'task-1'), createOp(clientA, 'task-2')];
      await service.uploadOps(userId, clientA, ops);

      // First sync from sinceSeq = 0 should never have a gap
      const result = await service.getOpsSinceWithSeq(userId, 0);
      expect(result.gapDetected).toBe(false);
      expect(result.ops.length).toBe(2);
      expect(result.latestSeq).toBe(2);
    });

    it('should not detect gap when operations are continuous', async () => {
      const service = getSyncService();

      // Upload 3 operations
      await service.uploadOps(userId, clientA, [createOp(clientA, 'task-1')]);
      await service.uploadOps(userId, clientA, [createOp(clientA, 'task-2')]);
      await service.uploadOps(userId, clientA, [createOp(clientA, 'task-3')]);

      // Client syncs from seq 1, should get ops 2 and 3 with no gap
      const result = await service.getOpsSinceWithSeq(userId, 1);
      expect(result.gapDetected).toBe(false);
      expect(result.ops.length).toBe(2);
      expect(result.ops[0].serverSeq).toBe(2);
      expect(result.ops[1].serverSeq).toBe(3);
    });

    it('should detect gap when seq jump occurs due to purged operations', async () => {
      const service = getSyncService();

      // Upload operations
      await service.uploadOps(userId, clientA, [createOp(clientA, 'task-1')]);
      await service.uploadOps(userId, clientA, [createOp(clientA, 'task-2')]);
      await service.uploadOps(userId, clientA, [createOp(clientA, 'task-3')]);
      await service.uploadOps(userId, clientA, [createOp(clientA, 'task-4')]);

      // Delete seq 2 and 3 to create a gap in the middle
      deleteOperations(
        (op) => op.userId === userId && (op.serverSeq === 2 || op.serverSeq === 3),
      );

      // Client syncs from seq 1, expects seq 2 next but gets seq 4
      const result = await service.getOpsSinceWithSeq(userId, 1);
      expect(result.gapDetected).toBe(true);
      expect(result.ops.length).toBe(1);
      expect(result.ops[0].serverSeq).toBe(4);
    });

    it('should detect gap when requested sinceSeq is older than retained operations', async () => {
      const service = getSyncService();

      // Upload operations
      await service.uploadOps(userId, clientA, [createOp(clientA, 'task-1')]);
      await service.uploadOps(userId, clientA, [createOp(clientA, 'task-2')]);
      await service.uploadOps(userId, clientA, [createOp(clientA, 'task-3')]);
      await service.uploadOps(userId, clientA, [createOp(clientA, 'task-4')]);

      // Delete first two operations (simulating retention cleanup)
      deleteOperations((op) => op.userId === userId && op.serverSeq <= 2);

      // Client syncs from seq 1, but minSeq is now 3
      const result = await service.getOpsSinceWithSeq(userId, 1);
      expect(result.gapDetected).toBe(true);
      expect(result.ops.length).toBe(2); // seqs 3 and 4
      expect(result.ops[0].serverSeq).toBe(3);
    });
  });

  describe('excludeClient Parameter', () => {
    it('should exclude operations from specified client', async () => {
      const service = getSyncService();

      // Client A uploads
      await service.uploadOps(userId, clientA, [createOp(clientA, 'task-1')]);
      // Client B uploads
      await service.uploadOps(userId, clientB, [createOp(clientB, 'task-2')]);
      // Client A uploads again
      await service.uploadOps(userId, clientA, [createOp(clientA, 'task-3')]);

      // Client A syncs excluding own ops
      const result = await service.getOpsSinceWithSeq(userId, 0, clientA);
      expect(result.ops.length).toBe(1);
      expect(result.ops[0].op.clientId).toBe(clientB);
      expect(result.ops[0].serverSeq).toBe(2);
    });

    it('should not flag gap when excluded client caused the seq jump', async () => {
      const service = getSyncService();

      // Client A uploads op 1
      await service.uploadOps(userId, clientA, [createOp(clientA, 'task-1')]);
      // Client B uploads op 2
      await service.uploadOps(userId, clientB, [createOp(clientB, 'task-2')]);
      // Client B uploads op 3
      await service.uploadOps(userId, clientB, [createOp(clientB, 'task-3')]);

      // Client B syncs from seq 0 excluding own ops
      // Should only get op 1, but seq jump from 1 to 4 shouldn't be flagged as gap
      // because the missing ops (2, 3) are from the excluded client
      const result = await service.getOpsSinceWithSeq(userId, 0, clientB);
      expect(result.ops.length).toBe(1);
      expect(result.ops[0].serverSeq).toBe(1);
      // Gap detection is disabled when excludeClient is specified
      expect(result.gapDetected).toBe(false);
    });

    it('should detect gap via minSeq check even with excludeClient', async () => {
      const service = getSyncService();

      // Upload ops from both clients
      await service.uploadOps(userId, clientA, [createOp(clientA, 'task-1')]);
      await service.uploadOps(userId, clientB, [createOp(clientB, 'task-2')]);
      await service.uploadOps(userId, clientA, [createOp(clientA, 'task-3')]);
      await service.uploadOps(userId, clientA, [createOp(clientA, 'task-4')]);

      // Delete ops 1 and 2
      deleteOperations((op) => op.userId === userId && op.serverSeq <= 2);

      // Client B syncs from seq 1, excluding own ops
      // sinceSeq=1, minSeq=3, so 1 < 3-1=2 is true -> gap detected
      const result = await service.getOpsSinceWithSeq(userId, 1, clientB);
      expect(result.gapDetected).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty database gracefully', async () => {
      const service = getSyncService();

      // No operations uploaded yet
      const result = await service.getOpsSinceWithSeq(userId, 0);
      expect(result.gapDetected).toBe(false);
      expect(result.ops.length).toBe(0);
      expect(result.latestSeq).toBe(0);
    });

    it('should detect gap when client is ahead of server (server reset scenario)', async () => {
      const service = getSyncService();

      // Upload one op
      await service.uploadOps(userId, clientA, [createOp(clientA, 'task-1')]);

      // Client claims to be at seq 100 (impossible - indicates server was reset)
      const result = await service.getOpsSinceWithSeq(userId, 100);
      expect(result.gapDetected).toBe(true); // Gap detected: client ahead of server
      expect(result.ops.length).toBe(0);
      expect(result.latestSeq).toBe(1);
    });

    it('should respect limit parameter', async () => {
      const service = getSyncService();

      // Upload 10 operations
      for (let i = 1; i <= 10; i++) {
        await service.uploadOps(userId, clientA, [createOp(clientA, `task-${i}`)]);
      }

      // Request with limit 3
      const result = await service.getOpsSinceWithSeq(userId, 0, undefined, 3);
      expect(result.ops.length).toBe(3);
      expect(result.ops[0].serverSeq).toBe(1);
      expect(result.ops[2].serverSeq).toBe(3);
      expect(result.latestSeq).toBe(10);
      expect(result.gapDetected).toBe(false);
    });

    it('should not detect gap when sinceSeq = 0 (first sync)', async () => {
      const service = getSyncService();

      // Upload and delete to create gap at seq 1
      await service.uploadOps(userId, clientA, [createOp(clientA, 'task-1')]);
      await service.uploadOps(userId, clientA, [createOp(clientA, 'task-2')]);
      deleteOperations((op) => op.userId === userId && op.serverSeq === 1);

      // sinceSeq = 0 skips gap detection entirely (first sync case)
      // The logic is: if (sinceSeq > 0 && latestSeq > 0) { ... }
      const result = await service.getOpsSinceWithSeq(userId, 0);
      expect(result.gapDetected).toBe(false);
      expect(result.ops.length).toBe(1);
      expect(result.ops[0].serverSeq).toBe(2);
    });

    it('should handle single operation in database', async () => {
      const service = getSyncService();

      await service.uploadOps(userId, clientA, [createOp(clientA, 'task-1')]);

      // Sync from 0
      const result0 = await service.getOpsSinceWithSeq(userId, 0);
      expect(result0.gapDetected).toBe(false);
      expect(result0.ops.length).toBe(1);

      // Sync from 1 (should get nothing, no gap)
      const result1 = await service.getOpsSinceWithSeq(userId, 1);
      expect(result1.gapDetected).toBe(false);
      expect(result1.ops.length).toBe(0);
    });
  });

  describe('Transaction Isolation', () => {
    it('should return consistent latestSeq with returned operations', async () => {
      const service = getSyncService();

      // Upload some operations
      for (let i = 1; i <= 5; i++) {
        await service.uploadOps(userId, clientA, [createOp(clientA, `task-${i}`)]);
      }

      // The returned latestSeq should reflect the actual state at query time
      const result = await service.getOpsSinceWithSeq(userId, 0);
      expect(result.latestSeq).toBe(5);
      expect(result.ops.length).toBe(5);

      // If we had 5 ops and latestSeq is 5, the last op should have serverSeq 5
      expect(result.ops[4].serverSeq).toBe(5);
    });
  });

  describe('User Isolation', () => {
    it('should only consider operations from requesting user', async () => {
      const service = getSyncService();
      const userId2 = 2;

      // Create second user
      testState.users.set(userId2, {
        id: userId2,
        email: 'test2@test.com',
        passwordHash: 'hash',
        isVerified: true,
        createdAt: new Date(),
      });

      // User 1 uploads
      await service.uploadOps(userId, clientA, [createOp(clientA, 'task-1')]);
      await service.uploadOps(userId, clientA, [createOp(clientA, 'task-2')]);

      // User 2 uploads
      await service.uploadOps(userId2, clientB, [createOp(clientB, 'task-1')]);

      // User 2's first sync should have no gap
      const result = await service.getOpsSinceWithSeq(userId2, 0);
      expect(result.gapDetected).toBe(false);
      expect(result.ops.length).toBe(1);
      expect(result.latestSeq).toBe(1); // User 2 has seq 1 only
    });
  });

  describe('Gap Detection with minSeq', () => {
    it('should correctly calculate minSeq after cleanup', async () => {
      const service = getSyncService();

      // Upload 5 operations
      for (let i = 1; i <= 5; i++) {
        await service.uploadOps(userId, clientA, [createOp(clientA, `task-${i}`)]);
      }

      // Delete first 3 operations
      deleteOperations((op) => op.userId === userId && op.serverSeq <= 3);

      // Now minSeq should be 4
      // Client requesting from seq 2 should detect gap
      const result = await service.getOpsSinceWithSeq(userId, 2);
      expect(result.gapDetected).toBe(true);

      // Client requesting from seq 3 should also detect gap (3 < 4 - 1 = 3 is false, but first op is 4 not 4)
      const result2 = await service.getOpsSinceWithSeq(userId, 3);
      // sinceSeq=3, minSeq=4, 3 < 4-1=3 is false, so no gap from minSeq
      // But first op is seq 4, which is 3+1=4, so no gap from first op check either
      expect(result2.gapDetected).toBe(false);
      expect(result2.ops[0].serverSeq).toBe(4);
    });
  });
});
