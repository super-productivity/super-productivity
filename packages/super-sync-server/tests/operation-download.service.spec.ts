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
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const mockTx = {
          operation: {
            findFirst: vi.fn().mockResolvedValue(null),
            findMany: vi.fn().mockResolvedValue([]),
            aggregate: vi.fn().mockResolvedValue({ _min: { serverSeq: null } }),
          },
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue({ lastSeq: 0 }),
          },
        };
        return fn(mockTx);
      });

      const result = await service.getOpsSinceWithSeq(1, 5); // Client at seq 5, server empty

      expect(result.gapDetected).toBe(true);
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

    it('should optimize download when latest snapshot exists', async () => {
      const snapshotOp = { serverSeq: 50 };
      const skippedOps = [
        { vectorClock: { 'client-1': 10, 'client-2': 5 } },
        { vectorClock: { 'client-1': 15, 'client-3': 8 } },
      ];
      const opsAfterSnapshot = [createMockOpRow(51)];

      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const mockTx = {
          operation: {
            findFirst: vi.fn().mockResolvedValue(snapshotOp), // Latest SYNC_IMPORT at seq 50
            findMany: vi
              .fn()
              .mockResolvedValueOnce(skippedOps) // Skipped ops for vector clock
              .mockResolvedValueOnce(opsAfterSnapshot as any), // Actual ops to return
            aggregate: vi.fn().mockResolvedValue({ _min: { serverSeq: 1 } }),
          },
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue({ lastSeq: 60 }),
          },
        };
        return fn(mockTx);
      });

      const result = await service.getOpsSinceWithSeq(1, 10); // Client at seq 10, snapshot at 50

      expect(result.latestSnapshotSeq).toBe(50);
      expect(result.snapshotVectorClock).toEqual({
        'client-1': 15, // Max of 10 and 15
        'client-2': 5,
        'client-3': 8,
      });
    });

    it('should aggregate vector clocks correctly from skipped ops', async () => {
      const skippedOps = [
        { vectorClock: { a: 1, b: 2 } },
        { vectorClock: { a: 3, c: 1 } },
        { vectorClock: { b: 5, c: 2 } },
      ];

      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const mockTx = {
          operation: {
            findFirst: vi.fn().mockResolvedValue({ serverSeq: 10 }),
            findMany: vi.fn().mockResolvedValueOnce(skippedOps).mockResolvedValueOnce([]),
            aggregate: vi.fn().mockResolvedValue({ _min: { serverSeq: 1 } }),
          },
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue({ lastSeq: 20 }),
          },
        };
        return fn(mockTx);
      });

      const result = await service.getOpsSinceWithSeq(1, 0);

      expect(result.snapshotVectorClock).toEqual({
        a: 3, // Max of 1 and 3
        b: 5, // Max of 2 and 5
        c: 2, // Max of 1 and 2
      });
    });

    it('should handle malformed vector clocks gracefully', async () => {
      const skippedOps = [
        { vectorClock: { a: 1 } },
        { vectorClock: null }, // Invalid
        { vectorClock: 'not an object' }, // Invalid
        { vectorClock: { b: 'not a number', c: 2 } }, // Partially invalid
      ];

      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const mockTx = {
          operation: {
            findFirst: vi.fn().mockResolvedValue({ serverSeq: 10 }),
            findMany: vi.fn().mockResolvedValueOnce(skippedOps).mockResolvedValueOnce([]),
            aggregate: vi.fn().mockResolvedValue({ _min: { serverSeq: 1 } }),
          },
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue({ lastSeq: 20 }),
          },
        };
        return fn(mockTx);
      });

      const result = await service.getOpsSinceWithSeq(1, 0);

      // Should only include valid entries
      expect(result.snapshotVectorClock).toEqual({
        a: 1,
        c: 2, // String 'not a number' is skipped
      });
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
