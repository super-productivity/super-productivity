/**
 * Integration Tests for Snapshot Skip Optimization
 *
 * Tests the download endpoint behavior when full-state operations exist.
 * Uses Fastify's inject() to simulate HTTP requests with Prisma mocked.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { uuidv7 } from 'uuidv7';

// Mock the database module
vi.mock('../../src/db', () => ({
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
      count: vi.fn().mockResolvedValue(1),
    },
  },
}));

// Mock the auth module to bypass authentication
vi.mock('../../src/auth', () => ({
  verifyToken: vi.fn().mockResolvedValue({ userId: 1, email: 'test@test.com' }),
}));

// Import after mocking
import { prisma } from '../../src/db';
import { syncRoutes } from '../../src/sync/sync.routes';
import { initSyncService } from '../../src/sync/sync.service';
import { DownloadOpsResponse } from '../../src/sync/sync.types';

describe('Snapshot Skip Optimization Integration', () => {
  let app: FastifyInstance;
  const userId = 1;

  beforeEach(async () => {
    vi.clearAllMocks();
    initSyncService();

    app = Fastify();
    await app.register(syncRoutes, { prefix: '/api/sync' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /api/sync/ops', () => {
    it('should include latestSnapshotSeq in response when SYNC_IMPORT exists', async () => {
      const syncImportSeq = 10;

      vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
        const tx = {
          operation: {
            findFirst: vi.fn().mockResolvedValue({ serverSeq: syncImportSeq }),
            findMany: vi.fn().mockResolvedValue([
              {
                id: uuidv7(),
                serverSeq: 10,
                clientId: 'client-a',
                actionType: '[SP_ALL] Load(import) all data',
                opType: 'SYNC_IMPORT',
                entityType: 'ALL',
                entityId: null,
                payload: { appDataComplete: {} },
                vectorClock: { 'client-a': 1 },
                schemaVersion: 1,
                clientTimestamp: BigInt(Date.now()),
                receivedAt: BigInt(Date.now()),
                parentOpId: null,
                isPayloadEncrypted: false,
              },
              {
                id: uuidv7(),
                serverSeq: 11,
                clientId: 'client-a',
                actionType: 'ADD_TASK',
                opType: 'CRT',
                entityType: 'TASK',
                entityId: 'task-1',
                payload: { title: 'Task 1' },
                vectorClock: { 'client-a': 2 },
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

      const response = await app.inject({
        method: 'GET',
        url: '/api/sync/ops?sinceSeq=0',
        headers: { authorization: 'Bearer mock-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as DownloadOpsResponse;
      expect(body.latestSnapshotSeq).toBe(syncImportSeq);
      expect(body.latestSeq).toBe(11);
      expect(body.ops.length).toBe(2);
    });

    it('should skip pre-import ops for fresh client (sinceSeq=0)', async () => {
      const syncImportSeq = 100;

      vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
        const tx = {
          operation: {
            findFirst: vi.fn().mockResolvedValue({ serverSeq: syncImportSeq }),
            findMany: vi.fn().mockImplementation(async (args: any) => {
              // The query should start from seq 99 (syncImportSeq - 1), not 0
              const startSeq = args.where.serverSeq.gt;
              expect(startSeq).toBe(syncImportSeq - 1);

              return [
                {
                  id: uuidv7(),
                  serverSeq: 100,
                  clientId: 'client-a',
                  actionType: '[SP_ALL] Load(import) all data',
                  opType: 'SYNC_IMPORT',
                  entityType: 'ALL',
                  entityId: null,
                  payload: { appDataComplete: {} },
                  vectorClock: { 'client-a': 100 },
                  schemaVersion: 1,
                  clientTimestamp: BigInt(Date.now()),
                  receivedAt: BigInt(Date.now()),
                  parentOpId: null,
                  isPayloadEncrypted: false,
                },
                {
                  id: uuidv7(),
                  serverSeq: 101,
                  clientId: 'client-a',
                  actionType: 'ADD_TASK',
                  opType: 'CRT',
                  entityType: 'TASK',
                  entityId: 'task-1',
                  payload: { title: 'Post-import task' },
                  vectorClock: { 'client-a': 101 },
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

      const response = await app.inject({
        method: 'GET',
        url: '/api/sync/ops?sinceSeq=0',
        headers: { authorization: 'Bearer mock-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as DownloadOpsResponse;

      // Should only return ops starting from SYNC_IMPORT
      expect(body.ops.length).toBe(2);
      expect(body.ops[0].serverSeq).toBe(100);
      expect(body.ops[0].op.opType).toBe('SYNC_IMPORT');
      expect(body.latestSnapshotSeq).toBe(100);
    });

    it('should NOT skip ops when sinceSeq is after SYNC_IMPORT', async () => {
      const syncImportSeq = 10;

      vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
        const tx = {
          operation: {
            findFirst: vi.fn().mockResolvedValue({ serverSeq: syncImportSeq }),
            findMany: vi.fn().mockImplementation(async (args: any) => {
              // Client already has ops up to seq 50, sinceSeq should NOT be modified
              expect(args.where.serverSeq.gt).toBe(50);

              return [
                {
                  id: uuidv7(),
                  serverSeq: 51,
                  clientId: 'client-a',
                  actionType: 'UPDATE_TASK',
                  opType: 'UPD',
                  entityType: 'TASK',
                  entityId: 'task-1',
                  payload: { done: true },
                  vectorClock: { 'client-a': 51 },
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

      const response = await app.inject({
        method: 'GET',
        url: '/api/sync/ops?sinceSeq=50',
        headers: { authorization: 'Bearer mock-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as DownloadOpsResponse;

      // Should return ops after sinceSeq=50
      expect(body.ops.length).toBe(1);
      expect(body.ops[0].serverSeq).toBe(51);
      expect(body.latestSnapshotSeq).toBe(10);
    });

    it('should not include latestSnapshotSeq when no full-state ops exist', async () => {
      vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
        const tx = {
          operation: {
            findFirst: vi.fn().mockResolvedValue(null), // No SYNC_IMPORT
            findMany: vi.fn().mockResolvedValue([
              {
                id: uuidv7(),
                serverSeq: 1,
                clientId: 'client-a',
                actionType: 'ADD_TASK',
                opType: 'CRT',
                entityType: 'TASK',
                entityId: 'task-1',
                payload: { title: 'Task 1' },
                vectorClock: { 'client-a': 1 },
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

      const response = await app.inject({
        method: 'GET',
        url: '/api/sync/ops?sinceSeq=0',
        headers: { authorization: 'Bearer mock-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as DownloadOpsResponse;

      // latestSnapshotSeq should be undefined/not present
      expect(body.latestSnapshotSeq).toBeUndefined();
      expect(body.ops.length).toBe(1);
    });

    it('should handle multiple full-state ops and use the latest one', async () => {
      // Scenario: User did SYNC_IMPORT at seq 10, then BACKUP_IMPORT at seq 50
      // Should skip to seq 50, not seq 10
      const latestFullStateSeq = 50;

      vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
        const tx = {
          operation: {
            // findFirst with orderBy: { serverSeq: 'desc' } returns the LATEST
            findFirst: vi.fn().mockResolvedValue({ serverSeq: latestFullStateSeq }),
            findMany: vi.fn().mockImplementation(async (args: any) => {
              // Should skip to seq 49, not seq 9
              expect(args.where.serverSeq.gt).toBe(latestFullStateSeq - 1);

              return [
                {
                  id: uuidv7(),
                  serverSeq: 50,
                  clientId: 'client-a',
                  actionType: '[SP_ALL] Load(import) backup file',
                  opType: 'BACKUP_IMPORT',
                  entityType: 'ALL',
                  entityId: null,
                  payload: { appDataComplete: {} },
                  vectorClock: { 'client-a': 50 },
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

      const response = await app.inject({
        method: 'GET',
        url: '/api/sync/ops?sinceSeq=0',
        headers: { authorization: 'Bearer mock-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as DownloadOpsResponse;

      expect(body.latestSnapshotSeq).toBe(50);
      expect(body.ops.length).toBe(1);
      expect(body.ops[0].serverSeq).toBe(50);
    });
  });
});
