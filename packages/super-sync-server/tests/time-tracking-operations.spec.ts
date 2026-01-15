/**
 * TIME_TRACKING Entity Operations Tests
 *
 * Comprehensive tests for TIME_TRACKING entity operations in the sync server.
 * Verifies that time tracking data is stored, validated, and included in
 * snapshots correctly.
 *
 * ## TIME_TRACKING Entity Structure:
 * - entityId format: `<contextType>:<contextId>:<date>` (e.g., "PROJECT:proj-1:2024-01-15")
 * - payload: { contextType, contextId, date, data: { s, e, b, bt } }
 * - opType: typically 'UPD' (updates to time tracking entries)
 *
 * ## Sync Behavior:
 * - Server stores operations verbatim (no domain logic)
 * - LWW conflict resolution happens on the client
 * - Snapshots include all TIME_TRACKING entities
 */

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
      deleteMany: vi.fn().mockImplementation(async () => ({ count: 0 })),
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
      deleteMany: vi.fn().mockImplementation(async () => ({ count: 0 })),
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
        deleteMany: vi.fn().mockImplementation(async () => ({ count: 0 })),
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
        count: vi.fn().mockImplementation(async () => 0),
        deleteMany: vi.fn().mockImplementation(async () => ({ count: 0 })),
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

