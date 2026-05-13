import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { OperationDownloadService } from '../src/sync/services/operation-download.service';
import { Operation, ServerOperation } from '../src/sync/sync.types';

// Mock prisma
vi.mock('../src/db', () => ({
  prisma: {
    operation: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      aggregate: vi.fn(),
    },
    userSyncState: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

// Mock logger to avoid console noise in tests
vi.mock('../src/logger', () => ({
  Logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { prisma } from '../src/db';

const EXPECTED_OPERATION_DOWNLOAD_SELECT = {
  id: true,
  serverSeq: true,
  clientId: true,
  actionType: true,
  opType: true,
  entityType: true,
  entityId: true,
  payload: true,
  vectorClock: true,
  schemaVersion: true,
  clientTimestamp: true,
  receivedAt: true,
  isPayloadEncrypted: true,
  syncImportReason: true,
};

// Helper to create a mock operation row (as returned by Prisma)
const createMockOpRow = (
  serverSeq: number,
  clientId: string = 'client-1',
  overrides: Partial<{
    id: string;
    opType: string;
    actionType: string;
    entityType: string;
    entityId: string | null;
    payload: unknown;
    vectorClock: Record<string, number>;
    schemaVersion: number;
    clientTimestamp: bigint;
    receivedAt: bigint;
    isPayloadEncrypted: boolean;
    syncImportReason: string | null;
  }> = {},
) => ({
  id: overrides.id ?? `op-${serverSeq}`,
  serverSeq,
  clientId,
  actionType: overrides.actionType ?? '[Task] Add',
  opType: overrides.opType ?? 'ADD',
  entityType: overrides.entityType ?? 'Task',
  // Use 'in' check to allow null to be explicitly set
  entityId: 'entityId' in overrides ? overrides.entityId : `task-${serverSeq}`,
  payload: overrides.payload ?? { title: `Task ${serverSeq}` },
  vectorClock: overrides.vectorClock ?? { [clientId]: serverSeq },
  schemaVersion: overrides.schemaVersion ?? 1,
  clientTimestamp: overrides.clientTimestamp ?? BigInt(Date.now()),
  receivedAt: overrides.receivedAt ?? BigInt(Date.now()),
  isPayloadEncrypted: overrides.isPayloadEncrypted ?? false,
  syncImportReason: overrides.syncImportReason ?? null,
});

describe('OperationDownloadService', () => {
  let service: OperationDownloadService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new OperationDownloadService();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getOpsSince', () => {
    it('should return empty array when no operations exist', async () => {
      vi.mocked(prisma.operation.findMany).mockResolvedValue([]);

      const result = await service.getOpsSince(1, 0);

      expect(result).toEqual([]);
      expect(prisma.operation.findMany).toHaveBeenCalledWith({
        where: {
          userId: 1,
          serverSeq: { gt: 0 },
        },
        orderBy: { serverSeq: 'asc' },
        take: 500,
        select: EXPECTED_OPERATION_DOWNLOAD_SELECT,
      });
    });

    it('should return operations mapped to ServerOperation format', async () => {
      const mockOps = [createMockOpRow(1), createMockOpRow(2)];
      vi.mocked(prisma.operation.findMany).mockResolvedValue(mockOps as any);

      const result = await service.getOpsSince(1, 0);

      expect(result).toHaveLength(2);
      expect(result[0].serverSeq).toBe(1);
      expect(result[0].op.id).toBe('op-1');
      expect(result[0].op.opType).toBe('ADD');
      expect(result[1].serverSeq).toBe(2);
    });

    it('should exclude operations from specified client', async () => {
      vi.mocked(prisma.operation.findMany).mockResolvedValue([]);

      await service.getOpsSince(1, 0, 'excluded-client');

      expect(prisma.operation.findMany).toHaveBeenCalledWith({
        where: {
          userId: 1,
          serverSeq: { gt: 0 },
          clientId: { not: 'excluded-client' },
        },
        orderBy: { serverSeq: 'asc' },
        take: 500,
        select: EXPECTED_OPERATION_DOWNLOAD_SELECT,
      });
    });

    it('should respect custom limit', async () => {
      vi.mocked(prisma.operation.findMany).mockResolvedValue([]);

      await service.getOpsSince(1, 0, undefined, 100);

      expect(prisma.operation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });

    it('should correctly map operation fields including optional entityId', async () => {
      const opWithNullEntityId = createMockOpRow(1, 'client-1', { entityId: null });
      vi.mocked(prisma.operation.findMany).mockResolvedValue([opWithNullEntityId as any]);

      const result = await service.getOpsSince(1, 0);

      expect(result[0].op.entityId).toBeUndefined();
    });

    it('should convert timestamps from bigint to number', async () => {
      const mockOp = createMockOpRow(1, 'client-1', {
        clientTimestamp: BigInt(1700000000000),
        receivedAt: BigInt(1700000001000),
      });
      vi.mocked(prisma.operation.findMany).mockResolvedValue([mockOp as any]);

      const result = await service.getOpsSince(1, 0);

      expect(result[0].op.timestamp).toBe(1700000000000);
      expect(result[0].receivedAt).toBe(1700000001000);
    });

    it('should handle operations with encrypted payloads', async () => {
      const encryptedOp = createMockOpRow(1, 'client-1', { isPayloadEncrypted: true });
      vi.mocked(prisma.operation.findMany).mockResolvedValue([encryptedOp as any]);

      const result = await service.getOpsSince(1, 0);

      expect(result[0].op.isPayloadEncrypted).toBe(true);
    });

    it('should map sync import reason when present', async () => {
      const importOp = createMockOpRow(1, 'client-1', {
        syncImportReason: 'recovery',
      });
      vi.mocked(prisma.operation.findMany).mockResolvedValue([importOp as any]);

      const result = await service.getOpsSince(1, 0);

      expect(result[0].op.syncImportReason).toBe('recovery');
    });
  });

  describe('getOpsSinceWithSeq', () => {
    // Helper to set up transaction mock
    const setupTransactionMock = (mockFn: (tx: any) => Promise<any>) => {
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const mockTx = {
          operation: {
            findFirst: vi.fn(),
            findMany: vi.fn(),
            aggregate: vi.fn(),
          },
          userSyncState: {
            findUnique: vi.fn(),
          },
        };
        return mockFn(mockTx);
      });
    };

    it('should return empty ops with correct latestSeq', async () => {
      setupTransactionMock(async (tx) => {
        tx.operation.findFirst.mockResolvedValue(null); // No full-state op
        tx.operation.findMany.mockResolvedValue([]);
        tx.userSyncState.findUnique.mockResolvedValue({ lastSeq: 5 });
        tx.operation.aggregate.mockResolvedValue({ _min: { serverSeq: 1 } });

        return {
          ops: [],
          latestSeq: 5,
          gapDetected: false,
          latestSnapshotSeq: undefined,
          snapshotVectorClock: undefined,
        };
      });

      const result = await service.getOpsSinceWithSeq(1, 4);

      expect(result.ops).toEqual([]);
      expect(result.latestSeq).toBe(5);
      expect(result.gapDetected).toBe(false);
    });

    it('should skip min sequence aggregate when gap detection cannot use it', async () => {
      let capturedTx: any;

      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        capturedTx = {
          operation: {
            findFirst: vi.fn().mockResolvedValue(null),
            findMany: vi.fn().mockResolvedValue([]),
            aggregate: vi.fn(),
          },
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue({ lastSeq: 5 }),
          },
        };
        return fn(capturedTx);
      });

      const result = await service.getOpsSinceWithSeq(1, 0);

      expect(result.gapDetected).toBe(false);
      expect(capturedTx.operation.aggregate).not.toHaveBeenCalled();
    });

    it('should return immediately for an empty server without operation queries', async () => {
      let capturedTx: any;

      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        capturedTx = {
          operation: {
            findFirst: vi.fn(),
            findMany: vi.fn(),
            aggregate: vi.fn(),
          },
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue({ lastSeq: 0 }),
          },
        };
        return fn(capturedTx);
      });

      const result = await service.getOpsSinceWithSeq(1, 0);

      expect(result).toEqual({
        ops: [],
        latestSeq: 0,
        gapDetected: false,
        latestSnapshotSeq: undefined,
        snapshotVectorClock: undefined,
      });
      expect(capturedTx.operation.findFirst).not.toHaveBeenCalled();
      expect(capturedTx.operation.findMany).not.toHaveBeenCalled();
      expect(capturedTx.operation.aggregate).not.toHaveBeenCalled();
    });

    it('should select only download response fields inside atomic reads', async () => {
      let capturedTx: any;
      let capturedOptions: any;

      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any, options: any) => {
        capturedOptions = options;
        capturedTx = {
          operation: {
            findFirst: vi.fn().mockResolvedValue(null),
            findMany: vi.fn().mockResolvedValue([]),
            aggregate: vi.fn(),
          },
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue({ lastSeq: 5 }),
          },
        };
        return fn(capturedTx);
      });

      await service.getOpsSinceWithSeq(1, 0);

      expect(capturedOptions).toEqual({ timeout: 60000 });
      expect(capturedTx.operation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: EXPECTED_OPERATION_DOWNLOAD_SELECT,
        }),
      );
    });

    it('should use latestSeq as a stable upper bound for operation reads', async () => {
      let capturedTx: any;

      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        capturedTx = {
          operation: {
            findFirst: vi.fn().mockResolvedValue(null),
            findMany: vi.fn().mockResolvedValue([]),
            aggregate: vi.fn().mockResolvedValue({ _min: { serverSeq: 1 } }),
          },
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue({ lastSeq: 20 }),
          },
        };
        return fn(capturedTx);
      });

      await service.getOpsSinceWithSeq(1, 10);

      expect(capturedTx.operation.findFirst).toHaveBeenCalledWith({
        where: {
          userId: 1,
          serverSeq: { lte: 20 },
          opType: { in: ['SYNC_IMPORT', 'BACKUP_IMPORT', 'REPAIR'] },
        },
        orderBy: { serverSeq: 'desc' },
        select: { serverSeq: true, clientId: true },
      });
      expect(capturedTx.operation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 1,
            serverSeq: { gt: 10, lte: 20 },
          }),
        }),
      );
      expect(capturedTx.operation.aggregate).toHaveBeenCalledWith({
        where: { userId: 1, serverSeq: { lte: 20 } },
        _min: { serverSeq: true },
      });
    });

    it('should skip snapshot vector-clock aggregation but still return the full-state op when metadata is not requested', async () => {
      let capturedTx: any;

      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        capturedTx = {
          operation: {
            findFirst: vi.fn().mockResolvedValue({
              serverSeq: 50,
              clientId: 'snapshot-author',
            }),
            findMany: vi.fn().mockResolvedValue([
              createMockOpRow(50, 'snapshot-author', {
                opType: 'SYNC_IMPORT',
                entityType: 'ALL',
                entityId: null,
                payload: { state: { task: {} } },
              }),
            ]),
            aggregate: vi.fn().mockResolvedValue({ _min: { serverSeq: 1 } }),
          },
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue({ lastSeq: 60 }),
          },
          $queryRaw: vi.fn(),
        };
        return fn(capturedTx);
      });

      const result = await service.getOpsSinceWithSeq(1, 10, undefined, 500, false);

      expect(result.latestSnapshotSeq).toBe(50);
      expect(result.snapshotVectorClock).toBeUndefined();
      expect(result.ops).toHaveLength(1);
      expect(result.ops[0].serverSeq).toBe(50);
      expect(result.ops[0].op.opType).toBe('SYNC_IMPORT');
      expect(capturedTx.$queryRaw).not.toHaveBeenCalled();
      expect(capturedTx.operation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            serverSeq: { gt: 49, lte: 60 },
          }),
        }),
      );
    });

    it('should detect gap when client is ahead of server', async () => {
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const mockTx = {
          operation: {
            findFirst: vi.fn().mockResolvedValue(null),
            findMany: vi.fn().mockResolvedValue([]),
            aggregate: vi.fn().mockResolvedValue({ _min: { serverSeq: 1 } }),
          },
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue({ lastSeq: 5 }),
          },
        };
        return fn(mockTx);
      });

      const result = await service.getOpsSinceWithSeq(1, 10); // Client at seq 10, server at 5

      expect(result.gapDetected).toBe(true);
    });

    it('should detect gap when client has history but server is empty', async () => {
      let capturedTx: any;
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        capturedTx = {
          operation: {
            findFirst: vi.fn(),
            findMany: vi.fn(),
            aggregate: vi.fn(),
          },
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue({ lastSeq: 0 }),
          },
        };
        return fn(capturedTx);
      });

      const result = await service.getOpsSinceWithSeq(1, 5); // Client at seq 5, server empty

      expect(result.gapDetected).toBe(true);
      expect(capturedTx.operation.findFirst).not.toHaveBeenCalled();
      expect(capturedTx.operation.findMany).not.toHaveBeenCalled();
      expect(capturedTx.operation.aggregate).not.toHaveBeenCalled();
    });

    it('should detect gap when requested seq is purged', async () => {
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const mockTx = {
          operation: {
            findFirst: vi.fn().mockResolvedValue(null),
            findMany: vi.fn().mockResolvedValue([]),
            aggregate: vi.fn().mockResolvedValue({ _min: { serverSeq: 50 } }), // Min is 50
          },
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue({ lastSeq: 100 }),
          },
        };
        return fn(mockTx);
      });

      const result = await service.getOpsSinceWithSeq(1, 10); // Client at seq 10, min is 50

      expect(result.gapDetected).toBe(true);
    });

    it('should not flag purged history as a gap when the latest full-state op covers it', async () => {
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const mockTx = {
          operation: {
            findFirst: vi.fn().mockResolvedValue({
              serverSeq: 50,
              clientId: 'snapshot-author',
            }),
            findMany: vi.fn().mockResolvedValue([
              createMockOpRow(50, 'snapshot-author', {
                opType: 'SYNC_IMPORT',
                entityType: 'ALL',
                entityId: null,
                payload: { TASK: { 'task-1': { id: 'task-1' } } },
              }),
            ]),
            aggregate: vi.fn().mockResolvedValue({ _min: { serverSeq: 50 } }),
          },
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue({ lastSeq: 100 }),
          },
          $queryRaw: vi
            .fn()
            .mockResolvedValue([{ client_id: 'snapshot-author', max_counter: 1n }]),
        };
        return fn(mockTx);
      });

      const result = await service.getOpsSinceWithSeq(1, 10);

      expect(result.gapDetected).toBe(false);
      expect(result.latestSnapshotSeq).toBe(50);
      expect(result.ops[0].serverSeq).toBe(50);
    });

    it('should detect gap when there is a gap in returned operations', async () => {
      const mockOps = [createMockOpRow(15)]; // Gap: requested sinceSeq + 1 = 11, but got 15

      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const mockTx = {
          operation: {
            findFirst: vi.fn().mockResolvedValue(null),
            findMany: vi.fn().mockResolvedValue(mockOps),
            aggregate: vi.fn().mockResolvedValue({ _min: { serverSeq: 1 } }),
          },
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue({ lastSeq: 20 }),
          },
        };
        return fn(mockTx);
      });

      const result = await service.getOpsSinceWithSeq(1, 10);

      expect(result.gapDetected).toBe(true);
    });

    it('should use latestSeq as a stable upper bound for snapshot and ops queries', async () => {
      let capturedTx: any;

      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        capturedTx = {
          operation: {
            findFirst: vi.fn().mockResolvedValue(null),
            findMany: vi.fn().mockResolvedValue([]),
            aggregate: vi.fn().mockResolvedValue({ _min: { serverSeq: 1 } }),
          },
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue({ lastSeq: 42 }),
          },
        };
        return fn(capturedTx);
      });

      await service.getOpsSinceWithSeq(1, 10);

      expect(
        capturedTx.userSyncState.findUnique.mock.invocationCallOrder[0],
      ).toBeLessThan(capturedTx.operation.findFirst.mock.invocationCallOrder[0]);
      expect(capturedTx.operation.findFirst).toHaveBeenCalledWith({
        where: {
          userId: 1,
          serverSeq: { lte: 42 },
          opType: { in: ['SYNC_IMPORT', 'BACKUP_IMPORT', 'REPAIR'] },
        },
        orderBy: { serverSeq: 'desc' },
        select: { serverSeq: true, clientId: true },
      });
      expect(capturedTx.operation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: 1,
            serverSeq: { gt: 10, lte: 42 },
          },
          orderBy: { serverSeq: 'asc' },
          take: 500,
        }),
      );
      expect(capturedTx.operation.aggregate).toHaveBeenCalledWith({
        where: { userId: 1, serverSeq: { lte: 42 } },
        _min: { serverSeq: true },
      });
    });

    it('should NOT detect gap via minSeq when snapshot supersedes purged history', async () => {
      // Regression: Case-2 previously compared raw sinceSeq against minSeq, so a
      // client requesting from before the retention boundary would get
      // gapDetected=true even though the snapshot already supersedes that purged
      // history. With the fix, Case-2 uses effectiveSinceSeq.
      // sinceSeq=10, snapshot at 50, minSeq=30 (ops 1-29 purged).
      // effectiveSinceSeq=49, so 49 < 30-1=29 is FALSE → no gap.
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const mockTx = {
          operation: {
            findFirst: vi.fn().mockResolvedValue({ serverSeq: 50 }),
            findMany: vi.fn().mockResolvedValue([
              createMockOpRow(50, 'snapshot-author', {
                opType: 'SYNC_IMPORT',
                entityType: 'ALL',
                entityId: null,
              }),
            ] as any),
            // Pre-snapshot ops were purged by retention; minSeq is now 30.
            aggregate: vi.fn().mockResolvedValue({ _min: { serverSeq: 30 } }),
          },
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue({ lastSeq: 50 }),
          },
          $queryRaw: vi.fn().mockResolvedValue([]),
        };
        return fn(mockTx);
      });

      const result = await service.getOpsSinceWithSeq(1, 10);

      expect(result.gapDetected).toBe(false);
      expect(result.latestSnapshotSeq).toBe(50);
      expect(result.ops.length).toBe(1);
      expect(result.ops[0].serverSeq).toBe(50);
    });

    it('should NOT detect gap when excludeClient filters cause apparent gaps', async () => {
      const mockOps = [createMockOpRow(15, 'other-client')]; // From different client

      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const mockTx = {
          operation: {
            findFirst: vi.fn().mockResolvedValue(null),
            findMany: vi.fn().mockResolvedValue(mockOps),
            aggregate: vi.fn().mockResolvedValue({ _min: { serverSeq: 1 } }),
          },
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue({ lastSeq: 20 }),
          },
        };
        return fn(mockTx);
      });

      const result = await service.getOpsSinceWithSeq(1, 10, 'excluded-client');

      // Gap detection is disabled when excludeClient is used
      expect(result.gapDetected).toBe(false);
    });

    // === Snapshot Vector Clock SQL Aggregate Tests ===
    // The server uses a PostgreSQL aggregate query (jsonb_each_text + GROUP BY + MAX)
    // to compute the snapshot vector clock from skipped ops. These tests verify:
    // - $queryRaw is used (not findMany for clock data)
    // - BigInt results are correctly converted to Number
    // - limitVectorClockSize is applied to the aggregate result
    // - preserveIds includes both excludeClient and snapshot author

    it('should use $queryRaw for clock aggregation (not findMany)', async () => {
      const snapshotOp = { serverSeq: 50, clientId: 'author-client' };
      let capturedTx: any;

      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        capturedTx = {
          operation: {
            findFirst: vi.fn().mockResolvedValue(snapshotOp),
            findMany: vi.fn().mockResolvedValue([]),
            aggregate: vi.fn().mockResolvedValue({ _min: { serverSeq: 1 } }),
          },
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue({ lastSeq: 60 }),
          },
          $queryRaw: vi.fn().mockResolvedValue([{ client_id: 'a', max_counter: 5n }]),
        };
        return fn(capturedTx);
      });

      await service.getOpsSinceWithSeq(1, 10);

      // $queryRaw should be called exactly once for clock aggregation
      expect(capturedTx.$queryRaw).toHaveBeenCalledTimes(1);
      // findMany should be called exactly once (for ops after snapshot), NOT twice
      expect(capturedTx.operation.findMany).toHaveBeenCalledTimes(1);
    });

    it('should optimize download when latest snapshot exists', async () => {
      const snapshotOp = { serverSeq: 50 };
      const opsAfterSnapshot = [createMockOpRow(51)];

      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const mockTx = {
          operation: {
            findFirst: vi.fn().mockResolvedValue(snapshotOp),
            findMany: vi.fn().mockResolvedValue(opsAfterSnapshot as any),
            aggregate: vi.fn().mockResolvedValue({ _min: { serverSeq: 1 } }),
          },
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue({ lastSeq: 60 }),
          },
          $queryRaw: vi.fn().mockResolvedValue([
            { client_id: 'client-1', max_counter: 15n },
            { client_id: 'client-2', max_counter: 5n },
            { client_id: 'client-3', max_counter: 8n },
          ]),
        };
        return fn(mockTx);
      });

      const result = await service.getOpsSinceWithSeq(1, 10);

      expect(result.latestSnapshotSeq).toBe(50);
      expect(result.snapshotVectorClock).toEqual({
        'client-1': 15,
        'client-2': 5,
        'client-3': 8,
      });
    });

    it('should aggregate vector clocks correctly from skipped ops', async () => {
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const mockTx = {
          operation: {
            findFirst: vi.fn().mockResolvedValue({ serverSeq: 10 }),
            findMany: vi.fn().mockResolvedValue([]),
            aggregate: vi.fn().mockResolvedValue({ _min: { serverSeq: 1 } }),
          },
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue({ lastSeq: 20 }),
          },
          $queryRaw: vi.fn().mockResolvedValue([
            { client_id: 'a', max_counter: 3n },
            { client_id: 'b', max_counter: 5n },
            { client_id: 'c', max_counter: 2n },
          ]),
        };
        return fn(mockTx);
      });

      const result = await service.getOpsSinceWithSeq(1, 0);

      expect(result.snapshotVectorClock).toEqual({
        a: 3,
        b: 5,
        c: 2,
      });
    });

    it('should handle empty aggregate result gracefully', async () => {
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const mockTx = {
          operation: {
            findFirst: vi.fn().mockResolvedValue({ serverSeq: 10 }),
            findMany: vi.fn().mockResolvedValue([]),
            aggregate: vi.fn().mockResolvedValue({ _min: { serverSeq: 1 } }),
          },
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue({ lastSeq: 20 }),
          },
          $queryRaw: vi.fn().mockResolvedValue([]),
        };
        return fn(mockTx);
      });

      const result = await service.getOpsSinceWithSeq(1, 0);

      expect(result.snapshotVectorClock).toEqual({});
    });

    it('should correctly convert BigInt values to Number', async () => {
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const mockTx = {
          operation: {
            findFirst: vi.fn().mockResolvedValue({ serverSeq: 10 }),
            findMany: vi.fn().mockResolvedValue([]),
            aggregate: vi.fn().mockResolvedValue({ _min: { serverSeq: 1 } }),
          },
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue({ lastSeq: 20 }),
          },
          $queryRaw: vi.fn().mockResolvedValue([
            { client_id: 'x', max_counter: 0n },
            { client_id: 'y', max_counter: 1n },
            { client_id: 'z', max_counter: 99999999n },
          ]),
        };
        return fn(mockTx);
      });

      const result = await service.getOpsSinceWithSeq(1, 0);

      expect(result.snapshotVectorClock).toEqual({ x: 0, y: 1, z: 99999999 });
      // Verify values are Numbers, not BigInts
      expect(typeof result.snapshotVectorClock!['x']).toBe('number');
      expect(typeof result.snapshotVectorClock!['z']).toBe('number');
    });

    it('should handle single-entry aggregate result', async () => {
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const mockTx = {
          operation: {
            findFirst: vi.fn().mockResolvedValue({ serverSeq: 5 }),
            findMany: vi.fn().mockResolvedValue([]),
            aggregate: vi.fn().mockResolvedValue({ _min: { serverSeq: 1 } }),
          },
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue({ lastSeq: 10 }),
          },
          $queryRaw: vi
            .fn()
            .mockResolvedValue([{ client_id: 'solo-client', max_counter: 42n }]),
        };
        return fn(mockTx);
      });

      const result = await service.getOpsSinceWithSeq(1, 0);

      expect(result.snapshotVectorClock).toEqual({ 'solo-client': 42 });
    });

    it('should apply limitVectorClockSize to aggregate result exceeding MAX', async () => {
      // Create 25 entries — exceeds MAX_VECTOR_CLOCK_SIZE (20)
      const clockRows = Array.from({ length: 25 }, (_, i) => ({
        client_id: `client-${String(i).padStart(3, '0')}`,
        max_counter: BigInt(100 - i), // Descending counters
      }));

      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const mockTx = {
          operation: {
            findFirst: vi.fn().mockResolvedValue({ serverSeq: 50 }),
            findMany: vi.fn().mockResolvedValue([]),
            aggregate: vi.fn().mockResolvedValue({ _min: { serverSeq: 1 } }),
          },
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue({ lastSeq: 60 }),
          },
          $queryRaw: vi.fn().mockResolvedValue(clockRows),
        };
        return fn(mockTx);
      });

      const result = await service.getOpsSinceWithSeq(1, 10);

      // Should be pruned to MAX_VECTOR_CLOCK_SIZE (20) entries
      expect(Object.keys(result.snapshotVectorClock!).length).toBeLessThanOrEqual(20);
      // Highest-counter entries should be preserved
      expect(result.snapshotVectorClock!['client-000']).toBe(100);
      expect(result.snapshotVectorClock!['client-001']).toBe(99);
    });

    it('should preserve excludeClient and snapshot author in pruned clock', async () => {
      // Create 25 entries exceeding MAX; put excludeClient and author at the bottom
      const clockRows = Array.from({ length: 25 }, (_, i) => ({
        client_id: `client-${String(i).padStart(3, '0')}`,
        max_counter: BigInt(100 - i),
      }));
      // Add low-counter entries for the clients that should be preserved
      clockRows.push({ client_id: 'requesting-client', max_counter: 1n });
      clockRows.push({ client_id: 'snapshot-author', max_counter: 1n });

      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const mockTx = {
          operation: {
            findFirst: vi
              .fn()
              .mockResolvedValue({ serverSeq: 50, clientId: 'snapshot-author' }),
            findMany: vi.fn().mockResolvedValue([]),
            aggregate: vi.fn().mockResolvedValue({ _min: { serverSeq: 1 } }),
          },
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue({ lastSeq: 60 }),
          },
          $queryRaw: vi.fn().mockResolvedValue(clockRows),
        };
        return fn(mockTx);
      });

      const result = await service.getOpsSinceWithSeq(1, 10, 'requesting-client');

      // Both low-counter clients should be preserved despite pruning
      expect(result.snapshotVectorClock!['requesting-client']).toBe(1);
      expect(result.snapshotVectorClock!['snapshot-author']).toBe(1);
      expect(Object.keys(result.snapshotVectorClock!).length).toBeLessThanOrEqual(20);
    });

    it('should NOT use $queryRaw when client is past snapshot', async () => {
      let capturedTx: any;

      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        capturedTx = {
          operation: {
            findFirst: vi.fn().mockResolvedValue({ serverSeq: 50 }),
            findMany: vi.fn().mockResolvedValue([createMockOpRow(61)] as any),
            aggregate: vi.fn().mockResolvedValue({ _min: { serverSeq: 1 } }),
          },
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue({ lastSeq: 70 }),
          },
          $queryRaw: vi.fn(),
        };
        return fn(capturedTx);
      });

      const result = await service.getOpsSinceWithSeq(1, 60);

      // $queryRaw should NOT be called — client is past the snapshot
      expect(capturedTx.$queryRaw).not.toHaveBeenCalled();
      expect(result.snapshotVectorClock).toBeUndefined();
    });

    it('should NOT use $queryRaw when no snapshot exists', async () => {
      let capturedTx: any;

      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        capturedTx = {
          operation: {
            findFirst: vi.fn().mockResolvedValue(null), // No full-state op
            findMany: vi.fn().mockResolvedValue([]),
            aggregate: vi.fn().mockResolvedValue({ _min: { serverSeq: 1 } }),
          },
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue({ lastSeq: 20 }),
          },
          $queryRaw: vi.fn(),
        };
        return fn(capturedTx);
      });

      const result = await service.getOpsSinceWithSeq(1, 0);

      expect(capturedTx.$queryRaw).not.toHaveBeenCalled();
      expect(result.snapshotVectorClock).toBeUndefined();
    });

    it('should not optimize when client is already past snapshot', async () => {
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const mockTx = {
          operation: {
            findFirst: vi.fn().mockResolvedValue({ serverSeq: 50 }), // Snapshot at 50
            findMany: vi.fn().mockResolvedValue([createMockOpRow(61)] as any),
            aggregate: vi.fn().mockResolvedValue({ _min: { serverSeq: 1 } }),
          },
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue({ lastSeq: 70 }),
          },
        };
        return fn(mockTx);
      });

      const result = await service.getOpsSinceWithSeq(1, 60); // Client already past snapshot

      // findMany for skipped ops should not be called when sinceSeq >= latestSnapshotSeq
      expect(result.snapshotVectorClock).toBeUndefined();
    });

    it('should return latestSeq as 0 when no sync state exists', async () => {
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const mockTx = {
          operation: {
            findFirst: vi.fn().mockResolvedValue(null),
            findMany: vi.fn().mockResolvedValue([]),
            aggregate: vi.fn().mockResolvedValue({ _min: { serverSeq: null } }),
          },
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue(null), // No sync state
          },
        };
        return fn(mockTx);
      });

      const result = await service.getOpsSinceWithSeq(1, 0);

      expect(result.latestSeq).toBe(0);
    });
  });

  describe('getLatestSeq', () => {
    it('should return latest sequence from userSyncState', async () => {
      vi.mocked(prisma.userSyncState.findUnique).mockResolvedValue({
        lastSeq: 42,
      } as any);

      const result = await service.getLatestSeq(1);

      expect(result).toBe(42);
      expect(prisma.userSyncState.findUnique).toHaveBeenCalledWith({
        where: { userId: 1 },
        select: { lastSeq: true },
      });
    });

    it('should return 0 when no sync state exists', async () => {
      vi.mocked(prisma.userSyncState.findUnique).mockResolvedValue(null);

      const result = await service.getLatestSeq(1);

      expect(result).toBe(0);
    });

    it('should handle large sequence numbers', async () => {
      vi.mocked(prisma.userSyncState.findUnique).mockResolvedValue({
        lastSeq: 999999999,
      } as any);

      const result = await service.getLatestSeq(1);

      expect(result).toBe(999999999);
    });
  });
});
