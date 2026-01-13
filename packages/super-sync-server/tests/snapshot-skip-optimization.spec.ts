/**
 * Tests for the Snapshot Skip Optimization
 *
 * When downloading operations, the server should skip operations that precede
 * the latest full-state operation (SYNC_IMPORT, BACKUP_IMPORT, REPAIR).
 * This reduces bandwidth and processing time for fresh clients.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SyncService } from '../src/sync/sync.service';

// Mock Prisma
vi.mock('../src/db', () => ({
  prisma: {
    $transaction: vi.fn(),
    userSyncState: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    operation: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      aggregate: vi.fn(),
      create: vi.fn(),
    },
    syncDevice: {
      upsert: vi.fn(),
    },
  },
}));

import { prisma } from '../src/db';

describe('Snapshot Skip Optimization', () => {
  let service: SyncService;
  const userId = 1;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SyncService();
  });

  describe('getOpsSinceWithSeq', () => {
    it('should return latestSnapshotSeq when SYNC_IMPORT exists', async () => {
      // Setup transaction mock
      vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
        const tx = {
          operation: {
            findFirst: vi.fn().mockResolvedValue({ serverSeq: 10 }), // SYNC_IMPORT at seq 10
            findMany: vi.fn().mockResolvedValue([
              {
                id: 'op-10',
                serverSeq: 10,
                clientId: 'client-a',
                actionType: '[SP_ALL] Load(import) all data',
                opType: 'SYNC_IMPORT',
                entityType: 'ALL',
                entityId: null,
                payload: {},
                vectorClock: {},
                schemaVersion: 1,
                clientTimestamp: BigInt(Date.now()),
                receivedAt: BigInt(Date.now()),
                parentOpId: null,
                isPayloadEncrypted: false,
              },
              {
                id: 'op-11',
                serverSeq: 11,
                clientId: 'client-a',
                actionType: 'ADD_TASK',
                opType: 'CRT',
                entityType: 'TASK',
                entityId: 'task-1',
                payload: { title: 'Task 1' },
                vectorClock: {},
                schemaVersion: 1,
                clientTimestamp: BigInt(Date.now()),
                receivedAt: BigInt(Date.now()),
                parentOpId: null,
                isPayloadEncrypted: false,
              },
            ]),
            aggregate: vi.fn().mockResolvedValue({ _min: { serverSeq: 1 } }),
          },
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue({ lastSeq: 11 }),
          },
        };
        return callback(tx);
      });

      const result = await service.getOpsSinceWithSeq(userId, 0);

      expect(result.latestSnapshotSeq).toBe(10);
      expect(result.latestSeq).toBe(11);
      expect(result.gapDetected).toBe(false);
    });

    it('should skip operations before SYNC_IMPORT when sinceSeq is 0', async () => {
      const syncImportSeq = 50;

      vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
        const tx = {
          operation: {
            findFirst: vi.fn().mockResolvedValue({ serverSeq: syncImportSeq }),
            findMany: vi.fn().mockImplementation(async (args: any) => {
              // Verify that the query starts from syncImportSeq - 1, not 0
              expect(args.where.serverSeq.gt).toBe(syncImportSeq - 1);
              return [
                {
                  id: 'op-50',
                  serverSeq: 50,
                  clientId: 'client-a',
                  actionType: '[SP_ALL] Load(import) all data',
                  opType: 'SYNC_IMPORT',
                  entityType: 'ALL',
                  entityId: null,
                  payload: {},
                  vectorClock: {},
                  schemaVersion: 1,
                  clientTimestamp: BigInt(Date.now()),
                  receivedAt: BigInt(Date.now()),
                  parentOpId: null,
                  isPayloadEncrypted: false,
                },
              ];
            }),
            aggregate: vi.fn().mockResolvedValue({ _min: { serverSeq: 1 } }),
          },
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue({ lastSeq: 50 }),
          },
        };
        return callback(tx);
      });

      const result = await service.getOpsSinceWithSeq(userId, 0);

      // Should only return ops from seq 50 onwards, not from seq 1
      expect(result.ops.length).toBe(1);
      expect(result.ops[0].serverSeq).toBe(50);
      expect(result.latestSnapshotSeq).toBe(50);
    });

    it('should NOT skip when sinceSeq is after SYNC_IMPORT', async () => {
      const syncImportSeq = 10;

      vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
        const tx = {
          operation: {
            findFirst: vi.fn().mockResolvedValue({ serverSeq: syncImportSeq }),
            findMany: vi.fn().mockImplementation(async (args: any) => {
              // When sinceSeq (15) > syncImportSeq (10), should NOT modify the query
              expect(args.where.serverSeq.gt).toBe(15);
              return [
                {
                  id: 'op-16',
                  serverSeq: 16,
                  clientId: 'client-a',
                  actionType: 'ADD_TASK',
                  opType: 'CRT',
                  entityType: 'TASK',
                  entityId: 'task-1',
                  payload: {},
                  vectorClock: {},
                  schemaVersion: 1,
                  clientTimestamp: BigInt(Date.now()),
                  receivedAt: BigInt(Date.now()),
                  parentOpId: null,
                  isPayloadEncrypted: false,
                },
              ];
            }),
            aggregate: vi.fn().mockResolvedValue({ _min: { serverSeq: 1 } }),
          },
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue({ lastSeq: 20 }),
          },
        };
        return callback(tx);
      });

      const result = await service.getOpsSinceWithSeq(userId, 15);

      expect(result.ops.length).toBe(1);
      expect(result.ops[0].serverSeq).toBe(16);
      expect(result.latestSnapshotSeq).toBe(10);
    });

    it('should return undefined latestSnapshotSeq when no full-state ops exist', async () => {
      vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
        const tx = {
          operation: {
            findFirst: vi.fn().mockResolvedValue(null), // No SYNC_IMPORT found
            findMany: vi.fn().mockResolvedValue([
              {
                id: 'op-1',
                serverSeq: 1,
                clientId: 'client-a',
                actionType: 'ADD_TASK',
                opType: 'CRT',
                entityType: 'TASK',
                entityId: 'task-1',
                payload: {},
                vectorClock: {},
                schemaVersion: 1,
                clientTimestamp: BigInt(Date.now()),
                receivedAt: BigInt(Date.now()),
                parentOpId: null,
                isPayloadEncrypted: false,
              },
            ]),
            aggregate: vi.fn().mockResolvedValue({ _min: { serverSeq: 1 } }),
          },
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue({ lastSeq: 1 }),
          },
        };
        return callback(tx);
      });

      const result = await service.getOpsSinceWithSeq(userId, 0);

      expect(result.latestSnapshotSeq).toBeUndefined();
      expect(result.ops.length).toBe(1);
    });

    it('should handle BACKUP_IMPORT as a full-state operation', async () => {
      vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
        const tx = {
          operation: {
            findFirst: vi.fn().mockResolvedValue({ serverSeq: 5 }), // BACKUP_IMPORT at seq 5
            findMany: vi.fn().mockResolvedValue([
              {
                id: 'op-5',
                serverSeq: 5,
                clientId: 'client-a',
                actionType: '[SP_ALL] Load(import) all data',
                opType: 'BACKUP_IMPORT',
                entityType: 'ALL',
                entityId: null,
                payload: {},
                vectorClock: {},
                schemaVersion: 1,
                clientTimestamp: BigInt(Date.now()),
                receivedAt: BigInt(Date.now()),
                parentOpId: null,
                isPayloadEncrypted: false,
              },
            ]),
            aggregate: vi.fn().mockResolvedValue({ _min: { serverSeq: 1 } }),
          },
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue({ lastSeq: 5 }),
          },
        };
        return callback(tx);
      });

      const result = await service.getOpsSinceWithSeq(userId, 0);

      expect(result.latestSnapshotSeq).toBe(5);
    });

    it('should handle REPAIR as a full-state operation', async () => {
      vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
        const tx = {
          operation: {
            findFirst: vi.fn().mockResolvedValue({ serverSeq: 20 }), // REPAIR at seq 20
            findMany: vi.fn().mockResolvedValue([
              {
                id: 'op-20',
                serverSeq: 20,
                clientId: 'client-a',
                actionType: '[SP_ALL] Load(import) all data',
                opType: 'REPAIR',
                entityType: 'ALL',
                entityId: null,
                payload: {},
                vectorClock: {},
                schemaVersion: 1,
                clientTimestamp: BigInt(Date.now()),
                receivedAt: BigInt(Date.now()),
                parentOpId: null,
                isPayloadEncrypted: false,
              },
            ]),
            aggregate: vi.fn().mockResolvedValue({ _min: { serverSeq: 1 } }),
          },
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue({ lastSeq: 20 }),
          },
        };
        return callback(tx);
      });

      const result = await service.getOpsSinceWithSeq(userId, 0);

      expect(result.latestSnapshotSeq).toBe(20);
    });

    // === Edge Cases ===

    it('should handle SYNC_IMPORT at seq 1 (edge case)', async () => {
      // Edge case: SYNC_IMPORT is the very first operation
      vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
        const tx = {
          operation: {
            findFirst: vi.fn().mockResolvedValue({ serverSeq: 1 }),
            findMany: vi.fn().mockImplementation(async (args: any) => {
              // effectiveSinceSeq should be 1 - 1 = 0, so query is serverSeq > 0
              expect(args.where.serverSeq.gt).toBe(0);
              return [
                {
                  id: 'op-1',
                  serverSeq: 1,
                  clientId: 'client-a',
                  actionType: '[SP_ALL] Load(import) all data',
                  opType: 'SYNC_IMPORT',
                  entityType: 'ALL',
                  entityId: null,
                  payload: {},
                  vectorClock: {},
                  schemaVersion: 1,
                  clientTimestamp: BigInt(Date.now()),
                  receivedAt: BigInt(Date.now()),
                  parentOpId: null,
                  isPayloadEncrypted: false,
                },
              ];
            }),
            aggregate: vi.fn().mockResolvedValue({ _min: { serverSeq: 1 } }),
          },
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue({ lastSeq: 1 }),
          },
        };
        return callback(tx);
      });

      const result = await service.getOpsSinceWithSeq(userId, 0);

      expect(result.latestSnapshotSeq).toBe(1);
      expect(result.ops.length).toBe(1);
      expect(result.ops[0].serverSeq).toBe(1);
    });

    it('should handle sinceSeq exactly equal to snapshotSeq (no skip needed)', async () => {
      // Client is exactly at the snapshot seq - shouldn't skip further
      const snapshotSeq = 50;

      vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
        const tx = {
          operation: {
            findFirst: vi.fn().mockResolvedValue({ serverSeq: snapshotSeq }),
            findMany: vi.fn().mockImplementation(async (args: any) => {
              // sinceSeq (50) >= snapshotSeq (50), so no skip
              expect(args.where.serverSeq.gt).toBe(50);
              return [
                {
                  id: 'op-51',
                  serverSeq: 51,
                  clientId: 'client-a',
                  actionType: 'ADD_TASK',
                  opType: 'CRT',
                  entityType: 'TASK',
                  entityId: 'task-1',
                  payload: {},
                  vectorClock: {},
                  schemaVersion: 1,
                  clientTimestamp: BigInt(Date.now()),
                  receivedAt: BigInt(Date.now()),
                  parentOpId: null,
                  isPayloadEncrypted: false,
                },
              ];
            }),
            aggregate: vi.fn().mockResolvedValue({ _min: { serverSeq: 1 } }),
          },
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue({ lastSeq: 51 }),
          },
        };
        return callback(tx);
      });

      const result = await service.getOpsSinceWithSeq(userId, 50);

      expect(result.latestSnapshotSeq).toBe(50);
      expect(result.ops.length).toBe(1);
      expect(result.ops[0].serverSeq).toBe(51);
    });

    it('should return empty ops when all operations are before the snapshot', async () => {
      // Scenario: SYNC_IMPORT at seq 100, but no ops after it yet
      vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
        const tx = {
          operation: {
            findFirst: vi.fn().mockResolvedValue({ serverSeq: 100 }),
            findMany: vi.fn().mockImplementation(async (args: any) => {
              // Skip to seq 99, return only the SYNC_IMPORT itself
              expect(args.where.serverSeq.gt).toBe(99);
              return [
                {
                  id: 'op-100',
                  serverSeq: 100,
                  clientId: 'client-a',
                  actionType: '[SP_ALL] Load(import) all data',
                  opType: 'SYNC_IMPORT',
                  entityType: 'ALL',
                  entityId: null,
                  payload: {},
                  vectorClock: {},
                  schemaVersion: 1,
                  clientTimestamp: BigInt(Date.now()),
                  receivedAt: BigInt(Date.now()),
                  parentOpId: null,
                  isPayloadEncrypted: false,
                },
              ];
            }),
            aggregate: vi.fn().mockResolvedValue({ _min: { serverSeq: 1 } }),
          },
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue({ lastSeq: 100 }),
          },
        };
        return callback(tx);
      });

      const result = await service.getOpsSinceWithSeq(userId, 0);

      // Should return just the SYNC_IMPORT
      expect(result.ops.length).toBe(1);
      expect(result.ops[0].op.opType).toBe('SYNC_IMPORT');
      expect(result.latestSnapshotSeq).toBe(100);
    });

    it('should handle excludeClient without affecting snapshot detection', async () => {
      // IMPORTANT: The snapshot detection should NOT be affected by excludeClient
      // But the returned ops WILL be filtered by excludeClient
      const snapshotSeq = 50;
      const importingClient = 'client-a';

      vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
        const tx = {
          operation: {
            // findFirst for snapshot does NOT use excludeClient filter
            findFirst: vi.fn().mockResolvedValue({ serverSeq: snapshotSeq }),
            findMany: vi.fn().mockImplementation(async (args: any) => {
              // Verify excludeClient is applied to the query
              expect(args.where.clientId?.not).toBe(importingClient);
              // Return ops from a DIFFERENT client (not excluded)
              return [
                {
                  id: 'op-51',
                  serverSeq: 51,
                  clientId: 'client-b', // Different client
                  actionType: 'ADD_TASK',
                  opType: 'CRT',
                  entityType: 'TASK',
                  entityId: 'task-1',
                  payload: {},
                  vectorClock: {},
                  schemaVersion: 1,
                  clientTimestamp: BigInt(Date.now()),
                  receivedAt: BigInt(Date.now()),
                  parentOpId: null,
                  isPayloadEncrypted: false,
                },
              ];
            }),
            aggregate: vi.fn().mockResolvedValue({ _min: { serverSeq: 1 } }),
          },
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue({ lastSeq: 51 }),
          },
        };
        return callback(tx);
      });

      // Client A created the SYNC_IMPORT, but downloads excluding own ops
      const result = await service.getOpsSinceWithSeq(userId, 0, importingClient);

      // Should still detect the snapshot (created by client-a)
      expect(result.latestSnapshotSeq).toBe(50);
      // But the SYNC_IMPORT itself is excluded from results (since client-a created it)
      // Only client-b's op is returned
      expect(result.ops.length).toBe(1);
      expect(result.ops[0].op.clientId).toBe('client-b');
    });

    it('should NOT detect gap when skipping to snapshot causes apparent gap', async () => {
      // When we skip from sinceSeq=0 to snapshotSeq=99, the first op returned is 100
      // This should NOT trigger gap detection because we intentionally skipped
      const snapshotSeq = 100;

      vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
        const tx = {
          operation: {
            findFirst: vi.fn().mockResolvedValue({ serverSeq: snapshotSeq }),
            findMany: vi.fn().mockResolvedValue([
              {
                id: 'op-100',
                serverSeq: 100,
                clientId: 'client-a',
                actionType: '[SP_ALL] Load(import) all data',
                opType: 'SYNC_IMPORT',
                entityType: 'ALL',
                entityId: null,
                payload: {},
                vectorClock: {},
                schemaVersion: 1,
                clientTimestamp: BigInt(Date.now()),
                receivedAt: BigInt(Date.now()),
                parentOpId: null,
                isPayloadEncrypted: false,
              },
            ]),
            aggregate: vi.fn().mockResolvedValue({ _min: { serverSeq: 1 } }),
          },
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue({ lastSeq: 100 }),
          },
        };
        return callback(tx);
      });

      const result = await service.getOpsSinceWithSeq(userId, 0);

      // effectiveSinceSeq = 99, first op is 100, 100 > 99 + 1 = 100 is FALSE
      // So no gap should be detected
      expect(result.gapDetected).toBe(false);
    });

    it('should still detect real gaps after the snapshot', async () => {
      // Scenario: Client has already synced past the snapshot (sinceSeq=52 > snapshotSeq=50)
      // Ops 53-55 were purged, first available is 56
      // This is a real gap that should be detected
      const snapshotSeq = 50;

      vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
        const tx = {
          operation: {
            findFirst: vi.fn().mockResolvedValue({ serverSeq: snapshotSeq }),
            findMany: vi.fn().mockImplementation(async (args: any) => {
              // sinceSeq=52 > snapshotSeq=50, so no skip optimization
              expect(args.where.serverSeq.gt).toBe(52);
              return [
                {
                  id: 'op-56',
                  serverSeq: 56, // Gap! Expected 53, got 56
                  clientId: 'client-a',
                  actionType: 'ADD_TASK',
                  opType: 'CRT',
                  entityType: 'TASK',
                  entityId: 'task-1',
                  payload: {},
                  vectorClock: {},
                  schemaVersion: 1,
                  clientTimestamp: BigInt(Date.now()),
                  receivedAt: BigInt(Date.now()),
                  parentOpId: null,
                  isPayloadEncrypted: false,
                },
              ];
            }),
            aggregate: vi.fn().mockResolvedValue({ _min: { serverSeq: 56 } }), // ops before 56 purged
          },
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue({ lastSeq: 56 }),
          },
        };
        return callback(tx);
      });

      // Client has synced up to seq 52, but ops 53-55 are missing
      const result = await service.getOpsSinceWithSeq(userId, 52);

      // sinceSeq=52, first op is 56, 56 > 52 + 1 = 53 is TRUE
      // Gap should be detected
      expect(result.gapDetected).toBe(true);
      expect(result.latestSnapshotSeq).toBe(50);
    });

    it('should handle pagination correctly (second request after snapshot)', async () => {
      // Scenario:
      // 1. First request: sinceSeq=0, skips to snapshot at 100, gets ops 100-199
      // 2. Second request: sinceSeq=199, should NOT skip (already past snapshot)
      const snapshotSeq = 100;

      vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
        const tx = {
          operation: {
            findFirst: vi.fn().mockResolvedValue({ serverSeq: snapshotSeq }),
            findMany: vi.fn().mockImplementation(async (args: any) => {
              // Second request with sinceSeq=199 should NOT modify query
              expect(args.where.serverSeq.gt).toBe(199);
              return [
                {
                  id: 'op-200',
                  serverSeq: 200,
                  clientId: 'client-a',
                  actionType: 'ADD_TASK',
                  opType: 'CRT',
                  entityType: 'TASK',
                  entityId: 'task-200',
                  payload: {},
                  vectorClock: {},
                  schemaVersion: 1,
                  clientTimestamp: BigInt(Date.now()),
                  receivedAt: BigInt(Date.now()),
                  parentOpId: null,
                  isPayloadEncrypted: false,
                },
              ];
            }),
            aggregate: vi.fn().mockResolvedValue({ _min: { serverSeq: 1 } }),
          },
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue({ lastSeq: 200 }),
          },
        };
        return callback(tx);
      });

      // Second request (sinceSeq=199 is after snapshot at 100)
      const result = await service.getOpsSinceWithSeq(userId, 199);

      expect(result.latestSnapshotSeq).toBe(100);
      expect(result.ops.length).toBe(1);
      expect(result.ops[0].serverSeq).toBe(200);
      expect(result.gapDetected).toBe(false);
    });

    it('should use the LATEST snapshot when multiple full-state ops exist', async () => {
      // Scenario: SYNC_IMPORT at 10, BACKUP_IMPORT at 50, REPAIR at 100
      // Should skip to 100, not 10 or 50
      const latestSnapshotSeq = 100;

      vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
        const tx = {
          operation: {
            // findFirst with orderBy: { serverSeq: 'desc' } returns the LATEST
            findFirst: vi.fn().mockResolvedValue({ serverSeq: latestSnapshotSeq }),
            findMany: vi.fn().mockImplementation(async (args: any) => {
              // Should skip to 99, not 9 or 49
              expect(args.where.serverSeq.gt).toBe(99);
              return [
                {
                  id: 'op-100',
                  serverSeq: 100,
                  clientId: 'client-a',
                  actionType: '[SP_ALL] Load(import) all data',
                  opType: 'REPAIR',
                  entityType: 'ALL',
                  entityId: null,
                  payload: {},
                  vectorClock: {},
                  schemaVersion: 1,
                  clientTimestamp: BigInt(Date.now()),
                  receivedAt: BigInt(Date.now()),
                  parentOpId: null,
                  isPayloadEncrypted: false,
                },
              ];
            }),
            aggregate: vi.fn().mockResolvedValue({ _min: { serverSeq: 1 } }),
          },
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue({ lastSeq: 100 }),
          },
        };
        return callback(tx);
      });

      const result = await service.getOpsSinceWithSeq(userId, 0);

      expect(result.latestSnapshotSeq).toBe(100);
    });

    it('should handle empty server state (no operations)', async () => {
      // Fresh user with no operations at all
      vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
        const tx = {
          operation: {
            findFirst: vi.fn().mockResolvedValue(null), // No snapshots
            findMany: vi.fn().mockResolvedValue([]), // No ops
            aggregate: vi.fn().mockResolvedValue({ _min: { serverSeq: null } }),
          },
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue({ lastSeq: 0 }),
          },
        };
        return callback(tx);
      });

      const result = await service.getOpsSinceWithSeq(userId, 0);

      expect(result.latestSnapshotSeq).toBeUndefined();
      expect(result.ops.length).toBe(0);
      expect(result.latestSeq).toBe(0);
      expect(result.gapDetected).toBe(false);
    });

    it('should correctly skip when sinceSeq is slightly before snapshotSeq', async () => {
      // Client at seq 95, snapshot at seq 100
      // Should skip to 99, not stay at 95 (would miss ops 96-99, but they're superseded anyway)
      const snapshotSeq = 100;

      vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
        const tx = {
          operation: {
            findFirst: vi.fn().mockResolvedValue({ serverSeq: snapshotSeq }),
            findMany: vi.fn().mockImplementation(async (args: any) => {
              // sinceSeq=95 < snapshotSeq=100, so skip to 99
              expect(args.where.serverSeq.gt).toBe(99);
              return [
                {
                  id: 'op-100',
                  serverSeq: 100,
                  clientId: 'client-a',
                  actionType: '[SP_ALL] Load(import) all data',
                  opType: 'SYNC_IMPORT',
                  entityType: 'ALL',
                  entityId: null,
                  payload: {},
                  vectorClock: {},
                  schemaVersion: 1,
                  clientTimestamp: BigInt(Date.now()),
                  receivedAt: BigInt(Date.now()),
                  parentOpId: null,
                  isPayloadEncrypted: false,
                },
                {
                  id: 'op-101',
                  serverSeq: 101,
                  clientId: 'client-a',
                  actionType: 'ADD_TASK',
                  opType: 'CRT',
                  entityType: 'TASK',
                  entityId: 'task-1',
                  payload: {},
                  vectorClock: {},
                  schemaVersion: 1,
                  clientTimestamp: BigInt(Date.now()),
                  receivedAt: BigInt(Date.now()),
                  parentOpId: null,
                  isPayloadEncrypted: false,
                },
              ];
            }),
            aggregate: vi.fn().mockResolvedValue({ _min: { serverSeq: 1 } }),
          },
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue({ lastSeq: 101 }),
          },
        };
        return callback(tx);
      });

      // Client has synced up to seq 95, slightly before snapshot at 100
      const result = await service.getOpsSinceWithSeq(userId, 95);

      expect(result.latestSnapshotSeq).toBe(100);
      // Should return snapshot and subsequent ops, not ops 96-99
      expect(result.ops.length).toBe(2);
      expect(result.ops[0].serverSeq).toBe(100);
      expect(result.ops[1].serverSeq).toBe(101);
      expect(result.gapDetected).toBe(false); // No gap - intentional skip
    });

    it('should handle sinceSeq at exactly snapshotSeq minus 1', async () => {
      // Edge case: sinceSeq = 99, snapshotSeq = 100
      // sinceSeq < snapshotSeq, so effectiveSinceSeq = 99 (same as original!)
      const snapshotSeq = 100;

      vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
        const tx = {
          operation: {
            findFirst: vi.fn().mockResolvedValue({ serverSeq: snapshotSeq }),
            findMany: vi.fn().mockImplementation(async (args: any) => {
              // sinceSeq=99 < snapshotSeq=100, so effectiveSinceSeq = 99
              // But original sinceSeq was also 99, so no change
              expect(args.where.serverSeq.gt).toBe(99);
              return [
                {
                  id: 'op-100',
                  serverSeq: 100,
                  clientId: 'client-a',
                  actionType: '[SP_ALL] Load(import) all data',
                  opType: 'SYNC_IMPORT',
                  entityType: 'ALL',
                  entityId: null,
                  payload: {},
                  vectorClock: {},
                  schemaVersion: 1,
                  clientTimestamp: BigInt(Date.now()),
                  receivedAt: BigInt(Date.now()),
                  parentOpId: null,
                  isPayloadEncrypted: false,
                },
              ];
            }),
            aggregate: vi.fn().mockResolvedValue({ _min: { serverSeq: 1 } }),
          },
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue({ lastSeq: 100 }),
          },
        };
        return callback(tx);
      });

      const result = await service.getOpsSinceWithSeq(userId, 99);

      expect(result.latestSnapshotSeq).toBe(100);
      expect(result.ops.length).toBe(1);
      expect(result.ops[0].serverSeq).toBe(100);
    });
  });
});
