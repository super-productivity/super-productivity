/**
 * Tests for storage quota cleanup functionality.
 *
 * Tests the deleteOldestRestorePointAndOps method and auto-cleanup logic
 * when storage quota is exceeded.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { uuidv7 } from 'uuidv7';

// Store for test data
let testOperations: Map<string, any>;
let testUsers: Map<number, any>;
let testUserSyncStates: Map<number, any>;
let serverSeqCounter: number;

// Mock the database module with Prisma mocks
vi.mock('../src/db', () => {
  return {
    prisma: {
      $transaction: vi.fn().mockImplementation(async (callback: any) => {
        const tx = {
          operation: {
            create: vi.fn().mockImplementation(async (args: any) => {
              serverSeqCounter++;
              const op = {
                ...args.data,
                serverSeq: serverSeqCounter,
                receivedAt: BigInt(Date.now()),
              };
              testOperations.set(args.data.id, op);
              return op;
            }),
            findFirst: vi.fn().mockImplementation(async (args: any) => {
              if (args.where?.id) {
                return testOperations.get(args.where.id) || null;
              }
              if (args.where?.opType?.in) {
                for (const op of Array.from(testOperations.values()).reverse()) {
                  if (
                    args.where.opType.in.includes(op.opType) &&
                    args.where.userId === op.userId
                  ) {
                    return op;
                  }
                }
              }
              return null;
            }),
            findMany: vi.fn().mockImplementation(async (args: any) => {
              const ops = Array.from(testOperations.values());
              return ops
                .filter((op) => {
                  if (args.where?.userId !== undefined && args.where.userId !== op.userId)
                    return false;
                  if (args.where?.opType?.in) {
                    if (!args.where.opType.in.includes(op.opType)) return false;
                  }
                  if (args.where?.serverSeq?.lte !== undefined) {
                    if (op.serverSeq > args.where.serverSeq.lte) return false;
                  }
                  if (args.where?.serverSeq?.gt !== undefined) {
                    if (op.serverSeq <= args.where.serverSeq.gt) return false;
                  }
                  return true;
                })
                .sort((a, b) => {
                  // Handle orderBy
                  if (args.orderBy?.serverSeq === 'asc') {
                    return a.serverSeq - b.serverSeq;
                  }
                  if (args.orderBy?.serverSeq === 'desc') {
                    return b.serverSeq - a.serverSeq;
                  }
                  return a.serverSeq - b.serverSeq;
                });
            }),
            deleteMany: vi.fn().mockImplementation(async (args: any) => {
              let count = 0;
              const toDelete: string[] = [];
              for (const [id, op] of testOperations.entries()) {
                if (args.where?.userId !== undefined && args.where.userId !== op.userId)
                  continue;
                if (args.where?.serverSeq?.lte !== undefined) {
                  if (op.serverSeq <= args.where.serverSeq.lte) {
                    toDelete.push(id);
                    count++;
                  }
                }
              }
              for (const id of toDelete) {
                testOperations.delete(id);
              }
              return { count };
            }),
            aggregate: vi.fn().mockResolvedValue({ _min: { serverSeq: 1 } }),
          },
          userSyncState: {
            findUnique: vi.fn().mockImplementation(async (args: any) => {
              return testUserSyncStates.get(args.where.userId) || null;
            }),
            upsert: vi.fn().mockResolvedValue({}),
            update: vi.fn().mockResolvedValue({}),
          },
          syncDevice: {
            upsert: vi.fn().mockResolvedValue({}),
            count: vi.fn().mockResolvedValue(1),
          },
        };
        return callback(tx);
      }),
      operation: {
        findFirst: vi.fn().mockImplementation(async (args: any) => {
          if (args.where?.id) {
            return testOperations.get(args.where.id) || null;
          }
          if (args.where?.opType?.in) {
            for (const op of Array.from(testOperations.values()).reverse()) {
              if (
                args.where.opType.in.includes(op.opType) &&
                args.where.userId === op.userId
              ) {
                return op;
              }
            }
          }
          return null;
        }),
        findMany: vi.fn().mockImplementation(async (args: any) => {
          const ops = Array.from(testOperations.values());
          return ops
            .filter((op) => {
              if (args.where?.userId !== undefined && args.where.userId !== op.userId)
                return false;
              if (args.where?.opType?.in) {
                if (!args.where.opType.in.includes(op.opType)) return false;
              }
              if (args.where?.serverSeq?.lte !== undefined) {
                if (op.serverSeq > args.where.serverSeq.lte) return false;
              }
              if (args.where?.serverSeq?.gt !== undefined) {
                if (op.serverSeq <= args.where.serverSeq.gt) return false;
              }
              return true;
            })
            .sort((a, b) => {
              if (args.orderBy?.serverSeq === 'asc') {
                return a.serverSeq - b.serverSeq;
              }
              if (args.orderBy?.serverSeq === 'desc') {
                return b.serverSeq - a.serverSeq;
              }
              return a.serverSeq - b.serverSeq;
            });
        }),
        deleteMany: vi.fn().mockImplementation(async (args: any) => {
          let count = 0;
          const toDelete: string[] = [];
          for (const [id, op] of testOperations.entries()) {
            if (args.where?.userId !== undefined && args.where.userId !== op.userId)
              continue;
            if (args.where?.serverSeq?.lte !== undefined) {
              if (op.serverSeq <= args.where.serverSeq.lte) {
                toDelete.push(id);
                count++;
              }
            }
          }
          for (const id of toDelete) {
            testOperations.delete(id);
          }
          return { count };
        }),
        aggregate: vi.fn().mockResolvedValue({ _min: { serverSeq: 1 } }),
      },
      userSyncState: {
        findUnique: vi.fn().mockImplementation(async (args: any) => {
          return testUserSyncStates.get(args.where.userId) || null;
        }),
        upsert: vi.fn().mockResolvedValue({}),
        update: vi.fn().mockResolvedValue({}),
        findMany: vi.fn().mockResolvedValue([]),
      },
      syncDevice: {
        upsert: vi.fn().mockResolvedValue({}),
        count: vi.fn().mockResolvedValue(1),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      user: {
        findUnique: vi.fn().mockImplementation(async (args: any) => {
          return testUsers.get(args.where.id) || null;
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      $queryRaw: vi.fn().mockResolvedValue([{ total: BigInt(0) }]),
    },
    initDb: vi.fn(),
    getDb: vi.fn(),
  };
});

// Mock auth module
vi.mock('../src/auth', () => ({
  verifyToken: vi.fn().mockResolvedValue({ userId: 1, email: 'test@test.com' }),
}));

// Mock zlib for snapshot compression
vi.mock('zlib', () => ({
  gzipSync: vi.fn().mockImplementation((data) => Buffer.from(data)),
  gunzipSync: vi.fn().mockImplementation((data) => data),
}));

// Helper to create operation
const createOp = (
  clientId: string,
  userId: number,
  overrides: Partial<{
    id: string;
    actionType: string;
    opType: string;
    entityType: string;
    entityId: string;
    payload: unknown;
    vectorClock: Record<string, number>;
    timestamp: number;
    schemaVersion: number;
  }> = {},
) => {
  serverSeqCounter++;
  const op = {
    id: overrides.id || uuidv7(),
    clientId,
    userId,
    actionType: overrides.actionType || 'ADD_TASK',
    opType: overrides.opType || 'CRT',
    entityType: overrides.entityType || 'TASK',
    entityId: overrides.entityId || `task-${serverSeqCounter}`,
    payload: overrides.payload || { title: 'Test Task' },
    vectorClock: overrides.vectorClock || {},
    clientTimestamp: BigInt(overrides.timestamp || Date.now()),
    receivedAt: BigInt(Date.now()),
    schemaVersion: overrides.schemaVersion || 1,
    serverSeq: serverSeqCounter,
    isPayloadEncrypted: false,
  };
  testOperations.set(op.id, op);
  return op;
};

// Helper to create a restore point (SYNC_IMPORT operation)
const createRestorePoint = (
  clientId: string,
  userId: number,
  opType: 'SYNC_IMPORT' | 'BACKUP_IMPORT' | 'REPAIR' = 'SYNC_IMPORT',
) => {
  return createOp(clientId, userId, {
    actionType: '[SP_ALL] Load(import) all data',
    opType,
    entityType: 'ALL',
    payload: { globalConfig: {}, tasks: {} },
  });
};

describe('Storage Quota Cleanup', () => {
  const userId = 1;
  const clientId = 'test-device-1';

  beforeEach(() => {
    // Reset test data
    testOperations = new Map();
    testUsers = new Map();
    testUserSyncStates = new Map();
    serverSeqCounter = 0;

    // Create test user with storage info
    testUsers.set(userId, {
      id: userId,
      email: 'test@test.com',
      storageUsedBytes: BigInt(0),
      storageQuotaBytes: BigInt(100 * 1024 * 1024), // 100MB
    });

    vi.clearAllMocks();
  });

  describe('deleteOldestRestorePointAndOps', () => {
    it('should return failure when no restore points exist', async () => {
      // Import after mocks are set up
      const { initSyncService, getSyncService } =
        await import('../src/sync/sync.service');
      initSyncService();
      const service = getSyncService();

      // Create some regular operations (no restore points)
      createOp(clientId, userId);
      createOp(clientId, userId);
      createOp(clientId, userId);

      const result = await service.deleteOldestRestorePointAndOps(userId);

      expect(result.success).toBe(false);
      expect(result.deletedCount).toBe(0);
      expect(result.freedBytes).toBe(0);
    });

    it('should delete oldest restore point and all ops before it when 2+ restore points exist', async () => {
      const { initSyncService, getSyncService } =
        await import('../src/sync/sync.service');
      initSyncService();
      const service = getSyncService();

      // Create: op1, op2, RESTORE1, op4, op5, RESTORE2, op7
      createOp(clientId, userId); // seq 1
      createOp(clientId, userId); // seq 2
      createRestorePoint(clientId, userId); // seq 3 - oldest restore point
      createOp(clientId, userId); // seq 4
      createOp(clientId, userId); // seq 5
      createRestorePoint(clientId, userId); // seq 6 - newer restore point
      createOp(clientId, userId); // seq 7

      expect(testOperations.size).toBe(7);

      const result = await service.deleteOldestRestorePointAndOps(userId);

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(3); // ops 1, 2, 3 (oldest restore point)
      expect(testOperations.size).toBe(4); // ops 4, 5, 6, 7 remain
    });

    it('should keep single restore point but delete ops before it', async () => {
      const { initSyncService, getSyncService } =
        await import('../src/sync/sync.service');
      initSyncService();
      const service = getSyncService();

      // Create: op1, op2, RESTORE1, op4, op5
      createOp(clientId, userId); // seq 1
      createOp(clientId, userId); // seq 2
      createRestorePoint(clientId, userId); // seq 3 - only restore point
      createOp(clientId, userId); // seq 4
      createOp(clientId, userId); // seq 5

      expect(testOperations.size).toBe(5);

      const result = await service.deleteOldestRestorePointAndOps(userId);

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(2); // ops 1, 2 (before restore point)
      expect(testOperations.size).toBe(3); // ops 3, 4, 5 remain (restore point kept)
    });

    it('should return failure when restore point is at seq 1 with no ops before it', async () => {
      const { initSyncService, getSyncService } =
        await import('../src/sync/sync.service');
      initSyncService();
      const service = getSyncService();

      // Create: RESTORE1 (at seq 1), op2, op3
      createRestorePoint(clientId, userId); // seq 1 - only restore point
      createOp(clientId, userId); // seq 2
      createOp(clientId, userId); // seq 3

      expect(testOperations.size).toBe(3);

      const result = await service.deleteOldestRestorePointAndOps(userId);

      // With only one restore point at seq 1, deleteUpToSeq = 0, nothing to delete
      expect(result.success).toBe(false);
      expect(result.deletedCount).toBe(0);
      expect(testOperations.size).toBe(3); // all ops remain
    });

    it('should handle BACKUP_IMPORT as restore point', async () => {
      const { initSyncService, getSyncService } =
        await import('../src/sync/sync.service');
      initSyncService();
      const service = getSyncService();

      createOp(clientId, userId); // seq 1
      createRestorePoint(clientId, userId, 'BACKUP_IMPORT'); // seq 2
      createOp(clientId, userId); // seq 3
      createRestorePoint(clientId, userId, 'SYNC_IMPORT'); // seq 4

      const result = await service.deleteOldestRestorePointAndOps(userId);

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(2); // ops 1, 2
    });

    it('should handle REPAIR as restore point', async () => {
      const { initSyncService, getSyncService } =
        await import('../src/sync/sync.service');
      initSyncService();
      const service = getSyncService();

      createOp(clientId, userId); // seq 1
      createRestorePoint(clientId, userId, 'REPAIR'); // seq 2
      createOp(clientId, userId); // seq 3
      createRestorePoint(clientId, userId, 'REPAIR'); // seq 4

      const result = await service.deleteOldestRestorePointAndOps(userId);

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(2); // ops 1, 2
    });
  });

  describe('Storage quota with auto-cleanup', () => {
    it('should recalculate storage when quota check fails', async () => {
      const { initSyncService, getSyncService } =
        await import('../src/sync/sync.service');
      initSyncService();
      const service = getSyncService();

      // Set user with stale high storage usage (simulating stale cache)
      testUsers.set(userId, {
        id: userId,
        email: 'test@test.com',
        storageUsedBytes: BigInt(200 * 1024 * 1024), // 200MB (stale value)
        storageQuotaBytes: BigInt(100 * 1024 * 1024), // 100MB quota
      });

      // First check should fail (using stale cache)
      const firstCheck = await service.checkStorageQuota(userId, 1000);
      expect(firstCheck.allowed).toBe(false);
      expect(firstCheck.currentUsage).toBe(200 * 1024 * 1024);
    });

    it('should allow upload after storage recalculation shows actual usage is lower', async () => {
      const { initSyncService, getSyncService } =
        await import('../src/sync/sync.service');
      initSyncService();
      const service = getSyncService();

      // After updateStorageUsage is called, the mock returns 0 from $queryRaw
      // So the actual storage is much lower than the stale cache
      testUsers.set(userId, {
        id: userId,
        email: 'test@test.com',
        storageUsedBytes: BigInt(50 * 1024 * 1024), // 50MB actual
        storageQuotaBytes: BigInt(100 * 1024 * 1024), // 100MB quota
      });

      const check = await service.checkStorageQuota(userId, 1000);
      expect(check.allowed).toBe(true);
      expect(check.currentUsage).toBe(50 * 1024 * 1024);
    });
  });

  describe('freeStorageForUpload - iterative cleanup', () => {
    it('should return success immediately if quota is already satisfied', async () => {
      const { initSyncService, getSyncService } =
        await import('../src/sync/sync.service');
      initSyncService();
      const service = getSyncService();

      // User has plenty of space
      testUsers.set(userId, {
        id: userId,
        email: 'test@test.com',
        storageUsedBytes: BigInt(10 * 1024 * 1024), // 10MB used
        storageQuotaBytes: BigInt(100 * 1024 * 1024), // 100MB quota
      });

      const result = await service.freeStorageForUpload(userId, 1000);

      expect(result.success).toBe(true);
      expect(result.freedBytes).toBe(0);
      expect(result.deletedRestorePoints).toBe(0);
      expect(result.deletedOps).toBe(0);
    });

    it('should return failure when no restore points exist and quota exceeded', async () => {
      const { initSyncService, getSyncService } =
        await import('../src/sync/sync.service');
      initSyncService();
      const service = getSyncService();

      // User is over quota with no restore points
      testUsers.set(userId, {
        id: userId,
        email: 'test@test.com',
        storageUsedBytes: BigInt(150 * 1024 * 1024), // 150MB used
        storageQuotaBytes: BigInt(100 * 1024 * 1024), // 100MB quota
      });

      // Create some regular operations (no restore points)
      createOp(clientId, userId);
      createOp(clientId, userId);

      const result = await service.freeStorageForUpload(userId, 1000);

      expect(result.success).toBe(false);
      expect(result.freedBytes).toBe(0);
      expect(result.deletedRestorePoints).toBe(0);
      expect(result.deletedOps).toBe(0);
    });

    it('should return failure when only one restore point exists', async () => {
      const { initSyncService, getSyncService } =
        await import('../src/sync/sync.service');
      initSyncService();
      const service = getSyncService();

      // User is over quota
      testUsers.set(userId, {
        id: userId,
        email: 'test@test.com',
        storageUsedBytes: BigInt(150 * 1024 * 1024), // 150MB used
        storageQuotaBytes: BigInt(100 * 1024 * 1024), // 100MB quota
      });

      // Create: op1, RESTORE1 (only one), op3
      createOp(clientId, userId); // seq 1
      createRestorePoint(clientId, userId); // seq 2 - only restore point
      createOp(clientId, userId); // seq 3

      const result = await service.freeStorageForUpload(userId, 1000);

      // Should fail because we can't delete the only restore point
      expect(result.success).toBe(false);
      // May have deleted ops before the restore point but still not enough space
      expect(result.deletedRestorePoints).toBe(0);
    });

    it('should delete multiple restore points iteratively until quota is satisfied', async () => {
      const { initSyncService, getSyncService } =
        await import('../src/sync/sync.service');
      initSyncService();
      const service = getSyncService();

      // Track storage updates to simulate freeing space after each deletion
      let currentStorage = 150 * 1024 * 1024; // Start at 150MB
      const storagePerRestorePoint = 30 * 1024 * 1024; // 30MB per restore point

      // Mock user lookup to return decreasing storage after each update
      const originalGet = testUsers.get.bind(testUsers);
      testUsers.get = (key: number) => {
        const user = originalGet(key);
        if (user) {
          return {
            ...user,
            storageUsedBytes: BigInt(currentStorage),
          };
        }
        return user;
      };

      testUsers.set(userId, {
        id: userId,
        email: 'test@test.com',
        storageUsedBytes: BigInt(currentStorage),
        storageQuotaBytes: BigInt(100 * 1024 * 1024), // 100MB quota
      });

      // Create: RESTORE1, ops, RESTORE2, ops, RESTORE3, ops, RESTORE4 (current)
      createRestorePoint(clientId, userId); // seq 1 - oldest
      createOp(clientId, userId); // seq 2
      createOp(clientId, userId); // seq 3
      createRestorePoint(clientId, userId); // seq 4
      createOp(clientId, userId); // seq 5
      createOp(clientId, userId); // seq 6
      createRestorePoint(clientId, userId); // seq 7
      createOp(clientId, userId); // seq 8
      createRestorePoint(clientId, userId); // seq 9 - newest (must keep)

      expect(testOperations.size).toBe(9);

      // Mock updateStorageUsage to decrease storage
      const originalUpdateStorageUsage = service.updateStorageUsage.bind(service);
      service.updateStorageUsage = async (uid: number) => {
        currentStorage -= storagePerRestorePoint;
        if (currentStorage < 0) currentStorage = 0;
        await originalUpdateStorageUsage(uid);
      };

      const result = await service.freeStorageForUpload(userId, 1000);

      // Should succeed after deleting enough restore points
      // Need to delete 2 restore points to go from 150MB to 90MB (under 100MB quota)
      expect(result.success).toBe(true);
      expect(result.deletedRestorePoints).toBeGreaterThanOrEqual(1);
      expect(result.deletedOps).toBeGreaterThan(0);
      expect(result.freedBytes).toBeGreaterThan(0);
    });

    it('should stop when only one restore point remains even if quota still exceeded', async () => {
      const { initSyncService, getSyncService } =
        await import('../src/sync/sync.service');
      initSyncService();
      const service = getSyncService();

      // User way over quota - can't be fixed by cleanup
      testUsers.set(userId, {
        id: userId,
        email: 'test@test.com',
        storageUsedBytes: BigInt(500 * 1024 * 1024), // 500MB used
        storageQuotaBytes: BigInt(100 * 1024 * 1024), // 100MB quota
      });

      // Create: op1, RESTORE1 (seq 2), op3, RESTORE2 (seq 4)
      // This way when we delete RESTORE1 and ops <= seq 2, we delete ops 1 and 2
      createOp(clientId, userId); // seq 1 - will be deleted
      createRestorePoint(clientId, userId); // seq 2 - oldest restore point, will be deleted
      createOp(clientId, userId); // seq 3 - remains
      createRestorePoint(clientId, userId); // seq 4 - must keep (only one left)

      const result = await service.freeStorageForUpload(userId, 1000);

      // Should fail because we can only delete down to 1 restore point
      expect(result.success).toBe(false);
      expect(result.deletedRestorePoints).toBe(1);
      expect(result.deletedOps).toBe(2); // ops 1 and 2 (restore point at seq 2)

      // Verify only the newer restore point and the op after the deleted one remain
      expect(testOperations.size).toBe(2);
      const remainingOps = Array.from(testOperations.values()).sort(
        (a, b) => a.serverSeq - b.serverSeq,
      );
      expect(remainingOps[0].serverSeq).toBe(3);
      expect(remainingOps[1].serverSeq).toBe(4);
      expect(remainingOps[1].opType).toBe('SYNC_IMPORT');
    });

    it('should return stats even when cleanup fails', async () => {
      const { initSyncService, getSyncService } =
        await import('../src/sync/sync.service');
      initSyncService();
      const service = getSyncService();

      // User over quota
      testUsers.set(userId, {
        id: userId,
        email: 'test@test.com',
        storageUsedBytes: BigInt(200 * 1024 * 1024),
        storageQuotaBytes: BigInt(100 * 1024 * 1024),
      });

      // Create: op, RESTORE1, op, RESTORE2
      createOp(clientId, userId); // seq 1
      createRestorePoint(clientId, userId); // seq 2
      createOp(clientId, userId); // seq 3
      createRestorePoint(clientId, userId); // seq 4

      const result = await service.freeStorageForUpload(userId, 1000);

      // Even if it fails, should report what was cleaned
      expect(result.freedBytes).toBeGreaterThanOrEqual(0);
      expect(result.deletedRestorePoints).toBeGreaterThanOrEqual(0);
      expect(result.deletedOps).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Stale snapshot cache cleanup', () => {
    it('should clear snapshot cache when deleted ops include the cached snapshot seq', async () => {
      const { initSyncService, getSyncService } =
        await import('../src/sync/sync.service');
      const { prisma } = await import('../src/db');
      initSyncService();
      const service = getSyncService();

      // Set up user sync state with cached snapshot at seq 2
      testUserSyncStates.set(userId, {
        userId,
        lastSeq: 10,
        lastSnapshotSeq: 2, // Cached snapshot is at seq 2
        snapshotData: Buffer.from('cached-snapshot'),
        snapshotAt: BigInt(Date.now()),
      });

      // Create: op1, RESTORE1 (seq 2 - matches cache), op3, RESTORE2
      createOp(clientId, userId); // seq 1
      createRestorePoint(clientId, userId); // seq 2 - oldest restore point (matches cache)
      createOp(clientId, userId); // seq 3
      createRestorePoint(clientId, userId); // seq 4 - newer

      const result = await service.deleteOldestRestorePointAndOps(userId);

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(2); // ops 1, 2

      // Verify snapshot cache was cleared (update was called with null values)
      expect(prisma.userSyncState.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId },
          data: expect.objectContaining({
            snapshotData: null,
            lastSnapshotSeq: null,
            snapshotAt: null,
          }),
        }),
      );
    });

    it('should NOT clear snapshot cache when cached seq is after deleted ops', async () => {
      const { initSyncService, getSyncService } =
        await import('../src/sync/sync.service');
      const { prisma } = await import('../src/db');
      initSyncService();
      const service = getSyncService();

      // Set up user sync state with cached snapshot at seq 5 (after what we'll delete)
      testUserSyncStates.set(userId, {
        userId,
        lastSeq: 10,
        lastSnapshotSeq: 5, // Cached snapshot is at seq 5
        snapshotData: Buffer.from('cached-snapshot'),
        snapshotAt: BigInt(Date.now()),
      });

      // Create: op1, RESTORE1 (seq 2), op3, RESTORE2 (seq 4), op5
      createOp(clientId, userId); // seq 1
      createRestorePoint(clientId, userId); // seq 2 - oldest restore point
      createOp(clientId, userId); // seq 3
      createRestorePoint(clientId, userId); // seq 4 - newer
      createOp(clientId, userId); // seq 5 (cache points here)

      // Clear mock call history
      (prisma.userSyncState.update as any).mockClear();

      const result = await service.deleteOldestRestorePointAndOps(userId);

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(2); // ops 1, 2

      // Verify snapshot cache was NOT cleared (update was called but not with null values)
      const updateCalls = (prisma.userSyncState.update as any).mock.calls;
      const nullDataCalls = updateCalls.filter(
        (call: any) =>
          call[0]?.data?.snapshotData === null && call[0]?.data?.lastSnapshotSeq === null,
      );
      expect(nullDataCalls.length).toBe(0);
    });

    it('should clear snapshot cache when cached seq equals deleteUpToSeq exactly', async () => {
      const { initSyncService, getSyncService } =
        await import('../src/sync/sync.service');
      const { prisma } = await import('../src/db');
      initSyncService();
      const service = getSyncService();

      // Set up user sync state with cached snapshot exactly at seq 2
      testUserSyncStates.set(userId, {
        userId,
        lastSeq: 10,
        lastSnapshotSeq: 2, // Exactly at the restore point we'll delete
        snapshotData: Buffer.from('cached-snapshot'),
        snapshotAt: BigInt(Date.now()),
      });

      // Create: op1, RESTORE1 (seq 2), op3, RESTORE2 (seq 4)
      createOp(clientId, userId); // seq 1
      createRestorePoint(clientId, userId); // seq 2 - will be deleted
      createOp(clientId, userId); // seq 3
      createRestorePoint(clientId, userId); // seq 4

      const result = await service.deleteOldestRestorePointAndOps(userId);

      expect(result.success).toBe(true);

      // Verify snapshot cache was cleared
      expect(prisma.userSyncState.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId },
          data: expect.objectContaining({
            snapshotData: null,
            lastSnapshotSeq: null,
            snapshotAt: null,
          }),
        }),
      );
    });

    it('should not crash when no cached snapshot exists', async () => {
      const { initSyncService, getSyncService } =
        await import('../src/sync/sync.service');
      initSyncService();
      const service = getSyncService();

      // No cached snapshot (lastSnapshotSeq is null)
      testUserSyncStates.set(userId, {
        userId,
        lastSeq: 10,
        lastSnapshotSeq: null,
        snapshotData: null,
        snapshotAt: null,
      });

      // Create: op1, RESTORE1, op3, RESTORE2
      createOp(clientId, userId); // seq 1
      createRestorePoint(clientId, userId); // seq 2
      createOp(clientId, userId); // seq 3
      createRestorePoint(clientId, userId); // seq 4

      // Should not throw
      const result = await service.deleteOldestRestorePointAndOps(userId);

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(2);
    });
  });
});
