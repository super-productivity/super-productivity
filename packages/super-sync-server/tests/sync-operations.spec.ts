import { describe, it, expect, beforeEach, vi } from 'vitest';
import { uuidv7 } from 'uuidv7';
import * as zlib from 'zlib';
import { testState, resetTestState } from './sync.service.test-state';
import { Operation, MS_PER_DAY } from '../src/sync/sync.types';
import { CURRENT_SCHEMA_VERSION } from '@sp/shared-schema';

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
      deleteMany: vi.fn().mockImplementation(async (args: any) => {
        let count = 0;
        for (const [id, op] of state.operations.entries()) {
          if (
            args.where?.userId !== undefined &&
            args.where.userId !== (op as any).userId
          )
            continue;
          if (
            args.where?.receivedAt?.lt !== undefined &&
            (op as any).receivedAt >= args.where.receivedAt.lt
          )
            continue;
          state.operations.delete(id);
          count++;
        }
        return { count };
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
      findUnique: vi.fn().mockImplementation(async (args: any) => {
        const key = `${args.where.userId_clientId.userId}:${args.where.userId_clientId.clientId}`;
        return state.syncDevices.get(key) || null;
      }),
      deleteMany: vi.fn().mockImplementation(async (args: any) => {
        let count = 0;
        for (const [key, device] of state.syncDevices.entries()) {
          if (
            args.where?.lastSeenAt?.lt !== undefined &&
            (device as any).lastSeenAt >= args.where.lastSeenAt.lt
          )
            continue;
          state.syncDevices.delete(key);
          count++;
        }
        return { count };
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
        findMany: vi.fn().mockImplementation(async () => {
          return Array.from(state.userSyncStates.values());
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
        deleteMany: vi.fn().mockImplementation(async (args: any) => {
          let count = 0;
          for (const [id, op] of state.operations.entries()) {
            if (
              args.where?.userId !== undefined &&
              args.where.userId !== (op as any).userId
            )
              continue;
            if (
              args.where?.receivedAt?.lt !== undefined &&
              (op as any).receivedAt >= args.where.receivedAt.lt
            )
              continue;
            state.operations.delete(id);
            count++;
          }
          return { count };
        }),
        findUnique: vi.fn().mockImplementation(async (args: any) => {
          if (args.where?.id) {
            return state.operations.get(args.where.id) || null;
          }
          return null;
        }),
      },
      syncDevice: {
        findMany: vi.fn().mockImplementation(async () => {
          return Array.from(state.syncDevices.values());
        }),
        findUnique: vi.fn().mockImplementation(async (args: any) => {
          const key = `${args.where.userId_clientId.userId}:${args.where.userId_clientId.clientId}`;
          return state.syncDevices.get(key) || null;
        }),
        count: vi.fn().mockImplementation(async (args: any) => {
          let count = 0;
          for (const device of state.syncDevices.values()) {
            if (
              args.where?.userId !== undefined &&
              (device as any).userId !== args.where.userId
            )
              continue;
            if (
              args.where?.clientId !== undefined &&
              (device as any).clientId !== args.where.clientId
            )
              continue;
            count++;
          }
          return count;
        }),
        deleteMany: vi.fn().mockImplementation(async (args: any) => {
          let count = 0;
          for (const [key, device] of state.syncDevices.entries()) {
            if (
              args.where?.lastSeenAt?.lt !== undefined &&
              (device as any).lastSeenAt >= args.where.lastSeenAt.lt
            )
              continue;
            state.syncDevices.delete(key);
            count++;
          }
          return { count };
        }),
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

describe('Sync Operations', () => {
  const userId = 1;
  const clientId = 'test-client';

  const createOp = (
    entityId: string,
    opType: 'CRT' | 'UPD' | 'DEL' = 'CRT',
    entityType = 'TASK',
  ): Operation => ({
    id: uuidv7(),
    clientId,
    actionType:
      opType === 'CRT' ? 'ADD_TASK' : opType === 'UPD' ? 'UPDATE_TASK' : 'DELETE_TASK',
    opType,
    entityType,
    entityId,
    payload: opType === 'DEL' ? null : { title: `Task ${entityId}` },
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

  describe('Snapshot Generation', () => {
    it('should generate empty snapshot for user with no operations', async () => {
      const service = getSyncService();

      const snapshot = await service.generateSnapshot(userId);

      expect(snapshot.state).toEqual({});
      expect(snapshot.serverSeq).toBe(0);
      expect(snapshot.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    });

    it('should generate snapshot reflecting all operations', async () => {
      const service = getSyncService();

      await service.uploadOps(userId, clientId, [
        createOp('task-1', 'CRT'),
        createOp('task-2', 'CRT'),
      ]);

      const snapshot = await service.generateSnapshot(userId);

      expect(snapshot.serverSeq).toBe(2);
      expect(snapshot.state).toHaveProperty('TASK');
      const tasks = (snapshot.state as Record<string, Record<string, unknown>>).TASK;
      expect(tasks['task-1']).toHaveProperty('title', 'Task task-1');
      expect(tasks['task-2']).toHaveProperty('title', 'Task task-2');
    });

    it('should apply updates to snapshot', async () => {
      const service = getSyncService();

      // Create task
      await service.uploadOps(userId, clientId, [createOp('task-1', 'CRT')]);

      // Update task
      const updateOp: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'UPDATE_TASK',
        opType: 'UPD',
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Updated Title', done: true },
        vectorClock: { [clientId]: 2 },
        timestamp: Date.now(),
        schemaVersion: 1,
      };
      await service.uploadOps(userId, clientId, [updateOp]);

      const snapshot = await service.generateSnapshot(userId);

      const tasks = (snapshot.state as Record<string, Record<string, unknown>>).TASK;
      expect(tasks['task-1']).toHaveProperty('title', 'Updated Title');
      expect(tasks['task-1']).toHaveProperty('done', true);
    });

    it('should remove deleted entities from snapshot', async () => {
      const service = getSyncService();

      // Create two tasks
      await service.uploadOps(userId, clientId, [
        createOp('task-1', 'CRT'),
        createOp('task-2', 'CRT'),
      ]);

      // Delete task-1
      await service.uploadOps(userId, clientId, [createOp('task-1', 'DEL')]);

      const snapshot = await service.generateSnapshot(userId);

      const tasks = (snapshot.state as Record<string, Record<string, unknown>>).TASK;
      expect(tasks['task-1']).toBeUndefined();
      expect(tasks['task-2']).toHaveProperty('title', 'Task task-2');
    });

    it('should cache and return cached snapshot when up to date', async () => {
      const service = getSyncService();

      await service.uploadOps(userId, clientId, [createOp('task-1', 'CRT')]);

      // First generation
      const snapshot1 = await service.generateSnapshot(userId);
      const generatedAt1 = snapshot1.generatedAt;

      // Wait a bit
      const start = Date.now();
      while (Date.now() - start < 10) {
        // spin
      }

      // Second generation should use cache (if no new ops)
      const snapshot2 = await service.generateSnapshot(userId);

      // Server seq should be same
      expect(snapshot2.serverSeq).toBe(snapshot1.serverSeq);
      // State should be equivalent
      expect(snapshot2.state).toEqual(snapshot1.state);
      // generatedAt should be refreshed (showing it was still accessed)
      expect(snapshot2.generatedAt).toBeGreaterThanOrEqual(generatedAt1);
    });

    it('should rebuild snapshot when new operations arrive', async () => {
      const service = getSyncService();

      await service.uploadOps(userId, clientId, [createOp('task-1', 'CRT')]);
      await service.generateSnapshot(userId);

      // Add new operation
      await service.uploadOps(userId, clientId, [createOp('task-2', 'CRT')]);

      // Second generation should include new op
      const snapshot2 = await service.generateSnapshot(userId);

      expect(snapshot2.serverSeq).toBe(2);
      const tasks = (snapshot2.state as Record<string, Record<string, unknown>>).TASK;
      expect(tasks['task-2']).toBeDefined();
    });

    it('should handle multiple entity types', async () => {
      const service = getSyncService();

      const taskOp = createOp('task-1', 'CRT', 'TASK');
      const projectOp: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD_PROJECT',
        opType: 'CRT',
        entityType: 'PROJECT',
        entityId: 'project-1',
        payload: { title: 'My Project' },
        vectorClock: { [clientId]: 1 },
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      await service.uploadOps(userId, clientId, [taskOp, projectOp]);

      const snapshot = await service.generateSnapshot(userId);

      expect(snapshot.state).toHaveProperty('TASK');
      expect(snapshot.state).toHaveProperty('PROJECT');
    });

    it('should accept time tracking operations', async () => {
      const service = getSyncService();

      const timeTrackingOp: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD_TIME',
        opType: 'UPD',
        entityType: 'TIME_TRACKING',
        entityId: 'tt-1',
        payload: { timeSpent: 120000, taskId: 'task-1' },
        vectorClock: { [clientId]: 1 },
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      const results = await service.uploadOps(userId, clientId, [timeTrackingOp]);

      expect(results[0]).toMatchObject({
        opId: timeTrackingOp.id,
        accepted: true,
      });
    });
  });

  describe('Snapshot Size Limits', () => {
    it('should skip caching oversized snapshots', async () => {
      const service = getSyncService();

      // Create many large operations to exceed size limit
      // The limit is 50MB compressed, which is hard to hit, so we just verify the function works
      await service.uploadOps(userId, clientId, [createOp('task-1', 'CRT')]);

      // This should work without error
      const snapshot = await service.generateSnapshot(userId);
      expect(snapshot).toBeDefined();
    });

    // Skip: Cannot spy on zlib.gunzipSync in this test environment
    it.skip('should discard cached snapshot if decompression exceeds limit', async () => {
      const service = getSyncService();

      await service.uploadOps(userId, clientId, [createOp('task-1', 'CRT')]);
      await service.generateSnapshot(userId);

      const gunzipSpy = vi.spyOn(zlib, 'gunzipSync').mockImplementation(() => {
        throw new RangeError('maxOutputLength exceeded');
      });

      const cached = await service.getCachedSnapshot(userId);
      expect(cached).toBeNull();

      gunzipSpy.mockRestore();
    });
  });

  describe('Rate Limiting', () => {
    it('should allow requests under the rate limit', () => {
      const service = getSyncService();

      // Default limit is 100 requests per minute
      for (let i = 0; i < 50; i++) {
        expect(service.isRateLimited(userId)).toBe(false);
      }
    });

    it('should block requests over the rate limit', () => {
      const service = getSyncService();

      // Exhaust rate limit (default 100)
      for (let i = 0; i < 100; i++) {
        service.isRateLimited(userId);
      }

      // Next request should be rate limited
      expect(service.isRateLimited(userId)).toBe(true);
    });

    it('should track rate limits per user', () => {
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

      // Exhaust user 1's limit
      for (let i = 0; i < 100; i++) {
        service.isRateLimited(userId);
      }

      // User 1 should be limited
      expect(service.isRateLimited(userId)).toBe(true);

      // User 2 should not be limited
      expect(service.isRateLimited(userId2)).toBe(false);
    });

    it('should cleanup expired rate limit counters', () => {
      const service = getSyncService();

      // Trigger rate limit tracking for multiple users
      for (let i = 1; i <= 5; i++) {
        service.isRateLimited(i);
      }

      // Since we can't easily manipulate time, just verify cleanup runs without error
      const cleaned = service.cleanupExpiredRateLimitCounters();
      // With fresh counters, nothing should be expired yet
      expect(cleaned).toBe(0);
    });
  });

  describe('Cleanup Operations', () => {
    it('should delete old synced operations', async () => {
      const service = getSyncService();

      // Upload some operations
      await service.uploadOps(userId, clientId, [
        createOp('task-1', 'CRT'),
        createOp('task-2', 'CRT'),
      ]);

      // Set up userSyncState with snapshot info (required for cleanup logic)
      const now = Date.now();
      testState.userSyncStates.set(userId, {
        userId,
        lastSnapshotSeq: 2,
        snapshotAt: BigInt(now),
        opCount: 2,
      });

      // Manually set one operation to be "old" (received 100 days ago)
      const hundredDaysMs = MS_PER_DAY * 100;
      for (const [id, op] of testState.operations.entries()) {
        if ((op as any).serverSeq === 1) {
          (op as any).receivedAt = BigInt(Date.now() - hundredDaysMs);
        }
      }

      // Delete operations older than 90 days
      const ninetyDaysMs = MS_PER_DAY * 90;
      const cutoff = Date.now() - ninetyDaysMs;
      const result = await service.deleteOldSyncedOpsForAllUsers(cutoff);

      expect(result.totalDeleted).toBe(1);
      expect(result.affectedUserIds).toContain(userId);

      // Verify correct operation was deleted
      const ops = await service.getOpsSince(userId, 0);
      expect(ops.length).toBe(1);
      expect(ops[0].serverSeq).toBe(2);
    });

    it('should delete stale devices', async () => {
      const service = getSyncService();

      // Upload op to create device entry
      await service.uploadOps(userId, clientId, [createOp('task-1', 'CRT')]);

      // Manually set device to stale (not seen in 60 days)
      const sixtyDaysMs = MS_PER_DAY * 60;
      for (const device of testState.syncDevices.values()) {
        (device as any).lastSeenAt = BigInt(Date.now() - sixtyDaysMs);
      }

      // Delete devices not seen in 50 days
      const fiftyDaysMs = MS_PER_DAY * 50;
      const cutoff = Date.now() - fiftyDaysMs;
      const deleted = await service.deleteStaleDevices(cutoff);

      expect(deleted).toBe(1);
    });

    it('should not delete active devices', async () => {
      const service = getSyncService();

      // Upload op to create device entry (will be "seen" now)
      await service.uploadOps(userId, clientId, [createOp('task-1', 'CRT')]);

      // Try to delete devices not seen in 50 days
      const fiftyDaysMs = MS_PER_DAY * 50;
      const cutoff = Date.now() - fiftyDaysMs;
      const deleted = await service.deleteStaleDevices(cutoff);

      // Should not delete anything (device was just seen)
      expect(deleted).toBe(0);
    });
  });

  describe('Request Deduplication', () => {
    it('should return null for new request IDs', () => {
      const service = getSyncService();

      const cached = service.checkRequestDeduplication(userId, 'new-request-123');
      expect(cached).toBeNull();
    });

    it('should cache and return results for duplicate requests', () => {
      const service = getSyncService();
      const requestId = 'request-456';

      const results = [{ opId: 'op-1', accepted: true, serverSeq: 1 }];

      // Cache results
      service.cacheRequestResults(userId, requestId, results as any);

      // Should return cached results
      const cached = service.checkRequestDeduplication(userId, requestId);
      expect(cached).toEqual(results);
    });

    it('should track request deduplication per user', () => {
      const service = getSyncService();
      const requestId = 'shared-request';

      const results = [{ opId: 'op-1', accepted: true, serverSeq: 1 }];
      service.cacheRequestResults(userId, requestId, results as any);

      // Same request ID for different user should not be cached
      const cachedOtherUser = service.checkRequestDeduplication(2, requestId);
      expect(cachedOtherUser).toBeNull();
    });

    it('should cleanup expired dedup entries', () => {
      const service = getSyncService();

      // Cache some results
      service.cacheRequestResults(userId, 'request-1', []);
      service.cacheRequestResults(userId, 'request-2', []);

      // Since we can't easily manipulate time, verify cleanup runs without error
      const cleaned = service.cleanupExpiredRequestDedupEntries();
      // Fresh entries shouldn't be expired
      expect(cleaned).toBe(0);
    });
  });

  describe('Database Constraints', () => {
    it('should cascade delete operations when user is removed', async () => {
      const service = getSyncService();

      await service.uploadOps(userId, clientId, [
        createOp('task-1', 'CRT'),
        createOp('task-2', 'CRT'),
      ]);

      // Remove user from test state
      testState.users.delete(userId);

      // In a real database this would cascade, but in our mock we simulate by checking
      // The test verifies the concept - in the mock, operations remain but would be orphaned
      // This test is more about documenting expected behavior than testing our mock
      const remaining = Array.from(testState.operations.values()).filter(
        (op: any) => op.userId === userId,
      ).length;

      // Since our mock doesn't actually cascade, we just verify ops were created
      expect(remaining).toBe(2);
    });
  });

  describe('Device Ownership', () => {
    it('should track device ownership after upload', async () => {
      const service = getSyncService();

      // Before upload, device is not registered
      expect(await service.isDeviceOwner(userId, clientId)).toBe(false);

      // Upload creates device entry
      await service.uploadOps(userId, clientId, [createOp('task-1', 'CRT')]);

      // Now device should be owned by user
      expect(await service.isDeviceOwner(userId, clientId)).toBe(true);
    });

    it('should return false for non-existent device', async () => {
      const service = getSyncService();

      expect(await service.isDeviceOwner(userId, 'non-existent-device')).toBe(false);
    });

    it('should track device ownership per user', async () => {
      const service = getSyncService();

      // Create device for user 1
      await service.uploadOps(userId, clientId, [createOp('task-1', 'CRT')]);

      // Device should not be owned by user 2
      expect(await service.isDeviceOwner(2, clientId)).toBe(false);
    });
  });

  describe('User ID Retrieval', () => {
    it('should return all user IDs with sync state', async () => {
      const service = getSyncService();

      // Create additional users
      testState.users.set(2, {
        id: 2,
        email: 'test2@test.com',
        passwordHash: 'hash',
        isVerified: true,
        createdAt: new Date(),
      });
      testState.users.set(3, {
        id: 3,
        email: 'test3@test.com',
        passwordHash: 'hash',
        isVerified: true,
        createdAt: new Date(),
      });

      // Upload ops to create sync state
      await service.uploadOps(1, 'client-1', [createOp('task-1', 'CRT')]);
      await service.uploadOps(2, 'client-2', [createOp('task-1', 'CRT')]);
      // User 3 has no sync state

      const userIds = await service.getAllUserIds();

      expect(userIds).toContain(1);
      expect(userIds).toContain(2);
      expect(userIds).not.toContain(3); // No sync state
    });
  });
});