describe('TIME_TRACKING Operations', () => {
  const userId = 1;
  const clientId = 'time-tracking-client';

  /**
   * Creates a TIME_TRACKING operation with the standard structure.
   *
   * @param contextType - 'PROJECT' or 'TAG'
   * @param contextId - ID of the project or tag
   * @param date - Date string in 'YYYY-MM-DD' format
   * @param data - Time tracking data { s: spent, e: estimated, b: breaks, bt: breakTime }
   * @param vectorClockValue - Value for the client's vector clock entry
   */
  const createTimeTrackingOp = (
    contextType: 'PROJECT' | 'TAG',
    contextId: string,
    date: string,
    data: { s?: number; e?: number; b?: number; bt?: number },
    vectorClockValue = 1,
  ): Operation => ({
    id: uuidv7(),
    clientId,
    actionType: '[Time Tracking] Sync Time Tracking',
    opType: 'UPD',
    entityType: 'TIME_TRACKING',
    entityId: `${contextType}:${contextId}:${date}`,
    payload: {
      contextType,
      contextId,
      date,
      data,
    },
    vectorClock: { [clientId]: vectorClockValue },
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

  describe('Operation Upload', () => {
    it('should accept PROJECT time tracking operation with valid structure', async () => {
      const service = getSyncService();

      const op = createTimeTrackingOp('PROJECT', 'proj-1', '2024-01-15', {
        s: 1000,
        e: 2000,
        b: 1,
        bt: 100,
      });

      const results = await service.uploadOps(userId, clientId, [op]);

      expect(results[0]).toMatchObject({
        opId: op.id,
        accepted: true,
      });
      expect(results[0].serverSeq).toBeDefined();
    });

    it('should accept TAG time tracking operation', async () => {
      const service = getSyncService();

      const op = createTimeTrackingOp('TAG', 'tag-1', '2024-01-15', {
        s: 500,
        e: 600,
      });

      const results = await service.uploadOps(userId, clientId, [op]);

      expect(results[0]).toMatchObject({
        opId: op.id,
        accepted: true,
      });
    });

    it('should accept partial time tracking data (only s field)', async () => {
      const service = getSyncService();

      const op = createTimeTrackingOp('PROJECT', 'proj-1', '2024-01-15', {
        s: 1000,
      });

      const results = await service.uploadOps(userId, clientId, [op]);

      expect(results[0].accepted).toBe(true);
    });

    it('should accept multiple time tracking operations in batch', async () => {
      const service = getSyncService();

      const ops = [
        createTimeTrackingOp('PROJECT', 'proj-1', '2024-01-15', { s: 1000 }, 1),
        createTimeTrackingOp('PROJECT', 'proj-1', '2024-01-16', { s: 2000 }, 2),
        createTimeTrackingOp('TAG', 'tag-1', '2024-01-15', { s: 500 }, 3),
      ];

      const results = await service.uploadOps(userId, clientId, ops);

      expect(results).toHaveLength(3);
      results.forEach((result) => {
        expect(result.accepted).toBe(true);
      });
    });

    it('should preserve payload data for time tracking operations', async () => {
      const service = getSyncService();

      const op = createTimeTrackingOp('PROJECT', 'proj-1', '2024-01-15', {
        s: 1000,
        e: 2000,
        b: 1,
        bt: 100,
      });

      await service.uploadOps(userId, clientId, [op]);

      // Verify the operation was stored with correct payload
      const storedOp = testState.operations.get(op.id);
      expect(storedOp).toBeDefined();

      // Parse the stored payload (it's serialized as JSON in the db mock)
      const payload =
        typeof storedOp.payload === 'string'
          ? JSON.parse(storedOp.payload)
          : storedOp.payload;

      expect(payload.contextType).toBe('PROJECT');
      expect(payload.contextId).toBe('proj-1');
      expect(payload.date).toBe('2024-01-15');
      expect(payload.data).toEqual({ s: 1000, e: 2000, b: 1, bt: 100 });
    });
  });

  describe('Multi-Client Time Tracking', () => {
    it('should reject concurrent updates from different clients (conflict detection)', async () => {
      const service = getSyncService();
      const clientA = 'client-A';
      const clientB = 'client-B';

      // Same entityId, different clients - truly concurrent (no merged clocks)
      const opA: Operation = {
        id: uuidv7(),
        clientId: clientA,
        actionType: '[Time Tracking] Sync Time Tracking',
        opType: 'UPD',
        entityType: 'TIME_TRACKING',
        entityId: 'PROJECT:proj-1:2024-01-15',
        payload: {
          contextType: 'PROJECT',
          contextId: 'proj-1',
          date: '2024-01-15',
          data: { s: 1000 },
        },
        vectorClock: { [clientA]: 1 },
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      const opB: Operation = {
        id: uuidv7(),
        clientId: clientB,
        actionType: '[Time Tracking] Sync Time Tracking',
        opType: 'UPD',
        entityType: 'TIME_TRACKING',
        entityId: 'PROJECT:proj-1:2024-01-15', // Same entityId = conflict
        payload: {
          contextType: 'PROJECT',
          contextId: 'proj-1',
          date: '2024-01-15',
          data: { s: 2000 },
        },
        vectorClock: { [clientB]: 1 }, // No knowledge of clientA's op = concurrent
        timestamp: Date.now() + 100,
        schemaVersion: 1,
      };

      const resultsA = await service.uploadOps(userId, clientA, [opA]);
      const resultsB = await service.uploadOps(userId, clientB, [opB]);

      // First operation accepted
      expect(resultsA[0].accepted).toBe(true);
      // Second operation rejected as concurrent conflict
      expect(resultsB[0].accepted).toBe(false);
      expect(resultsB[0].errorCode).toBe('CONFLICT_CONCURRENT');
    });

    it('should accept sequential updates from different clients (with merged clocks)', async () => {
      const service = getSyncService();
      const clientA = 'client-A';
      const clientB = 'client-B';

      // Client A's operation
      const opA: Operation = {
        id: uuidv7(),
        clientId: clientA,
        actionType: '[Time Tracking] Sync Time Tracking',
        opType: 'UPD',
        entityType: 'TIME_TRACKING',
        entityId: 'PROJECT:proj-1:2024-01-15',
        payload: {
          contextType: 'PROJECT',
          contextId: 'proj-1',
          date: '2024-01-15',
          data: { s: 1000 },
        },
        vectorClock: { [clientA]: 1 },
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      // Client B's operation with knowledge of A's operation (merged clock)
      const opB: Operation = {
        id: uuidv7(),
        clientId: clientB,
        actionType: '[Time Tracking] Sync Time Tracking',
        opType: 'UPD',
        entityType: 'TIME_TRACKING',
        entityId: 'PROJECT:proj-1:2024-01-15',
        payload: {
          contextType: 'PROJECT',
          contextId: 'proj-1',
          date: '2024-01-15',
          data: { s: 2000 },
        },
        vectorClock: { [clientA]: 1, [clientB]: 1 }, // Has knowledge of A's op
        timestamp: Date.now() + 100,
        schemaVersion: 1,
      };

      const resultsA = await service.uploadOps(userId, clientA, [opA]);
      const resultsB = await service.uploadOps(userId, clientB, [opB]);

      // Both operations accepted (B happens-after A)
      expect(resultsA[0].accepted).toBe(true);
      expect(resultsB[0].accepted).toBe(true);

      // Both operations should be stored
      expect(testState.operations.size).toBe(2);
    });

    it('should assign sequential serverSeq to time tracking operations', async () => {
      const service = getSyncService();

      const op1 = createTimeTrackingOp('PROJECT', 'proj-1', '2024-01-15', { s: 1000 }, 1);
      const op2 = createTimeTrackingOp('PROJECT', 'proj-1', '2024-01-16', { s: 2000 }, 2);

      const results1 = await service.uploadOps(userId, clientId, [op1]);
      const results2 = await service.uploadOps(userId, clientId, [op2]);

      expect(results1[0].serverSeq).toBe(1);
      expect(results2[0].serverSeq).toBe(2);
    });
  });

  describe('Snapshot Generation with TIME_TRACKING', () => {
    it('should include TIME_TRACKING entities in snapshot', async () => {
      const service = getSyncService();

      const op = createTimeTrackingOp('PROJECT', 'proj-1', '2024-01-15', {
        s: 1000,
        e: 2000,
      });

      await service.uploadOps(userId, clientId, [op]);

      const snapshot = await service.generateSnapshot(userId);

      expect(snapshot.state).toHaveProperty('TIME_TRACKING');
      const timeTracking = (snapshot.state as Record<string, Record<string, unknown>>)
        .TIME_TRACKING;
      expect(timeTracking['PROJECT:proj-1:2024-01-15']).toBeDefined();
    });

    it('should apply LWW semantics in snapshot generation', async () => {
      const service = getSyncService();

      // First operation
      const op1: Operation = {
        id: uuidv7(),
        clientId,
        actionType: '[Time Tracking] Sync Time Tracking',
        opType: 'UPD',
        entityType: 'TIME_TRACKING',
        entityId: 'PROJECT:proj-1:2024-01-15',
        payload: { data: { s: 1000 } },
        vectorClock: { [clientId]: 1 },
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      // Second operation (update)
      const op2: Operation = {
        id: uuidv7(),
        clientId,
        actionType: '[Time Tracking] Sync Time Tracking',
        opType: 'UPD',
        entityType: 'TIME_TRACKING',
        entityId: 'PROJECT:proj-1:2024-01-15', // Same entityId
        payload: { data: { s: 2000, e: 3000 } }, // Updated values
        vectorClock: { [clientId]: 2 },
        timestamp: Date.now() + 1000,
        schemaVersion: 1,
      };

      await service.uploadOps(userId, clientId, [op1, op2]);

      const snapshot = await service.generateSnapshot(userId);

      const timeTracking = (snapshot.state as Record<string, Record<string, unknown>>)
        .TIME_TRACKING;
      const entry = timeTracking['PROJECT:proj-1:2024-01-15'] as Record<string, unknown>;

      // LWW: later operation wins, but server merges payload
      expect(entry.data).toEqual({ s: 2000, e: 3000 });
    });

    it('should include multiple TIME_TRACKING entries in snapshot', async () => {
      const service = getSyncService();

      const ops = [
        createTimeTrackingOp('PROJECT', 'proj-1', '2024-01-15', { s: 1000 }, 1),
        createTimeTrackingOp('PROJECT', 'proj-1', '2024-01-16', { s: 2000 }, 2),
        createTimeTrackingOp('PROJECT', 'proj-2', '2024-01-15', { s: 3000 }, 3),
        createTimeTrackingOp('TAG', 'tag-1', '2024-01-15', { s: 500 }, 4),
      ];

      await service.uploadOps(userId, clientId, ops);

      const snapshot = await service.generateSnapshot(userId);

      const timeTracking = (snapshot.state as Record<string, Record<string, unknown>>)
        .TIME_TRACKING;

      expect(Object.keys(timeTracking)).toHaveLength(4);
      expect(timeTracking['PROJECT:proj-1:2024-01-15']).toBeDefined();
      expect(timeTracking['PROJECT:proj-1:2024-01-16']).toBeDefined();
      expect(timeTracking['PROJECT:proj-2:2024-01-15']).toBeDefined();
      expect(timeTracking['TAG:tag-1:2024-01-15']).toBeDefined();
    });

    it('should handle mixed entity types (TASK + TIME_TRACKING) in snapshot', async () => {
      const service = getSyncService();

      const taskOp: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD_TASK',
        opType: 'CRT',
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Test Task' },
        vectorClock: { [clientId]: 1 },
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      const timeTrackingOp = createTimeTrackingOp(
        'PROJECT',
        'proj-1',
        '2024-01-15',
        { s: 1000 },
        2,
      );

      await service.uploadOps(userId, clientId, [taskOp, timeTrackingOp]);

      const snapshot = await service.generateSnapshot(userId);

      expect(snapshot.state).toHaveProperty('TASK');
      expect(snapshot.state).toHaveProperty('TIME_TRACKING');

      const tasks = (snapshot.state as Record<string, Record<string, unknown>>).TASK;
      expect(tasks['task-1']).toHaveProperty('title', 'Test Task');

      const timeTracking = (snapshot.state as Record<string, Record<string, unknown>>)
        .TIME_TRACKING;
      expect(timeTracking['PROJECT:proj-1:2024-01-15']).toBeDefined();
    });
  });

  describe('Download Operations', () => {
    it('should download TIME_TRACKING operations for syncing clients', async () => {
      const service = getSyncService();

      const op = createTimeTrackingOp('PROJECT', 'proj-1', '2024-01-15', {
        s: 1000,
        e: 2000,
      });

      await service.uploadOps(userId, clientId, [op]);

      // Another client downloads - getOpsSince returns { op: Operation, serverSeq }[]
      const downloadedOps = await service.getOpsSince(userId, 0);

      expect(downloadedOps).toHaveLength(1);
      expect(downloadedOps[0].op.entityType).toBe('TIME_TRACKING');
      expect(downloadedOps[0].op.entityId).toBe('PROJECT:proj-1:2024-01-15');
    });

    it('should preserve TIME_TRACKING payload structure in downloads', async () => {
      const service = getSyncService();

      const op = createTimeTrackingOp('PROJECT', 'proj-1', '2024-01-15', {
        s: 1000,
        e: 2000,
        b: 2,
        bt: 300,
      });

      await service.uploadOps(userId, clientId, [op]);

      const downloadedOps = await service.getOpsSince(userId, 0);

      expect(downloadedOps[0].op.payload).toEqual({
        contextType: 'PROJECT',
        contextId: 'proj-1',
        date: '2024-01-15',
        data: { s: 1000, e: 2000, b: 2, bt: 300 },
      });
    });
  });

  describe('Edge Cases', () => {
    it('should accept TIME_TRACKING with zero values', async () => {
      const service = getSyncService();

      const op = createTimeTrackingOp('PROJECT', 'proj-1', '2024-01-15', {
        s: 0,
        e: 0,
        b: 0,
        bt: 0,
      });

      const results = await service.uploadOps(userId, clientId, [op]);

      expect(results[0].accepted).toBe(true);
    });

    it('should accept TIME_TRACKING with large values', async () => {
      const service = getSyncService();

      const op = createTimeTrackingOp('PROJECT', 'proj-1', '2024-01-15', {
        s: 86400000, // 24 hours in ms
        e: 172800000, // 48 hours in ms
      });

      const results = await service.uploadOps(userId, clientId, [op]);

      expect(results[0].accepted).toBe(true);
    });

    it('should handle special characters in entityId', async () => {
      const service = getSyncService();

      // UUIDs with dashes are common in contextIds
      const op = createTimeTrackingOp(
        'PROJECT',
        'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        '2024-01-15',
        { s: 1000 },
      );

      const results = await service.uploadOps(userId, clientId, [op]);

      expect(results[0].accepted).toBe(true);
      expect(op.entityId).toBe('PROJECT:a1b2c3d4-e5f6-7890-abcd-ef1234567890:2024-01-15');
    });

    it('should reject duplicate operation IDs', async () => {
      const service = getSyncService();

      const op = createTimeTrackingOp('PROJECT', 'proj-1', '2024-01-15', { s: 1000 });

      // First upload succeeds
      const results1 = await service.uploadOps(userId, clientId, [op]);
      expect(results1[0].accepted).toBe(true);

      // Duplicate upload is rejected
      const results2 = await service.uploadOps(userId, clientId, [op]);
      expect(results2[0].accepted).toBe(false);
    });
  });
});
