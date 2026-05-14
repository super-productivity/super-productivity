import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  SnapshotService,
  EncryptedOpsNotSupportedError,
} from '../src/sync/services/snapshot.service';
import * as zlib from 'zlib';

// Mock prisma
vi.mock('../src/db', () => ({
  prisma: {
    userSyncState: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
      upsert: vi.fn(),
    },
    operation: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
    },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));

import { prisma } from '../src/db';

const EXPECTED_REPLAY_OPERATION_SELECT = {
  id: true,
  serverSeq: true,
  opType: true,
  entityType: true,
  entityId: true,
  payload: true,
  schemaVersion: true,
  isPayloadEncrypted: true,
};

describe('SnapshotService', () => {
  let service: SnapshotService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ bytes: 0 }] as any);
    service = new SnapshotService();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getCachedSnapshot', () => {
    it('should return null when no snapshot exists', async () => {
      vi.mocked(prisma.userSyncState.findUnique).mockResolvedValue(null);

      const result = await service.getCachedSnapshot(1);

      expect(result).toBeNull();
    });

    it('should return null when snapshotData is null', async () => {
      vi.mocked(prisma.userSyncState.findUnique).mockResolvedValue({
        snapshotData: null,
        lastSnapshotSeq: 10,
        snapshotAt: BigInt(Date.now()),
        snapshotSchemaVersion: 1,
      } as any);

      const result = await service.getCachedSnapshot(1);

      expect(result).toBeNull();
    });

    it('should decompress and return cached snapshot', async () => {
      const state = { TASK: { 'task-1': { id: 'task-1', title: 'Test' } } };
      const compressed = zlib.gzipSync(JSON.stringify(state));
      const snapshotAt = BigInt(Date.now());

      vi.mocked(prisma.userSyncState.findUnique).mockResolvedValue({
        snapshotData: compressed,
        lastSnapshotSeq: 10,
        snapshotAt,
        snapshotSchemaVersion: 1,
      } as any);

      const result = await service.getCachedSnapshot(1);

      expect(result).toEqual({
        state,
        serverSeq: 10,
        generatedAt: Number(snapshotAt),
        schemaVersion: 1,
      });
    });

    it('should return null and invalidate the cached blob on decompression error', async () => {
      vi.mocked(prisma.userSyncState.findUnique).mockResolvedValue({
        snapshotData: Buffer.from('not-compressed-data'),
        lastSnapshotSeq: 10,
        snapshotAt: BigInt(Date.now()),
        snapshotSchemaVersion: 1,
      } as any);
      vi.mocked(prisma.userSyncState.update).mockResolvedValue({} as any);

      const result = await service.getCachedSnapshot(1);

      expect(result).toBeNull();
      expect(prisma.userSyncState.update).toHaveBeenCalledWith({
        where: { userId: 1 },
        data: {
          snapshotData: null,
          lastSnapshotSeq: null,
          snapshotAt: null,
          snapshotSchemaVersion: null,
        },
      });
    });
  });

  describe('getCachedSnapshotGeneratedAt', () => {
    it('should return null when no cached snapshot metadata exists', async () => {
      vi.mocked(prisma.userSyncState.findUnique).mockResolvedValue(null);

      const result = await service.getCachedSnapshotGeneratedAt(1);

      expect(result).toBeNull();
    });

    it('should read only snapshot metadata', async () => {
      const snapshotAt = BigInt(1700000000000);
      vi.mocked(prisma.userSyncState.findUnique).mockResolvedValue({
        snapshotAt,
      } as any);

      const result = await service.getCachedSnapshotGeneratedAt(1);

      expect(result).toBe(Number(snapshotAt));
      expect(prisma.userSyncState.findUnique).toHaveBeenCalledWith({
        where: { userId: 1 },
        select: { snapshotAt: true },
      });
    });
  });

  describe('cacheSnapshot', () => {
    it('should compress and conditionally update an existing row', async () => {
      vi.useFakeTimers();
      const now = 1700000000000;
      vi.setSystemTime(now);

      const state = { TASK: { 'task-1': { id: 'task-1' } } };
      vi.mocked(prisma.userSyncState.updateMany).mockResolvedValue({ count: 1 } as any);

      const result = await service.cacheSnapshot(1, state, 10);

      expect(prisma.userSyncState.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 1,
          OR: [{ lastSnapshotSeq: null }, { lastSnapshotSeq: { lt: 10 } }],
        },
        data: {
          snapshotData: expect.any(Buffer),
          lastSnapshotSeq: 10,
          snapshotAt: BigInt(now),
          snapshotSchemaVersion: expect.any(Number),
        },
      });
      expect(result.cached).toBe(true);
      expect(result.previousBytes).toBe(0);
      expect(result.bytesWritten).toBeGreaterThan(0);
      expect(result.deltaBytes).toBe(result.bytesWritten);
      expect(prisma.userSyncState.create).not.toHaveBeenCalled();
    });

    it('should report replacement byte delta when caching snapshot', async () => {
      vi.useFakeTimers();
      const now = 1700000000000;
      vi.setSystemTime(now);

      const preparedSnapshot = {
        data: Buffer.from('prepared-cache'),
        bytes: 14,
        stateBytes: 42,
        cacheable: true,
      };
      vi.mocked(prisma.$queryRaw).mockResolvedValue([{ bytes: BigInt(5) }] as any);
      vi.mocked(prisma.userSyncState.updateMany).mockResolvedValue({ count: 1 } as any);

      const result = await service.cacheSnapshot(
        1,
        { ignored: true },
        10,
        preparedSnapshot,
      );

      expect(prisma.userSyncState.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 1,
          OR: [{ lastSnapshotSeq: null }, { lastSnapshotSeq: { lt: 10 } }],
        },
        data: {
          snapshotData: preparedSnapshot.data,
          lastSnapshotSeq: 10,
          snapshotAt: BigInt(now),
          snapshotSchemaVersion: expect.any(Number),
        },
      });
      expect(result).toEqual({
        cached: true,
        bytesWritten: 14,
        previousBytes: 5,
        deltaBytes: 9,
      });
    });

    it('should create the row when no userSyncState exists (first-time user)', async () => {
      const state = { TASK: { 'task-1': { id: 'task-1' } } };
      vi.mocked(prisma.userSyncState.updateMany).mockResolvedValue({ count: 0 } as any);
      vi.mocked(prisma.userSyncState.create).mockResolvedValue({} as any);

      const result = await service.cacheSnapshot(1, state, 10);

      expect(prisma.userSyncState.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 1,
          lastSnapshotSeq: 10,
          snapshotData: expect.any(Buffer),
        }),
      });
      expect(result.cached).toBe(true);
      expect(result.bytesWritten).toBeGreaterThan(0);
    });

    it('should swallow P2002 when a concurrent writer inserted the row first', async () => {
      const state = { TASK: { 'task-1': { id: 'task-1' } } };
      vi.mocked(prisma.userSyncState.updateMany).mockResolvedValue({ count: 0 } as any);
      const p2002 = Object.assign(new Error('unique constraint'), { code: 'P2002' });
      vi.mocked(prisma.userSyncState.create).mockRejectedValue(p2002);

      const result = await service.cacheSnapshot(1, state, 10);
      expect(result).toEqual({
        cached: false,
        bytesWritten: 0,
        previousBytes: 0,
        deltaBytes: 0,
      });
    });

    it('should rethrow non-P2002 create errors', async () => {
      const state = { TASK: { 'task-1': { id: 'task-1' } } };
      vi.mocked(prisma.userSyncState.updateMany).mockResolvedValue({ count: 0 } as any);
      vi.mocked(prisma.userSyncState.create).mockRejectedValue(new Error('boom'));

      await expect(service.cacheSnapshot(1, state, 10)).rejects.toThrow('boom');
    });

    it('should be a no-op when a newer snapshot already won the race', async () => {
      // updateMany returns count=0 with an existing newer row. create then
      // throws P2002 because a row exists. Both swallowed.
      const state = { TASK: { 'task-1': { id: 'task-1' } } };
      vi.mocked(prisma.userSyncState.updateMany).mockResolvedValue({ count: 0 } as any);
      const p2002 = Object.assign(new Error('unique constraint'), { code: 'P2002' });
      vi.mocked(prisma.userSyncState.create).mockRejectedValue(p2002);

      const result = await service.cacheSnapshot(1, state, 5);
      expect(result).toEqual({
        cached: false,
        bytesWritten: 0,
        previousBytes: 0,
        deltaBytes: 0,
      });
    });

    // Skip: Testing size limit requires mocking zlib which is a native module.
    // The size check is a simple comparison and is implicitly tested by integration tests.
    it.skip('should skip caching if snapshot is too large', async () => {
      // This test is skipped because zlib cannot be easily mocked
      // The MAX_SNAPSHOT_SIZE_BYTES check is a simple comparison
    });

    it('should clear a previously-cached snapshot when the new one is oversized', async () => {
      // Regression for W11: when prepared.cacheable is false, the stale
      // snapshot row must be cleared (otherwise callers see an outdated blob
      // alongside ops the new — rejected — snapshot was supposed to cover),
      // and the negative delta must be returned so storage accounting credits
      // the freed space. Clear is race-safe (only when our serverSeq is newer
      // than what's cached) so it goes through updateMany, not update.
      const preparedTooLarge = {
        data: Buffer.alloc(1),
        bytes: 60 * 1024 * 1024,
        stateBytes: 100,
        cacheable: false,
      };
      vi.mocked(prisma.$queryRaw).mockResolvedValue([{ bytes: BigInt(8000) }] as any);
      vi.mocked(prisma.userSyncState.updateMany).mockResolvedValue({ count: 1 } as any);

      const result = await service.cacheSnapshot(
        1,
        { ignored: true },
        10,
        preparedTooLarge,
      );

      expect(prisma.userSyncState.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 1,
          OR: [{ lastSnapshotSeq: null }, { lastSnapshotSeq: { lt: 10 } }],
        },
        data: {
          snapshotData: null,
          lastSnapshotSeq: null,
          snapshotAt: null,
          snapshotSchemaVersion: null,
        },
      });
      expect(result).toEqual({
        cached: false,
        bytesWritten: 0,
        previousBytes: 8000,
        deltaBytes: -8000,
      });
    });

    it('should not touch the row when oversized and no previous snapshot exists', async () => {
      // Avoid an unnecessary UPDATE when there is nothing to clear.
      const preparedTooLarge = {
        data: Buffer.alloc(1),
        bytes: 60 * 1024 * 1024,
        stateBytes: 100,
        cacheable: false,
      };
      vi.mocked(prisma.$queryRaw).mockResolvedValue([{ bytes: BigInt(0) }] as any);
      vi.mocked(prisma.userSyncState.updateMany).mockResolvedValue({ count: 0 } as any);

      const result = await service.cacheSnapshot(
        1,
        { ignored: true },
        10,
        preparedTooLarge,
      );

      expect(prisma.userSyncState.updateMany).not.toHaveBeenCalled();
      expect(result).toEqual({
        cached: false,
        bytesWritten: 0,
        previousBytes: 0,
        deltaBytes: 0,
      });
    });
  });

  describe('cacheSnapshotIfReplayable', () => {
    it('should skip caching for encrypted payloads', async () => {
      await service.cacheSnapshotIfReplayable(1, {}, 10, true);

      expect(prisma.userSyncState.updateMany).not.toHaveBeenCalled();
      expect(prisma.userSyncState.create).not.toHaveBeenCalled();
    });

    it('should cache plaintext payloads', async () => {
      vi.mocked(prisma.userSyncState.updateMany).mockResolvedValue({ count: 1 } as any);

      await service.cacheSnapshotIfReplayable(1, { TASK: {} }, 10, false);

      expect(prisma.userSyncState.updateMany).toHaveBeenCalled();
    });
  });

  describe('generateSnapshot - first-time user (no userSyncState row)', () => {
    // Regression test for the RecordNotFound bug: when a user calls
    // generateSnapshot before any uploads, there is no userSyncState row.
    // Previously the inline `tx.userSyncState.update` threw P2025 and the
    // route returned 500. With the race-safe updateMany+create fallback the
    // path must succeed and return an empty snapshot at seq=0.
    it('should not throw RecordNotFound when no userSyncState row exists', async () => {
      const updateManySpy = vi.fn().mockResolvedValue({ count: 0 });
      const createSpy = vi.fn().mockResolvedValue({});

      vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
        const mockTx = {
          userSyncState: {
            // Both findUnique calls (lastSeq + cachedRow) return null —
            // simulating a brand-new user.
            findUnique: vi.fn().mockResolvedValue(null),
            updateMany: updateManySpy,
            create: createSpy,
          },
          operation: {
            count: vi.fn().mockResolvedValue(0),
            findFirst: vi.fn().mockResolvedValue(null),
            findMany: vi.fn().mockResolvedValue([]),
          },
        };
        return fn(mockTx as any);
      });

      const result = await service.generateSnapshot(1);

      // latestSeq=0, startSeq=0 → no replay needed but no cache either, so
      // the service runs through replay (empty loop) and still writes the
      // cache row via updateMany+create fallback.
      expect(result.serverSeq).toBe(0);
      expect(result.state).toEqual({});
      expect(createSpy).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: 1, lastSnapshotSeq: 0 }),
      });
    });

    it('cacheSnapshot via the standalone path should create the row on first-time user', async () => {
      vi.mocked(prisma.userSyncState.updateMany).mockResolvedValue({ count: 0 } as any);
      vi.mocked(prisma.userSyncState.create).mockResolvedValue({} as any);

      await service.cacheSnapshot(99, { TASK: {} }, 1);

      expect(prisma.userSyncState.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: 99, lastSnapshotSeq: 1 }),
      });
    });
  });

  describe('generateSnapshot - FIX 1.7 concurrent lock', () => {
    it('should only select replay fields needed to generate snapshots', async () => {
      const findMany = vi.fn().mockResolvedValue([
        {
          id: 'op-1',
          serverSeq: 1,
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 'task-1',
          payload: { title: 'Test Task' },
          schemaVersion: 1,
          isPayloadEncrypted: false,
        },
      ]);
      const mockTransaction = vi.mocked(prisma.$transaction);

      mockTransaction.mockImplementation(async (fn) => {
        const mockTx = {
          userSyncState: {
            findUnique: vi
              .fn()
              .mockResolvedValueOnce({ lastSeq: 1 })
              .mockResolvedValueOnce({
                snapshotData: null,
                lastSnapshotSeq: null,
                snapshotAt: null,
                snapshotSchemaVersion: null,
              }),
            updateMany: vi.fn().mockResolvedValue({ count: 0 }),
            create: vi.fn().mockResolvedValue({}),
          },
          operation: { count: vi.fn().mockResolvedValue(0), findMany },
        };
        return fn(mockTx as any);
      });

      await service.generateSnapshot(1);

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: 1,
            serverSeq: { gt: 0, lte: 1 },
          },
          select: EXPECTED_REPLAY_OPERATION_SELECT,
        }),
      );
      expect(findMany.mock.calls[0][0].select).not.toHaveProperty('clientId');
      expect(findMany.mock.calls[0][0].select).not.toHaveProperty('vectorClock');
      expect(findMany.mock.calls[0][0].select).not.toHaveProperty('receivedAt');
    });

    it('should invoke onCacheDelta with the bytes-written delta after a snapshot rewrite', async () => {
      // Regression for C3: GET /snapshot rewrites snapshotData inside its
      // transaction, but the storage counter is updated incrementally based
      // on op deltas only. Without this hook the cache can grow up to
      // MAX_SNAPSHOT_SIZE_BYTES with no quota accounting.
      const previousBytes = 500;
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const updateMany = vi.fn().mockResolvedValue({ count: 1 });
        const create = vi.fn().mockResolvedValue({});
        const mockTx = {
          userSyncState: {
            findUnique: vi
              .fn()
              .mockResolvedValueOnce({ lastSeq: 1 })
              .mockResolvedValueOnce({
                snapshotData: Buffer.alloc(previousBytes),
                lastSnapshotSeq: 0,
                snapshotAt: null,
                snapshotSchemaVersion: 1,
              }),
            updateMany,
            create,
          },
          operation: {
            count: vi.fn().mockResolvedValue(0),
            findFirst: vi.fn().mockResolvedValue(null),
            findMany: vi.fn().mockResolvedValue([
              {
                id: 'op-1',
                serverSeq: 1,
                opType: 'CRT',
                entityType: 'TASK',
                entityId: 'task-1',
                payload: { title: 'T' },
                schemaVersion: 1,
                isPayloadEncrypted: false,
              },
            ]),
          },
        };
        return fn(mockTx);
      });

      const onCacheDelta = vi.fn().mockResolvedValue(undefined);

      await service.generateSnapshot(1, onCacheDelta);

      expect(onCacheDelta).toHaveBeenCalledTimes(1);
      const deltaArg = onCacheDelta.mock.calls[0][0] as number;
      // The new snapshot is a fresh gzip of the replayed state; the previous
      // cached snapshot was 500 bytes of zeros. The delta is whatever the new
      // compressed size is minus 500 — assert the directionality rather than
      // an exact number since gzip output varies.
      expect(typeof deltaArg).toBe('number');
      expect(deltaArg).not.toBe(0);
    });

    it('should skip the cache write when the new blob exceeds maxCacheBytes (B5)', async () => {
      // Regression for B5: GET /snapshot must not grow `snapshotData` beyond
      // the user's remaining quota. When `maxCacheBytes` is set and the new
      // compressed blob would exceed it (accounting for the bytes the
      // previously-cached snapshot will free), skip the cache write — the
      // in-memory snapshot is still returned to the caller.
      const previousBytes = 0;
      const updateManySpy = vi.fn().mockResolvedValue({ count: 1 });
      const createSpy = vi.fn();
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const mockTx = {
          userSyncState: {
            findUnique: vi
              .fn()
              .mockResolvedValueOnce({ lastSeq: 1 })
              .mockResolvedValueOnce({
                snapshotData: null,
                lastSnapshotSeq: 0,
                snapshotAt: null,
                snapshotSchemaVersion: 1,
              }),
            updateMany: updateManySpy,
            create: createSpy,
          },
          operation: {
            count: vi.fn().mockResolvedValue(0),
            findFirst: vi.fn().mockResolvedValue(null),
            findMany: vi.fn().mockResolvedValue([
              {
                id: 'op-1',
                serverSeq: 1,
                opType: 'CRT',
                entityType: 'TASK',
                entityId: 'task-1',
                payload: { title: 'T' },
                schemaVersion: 1,
                isPayloadEncrypted: false,
              },
            ]),
          },
        };
        return fn(mockTx);
      });

      const onCacheDelta = vi.fn().mockResolvedValue(undefined);

      // maxCacheBytes=1 forces the cap below any real gzip output, so the
      // write must be skipped even though the snapshot itself is generated.
      const result = await service.generateSnapshot(1, onCacheDelta, 1);

      expect(result.serverSeq).toBe(1);
      expect(updateManySpy).not.toHaveBeenCalled();
      expect(createSpy).not.toHaveBeenCalled();
      expect(onCacheDelta).not.toHaveBeenCalled();
      void previousBytes;
    });

    it('should not invoke onCacheDelta when the cached snapshot is already up to date', async () => {
      // When startSeq >= latestSeq the snapshot service returns the cached
      // state without rewriting snapshotData — no counter update is needed.
      // The fast path now runs _assertCachedSnapshotBaseReplayable first, so
      // the operation mocks must answer the findFirst/count probes. Set
      // snapshotSchemaVersion to CURRENT_SCHEMA_VERSION (2) so the fast
      // path triggers; v1 would force a migration and bypass it.
      const cachedState = { TASK: { t1: { id: 't1' } } };
      const compressed = zlib.gzipSync(JSON.stringify(cachedState));
      const updateManySpy = vi.fn().mockResolvedValue({ count: 0 });
      const createSpy = vi.fn();
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const mockTx = {
          userSyncState: {
            findUnique: vi
              .fn()
              .mockResolvedValueOnce({ lastSeq: 7 })
              .mockResolvedValueOnce({
                snapshotData: compressed,
                lastSnapshotSeq: 7,
                snapshotAt: BigInt(1),
                snapshotSchemaVersion: 2,
              }),
            updateMany: updateManySpy,
            create: createSpy,
          },
          operation: {
            count: vi.fn().mockResolvedValue(0),
            findFirst: vi.fn().mockResolvedValue({ serverSeq: 7 }),
            findMany: vi.fn(),
          },
        };
        return fn(mockTx);
      });

      const onCacheDelta = vi.fn().mockResolvedValue(undefined);

      await service.generateSnapshot(1, onCacheDelta);

      expect(onCacheDelta).not.toHaveBeenCalled();
      // Fast path returns before the cache-write block, so neither write op
      // is invoked.
      expect(updateManySpy).not.toHaveBeenCalled();
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('should run _assertCachedSnapshotBaseReplayable before the fast path returns the cached snapshot', async () => {
      // Defense in depth: a legacy server build that failed to reject
      // encrypted ops could have produced a poisoned cache. The fast path
      // (startSeq >= latestSeq + schema match) MUST still validate the
      // cached base, otherwise it would serve poisoned cache forever.
      const cachedState = { TASK: { t1: { id: 't1' } } };
      const compressed = zlib.gzipSync(JSON.stringify(cachedState));
      const findFirstSpy = vi.fn().mockResolvedValue(null);
      const countSpy = vi.fn().mockResolvedValue(1); // encrypted op present
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const mockTx = {
          userSyncState: {
            findUnique: vi
              .fn()
              .mockResolvedValueOnce({ lastSeq: 7 })
              .mockResolvedValueOnce({
                snapshotData: compressed,
                lastSnapshotSeq: 7,
                snapshotAt: BigInt(1),
                snapshotSchemaVersion: 2,
              }),
            updateMany: vi.fn(),
            create: vi.fn(),
          },
          operation: {
            findFirst: findFirstSpy,
            count: countSpy,
            findMany: vi.fn(),
          },
        };
        return fn(mockTx);
      });

      await expect(service.generateSnapshot(1)).rejects.toThrow(
        'ENCRYPTED_OPS_NOT_SUPPORTED',
      );
      expect(findFirstSpy).toHaveBeenCalled();
      expect(countSpy).toHaveBeenCalled();
    });

    it('should swallow a thrown onCacheDelta to avoid corrupting the snapshot result', async () => {
      // The hook is post-commit and side-effecting; its failure should not
      // bubble up and fail the snapshot generation.
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const mockTx = {
          userSyncState: {
            findUnique: vi
              .fn()
              .mockResolvedValueOnce({ lastSeq: 1 })
              .mockResolvedValueOnce({
                snapshotData: null,
                lastSnapshotSeq: null,
                snapshotAt: null,
                snapshotSchemaVersion: null,
              }),
            updateMany: vi.fn().mockResolvedValue({ count: 0 }),
            create: vi.fn().mockResolvedValue({}),
          },
          operation: {
            count: vi.fn().mockResolvedValue(0),
            findFirst: vi.fn().mockResolvedValue(null),
            findMany: vi.fn().mockResolvedValue([
              {
                id: 'op-1',
                serverSeq: 1,
                opType: 'CRT',
                entityType: 'TASK',
                entityId: 'task-1',
                payload: { title: 'T' },
                schemaVersion: 1,
                isPayloadEncrypted: false,
              },
            ]),
          },
        };
        return fn(mockTx);
      });

      const onCacheDelta = vi.fn().mockRejectedValue(new Error('counter down'));

      await expect(service.generateSnapshot(1, onCacheDelta)).resolves.toBeDefined();
      expect(onCacheDelta).toHaveBeenCalledTimes(1);
    });

    it('should reject latest snapshot generation when encrypted ops are in the replay range', async () => {
      const upsert = vi.fn();
      const findMany = vi.fn();

      vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
        const mockTx = {
          userSyncState: {
            findUnique: vi
              .fn()
              .mockResolvedValueOnce({ lastSeq: 1 })
              .mockResolvedValueOnce({
                snapshotData: null,
                lastSnapshotSeq: null,
                snapshotAt: null,
                snapshotSchemaVersion: null,
              }),
            upsert,
          },
          operation: {
            count: vi.fn().mockResolvedValue(1),
            findMany,
          },
        };
        return fn(mockTx as any);
      });

      await expect(service.generateSnapshot(1)).rejects.toThrow(
        'ENCRYPTED_OPS_NOT_SUPPORTED',
      );
      expect(findMany).not.toHaveBeenCalled();
      expect(upsert).not.toHaveBeenCalled();
    });

    it('should reject latest snapshot generation when replay cannot reach latestSeq', async () => {
      const upsert = vi.fn();

      vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
        const mockTx = {
          userSyncState: {
            findUnique: vi
              .fn()
              .mockResolvedValueOnce({ lastSeq: 2 })
              .mockResolvedValueOnce({
                snapshotData: null,
                lastSnapshotSeq: null,
                snapshotAt: null,
                snapshotSchemaVersion: null,
              }),
            upsert,
          },
          operation: {
            count: vi.fn().mockResolvedValue(0),
            findMany: vi.fn().mockResolvedValue([
              {
                id: 'op-2',
                serverSeq: 2,
                opType: 'CRT',
                entityType: 'TASK',
                entityId: 'task-2',
                payload: { title: 'Task 2' },
                schemaVersion: 1,
                isPayloadEncrypted: false,
              },
            ]),
          },
        };
        return fn(mockTx as any);
      });

      await expect(service.generateSnapshot(1)).rejects.toThrow(
        'SNAPSHOT_REPLAY_INCOMPLETE',
      );
      expect(upsert).not.toHaveBeenCalled();
    });

    it('should prevent concurrent snapshot generation for same user', async () => {
      // Create a delayed response to simulate long snapshot generation
      let resolveFirst: (value: any) => void;
      const firstPromise = new Promise((resolve) => {
        resolveFirst = resolve;
      });

      const mockTransaction = vi.mocked(prisma.$transaction);
      let callCount = 0;
      mockTransaction.mockImplementation(async (fn) => {
        callCount++;
        if (callCount === 1) {
          // First call waits
          return firstPromise;
        }
        // Second call should never happen due to lock
        return { state: {}, serverSeq: 0, generatedAt: Date.now(), schemaVersion: 1 };
      });

      // Start first generation
      const gen1 = service.generateSnapshot(1);

      // Start second generation for same user - should wait for first
      const gen2 = service.generateSnapshot(1);

      // Resolve first generation
      const result = {
        state: { test: 'data' },
        serverSeq: 5,
        generatedAt: Date.now(),
        schemaVersion: 1,
      };
      resolveFirst!(result);

      // Both should return the same result
      const [result1, result2] = await Promise.all([gen1, gen2]);

      expect(result1).toEqual(result);
      expect(result2).toEqual(result);
      // Transaction should only be called once
      expect(mockTransaction).toHaveBeenCalledTimes(1);
    });

    it('should allow concurrent generation for different users', async () => {
      const mockTransaction = vi.mocked(prisma.$transaction);
      mockTransaction.mockImplementation(async (fn, options) => {
        // Mock the transaction callback
        const mockTx = {
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue({ lastSeq: 0 }),
            updateMany: vi.fn().mockResolvedValue({ count: 0 }),
            create: vi.fn().mockResolvedValue({}),
          },
          operation: {
            findMany: vi.fn().mockResolvedValue([]),
          },
        };
        return fn(mockTx as any);
      });

      // Generate for two different users concurrently
      const [result1, result2] = await Promise.all([
        service.generateSnapshot(1),
        service.generateSnapshot(2),
      ]);

      // Both should complete
      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
      // Transaction should be called twice (once per user)
      expect(mockTransaction).toHaveBeenCalledTimes(2);
    });

    it('should clean up lock on error', async () => {
      const mockTransaction = vi.mocked(prisma.$transaction);
      mockTransaction.mockRejectedValueOnce(new Error('DB error'));

      await expect(service.generateSnapshot(1)).rejects.toThrow('DB error');

      // Lock should be cleaned up, so next call should work
      mockTransaction.mockImplementation(async (fn) => {
        const mockTx = {
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue({ lastSeq: 0 }),
            updateMany: vi.fn().mockResolvedValue({ count: 0 }),
            create: vi.fn().mockResolvedValue({}),
          },
          operation: {
            findMany: vi.fn().mockResolvedValue([]),
          },
        };
        return fn(mockTx as any);
      });

      const result = await service.generateSnapshot(1);
      expect(result).toBeDefined();
    });

    it('should reject latest snapshots when encrypted ops exist in replay range', async () => {
      vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
        const mockTx = {
          userSyncState: {
            findUnique: vi
              .fn()
              .mockResolvedValueOnce({ lastSeq: 5 })
              .mockResolvedValueOnce({ snapshotData: null, lastSnapshotSeq: null }),
          },
          operation: {
            count: vi.fn().mockResolvedValue(1),
            findMany: vi.fn(),
          },
        };
        return fn(mockTx as any);
      });

      await expect(service.generateSnapshot(1)).rejects.toThrow(
        'ENCRYPTED_OPS_NOT_SUPPORTED',
      );
    });

    it('should bound latest snapshot replay queries by latestSeq', async () => {
      let findManySpy: ReturnType<typeof vi.fn>;

      vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
        findManySpy = vi.fn().mockResolvedValue([
          {
            id: 'op-1',
            opType: 'CRT',
            entityType: 'TASK',
            entityId: 'task-1',
            payload: { id: 'task-1' },
            isPayloadEncrypted: false,
            serverSeq: 1,
            schemaVersion: 1,
          },
        ]);
        const mockTx = {
          userSyncState: {
            findUnique: vi
              .fn()
              .mockResolvedValueOnce({ lastSeq: 1 })
              .mockResolvedValueOnce({ snapshotData: null, lastSnapshotSeq: null }),
            updateMany: vi.fn().mockResolvedValue({ count: 0 }),
            create: vi.fn().mockResolvedValue({}),
          },
          operation: {
            count: vi.fn().mockResolvedValue(0),
            findMany: findManySpy,
          },
        };
        return fn(mockTx as any);
      });

      await service.generateSnapshot(1);

      expect(findManySpy!).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: 1,
            serverSeq: { gt: 0, lte: 1 },
          },
        }),
      );
    });

    it('should reject latest snapshot replay when an operation is missing', async () => {
      vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
        const mockTx = {
          userSyncState: {
            findUnique: vi
              .fn()
              .mockResolvedValueOnce({ lastSeq: 2 })
              .mockResolvedValueOnce({ snapshotData: null, lastSnapshotSeq: null }),
          },
          operation: {
            count: vi.fn().mockResolvedValue(0),
            findMany: vi.fn().mockResolvedValue([
              {
                id: 'op-2',
                opType: 'CRT',
                entityType: 'TASK',
                entityId: 'task-2',
                payload: { id: 'task-2' },
                isPayloadEncrypted: false,
                serverSeq: 2,
                schemaVersion: 1,
              },
            ]),
          },
        };
        return fn(mockTx as any);
      });

      await expect(service.generateSnapshot(1)).rejects.toThrow(
        'SNAPSHOT_REPLAY_INCOMPLETE',
      );
    });

    it('should allow latest snapshot replay across a leading gap when the first surviving op is a full-state op', async () => {
      // Scenario: after a clean-slate upload (sync.service preserves lastSeq but
      // wipes ops) the next SYNC_IMPORT lands at lastSeq+1 (e.g. 102). Snapshot
      // replay must accept the leading gap because SYNC_IMPORT resets state.
      const updateManySpy = vi.fn().mockResolvedValue({ count: 0 });
      const createSpy = vi.fn().mockResolvedValue({});

      vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
        const mockTx = {
          userSyncState: {
            findUnique: vi
              .fn()
              .mockResolvedValueOnce({ lastSeq: 102 })
              .mockResolvedValueOnce({ snapshotData: null, lastSnapshotSeq: null }),
            updateMany: updateManySpy,
            create: createSpy,
          },
          operation: {
            count: vi.fn().mockResolvedValue(0),
            findMany: vi.fn().mockResolvedValue([
              {
                id: 'op-102',
                opType: 'SYNC_IMPORT',
                entityType: 'NONE',
                entityId: null,
                payload: { task: { t1: { id: 't1', title: 'after-clean-slate' } } },
                isPayloadEncrypted: false,
                serverSeq: 102,
                schemaVersion: 1,
              },
            ]),
          },
        };
        return fn(mockTx as any);
      });

      const result = await service.generateSnapshot(1);
      expect(result.serverSeq).toBe(102);
      expect((result.state as any).task.t1.title).toBe('after-clean-slate');
    });

    it('should reject leading gap when the first surviving op is not a full-state op', async () => {
      // Same shape as the clean-slate scenario but the surviving op is a CRT —
      // applying it to empty state would silently corrupt the snapshot.
      vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
        const mockTx = {
          userSyncState: {
            findUnique: vi
              .fn()
              .mockResolvedValueOnce({ lastSeq: 102 })
              .mockResolvedValueOnce({ snapshotData: null, lastSnapshotSeq: null }),
          },
          operation: {
            count: vi.fn().mockResolvedValue(0),
            findMany: vi.fn().mockResolvedValue([
              {
                id: 'op-102',
                opType: 'CRT',
                entityType: 'TASK',
                entityId: 'task-102',
                payload: { id: 'task-102' },
                isPayloadEncrypted: false,
                serverSeq: 102,
                schemaVersion: 1,
              },
            ]),
          },
        };
        return fn(mockTx as any);
      });

      await expect(service.generateSnapshot(1)).rejects.toThrow(
        'SNAPSHOT_REPLAY_INCOMPLETE',
      );
    });
  });

  describe('clearForUser', () => {
    it('should remove pending lock for a user', async () => {
      // Create a pending lock by starting a generation that never resolves
      let resolveGeneration: (value: any) => void;
      const pendingPromise = new Promise((resolve) => {
        resolveGeneration = resolve;
      });

      const mockTransaction = vi.mocked(prisma.$transaction);
      mockTransaction.mockImplementation(() => pendingPromise as any);

      // Start generation (creates a lock)
      const gen1 = service.generateSnapshot(1);

      // Clear the lock for user 1
      service.clearForUser(1);

      // Start another generation - should create a new transaction call
      // because the lock was cleared
      let secondCallCount = 0;
      mockTransaction.mockImplementation(async (fn) => {
        secondCallCount++;
        const mockTx = {
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue({ lastSeq: 0 }),
            updateMany: vi.fn().mockResolvedValue({ count: 0 }),
            create: vi.fn().mockResolvedValue({}),
          },
          operation: {
            findMany: vi.fn().mockResolvedValue([]),
          },
        };
        return fn(mockTx as any);
      });

      const gen2 = service.generateSnapshot(1);
      const result2 = await gen2;

      // Second generation should have started a new transaction
      expect(secondCallCount).toBe(1);
      expect(result2).toBeDefined();

      // Resolve the first one to clean up (avoid unhandled promise rejection)
      resolveGeneration!({
        state: {},
        serverSeq: 0,
        generatedAt: Date.now(),
        schemaVersion: 1,
      });
      await gen1.catch(() => {}); // Ignore any errors from the orphaned promise
    });

    it('should not affect locks for other users', async () => {
      // Create locks for users 1 and 2
      let resolveUser1: (value: any) => void;
      let resolveUser2: (value: any) => void;
      const user1Promise = new Promise((resolve) => {
        resolveUser1 = resolve;
      });
      const user2Promise = new Promise((resolve) => {
        resolveUser2 = resolve;
      });

      const mockTransaction = vi.mocked(prisma.$transaction);
      let callCount = 0;
      mockTransaction.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) return user1Promise;
        if (callCount === 2) return user2Promise;
        throw new Error('Unexpected call');
      });

      // Start generations for both users
      const gen1 = service.generateSnapshot(1);
      const gen2 = service.generateSnapshot(2);

      // Clear lock for user 1 only
      service.clearForUser(1);

      // User 2's lock should still be active - a new call should wait for it
      const gen2b = service.generateSnapshot(2);

      // Resolve user 2's generation
      const result2 = {
        state: { user: 2 },
        serverSeq: 10,
        generatedAt: Date.now(),
        schemaVersion: 1,
      };
      resolveUser2!(result2);

      // Both gen2 and gen2b should get the same result (waited for same lock)
      const [result2a, result2bResult] = await Promise.all([gen2, gen2b]);
      expect(result2a).toEqual(result2);
      expect(result2bResult).toEqual(result2);

      // Clean up user 1's pending promise
      resolveUser1!({
        state: {},
        serverSeq: 0,
        generatedAt: Date.now(),
        schemaVersion: 1,
      });
      await gen1.catch(() => {});
    });
  });

  describe('getRestorePoints', () => {
    it('should return empty array when no restore points exist', async () => {
      vi.mocked(prisma.operation.findMany).mockResolvedValue([]);

      const result = await service.getRestorePoints(1);

      expect(result).toEqual([]);
      expect(prisma.operation.findMany).toHaveBeenCalledWith({
        where: {
          userId: 1,
          opType: { in: ['SYNC_IMPORT', 'BACKUP_IMPORT', 'REPAIR'] },
        },
        orderBy: { serverSeq: 'desc' },
        take: 30,
        select: {
          serverSeq: true,
          clientId: true,
          opType: true,
          clientTimestamp: true,
        },
      });
    });

    it('should return restore points with descriptions', async () => {
      vi.mocked(prisma.operation.findMany).mockResolvedValue([
        {
          serverSeq: 100,
          clientId: 'client-1',
          opType: 'SYNC_IMPORT',
          clientTimestamp: BigInt(1000),
        },
        {
          serverSeq: 50,
          clientId: 'client-2',
          opType: 'BACKUP_IMPORT',
          clientTimestamp: BigInt(500),
        },
        {
          serverSeq: 25,
          clientId: 'client-3',
          opType: 'REPAIR',
          clientTimestamp: BigInt(250),
        },
      ] as any);

      const result = await service.getRestorePoints(1);

      expect(result).toEqual([
        {
          serverSeq: 100,
          timestamp: 1000,
          type: 'SYNC_IMPORT',
          clientId: 'client-1',
          description: 'Full sync import',
        },
        {
          serverSeq: 50,
          timestamp: 500,
          type: 'BACKUP_IMPORT',
          clientId: 'client-2',
          description: 'Backup restore',
        },
        {
          serverSeq: 25,
          timestamp: 250,
          type: 'REPAIR',
          clientId: 'client-3',
          description: 'Auto-repair',
        },
      ]);
    });

    it('should respect limit parameter', async () => {
      vi.mocked(prisma.operation.findMany).mockResolvedValue([]);

      await service.getRestorePoints(1, 5);

      expect(prisma.operation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 }),
      );
    });
  });

  describe('generateSnapshotAtSeq', () => {
    it('should throw error for targetSeq > maxSeq', async () => {
      vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
        const mockTx = {
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue({ lastSeq: 10 }),
          },
        };
        return fn(mockTx as any);
      });

      await expect(service.generateSnapshotAtSeq(1, 20)).rejects.toThrow(
        'Target sequence 20 exceeds latest sequence 10',
      );
    });

    it('should throw error for targetSeq < 1', async () => {
      vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
        const mockTx = {
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue({ lastSeq: 10 }),
          },
        };
        return fn(mockTx as any);
      });

      await expect(service.generateSnapshotAtSeq(1, 0)).rejects.toThrow(
        'Target sequence must be at least 1',
      );
    });

    it('should throw error when encrypted ops exist in range', async () => {
      vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
        const mockTx = {
          userSyncState: {
            findUnique: vi.fn().mockResolvedValue({ lastSeq: 10, snapshotData: null }),
          },
          operation: {
            count: vi.fn().mockResolvedValue(5),
          },
        };
        return fn(mockTx as any);
      });

      await expect(service.generateSnapshotAtSeq(1, 5)).rejects.toThrow(
        'ENCRYPTED_OPS_NOT_SUPPORTED',
      );
    });

    it('should throw error when cached snapshot base contains encrypted ops', async () => {
      const encryptedCachedSnapshot = zlib.gzipSync(JSON.stringify('encrypted-state'));

      vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
        const mockTx = {
          userSyncState: {
            findUnique: vi
              .fn()
              .mockResolvedValueOnce({ lastSeq: 5 })
              .mockResolvedValueOnce({
                snapshotData: encryptedCachedSnapshot,
                lastSnapshotSeq: 5,
                snapshotSchemaVersion: 1,
              }),
          },
          operation: {
            findFirst: vi.fn().mockResolvedValue(null),
            count: vi.fn().mockResolvedValue(1),
            findMany: vi.fn(),
          },
        };
        return fn(mockTx as any);
      });

      await expect(service.generateSnapshotAtSeq(1, 5)).rejects.toThrow(
        'ENCRYPTED_OPS_NOT_SUPPORTED',
      );
    });

    it('should reject historical snapshot generation when replay cannot reach targetSeq', async () => {
      vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
        const mockTx = {
          userSyncState: {
            findUnique: vi
              .fn()
              .mockResolvedValueOnce({ lastSeq: 5 })
              .mockResolvedValueOnce({
                snapshotData: null,
                lastSnapshotSeq: null,
                snapshotSchemaVersion: null,
              }),
          },
          operation: {
            count: vi.fn().mockResolvedValue(0),
            findMany: vi.fn().mockResolvedValue([]),
          },
        };
        return fn(mockTx as any);
      });

      await expect(service.generateSnapshotAtSeq(1, 5)).rejects.toThrow(
        'SNAPSHOT_REPLAY_INCOMPLETE',
      );
    });

    it('should throw error when replay range is not contiguous', async () => {
      vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
        const mockTx = {
          userSyncState: {
            findUnique: vi
              .fn()
              .mockResolvedValueOnce({ lastSeq: 10 })
              .mockResolvedValueOnce({ snapshotData: null, lastSnapshotSeq: null }),
          },
          operation: {
            count: vi.fn().mockResolvedValue(0),
            findMany: vi.fn().mockResolvedValue([
              {
                id: 'op-2',
                opType: 'CRT',
                entityType: 'TASK',
                entityId: 'task-2',
                payload: { id: 'task-2' },
                isPayloadEncrypted: false,
                serverSeq: 2,
                schemaVersion: 1,
              },
            ]),
          },
        };
        return fn(mockTx as any);
      });

      await expect(service.generateSnapshotAtSeq(1, 5)).rejects.toThrow(
        'SNAPSHOT_REPLAY_INCOMPLETE',
      );
    });

    it('should only select replay fields needed to generate snapshots at a sequence', async () => {
      const findMany = vi.fn().mockResolvedValue([
        {
          id: 'op-1',
          serverSeq: 1,
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 'task-1',
          payload: { title: 'Test Task' },
          schemaVersion: 1,
          isPayloadEncrypted: false,
        },
      ]);

      vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
        const mockTx = {
          userSyncState: {
            findUnique: vi
              .fn()
              .mockResolvedValueOnce({ lastSeq: 1 })
              .mockResolvedValueOnce({
                snapshotData: null,
                lastSnapshotSeq: null,
                snapshotSchemaVersion: null,
              }),
          },
          operation: {
            count: vi.fn().mockResolvedValue(0),
            findMany,
          },
        };
        return fn(mockTx as any);
      });

      await service.generateSnapshotAtSeq(1, 1);

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: EXPECTED_REPLAY_OPERATION_SELECT,
        }),
      );
      expect(findMany.mock.calls[0][0].select).not.toHaveProperty('clientId');
      expect(findMany.mock.calls[0][0].select).not.toHaveProperty('vectorClock');
      expect(findMany.mock.calls[0][0].select).not.toHaveProperty('receivedAt');
    });
  });

  describe('replayOpsToState', () => {
    it('should handle CRT operation', () => {
      const ops = [
        {
          id: 'op-1',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 'task-1',
          payload: { id: 'task-1', title: 'Test Task' },
          isPayloadEncrypted: false,
          serverSeq: 1,
          schemaVersion: 1,
        },
      ];

      const result = service.replayOpsToState(ops as any);

      expect(result).toEqual({
        TASK: {
          'task-1': { id: 'task-1', title: 'Test Task' },
        },
      });
    });

    it('should handle UPD operation', () => {
      const initialState = {
        TASK: { 'task-1': { id: 'task-1', title: 'Old Title' } },
      };
      const ops = [
        {
          id: 'op-1',
          opType: 'UPD',
          entityType: 'TASK',
          entityId: 'task-1',
          payload: { title: 'New Title' },
          isPayloadEncrypted: false,
          serverSeq: 1,
          schemaVersion: 1,
        },
      ];

      const result = service.replayOpsToState(ops as any, initialState);

      expect(result).toEqual({
        TASK: {
          'task-1': { id: 'task-1', title: 'New Title' },
        },
      });
    });

    it('should handle DEL operation', () => {
      const initialState = {
        TASK: {
          'task-1': { id: 'task-1' },
          'task-2': { id: 'task-2' },
        },
      };
      const ops = [
        {
          id: 'op-1',
          opType: 'DEL',
          entityType: 'TASK',
          entityId: 'task-1',
          payload: null,
          isPayloadEncrypted: false,
          serverSeq: 1,
          schemaVersion: 1,
        },
      ];

      const result = service.replayOpsToState(ops as any, initialState);

      expect(result).toEqual({
        TASK: {
          'task-2': { id: 'task-2' },
        },
      });
    });

    it('should handle BATCH operation with entities', () => {
      const ops = [
        {
          id: 'op-1',
          opType: 'BATCH',
          entityType: 'TASK',
          entityId: null,
          payload: {
            entities: {
              'task-1': { id: 'task-1', title: 'Task 1' },
              'task-2': { id: 'task-2', title: 'Task 2' },
            },
          },
          isPayloadEncrypted: false,
          serverSeq: 1,
          schemaVersion: 1,
        },
      ];

      const result = service.replayOpsToState(ops as any);

      expect(result).toEqual({
        TASK: {
          'task-1': { id: 'task-1', title: 'Task 1' },
          'task-2': { id: 'task-2', title: 'Task 2' },
        },
      });
    });

    it('should handle SYNC_IMPORT operation', () => {
      const ops = [
        {
          id: 'op-1',
          opType: 'SYNC_IMPORT',
          entityType: 'FULL_STATE',
          entityId: null,
          payload: {
            appDataComplete: {
              TASK: { 'task-1': { id: 'task-1' } },
              PROJECT: { 'proj-1': { id: 'proj-1' } },
            },
          },
          isPayloadEncrypted: false,
          serverSeq: 1,
          schemaVersion: 1,
        },
      ];

      const result = service.replayOpsToState(ops as any);

      expect(result.TASK).toEqual({ 'task-1': { id: 'task-1' } });
      expect(result.PROJECT).toEqual({ 'proj-1': { id: 'proj-1' } });
    });

    it('should stringify the full replay state only once for small delta ops', () => {
      const stringifySpy = vi.spyOn(JSON, 'stringify');
      const ops = Array.from({ length: 1500 }, (_, index) => ({
        id: `op-${index}`,
        opType: 'CRT',
        entityType: 'TASK',
        entityId: `task-${index}`,
        payload: { id: `task-${index}`, title: `Task ${index}` },
        isPayloadEncrypted: false,
        serverSeq: index + 1,
        schemaVersion: 1,
      }));

      try {
        service.replayOpsToState(ops as any);

        const fullStateStringifications = stringifySpy.mock.calls.filter(([value]) => {
          return (
            value !== null &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            Object.prototype.hasOwnProperty.call(value, 'TASK')
          );
        });
        expect(fullStateStringifications).toHaveLength(1);
      } finally {
        stringifySpy.mockRestore();
      }
    });

    it('should measure replay state immediately after a full-state op', () => {
      const stringifySpy = vi.spyOn(JSON, 'stringify');
      const ops = [
        {
          id: 'op-1',
          opType: 'SYNC_IMPORT',
          entityType: 'FULL_STATE',
          entityId: null,
          payload: {
            appDataComplete: {
              TASK: { 'task-1': { id: 'task-1' } },
            },
          },
          isPayloadEncrypted: false,
          serverSeq: 1,
          schemaVersion: 1,
        },
      ];

      try {
        service.replayOpsToState(ops as any);

        const fullStateStringifications = stringifySpy.mock.calls.filter(([value]) => {
          return (
            value !== null &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            Object.prototype.hasOwnProperty.call(value, 'TASK')
          );
        });
        expect(fullStateStringifications.length).toBeGreaterThanOrEqual(1);
      } finally {
        stringifySpy.mockRestore();
      }
    });

    it('SYNC_IMPORT replaces the entire state (does NOT merge into stale cache)', () => {
      // Regression test: previously the full-state ops used Object.assign which
      // merged into existing state, so stale entity types from a cached base
      // survived a "reset" SYNC_IMPORT. After the fix, a SYNC_IMPORT must
      // wipe the prior state.
      const stalePriorState = {
        TASK: { 'stale-task': { id: 'stale-task' } },
        PROJECT: { 'stale-proj': { id: 'stale-proj' } },
        TAG: { 'stale-tag': { id: 'stale-tag' } },
      };
      const ops = [
        {
          id: 'op-1',
          opType: 'SYNC_IMPORT',
          entityType: 'FULL_STATE',
          entityId: null,
          payload: {
            appDataComplete: {
              TASK: { 'new-task': { id: 'new-task' } },
            },
          },
          isPayloadEncrypted: false,
          serverSeq: 1,
          schemaVersion: 1,
        },
      ];

      const result = service.replayOpsToState(ops as any, stalePriorState);

      expect(result).toEqual({ TASK: { 'new-task': { id: 'new-task' } } });
      // Stale keys gone
      expect(result.PROJECT).toBeUndefined();
      expect(result.TAG).toBeUndefined();
    });

    it('SYNC_IMPORT must not allow prototype pollution via __proto__ in the uploaded payload', () => {
      // Regression: a malicious client could upload a SYNC_IMPORT payload
      // whose `appDataComplete` contains a `__proto__` key. The previous
      // implementation used `Object.assign(state, fullState)`. Because
      // `Object.assign` uses `[[Set]]` semantics on the target, an own
      // `__proto__` data property in `fullState` triggers the prototype
      // setter on `state`, swapping `state`'s prototype chain to the
      // attacker-controlled object. `state` then exposes attacker keys
      // (e.g. `polluted: true`) via the prototype chain — a poisoned
      // snapshot served to every client.
      //
      // Note: `Object.assign({}, {__proto__: …})` does NOT pollute the
      // *global* `Object.prototype` — only the target's own prototype
      // reference. So asserting `Object.prototype.polluted === undefined`
      // is tautological (it would pass even with the buggy code).
      // The real invariant is that `state`'s prototype reference is
      // still `Object.prototype` and that `state.polluted` is undefined
      // via the chain.
      //
      // Construct a malicious payload via JSON.parse so __proto__ is an
      // own data property (V8 / spec behaviour since 2018).
      const maliciousPayload = JSON.parse(
        JSON.stringify({
          appDataComplete: {
            TASK: { 'new-task': { id: 'new-task' } },
          },
        }).replace('"TASK"', '"__proto__":{"polluted":true},"TASK"'),
      );
      // Sanity-check the test fixture itself before relying on it.
      const inner = maliciousPayload.appDataComplete as Record<string, unknown>;
      expect(Object.prototype.hasOwnProperty.call(inner, '__proto__')).toBe(true);

      const ops = [
        {
          id: 'op-malicious',
          opType: 'SYNC_IMPORT',
          entityType: 'FULL_STATE',
          entityId: null,
          payload: maliciousPayload,
          isPayloadEncrypted: false,
          serverSeq: 1,
          schemaVersion: 1,
        },
      ];

      try {
        const result = service.replayOpsToState(ops as any) as Record<string, unknown> & {
          polluted?: unknown;
        };

        // Benign keys must still be copied — the fix must not regress
        // functionality.
        expect(result.TASK).toEqual({ 'new-task': { id: 'new-task' } });

        // Primary invariant: the replayed state's prototype is still
        // Object.prototype (not the attacker-controlled object). This is
        // what flips under the buggy `Object.assign` implementation —
        // `Object.getPrototypeOf(state) === Object.prototype` becomes
        // `false`.
        expect(Object.getPrototypeOf(result)).toBe(Object.prototype);

        // Consequence of the prototype swap: `state.polluted` would be
        // truthy via the chain. The fixed code keeps the chain clean.
        expect(result.polluted).toBeUndefined();
        // Also assert via hasOwnProperty for clarity — the key must not
        // appear as an own property either.
        expect(Object.prototype.hasOwnProperty.call(result, 'polluted')).toBe(false);
        // Also assert via hasOwnProperty for `__proto__` — defensive: even
        // if some future implementation defines it as an own data
        // property via `Object.defineProperty`, the SYNC_IMPORT loop must
        // skip it.
        expect(Object.prototype.hasOwnProperty.call(result, '__proto__')).toBe(false);

        // Defense in depth: confirm the global Object.prototype was not
        // affected either (it cannot be, given the above semantics, but
        // a future implementation could regress this).
        expect((Object.prototype as { polluted?: unknown }).polluted).toBeUndefined();
        expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
      } finally {
        // Defensive cleanup in case a future regression accidentally
        // pollutes the global prototype — keep subsequent tests clean.
        delete (Object.prototype as { polluted?: unknown }).polluted;
      }
    });

    it('should throw EncryptedOpsNotSupportedError for encrypted operations', () => {
      const ops = [
        {
          id: 'op-1',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 'task-1',
          payload: { id: 'task-1' },
          isPayloadEncrypted: true, // encrypted
          serverSeq: 1,
          schemaVersion: 1,
        },
      ];

      expect(() => service.replayOpsToState(ops as any)).toThrow(
        EncryptedOpsNotSupportedError,
      );
      expect(() => service.replayOpsToState(ops as any)).toThrow(
        'ENCRYPTED_OPS_NOT_SUPPORTED',
      );
    });

    it('should skip unknown entity types', () => {
      const ops = [
        {
          id: 'op-1',
          opType: 'CRT',
          entityType: 'unknown_type',
          entityId: 'id-1',
          payload: { id: 'id-1' },
          isPayloadEncrypted: false,
          serverSeq: 1,
          schemaVersion: 1,
        },
      ];

      const result = service.replayOpsToState(ops as any);

      expect(result).toEqual({});
    });

    it('CRT must not allow prototype pollution via entityId === "__proto__" (C1)', () => {
      // bracket-assignment `state.TASK["__proto__"] = …` invokes the
      // Object.prototype.__proto__ setter, replacing state.TASK's prototype
      // with the assigned payload. The C1 fix skips unsafe entityIds outright.
      const ops = [
        {
          id: 'op-1',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: '__proto__',
          payload: { polluted: true },
          isPayloadEncrypted: false,
          serverSeq: 1,
          schemaVersion: 1,
        },
        {
          id: 'op-2',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 'task-1',
          payload: { id: 'task-1', title: 'real task' },
          isPayloadEncrypted: false,
          serverSeq: 2,
          schemaVersion: 1,
        },
      ];

      const result = service.replayOpsToState(ops as any) as Record<string, unknown>;
      const taskMap = result.TASK as Record<string, unknown> & { polluted?: boolean };

      // Unsafe id was skipped; the legitimate task still applied.
      expect(taskMap['task-1']).toEqual({ id: 'task-1', title: 'real task' });
      // state.TASK's prototype is still Object.prototype — not the payload.
      expect(Object.getPrototypeOf(taskMap)).toBe(Object.prototype);
      expect(taskMap.polluted).toBeUndefined();
    });

    it('BATCH entities map must not allow prototype pollution via "__proto__" key (C1)', () => {
      // JSON.parse can produce `__proto__` as an own data property on
      // `entities`. Iterating with Object.entries and then assigning
      // `state.TASK["__proto__"] = …` would trigger the setter.
      const maliciousBatch = JSON.parse(
        '{"entities":{"__proto__":{"polluted":true},"real-id":{"id":"real-id"}}}',
      );
      const ops = [
        {
          id: 'op-1',
          opType: 'BATCH',
          entityType: 'TASK',
          entityId: null,
          payload: maliciousBatch,
          isPayloadEncrypted: false,
          serverSeq: 1,
          schemaVersion: 1,
        },
      ];

      const result = service.replayOpsToState(ops as any) as Record<string, unknown>;
      const taskMap = result.TASK as Record<string, unknown> & { polluted?: boolean };
      expect(taskMap['real-id']).toEqual({ id: 'real-id' });
      expect(Object.getPrototypeOf(taskMap)).toBe(Object.prototype);
      expect(taskMap.polluted).toBeUndefined();
    });

    it('UPD / MOV / BATCH single-entity paths reject __proto__/constructor/prototype entityIds (C1)', () => {
      for (const unsafe of ['__proto__', 'constructor', 'prototype']) {
        for (const opType of ['UPD', 'MOV', 'BATCH'] as const) {
          const ops = [
            {
              id: `op-${opType}-${unsafe}`,
              opType,
              entityType: 'TASK',
              entityId: unsafe,
              payload: { polluted: true },
              isPayloadEncrypted: false,
              serverSeq: 1,
              schemaVersion: 1,
            },
          ];
          const result = service.replayOpsToState(ops as any) as Record<string, unknown>;
          const taskMap = result.TASK as Record<string, unknown> | undefined;
          if (taskMap) {
            expect(Object.getPrototypeOf(taskMap)).toBe(Object.prototype);
            expect((taskMap as Record<string, unknown>).polluted).toBeUndefined();
          }
        }
      }
    });
  });
});
