import { describe, it, expect, beforeEach, vi } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { Prisma } from '@prisma/client';
import { testState, resetTestState } from './sync.service.test-state';

// Mock the database module with Prisma mocks
vi.mock('../src/db', async () => {
  // Import testState from separate module to avoid circular import
  const { testState: state } = await import('./sync.service.test-state');
  const { Prisma: PrismaModule } = await import('@prisma/client');

  const createTxMock = () => ({
    operation: {
      create: vi.fn().mockImplementation(async (args: any) => {
        // Check for duplicate ID (unique constraint)
        if (state.operations.has(args.data.id)) {
          throw new PrismaModule.PrismaClientKnownRequestError(
            'Unique constraint failed',
            { code: 'P2002', clientVersion: '5.0.0' },
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
        if (args.where?.opType?.in) {
          const ops = Array.from(state.operations.values())
            .filter((op: any) => args.where.userId === op.userId)
            .sort((a: any, b: any) => b.serverSeq - a.serverSeq);
          for (const op of ops) {
            if (args.where.opType.in.includes(op.opType)) {
              if (args.where.serverSeq?.lte !== undefined) {
                if (op.serverSeq <= args.where.serverSeq.lte) return op;
              } else {
                return op;
              }
            }
          }
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
            if (
              args.where?.serverSeq?.lte !== undefined &&
              op.serverSeq > args.where.serverSeq.lte
            )
              return false;
            if (args.where?.clientId?.not && op.clientId === args.where.clientId.not)
              return false;
            if (args.where?.opType?.in && !args.where.opType.in.includes(op.opType))
              return false;
            return true;
          })
          .sort((a: any, b: any) => {
            if (args.orderBy?.serverSeq === 'desc') return b.serverSeq - a.serverSeq;
            return a.serverSeq - b.serverSeq;
          })
          .slice(0, args.take || 500);
      }),
      aggregate: vi.fn().mockImplementation(async (args: any) => {
        const ops = Array.from(state.operations.values()).filter(
          (op: any) => args.where?.userId === op.userId,
        );
        if (ops.length === 0)
          return { _min: { serverSeq: null }, _max: { serverSeq: null } };
        const seqs = ops.map((op: any) => op.serverSeq);
        return {
          _min: { serverSeq: Math.min(...seqs) },
          _max: { serverSeq: Math.max(...seqs) },
        };
      }),
      deleteMany: vi.fn().mockImplementation(async (args: any) => {
        let deleted = 0;
        for (const [id, op] of state.operations) {
          let shouldDelete = true;
          if (args.where?.userId !== undefined && op.userId !== args.where.userId)
            shouldDelete = false;
          if (
            args.where?.receivedAt?.lt !== undefined &&
            op.receivedAt >= args.where.receivedAt.lt
          )
            shouldDelete = false;
          if (shouldDelete) {
            state.operations.delete(id);
            deleted++;
          }
        }
        return { count: deleted };
      }),
      count: vi.fn().mockImplementation(async (args: any) => {
        let count = 0;
        for (const op of state.operations.values()) {
          let matches = true;
          if (args.where?.userId !== undefined && op.userId !== args.where.userId)
            matches = false;
          if (
            args.where?.serverSeq?.gt !== undefined &&
            op.serverSeq <= args.where.serverSeq.gt
          )
            matches = false;
          if (
            args.where?.serverSeq?.lte !== undefined &&
            op.serverSeq > args.where.serverSeq.lte
          )
            matches = false;
          if (args.where?.isPayloadEncrypted && !op.isPayloadEncrypted) matches = false;
          if (matches) count++;
        }
        return count;
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
          // Handle Prisma increment syntax
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
      findMany: vi.fn().mockImplementation(async (args: any) => {
        return Array.from(state.userSyncStates.values()).filter((s: any) => {
          if (
            args?.where?.lastSnapshotSeq?.not !== undefined &&
            s.lastSnapshotSeq == null
          )
            return false;
          if (args?.where?.snapshotAt?.not !== undefined && s.snapshotAt == null)
            return false;
          return true;
        });
      }),
      deleteMany: vi.fn().mockImplementation(async (args: any) => {
        let deleted = 0;
        for (const [key, syncState] of state.userSyncStates) {
          if (
            args.where?.userId !== undefined &&
            syncState.userId === args.where.userId
          ) {
            state.userSyncStates.delete(key);
            deleted++;
          }
        }
        return { count: deleted };
      }),
      updateMany: vi.fn().mockImplementation(async (args: any) => {
        let updated = 0;
        for (const [key, syncState] of state.userSyncStates) {
          if (
            args.where?.userId !== undefined &&
            syncState.userId === args.where.userId
          ) {
            Object.assign(syncState, args.data);
            updated++;
          }
        }
        return { count: updated };
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
      count: vi.fn().mockImplementation(async (args: any) => {
        let count = 0;
        for (const device of state.syncDevices.values()) {
          if (args.where?.userId !== undefined && device.userId !== args.where.userId)
            continue;
          if (args.where?.lastSeenAt?.gt !== undefined) {
            if ((device.lastSeenAt || 0) <= args.where.lastSeenAt.gt) continue;
          }
          count++;
        }
        return count;
      }),
      deleteMany: vi.fn().mockImplementation(async (args: any) => {
        let deleted = 0;
        for (const [key, device] of state.syncDevices) {
          if (
            args.where?.lastSeenAt?.lt !== undefined &&
            device.lastSeenAt < args.where.lastSeenAt.lt
          ) {
            state.syncDevices.delete(key);
            deleted++;
          }
        }
        return { count: deleted };
      }),
    },
    user: {
      findUnique: vi.fn().mockImplementation(async (args: any) => {
        return state.users.get(args.where.id) || null;
      }),
      update: vi.fn().mockResolvedValue({}),
    },
  });

  return {
    prisma: {
      $transaction: vi
        .fn()
        .mockImplementation(async (callback: any) => callback(createTxMock())),
      operation: {
        findFirst: vi.fn().mockImplementation(async (args: any) => {
          if (args.where?.opType?.in) {
            const ops = Array.from(state.operations.values())
              .filter((op: any) => args.where.userId === op.userId)
              .sort((a: any, b: any) => b.serverSeq - a.serverSeq);
            for (const op of ops) {
              if (args.where.opType.in.includes(op.opType)) {
                if (args.where.serverSeq?.lte !== undefined) {
                  if (op.serverSeq <= args.where.serverSeq.lte) return op;
                } else {
                  return op;
                }
              }
            }
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
              if (
                args.where?.serverSeq?.lte !== undefined &&
                op.serverSeq > args.where.serverSeq.lte
              )
                return false;
              if (args.where?.clientId?.not && op.clientId === args.where.clientId.not)
                return false;
              if (args.where?.opType?.in && !args.where.opType.in.includes(op.opType))
                return false;
              return true;
            })
            .sort((a: any, b: any) => {
              if (args.orderBy?.serverSeq === 'desc') return b.serverSeq - a.serverSeq;
              return a.serverSeq - b.serverSeq;
            })
            .slice(0, args.take || 500);
        }),
        aggregate: vi.fn().mockImplementation(async (args: any) => {
          const ops = Array.from(state.operations.values()).filter(
            (op: any) => args.where?.userId === op.userId,
          );
          if (ops.length === 0)
            return { _min: { serverSeq: null }, _max: { serverSeq: null } };
          const seqs = ops.map((op: any) => op.serverSeq);
          return {
            _min: { serverSeq: Math.min(...seqs) },
            _max: { serverSeq: Math.max(...seqs) },
          };
        }),
        count: vi.fn().mockImplementation(async (args: any) => {
          let count = 0;
          for (const op of state.operations.values()) {
            let matches = true;
            if (args.where?.userId !== undefined && op.userId !== args.where.userId)
              matches = false;
            if (
              args.where?.serverSeq?.gt !== undefined &&
              op.serverSeq <= args.where.serverSeq.gt
            )
              matches = false;
            if (
              args.where?.serverSeq?.lte !== undefined &&
              op.serverSeq > args.where.serverSeq.lte
            )
              matches = false;
            if (args.where?.isPayloadEncrypted && !op.isPayloadEncrypted) matches = false;
            if (matches) count++;
          }
          return count;
        }),
        deleteMany: vi.fn().mockImplementation(async (args: any) => {
          let deleted = 0;
          for (const [id, op] of state.operations) {
            let shouldDelete = true;
            if (args.where?.userId !== undefined && op.userId !== args.where.userId)
              shouldDelete = false;
            if (
              args.where?.serverSeq?.lte !== undefined &&
              op.serverSeq > args.where.serverSeq.lte
            )
              shouldDelete = false;
            if (
              args.where?.receivedAt?.lt !== undefined &&
              op.receivedAt >= args.where.receivedAt.lt
            )
              shouldDelete = false;
            if (shouldDelete) {
              state.operations.delete(id);
              deleted++;
            }
          }
          return { count: deleted };
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
        update: vi.fn().mockResolvedValue({}),
        findMany: vi.fn().mockImplementation(async (args: any) => {
          return Array.from(state.userSyncStates.values()).filter((s: any) => {
            if (
              args?.where?.lastSnapshotSeq?.not !== undefined &&
              s.lastSnapshotSeq == null
            )
              return false;
            if (args?.where?.snapshotAt?.not !== undefined && s.snapshotAt == null)
              return false;
            return true;
          });
        }),
        updateMany: vi.fn().mockImplementation(async (args: any) => {
          let updated = 0;
          for (const [, syncState] of state.userSyncStates) {
            if (
              args.where?.userId !== undefined &&
              syncState.userId === args.where.userId
            ) {
              Object.assign(syncState, args.data);
              updated++;
            }
          }
          return { count: updated };
        }),
      },
      syncDevice: {
        upsert: vi.fn().mockImplementation(async (args: any) => {
          const key = `${args.where.clientId_userId.userId}:${args.where.clientId_userId.clientId}`;
          const result = {
            ...args.create,
            ...args.update,
            userId: args.where.clientId_userId.userId,
            clientId: args.where.clientId_userId.clientId,
          };
          state.syncDevices.set(key, result);
          return result;
        }),
        count: vi.fn().mockImplementation(async (args: any) => {
          let count = 0;
          for (const device of state.syncDevices.values()) {
            if (args.where?.userId !== undefined && device.userId !== args.where.userId)
              continue;
            if (args.where?.lastSeenAt?.gt !== undefined) {
              if ((device.lastSeenAt || 0) <= args.where.lastSeenAt.gt) continue;
            }
            count++;
          }
          return count;
        }),
        deleteMany: vi.fn().mockImplementation(async (args: any) => {
          let deleted = 0;
          for (const [key, device] of state.syncDevices) {
            if (
              args.where?.lastSeenAt?.lt !== undefined &&
              device.lastSeenAt < args.where.lastSeenAt.lt
            ) {
              state.syncDevices.delete(key);
              deleted++;
            }
          }
          return { count: deleted };
        }),
      },
      user: {
        findUnique: vi.fn().mockImplementation(async (args: any) => {
          return state.users.get(args.where.id) || null;
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      $queryRaw: vi.fn().mockResolvedValue([{ total: BigInt(0) }]),
    },
  };
});

// Mock auth module
vi.mock('../src/auth', () => ({
  verifyToken: vi.fn().mockResolvedValue({ userId: 1, email: 'test@test.com' }),
}));

// Import AFTER mocking
import { initSyncService, getSyncService, SyncService } from '../src/sync/sync.service';
import { Operation, DEFAULT_SYNC_CONFIG } from '../src/sync/sync.types';

describe('SyncService', () => {
  const userId = 1;
  const clientId = 'test-device-1';

  beforeEach(() => {
    // Reset all test data stores
    resetTestState();

    // Add a test user
    testState.users.set(userId, {
      id: userId,
      email: 'test@test.com',
      storageQuotaBytes: BigInt(100 * 1024 * 1024),
      storageUsedBytes: BigInt(0),
    });

    vi.clearAllMocks();

    // Initialize service
    initSyncService();
  });

  describe('uploadOps', () => {
    it('should correctly upload operations', async () => {
      const service = getSyncService();
      const op: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD_TASK',
        opType: 'CRT',
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Test Task' },
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      const results = await service.uploadOps(userId, clientId, [op]);

      expect(results).toHaveLength(1);
      expect(results[0].accepted).toBe(true);
      expect(results[0].serverSeq).toBe(1);

      const latestSeq = await service.getLatestSeq(userId);
      expect(latestSeq).toBe(1);
    });

    it('should handle multiple operations in order', async () => {
      const service = getSyncService();
      const ops: Operation[] = [
        {
          id: uuidv7(),
          clientId,
          actionType: 'ADD_TASK',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 'task-1',
          payload: { title: 'Task 1' },
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
        {
          id: uuidv7(),
          clientId,
          actionType: 'ADD_TASK',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 'task-2',
          payload: { title: 'Task 2' },
          vectorClock: {},
          timestamp: Date.now() + 1,
          schemaVersion: 1,
        },
      ];

      const results = await service.uploadOps(userId, clientId, ops);

      expect(results).toHaveLength(2);
      expect(results[0].serverSeq).toBe(1);
      expect(results[1].serverSeq).toBe(2);
    });

    it('should reject duplicate operation IDs (idempotency)', async () => {
      const service = getSyncService();
      const opId = uuidv7();
      const op: Operation = {
        id: opId,
        clientId,
        actionType: 'ADD_TASK',
        opType: 'CRT',
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Test Task' },
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      // First upload should succeed
      const firstResults = await service.uploadOps(userId, clientId, [op]);
      expect(firstResults[0].accepted).toBe(true);

      // Second upload with same ID should be rejected
      const secondResults = await service.uploadOps(userId, clientId, [op]);
      expect(secondResults[0].accepted).toBe(false);
      expect(secondResults[0].error).toBe('Duplicate operation ID');
    });

    it('should update device last seen timestamp', async () => {
      const service = getSyncService();

      const op: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD_TASK',
        opType: 'CRT',
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Test Task' },
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      await service.uploadOps(userId, clientId, [op]);

      const deviceKey = `${userId}:${clientId}`;
      const device = testState.syncDevices.get(deviceKey);

      expect(device).toBeDefined();
      expect(device.lastSeenAt).toBeDefined();
    });
  });

  describe('validation', () => {
    it('should reject operations with invalid opType', async () => {
      const service = getSyncService();
      const op = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD_TASK',
        opType: 'INVALID' as Operation['opType'],
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Test Task' },
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      const results = await service.uploadOps(userId, clientId, [op]);

      expect(results[0].accepted).toBe(false);
      expect(results[0].error).toBe('Invalid opType');
    });

    it('should reject operations with missing entityType', async () => {
      const service = getSyncService();
      const op = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD_TASK',
        opType: 'CRT' as const,
        entityType: '',
        entityId: 'task-1',
        payload: { title: 'Test Task' },
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      const results = await service.uploadOps(userId, clientId, [op]);

      expect(results[0].accepted).toBe(false);
      expect(results[0].error).toBe('Missing entityType');
    });

    it('should reject operations with missing payload', async () => {
      const service = getSyncService();
      const op = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD_TASK',
        opType: 'CRT' as const,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: undefined,
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 1,
      } as unknown as Operation;

      const results = await service.uploadOps(userId, clientId, [op]);

      expect(results[0].accepted).toBe(false);
      expect(results[0].error).toBe('Missing payload');
    });

    it('should reject operations with invalid ID', async () => {
      const service = getSyncService();
      const op = {
        id: '',
        clientId,
        actionType: 'ADD_TASK',
        opType: 'CRT' as const,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Test Task' },
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      const results = await service.uploadOps(userId, clientId, [op]);

      expect(results[0].accepted).toBe(false);
      expect(results[0].error).toBe('Invalid operation ID');
    });

    it('should clamp operations with timestamp too far in the future', async () => {
      const service = getSyncService();
      const now = Date.now();
      const farFuture = now + DEFAULT_SYNC_CONFIG.maxClockDriftMs + 10000; // 10s beyond limit

      const op: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD_TASK',
        opType: 'CRT',
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Test Task' },
        vectorClock: {},
        timestamp: farFuture,
        schemaVersion: 1,
      };

      const results = await service.uploadOps(userId, clientId, [op]);

      // Should be accepted with clamped timestamp (not rejected)
      expect(results[0].accepted).toBe(true);
      expect(results[0].serverSeq).toBeDefined();

      // Verify the stored timestamp was clamped
      const storedOp = testState.operations.get(op.id);
      expect(storedOp).toBeDefined();
      // clientTimestamp should be clamped to approximately now + maxClockDriftMs
      const storedTimestamp = Number(storedOp.clientTimestamp);
      expect(storedTimestamp).toBeLessThanOrEqual(
        now + DEFAULT_SYNC_CONFIG.maxClockDriftMs + 100,
      ); // 100ms tolerance
      expect(storedTimestamp).toBeLessThan(farFuture); // Must be less than original
    });

    it('should NOT clamp timestamp exactly at max clock drift boundary', async () => {
      const service = getSyncService();
      const now = Date.now();
      const exactlyAtLimit = now + DEFAULT_SYNC_CONFIG.maxClockDriftMs;

      const op: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD_TASK',
        opType: 'CRT',
        entityType: 'TASK',
        entityId: 'task-2',
        payload: { title: 'Boundary Test' },
        vectorClock: {},
        timestamp: exactlyAtLimit,
        schemaVersion: 1,
      };

      const results = await service.uploadOps(userId, clientId, [op]);

      expect(results[0].accepted).toBe(true);

      // Timestamp at exactly the boundary should NOT be clamped
      const storedOp = testState.operations.get(op.id);
      const storedTimestamp = Number(storedOp.clientTimestamp);
      expect(storedTimestamp).toBe(exactlyAtLimit);
    });

    it('should clamp timestamp just 1ms over max clock drift boundary', async () => {
      const service = getSyncService();
      const now = Date.now();
      const justOverLimit = now + DEFAULT_SYNC_CONFIG.maxClockDriftMs + 1;

      const op: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD_TASK',
        opType: 'CRT',
        entityType: 'TASK',
        entityId: 'task-3',
        payload: { title: 'Just Over Boundary' },
        vectorClock: {},
        timestamp: justOverLimit,
        schemaVersion: 1,
      };

      const results = await service.uploadOps(userId, clientId, [op]);

      expect(results[0].accepted).toBe(true);

      // Timestamp just over the boundary should be clamped
      const storedOp = testState.operations.get(op.id);
      const storedTimestamp = Number(storedOp.clientTimestamp);
      expect(storedTimestamp).toBeLessThan(justOverLimit);
      // Should be clamped to maxClockDriftMs (within small tolerance for test execution time)
      expect(storedTimestamp).toBeLessThanOrEqual(
        now + DEFAULT_SYNC_CONFIG.maxClockDriftMs + 50,
      );
    });

    it('should reject operations that are too old', async () => {
      const service = getSyncService();
      const tooOld = Date.now() - DEFAULT_SYNC_CONFIG.retentionMs - 10000;

      const op: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD_TASK',
        opType: 'CRT',
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Test Task' },
        vectorClock: {},
        timestamp: tooOld,
        schemaVersion: 1,
      };

      const results = await service.uploadOps(userId, clientId, [op]);

      expect(results[0].accepted).toBe(false);
      expect(results[0].error).toBe('Operation too old');
    });

    it('should reject operations with payload exceeding size limit', async () => {
      // Create service with small payload limit for testing
      const testService = new (SyncService as any)({
        maxPayloadSizeBytes: 100,
      });

      const largePayload = { data: 'x'.repeat(200) };
      const op: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD_TASK',
        opType: 'CRT',
        entityType: 'TASK',
        entityId: 'task-1',
        payload: largePayload,
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      const results = await testService.uploadOps(userId, clientId, [op]);

      expect(results[0].accepted).toBe(false);
      expect(results[0].error).toBe('Payload too large');
    });

    it('should reject complex payloads for regular operations', async () => {
      const service = getSyncService();

      // Create a deeply nested object that exceeds complexity limits
      const createDeeplyNested = (depth: number): Record<string, unknown> => {
        if (depth === 0) return { value: 'leaf' };
        return { nested: createDeeplyNested(depth - 1) };
      };

      const op: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'UPDATE_TASK',
        opType: 'UPD',
        entityType: 'TASK',
        entityId: 'task-1',
        payload: createDeeplyNested(25), // Exceeds max depth of 20
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      const results = await service.uploadOps(userId, clientId, [op]);

      expect(results[0].accepted).toBe(false);
      expect(results[0].error).toBe('Payload too complex (max depth 20, max keys 20000)');
    });

    it('should accept complex payloads for SYNC_IMPORT operations', async () => {
      const service = getSyncService();

      // Create a deeply nested object that would fail complexity check for regular ops
      const createDeeplyNested = (depth: number): Record<string, unknown> => {
        if (depth === 0) return { value: 'leaf' };
        return { nested: createDeeplyNested(depth - 1) };
      };

      const op: Operation = {
        id: uuidv7(),
        clientId,
        actionType: '[SP_ALL] Load(import) all data',
        opType: 'SYNC_IMPORT',
        entityType: 'ALL',
        payload: createDeeplyNested(25), // Exceeds max depth of 20 but allowed for SYNC_IMPORT
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      const results = await service.uploadOps(userId, clientId, [op]);

      expect(results[0].accepted).toBe(true);
      expect(results[0].serverSeq).toBeDefined();
    });

    it('should accept complex payloads for BACKUP_IMPORT operations', async () => {
      const service = getSyncService();

      // Create an object with many keys that would fail complexity check
      const manyKeys: Record<string, string> = {};
      for (let i = 0; i < 25000; i++) {
        manyKeys[`key${i}`] = `value${i}`;
      }

      const op: Operation = {
        id: uuidv7(),
        clientId,
        actionType: '[SP_ALL] Load(import) all data',
        opType: 'BACKUP_IMPORT',
        entityType: 'ALL',
        payload: manyKeys, // Exceeds max keys of 20000 but allowed for BACKUP_IMPORT
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      const results = await service.uploadOps(userId, clientId, [op]);

      expect(results[0].accepted).toBe(true);
      expect(results[0].serverSeq).toBeDefined();
    });

    it('should accept complex payloads for REPAIR operations', async () => {
      const service = getSyncService();

      // Create a deeply nested object
      const createDeeplyNested = (depth: number): Record<string, unknown> => {
        if (depth === 0) return { value: 'leaf' };
        return { nested: createDeeplyNested(depth - 1) };
      };

      const op: Operation = {
        id: uuidv7(),
        clientId,
        actionType: '[SP_ALL] Load(import) all data',
        opType: 'REPAIR',
        entityType: 'ALL',
        payload: createDeeplyNested(25), // Exceeds max depth of 20 but allowed for REPAIR
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      const results = await service.uploadOps(userId, clientId, [op]);

      expect(results[0].accepted).toBe(true);
      expect(results[0].serverSeq).toBeDefined();
    });

    // === VECTOR CLOCK EDGE CASE TESTS ===

    it('should accept vector clock with zero values', async () => {
      const service = getSyncService();
      const op: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD_TASK',
        opType: 'CRT',
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Test Task' },
        vectorClock: { client1: 0 },
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      const results = await service.uploadOps(userId, clientId, [op]);
      // Zero is a valid clock value (represents initial state)
      expect(results[0].accepted).toBe(true);
    });

    it('should sanitize vector clock with string values (strip invalid entries)', async () => {
      const service = getSyncService();
      const op = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD_TASK',
        opType: 'CRT',
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Test Task' },
        vectorClock: { client1: '1' as unknown as number },
        timestamp: Date.now(),
        schemaVersion: 1,
      } as Operation;

      // Service sanitizes by stripping invalid entries, not rejecting
      const results = await service.uploadOps(userId, clientId, [op]);
      expect(results[0].accepted).toBe(true);
    });

    it('should sanitize vector clock with negative values (strip invalid entries)', async () => {
      const service = getSyncService();
      const op: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD_TASK',
        opType: 'CRT',
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Test Task' },
        vectorClock: { client1: -1 },
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      // Service sanitizes by stripping invalid entries, not rejecting
      const results = await service.uploadOps(userId, clientId, [op]);
      expect(results[0].accepted).toBe(true);
    });

    it('should sanitize vector clock with null entries (strip invalid entries)', async () => {
      const service = getSyncService();
      const op = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD_TASK',
        opType: 'CRT',
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Test Task' },
        vectorClock: { client1: null as unknown as number },
        timestamp: Date.now(),
        schemaVersion: 1,
      } as Operation;

      // Service sanitizes by stripping invalid entries, not rejecting
      const results = await service.uploadOps(userId, clientId, [op]);
      expect(results[0].accepted).toBe(true);
    });

    it('should reject payload that is null', async () => {
      const service = getSyncService();
      const op = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD_TASK',
        opType: 'CRT',
        entityType: 'TASK',
        entityId: 'task-1',
        payload: null,
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 1,
      } as unknown as Operation;

      const results = await service.uploadOps(userId, clientId, [op]);
      expect(results[0].accepted).toBe(false);
      expect(results[0].error).toBe('CRT payload must be a non-null object');
    });

    it('should reject schema version at boundary (> 100)', async () => {
      const service = getSyncService();
      const op: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD_TASK',
        opType: 'CRT',
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Test Task' },
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 101,
      };

      const results = await service.uploadOps(userId, clientId, [op]);
      expect(results[0].accepted).toBe(false);
      expect(results[0].error).toContain('Invalid schema version');
    });

    it('should accept schema version at max boundary (100)', async () => {
      const service = getSyncService();
      const op: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD_TASK',
        opType: 'CRT',
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Test Task' },
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 100,
      };

      const results = await service.uploadOps(userId, clientId, [op]);
      expect(results[0].accepted).toBe(true);
    });

    it('should accept timestamp exactly at max clock drift', async () => {
      const service = getSyncService();
      const exactlyAtDrift = Date.now() + DEFAULT_SYNC_CONFIG.maxClockDriftMs;

      const op: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD_TASK',
        opType: 'CRT',
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Test Task' },
        vectorClock: {},
        timestamp: exactlyAtDrift,
        schemaVersion: 1,
      };

      const results = await service.uploadOps(userId, clientId, [op]);
      // Should be accepted at exactly the boundary
      expect(results[0].accepted).toBe(true);
    });

    it('should handle unicode characters in entityId', async () => {
      const service = getSyncService();
      const op: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD_TASK',
        opType: 'CRT',
        entityType: 'TASK',
        entityId: 'task-日本語-émoji-🎉',
        payload: { title: 'Test Task' },
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      const results = await service.uploadOps(userId, clientId, [op]);
      // Unicode should be accepted
      expect(results[0].accepted).toBe(true);

      // Verify round-trip
      const ops = await service.getOpsSince(userId, 0);
      expect(ops[0].op.entityId).toBe('task-日本語-émoji-🎉');
    });

    it('should reject entityId that is too long', async () => {
      const service = getSyncService();
      const op: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD_TASK',
        opType: 'CRT',
        entityType: 'TASK',
        entityId: 'x'.repeat(300), // Exceeds typical limit
        payload: { title: 'Test Task' },
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      const results = await service.uploadOps(userId, clientId, [op]);
      expect(results[0].accepted).toBe(false);
      expect(results[0].error).toContain('Invalid entityId');
    });
  });

  describe('getOpsSince', () => {
    it('should return operations after given sequence', async () => {
      const service = getSyncService();

      // Upload 5 operations
      for (let i = 1; i <= 5; i++) {
        const op: Operation = {
          id: uuidv7(),
          clientId,
          actionType: 'ADD_TASK',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: `task-${i}`,
          payload: { title: `Task ${i}` },
          vectorClock: {},
          timestamp: Date.now() + i,
          schemaVersion: 1,
        };
        await service.uploadOps(userId, clientId, [op]);
      }

      const ops = await service.getOpsSince(userId, 2);

      expect(ops).toHaveLength(3);
      expect(ops[0].serverSeq).toBe(3);
      expect(ops[1].serverSeq).toBe(4);
      expect(ops[2].serverSeq).toBe(5);
    });

    it('should exclude operations from specified client', async () => {
      const service = getSyncService();
      const client1 = 'client-1';
      const client2 = 'client-2';

      // Upload from client 1
      await service.uploadOps(userId, client1, [
        {
          id: uuidv7(),
          clientId: client1,
          actionType: 'ADD_TASK',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 'task-1',
          payload: { title: 'Task 1' },
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      // Upload from client 2
      await service.uploadOps(userId, client2, [
        {
          id: uuidv7(),
          clientId: client2,
          actionType: 'ADD_TASK',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 'task-2',
          payload: { title: 'Task 2' },
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      const ops = await service.getOpsSince(userId, 0, client1);

      expect(ops).toHaveLength(1);
      expect(ops[0].op.entityId).toBe('task-2');
    });

    it('should respect limit parameter', async () => {
      const service = getSyncService();

      // Upload 10 operations
      for (let i = 1; i <= 10; i++) {
        await service.uploadOps(userId, clientId, [
          {
            id: uuidv7(),
            clientId,
            actionType: 'ADD_TASK',
            opType: 'CRT',
            entityType: 'TASK',
            entityId: `task-${i}`,
            payload: { title: `Task ${i}` },
            vectorClock: {},
            timestamp: Date.now() + i,
            schemaVersion: 1,
          },
        ]);
      }

      const ops = await service.getOpsSince(userId, 0, undefined, 3);

      expect(ops).toHaveLength(3);
    });

    it('should return empty array when no operations exist', async () => {
      const service = getSyncService();

      const ops = await service.getOpsSince(userId, 0);

      expect(ops).toHaveLength(0);
    });
  });

  describe('snapshots', () => {
    it('should reconstruct state from operations (snapshot)', async () => {
      const service = getSyncService();

      // Op 1: Create Task
      const op1: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD',
        opType: 'CRT',
        entityType: 'TASK',
        entityId: 't1',
        payload: { title: 'Task 1', done: false },
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      // Op 2: Update Task
      const op2: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'UPDATE',
        opType: 'UPD',
        entityType: 'TASK',
        entityId: 't1',
        payload: { done: true },
        vectorClock: {},
        timestamp: Date.now() + 100,
        schemaVersion: 1,
      };

      await service.uploadOps(userId, clientId, [op1, op2]);

      const snapshot = await service.generateSnapshot(userId);

      expect(snapshot.serverSeq).toBe(2);

      const state = snapshot.state as Record<
        string,
        Record<string, { title: string; done: boolean }>
      >;
      expect(state.TASK).toBeDefined();
      expect(state.TASK.t1).toBeDefined();
      expect(state.TASK.t1.title).toBe('Task 1');
      expect(state.TASK.t1.done).toBe(true);
    });

    it('should use incremental snapshots', async () => {
      const service = getSyncService();

      // Step 1: Initial State
      const op1: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD',
        opType: 'CRT',
        entityType: 'NOTE',
        entityId: 'n1',
        payload: { text: 'Note 1' },
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 1,
      };
      await service.uploadOps(userId, clientId, [op1]);

      // Generate first snapshot (caches it)
      const snap1 = await service.generateSnapshot(userId);
      expect(snap1.serverSeq).toBe(1);
      expect(
        (snap1.state as Record<string, Record<string, { text: string }>>).NOTE.n1.text,
      ).toBe('Note 1');

      // Step 2: Add more operations
      const op2: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD',
        opType: 'CRT',
        entityType: 'NOTE',
        entityId: 'n2',
        payload: { text: 'Note 2' },
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 1,
      };
      await service.uploadOps(userId, clientId, [op2]);

      // Generate second snapshot
      // This should internally use the cached state from snap1 and apply op2
      const snap2 = await service.generateSnapshot(userId);

      expect(snap2.serverSeq).toBe(2);
      const state = snap2.state as Record<string, Record<string, { text: string }>>;
      expect(state.NOTE.n1.text).toBe('Note 1'); // Preserved
      expect(state.NOTE.n2.text).toBe('Note 2'); // Added
    });

    it('should handle deletions in snapshots', async () => {
      const service = getSyncService();

      // Create
      const op1: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD',
        opType: 'CRT',
        entityType: 'TAG',
        entityId: 'tg1',
        payload: { title: 'Tag 1' },
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 1,
      };
      await service.uploadOps(userId, clientId, [op1]);

      await service.generateSnapshot(userId); // Checkpoint

      // Delete
      const op2: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'DEL',
        opType: 'DEL',
        entityType: 'TAG',
        entityId: 'tg1',
        payload: {},
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 1,
      };
      await service.uploadOps(userId, clientId, [op2]);

      const snap = await service.generateSnapshot(userId);
      const state = snap.state as Record<string, Record<string, unknown>>;

      expect(state.TAG.tg1).toBeUndefined();
    });

    it('should handle MOV operations', async () => {
      const service = getSyncService();

      // Create task
      const op1: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD',
        opType: 'CRT',
        entityType: 'TASK',
        entityId: 't1',
        payload: { title: 'Task 1', parentId: null },
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 1,
      };
      await service.uploadOps(userId, clientId, [op1]);

      // Move task
      const op2: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'MOVE',
        opType: 'MOV',
        entityType: 'TASK',
        entityId: 't1',
        payload: { parentId: 'p1' },
        vectorClock: {},
        timestamp: Date.now() + 100,
        schemaVersion: 1,
      };
      await service.uploadOps(userId, clientId, [op2]);

      const snap = await service.generateSnapshot(userId);
      const state = snap.state as Record<string, Record<string, { parentId: string }>>;

      expect(state.TASK.t1.parentId).toBe('p1');
    });

    it('should handle BATCH operations with entities payload', async () => {
      const service = getSyncService();

      // BATCH operations still need entityId for validation
      const op: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'BATCH_UPDATE',
        opType: 'BATCH',
        entityType: 'TASK',
        entityId: '*', // Wildcard entityId for batch operations
        payload: {
          entities: {
            t1: { title: 'Task 1', done: false },
            t2: { title: 'Task 2', done: true },
          },
        },
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 1,
      };
      await service.uploadOps(userId, clientId, [op]);

      const snap = await service.generateSnapshot(userId);
      const state = snap.state as Record<
        string,
        Record<string, { title: string; done: boolean }>
      >;

      expect(state.TASK.t1.title).toBe('Task 1');
      expect(state.TASK.t2.done).toBe(true);
    });

    it('should return cached snapshot if up to date', async () => {
      const service = getSyncService();

      const op: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD',
        opType: 'CRT',
        entityType: 'TASK',
        entityId: 't1',
        payload: { title: 'Task 1' },
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 1,
      };
      await service.uploadOps(userId, clientId, [op]);

      // Generate and cache
      const snap1 = await service.generateSnapshot(userId);

      // Call again - should return cached
      const snap2 = await service.generateSnapshot(userId);

      expect(snap1.serverSeq).toBe(snap2.serverSeq);
      expect(snap1.state).toEqual(snap2.state);
    });
  });

  describe('cleanup', () => {
    it('should delete old operations (time-based)', async () => {
      const service = getSyncService();

      // Upload operations
      for (let i = 1; i <= 5; i++) {
        await service.uploadOps(userId, clientId, [
          {
            id: uuidv7(),
            clientId,
            actionType: 'ADD',
            opType: 'CRT',
            entityType: 'TASK',
            entityId: `t${i}`,
            payload: {},
            vectorClock: {},
            timestamp: Date.now(),
            schemaVersion: 1,
          },
        ]);
      }

      // Manually set old received_at to simulate old operations
      for (const [_id, op] of testState.operations) {
        if (op.serverSeq <= 2) {
          op.receivedAt = BigInt(Date.now() - 100 * 24 * 60 * 60 * 1000); // 100 days ago
        }
      }

      // Set up userSyncState with required fields for cleanup
      // The cleanup requires lastSnapshotSeq and snapshotAt to be set
      const cutoffTime = Date.now() - 50 * 24 * 60 * 60 * 1000; // 50 days ago
      testState.userSyncStates.set(userId, {
        userId,
        lastSeq: 5,
        lastSnapshotSeq: 5, // Snapshot covers all ops up to seq 5
        snapshotAt: BigInt(Date.now()), // Snapshot taken recently (>= cutoffTime)
      });

      const { totalDeleted, affectedUserIds } =
        await service.deleteOldSyncedOpsForAllUsers(cutoffTime);

      expect(totalDeleted).toBe(2);
      expect(affectedUserIds).toContain(userId);

      const remaining = await service.getOpsSince(userId, 0);
      expect(remaining).toHaveLength(3);
    });

    it('should delete old operations from all users', async () => {
      const service = getSyncService();
      const user2Id = 2;

      // Create second user
      testState.users.set(user2Id, {
        id: user2Id,
        email: 'test2@test.com',
        storageQuotaBytes: BigInt(100 * 1024 * 1024),
        storageUsedBytes: BigInt(0),
      });

      // Upload ops for user 1
      await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: 'ADD',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 't1',
          payload: {},
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      // Upload ops for user 2
      await service.uploadOps(user2Id, 'client-2', [
        {
          id: uuidv7(),
          clientId: 'client-2',
          actionType: 'ADD',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 't2',
          payload: {},
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      // Make all ops old
      for (const op of testState.operations.values()) {
        op.receivedAt = BigInt(Date.now() - 100 * 24 * 60 * 60 * 1000); // 100 days ago
      }

      // Set up userSyncState with required fields for both users
      const cutoffTime = Date.now() - 50 * 24 * 60 * 60 * 1000;
      testState.userSyncStates.set(userId, {
        userId,
        lastSeq: 1,
        lastSnapshotSeq: 1,
        snapshotAt: BigInt(Date.now()),
      });
      testState.userSyncStates.set(user2Id, {
        userId: user2Id,
        lastSeq: 2,
        lastSnapshotSeq: 2,
        snapshotAt: BigInt(Date.now()),
      });

      // Delete ops older than 50 days
      const { totalDeleted, affectedUserIds } =
        await service.deleteOldSyncedOpsForAllUsers(cutoffTime);

      expect(totalDeleted).toBe(2); // Both users' ops deleted
      expect(affectedUserIds).toHaveLength(2);
      expect(affectedUserIds).toContain(userId);
      expect(affectedUserIds).toContain(user2Id);

      expect((await service.getOpsSince(userId, 0)).length).toBe(0);
      expect((await service.getOpsSince(user2Id, 0)).length).toBe(0);
    });

    it('should delete stale devices', async () => {
      const service = getSyncService();

      // Create device by uploading
      await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: 'ADD',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 't1',
          payload: {},
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      // Make device stale (100 days ago)
      const deviceKey = `${userId}:${clientId}`;
      const device = testState.syncDevices.get(deviceKey);
      if (device) {
        device.lastSeenAt = Date.now() - 100 * 24 * 60 * 60 * 1000;
      }

      // Delete devices not seen in 50 days
      const deleted = await service.deleteStaleDevices(
        Date.now() - 50 * 24 * 60 * 60 * 1000,
      );

      expect(deleted).toBe(1);
    });

    it('should not delete recent operations', async () => {
      const service = getSyncService();

      // Upload recent operations
      for (let i = 1; i <= 3; i++) {
        await service.uploadOps(userId, clientId, [
          {
            id: uuidv7(),
            clientId,
            actionType: 'ADD',
            opType: 'CRT',
            entityType: 'TASK',
            entityId: `t${i}`,
            payload: {},
            vectorClock: {},
            timestamp: Date.now(),
            schemaVersion: 1,
          },
        ]);
      }

      // Try to delete with 50-day cutoff - should delete nothing since ops are fresh
      const cutoffTime = Date.now() - 50 * 24 * 60 * 60 * 1000;
      const { totalDeleted, affectedUserIds } =
        await service.deleteOldSyncedOpsForAllUsers(cutoffTime);

      expect(totalDeleted).toBe(0);
      expect(affectedUserIds).toHaveLength(0);
      expect((await service.getOpsSince(userId, 0)).length).toBe(3);
    });

    it('should not delete recent devices', async () => {
      const service = getSyncService();

      // Create device by uploading (device will have current timestamp)
      await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: 'ADD',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 't1',
          payload: {},
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      // Try to delete with 50-day cutoff - should delete nothing since device is fresh
      const deleted = await service.deleteStaleDevices(
        Date.now() - 50 * 24 * 60 * 60 * 1000,
      );

      expect(deleted).toBe(0);
    });
  });

  describe('rate limiting', () => {
    it('should not rate limit initially', () => {
      const service = getSyncService();

      expect(service.isRateLimited(userId)).toBe(false);
    });

    it('should rate limit after exceeding max requests', () => {
      // Create service with low rate limit for testing
      const testService = new (SyncService as any)({
        uploadRateLimit: { max: 2, windowMs: 60000 },
      });

      // First request
      expect(testService.isRateLimited(userId)).toBe(false);
      // Second request
      expect(testService.isRateLimited(userId)).toBe(false);
      // Third request - should be rate limited
      expect(testService.isRateLimited(userId)).toBe(true);
    });

    it('should reset rate limit after window expires', () => {
      vi.useFakeTimers();

      const testService = new (SyncService as any)({
        uploadRateLimit: { max: 1, windowMs: 1000 },
      });

      // Use up the limit
      expect(testService.isRateLimited(userId)).toBe(false);
      expect(testService.isRateLimited(userId)).toBe(true);

      // Advance time past window
      vi.advanceTimersByTime(1500);

      // Should be reset
      expect(testService.isRateLimited(userId)).toBe(false);

      vi.useRealTimers();
    });
  });

  describe('online device count', () => {
    it('should count recently seen devices as online', async () => {
      const service = getSyncService();

      // Create devices by uploading
      await service.uploadOps(userId, 'device-1', [
        {
          id: uuidv7(),
          clientId: 'device-1',
          actionType: 'ADD',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 't1',
          payload: {},
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      await service.uploadOps(userId, 'device-2', [
        {
          id: uuidv7(),
          clientId: 'device-2',
          actionType: 'ADD',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 't2',
          payload: {},
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      const onlineCount = await service.getOnlineDeviceCount(userId);

      expect(onlineCount).toBe(2);
    });

    it('should not count stale devices as online', async () => {
      const service = getSyncService();

      await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: 'ADD',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 't1',
          payload: {},
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      // Make device stale (last seen 10 minutes ago)
      const deviceKey = `${userId}:${clientId}`;
      const device = testState.syncDevices.get(deviceKey);
      if (device) {
        device.lastSeenAt = Date.now() - 10 * 60 * 1000;
      }

      const onlineCount = await service.getOnlineDeviceCount(userId);

      expect(onlineCount).toBe(0);
    });
  });

  describe('getAllUserIds', () => {
    it('should return all users with sync state', async () => {
      const service = getSyncService();
      const user2Id = 2;

      // Create another user
      testState.users.set(user2Id, {
        id: user2Id,
        email: 'user2@test.com',
        storageQuotaBytes: BigInt(100 * 1024 * 1024),
        storageUsedBytes: BigInt(0),
      });

      // Initialize sync state for both users via upload
      await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: 'ADD',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 't1',
          payload: {},
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      await service.uploadOps(user2Id, 'device-2', [
        {
          id: uuidv7(),
          clientId: 'device-2',
          actionType: 'ADD',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 't2',
          payload: {},
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      const userIds = await service.getAllUserIds();

      expect(userIds).toContain(userId);
      expect(userIds).toContain(user2Id);
      expect(userIds).toHaveLength(2);
    });
  });

  describe('getRestorePoints', () => {
    it('should return empty array when no restore points exist', async () => {
      const service = getSyncService();

      // Upload regular operations (not restore points)
      await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: 'ADD_TASK',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 'task-1',
          payload: { title: 'Test Task' },
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      const restorePoints = await service.getRestorePoints(userId);

      expect(restorePoints).toHaveLength(0);
    });

    it('should return SYNC_IMPORT operations as restore points', async () => {
      const service = getSyncService();
      const timestamp = Date.now();

      await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: '[SP_ALL] Load(import) all data',
          opType: 'SYNC_IMPORT',
          entityType: 'ALL',
          payload: { globalConfig: {}, tasks: {} },
          vectorClock: {},
          timestamp,
          schemaVersion: 1,
        },
      ]);

      const restorePoints = await service.getRestorePoints(userId);

      expect(restorePoints).toHaveLength(1);
      expect(restorePoints[0].type).toBe('SYNC_IMPORT');
      expect(restorePoints[0].serverSeq).toBe(1);
      expect(restorePoints[0].clientId).toBe(clientId);
      expect(restorePoints[0].description).toBe('Full sync import');
    });

    it('should return BACKUP_IMPORT operations as restore points', async () => {
      const service = getSyncService();

      await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: '[SP_ALL] Load(import) all data',
          opType: 'BACKUP_IMPORT',
          entityType: 'ALL',
          payload: { globalConfig: {}, tasks: {} },
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      const restorePoints = await service.getRestorePoints(userId);

      expect(restorePoints).toHaveLength(1);
      expect(restorePoints[0].type).toBe('BACKUP_IMPORT');
      expect(restorePoints[0].description).toBe('Backup restore');
    });

    it('should return REPAIR operations as restore points', async () => {
      const service = getSyncService();

      await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: '[SP_ALL] Load(import) all data',
          opType: 'REPAIR',
          entityType: 'ALL',
          payload: { globalConfig: {}, tasks: {} },
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      const restorePoints = await service.getRestorePoints(userId);

      expect(restorePoints).toHaveLength(1);
      expect(restorePoints[0].type).toBe('REPAIR');
      expect(restorePoints[0].description).toBe('Auto-repair');
    });

    it('should return restore points in descending order by serverSeq', async () => {
      const service = getSyncService();

      // Upload multiple restore points
      for (let i = 1; i <= 3; i++) {
        await service.uploadOps(userId, clientId, [
          {
            id: uuidv7(),
            clientId,
            actionType: '[SP_ALL] Load(import) all data',
            opType: 'SYNC_IMPORT',
            entityType: 'ALL',
            payload: { version: i },
            vectorClock: {},
            timestamp: Date.now() + i,
            schemaVersion: 1,
          },
        ]);
      }

      const restorePoints = await service.getRestorePoints(userId);

      expect(restorePoints).toHaveLength(3);
      expect(restorePoints[0].serverSeq).toBe(3);
      expect(restorePoints[1].serverSeq).toBe(2);
      expect(restorePoints[2].serverSeq).toBe(1);
    });

    it('should respect limit parameter', async () => {
      const service = getSyncService();

      // Upload 5 restore points
      for (let i = 1; i <= 5; i++) {
        await service.uploadOps(userId, clientId, [
          {
            id: uuidv7(),
            clientId,
            actionType: '[SP_ALL] Load(import) all data',
            opType: 'SYNC_IMPORT',
            entityType: 'ALL',
            payload: { version: i },
            vectorClock: {},
            timestamp: Date.now() + i,
            schemaVersion: 1,
          },
        ]);
      }

      const restorePoints = await service.getRestorePoints(userId, 2);

      expect(restorePoints).toHaveLength(2);
      expect(restorePoints[0].serverSeq).toBe(5);
      expect(restorePoints[1].serverSeq).toBe(4);
    });

    it('should only return restore point types, not regular operations', async () => {
      const service = getSyncService();

      // Upload mixed operations
      await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: 'ADD_TASK',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 'task-1',
          payload: { title: 'Task 1' },
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: '[SP_ALL] Load(import) all data',
          opType: 'SYNC_IMPORT',
          entityType: 'ALL',
          payload: { globalConfig: {} },
          vectorClock: {},
          timestamp: Date.now() + 1,
          schemaVersion: 1,
        },
      ]);

      await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: 'UPDATE_TASK',
          opType: 'UPD',
          entityType: 'TASK',
          entityId: 'task-1',
          payload: { done: true },
          vectorClock: {},
          timestamp: Date.now() + 2,
          schemaVersion: 1,
        },
      ]);

      const restorePoints = await service.getRestorePoints(userId);

      expect(restorePoints).toHaveLength(1);
      expect(restorePoints[0].type).toBe('SYNC_IMPORT');
      expect(restorePoints[0].serverSeq).toBe(2);
    });
  });

  describe('generateSnapshotAtSeq', () => {
    it('should generate snapshot at a specific serverSeq', async () => {
      const service = getSyncService();

      // Upload 3 operations
      await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: 'ADD',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 't1',
          payload: { title: 'Task 1', done: false },
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: 'ADD',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 't2',
          payload: { title: 'Task 2', done: false },
          vectorClock: {},
          timestamp: Date.now() + 1,
          schemaVersion: 1,
        },
      ]);

      await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: 'UPDATE',
          opType: 'UPD',
          entityType: 'TASK',
          entityId: 't1',
          payload: { done: true },
          vectorClock: {},
          timestamp: Date.now() + 2,
          schemaVersion: 1,
        },
      ]);

      // Get snapshot at seq 2 (before the update)
      const snapshot = await service.generateSnapshotAtSeq(userId, 2);

      expect(snapshot.serverSeq).toBe(2);
      const state = snapshot.state as Record<
        string,
        Record<string, { title: string; done: boolean }>
      >;
      expect(state.TASK.t1.done).toBe(false); // Not yet updated
      expect(state.TASK.t2).toBeDefined();
    });

    it('should throw error for targetSeq exceeding latest', async () => {
      const service = getSyncService();

      await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: 'ADD',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 't1',
          payload: { title: 'Task 1' },
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      await expect(service.generateSnapshotAtSeq(userId, 100)).rejects.toThrow(
        'Target sequence 100 exceeds latest sequence 1',
      );
    });

    it('should throw error for targetSeq less than 1', async () => {
      const service = getSyncService();

      await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: 'ADD',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 't1',
          payload: { title: 'Task 1' },
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      await expect(service.generateSnapshotAtSeq(userId, 0)).rejects.toThrow(
        'Target sequence must be at least 1',
      );
    });

    it('should correctly restore state from SYNC_IMPORT operation', async () => {
      const service = getSyncService();

      const importPayload = {
        globalConfig: { theme: 'dark' },
        tasks: {
          t1: { title: 'Imported Task', done: true },
        },
      };

      // Upload a SYNC_IMPORT (full state)
      await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: '[SP_ALL] Load(import) all data',
          opType: 'SYNC_IMPORT',
          entityType: 'ALL',
          payload: importPayload,
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      // Add more operations after
      await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: 'ADD',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 't2',
          payload: { title: 'New Task' },
          vectorClock: {},
          timestamp: Date.now() + 1,
          schemaVersion: 1,
        },
      ]);

      // Get snapshot at seq 1 (the SYNC_IMPORT)
      const snapshot = await service.generateSnapshotAtSeq(userId, 1);

      expect(snapshot.serverSeq).toBe(1);
      const state = snapshot.state as Record<string, unknown>;
      expect(state.globalConfig).toEqual({ theme: 'dark' });
      expect((state.tasks as Record<string, unknown>).t1).toEqual({
        title: 'Imported Task',
        done: true,
      });
      expect((state.TASK as Record<string, unknown> | undefined)?.t2).toBeUndefined();
    });

    it('should include generatedAt timestamp', async () => {
      const service = getSyncService();
      const beforeTime = Date.now();

      await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: 'ADD',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 't1',
          payload: { title: 'Task 1' },
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      const snapshot = await service.generateSnapshotAtSeq(userId, 1);
      const afterTime = Date.now();

      expect(snapshot.generatedAt).toBeGreaterThanOrEqual(beforeTime);
      expect(snapshot.generatedAt).toBeLessThanOrEqual(afterTime);
    });
  });

  describe('deleteAllUserData (Reset Account)', () => {
    it('should delete all operations for the user', async () => {
      const service = getSyncService();

      // Upload some operations
      await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: 'ADD_TASK',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 't1',
          payload: { title: 'Task 1' },
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
        {
          id: uuidv7(),
          clientId,
          actionType: 'ADD_TASK',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 't2',
          payload: { title: 'Task 2' },
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      // Verify operations exist
      const opsBefore = await service.getOpsSince(userId, 0);
      expect(opsBefore.length).toBe(2);

      // Delete all user data
      await service.deleteAllUserData(userId);

      // Verify operations are gone
      const opsAfter = await service.getOpsSince(userId, 0);
      expect(opsAfter.length).toBe(0);
    });

    it('should allow uploading new operations after reset', async () => {
      const service = getSyncService();

      // Upload initial operation
      await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: 'ADD_TASK',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 't1',
          payload: { title: 'Task 1' },
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      // Delete all user data
      await service.deleteAllUserData(userId);

      // Upload new operation after reset
      const results = await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: 'ADD_TASK',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 't2',
          payload: { title: 'New Task After Reset' },
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      expect(results[0].accepted).toBe(true);

      // Verify only new operation exists
      const ops = await service.getOpsSince(userId, 0);
      expect(ops.length).toBe(1);
      expect(ops[0].op.entityId).toBe('t2');
    });

    it('should not affect other users data', async () => {
      const service = getSyncService();
      const otherUserId = 2;

      // Add other user to test state
      testState.users.set(otherUserId, {
        id: otherUserId,
        email: 'other@test.com',
        storageQuotaBytes: BigInt(100 * 1024 * 1024),
        storageUsedBytes: BigInt(0),
      });

      // Upload operations for both users
      await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: 'ADD_TASK',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 't1',
          payload: { title: 'User 1 Task' },
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      await service.uploadOps(otherUserId, 'other-device', [
        {
          id: uuidv7(),
          clientId: 'other-device',
          actionType: 'ADD_TASK',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 't2',
          payload: { title: 'User 2 Task' },
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      // Delete user 1's data
      await service.deleteAllUserData(userId);

      // Verify user 1's data is gone
      const user1Ops = await service.getOpsSince(userId, 0);
      expect(user1Ops.length).toBe(0);

      // Verify user 2's data still exists
      const user2Ops = await service.getOpsSince(otherUserId, 0);
      expect(user2Ops.length).toBe(1);
      expect(user2Ops[0].op.entityId).toBe('t2');
    });
  });
});
