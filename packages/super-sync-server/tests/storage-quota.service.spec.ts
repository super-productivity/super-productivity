import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StorageQuotaService } from '../src/sync/services/storage-quota.service';

// Mock prisma
vi.mock('../src/db', () => ({
  prisma: {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    userSyncState: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from '../src/db';

const flushPromises = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('StorageQuotaService', () => {
  let service: StorageQuotaService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new StorageQuotaService();
  });

  describe('calculateStorageUsage', () => {
    it('should calculate storage from operations and snapshot', async () => {
      vi.mocked(prisma.$queryRaw).mockResolvedValue([{ total: BigInt(5000) }]);
      vi.mocked(prisma.userSyncState.findUnique).mockResolvedValue({
        snapshotData: Buffer.alloc(3000),
      } as any);

      const result = await service.calculateStorageUsage(1);

      expect(result).toEqual({
        operationsBytes: 5000,
        snapshotBytes: 3000,
        totalBytes: 8000,
      });
    });

    it('should handle null operation total', async () => {
      vi.mocked(prisma.$queryRaw).mockResolvedValue([{ total: null }]);
      vi.mocked(prisma.userSyncState.findUnique).mockResolvedValue(null);

      const result = await service.calculateStorageUsage(1);

      expect(result).toEqual({
        operationsBytes: 0,
        snapshotBytes: 0,
        totalBytes: 0,
      });
    });

    it('should handle missing snapshot', async () => {
      vi.mocked(prisma.$queryRaw).mockResolvedValue([{ total: BigInt(1000) }]);
      vi.mocked(prisma.userSyncState.findUnique).mockResolvedValue({
        snapshotData: null,
      } as any);

      const result = await service.calculateStorageUsage(1);

      expect(result).toEqual({
        operationsBytes: 1000,
        snapshotBytes: 0,
        totalBytes: 1000,
      });
    });

    it('should avoid materializing JSON payloads as text', async () => {
      vi.mocked(prisma.$queryRaw).mockResolvedValue([{ total: BigInt(1000) }]);
      vi.mocked(prisma.userSyncState.findUnique).mockResolvedValue({
        snapshotData: null,
      } as any);

      await service.calculateStorageUsage(1);

      const [queryParts] = vi.mocked(prisma.$queryRaw).mock.calls[0] as unknown as [
        TemplateStringsArray,
        number,
      ];
      const query = Array.from(queryParts).join('');

      expect(query).toContain('pg_column_size(payload)');
      expect(query).toContain('pg_column_size(vector_clock)');
      expect(query).not.toContain('payload::text');
      expect(query).not.toContain('vector_clock::text');
    });
  });

  describe('checkStorageQuota', () => {
    it('should allow upload when under quota', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        storageQuotaBytes: BigInt(100000),
        storageUsedBytes: BigInt(50000),
      } as any);

      const result = await service.checkStorageQuota(1, 10000);

      expect(result).toEqual({
        allowed: true,
        currentUsage: 50000,
        quota: 100000,
      });
    });

    it('should deny upload when over quota', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        storageQuotaBytes: BigInt(100000),
        storageUsedBytes: BigInt(95000),
      } as any);

      const result = await service.checkStorageQuota(1, 10000);

      expect(result).toEqual({
        allowed: false,
        currentUsage: 95000,
        quota: 100000,
      });
    });

    it('should use default quota when user has none set', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        storageQuotaBytes: null,
        storageUsedBytes: BigInt(0),
      } as any);

      const result = await service.checkStorageQuota(1, 1000);

      expect(result.quota).toBe(100 * 1024 * 1024); // Default 100MB
      expect(result.allowed).toBe(true);
    });

    it('should handle missing user', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

      const result = await service.checkStorageQuota(1, 1000);

      expect(result).toEqual({
        allowed: true,
        currentUsage: 0,
        quota: 100 * 1024 * 1024,
      });
    });
  });

  describe('updateStorageUsage', () => {
    it('should update storage usage from calculated total', async () => {
      vi.mocked(prisma.$queryRaw).mockResolvedValue([{ total: BigInt(75000) }]);
      vi.mocked(prisma.userSyncState.findUnique).mockResolvedValue({
        snapshotData: Buffer.alloc(25000),
      } as any);
      vi.mocked(prisma.user.update).mockResolvedValue({} as any);

      await service.updateStorageUsage(1);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { storageUsedBytes: BigInt(100000) },
      });
    });

    it('should dedupe concurrent reconciles for the same user', async () => {
      // Simulate a slow SUM(pg_column_size) scan so concurrent callers
      // overlap on the in-flight promise.
      let releaseScan: (value: [{ total: bigint }]) => void = () => undefined;
      vi.mocked(prisma.$queryRaw).mockReturnValueOnce(
        new Promise((resolve) => {
          releaseScan = resolve;
        }) as any,
      );
      vi.mocked(prisma.userSyncState.findUnique).mockResolvedValue({
        snapshotData: null,
      } as any);
      vi.mocked(prisma.user.update).mockResolvedValue({} as any);

      const first = service.updateStorageUsage(1);
      const second = service.updateStorageUsage(1);
      const third = service.updateStorageUsage(1);

      releaseScan([{ total: BigInt(123) }]);
      await Promise.all([first, second, third]);

      // Only one scan + one write should have run for three concurrent calls.
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(prisma.user.update).toHaveBeenCalledTimes(1);
    });

    it('should re-scan on a subsequent sequential call after the lock clears', async () => {
      vi.mocked(prisma.$queryRaw).mockResolvedValue([{ total: BigInt(10) }]);
      vi.mocked(prisma.userSyncState.findUnique).mockResolvedValue({
        snapshotData: null,
      } as any);
      vi.mocked(prisma.user.update).mockResolvedValue({} as any);

      await service.updateStorageUsage(1);
      await service.updateStorageUsage(1);

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
      expect(prisma.user.update).toHaveBeenCalledTimes(2);
    });

    it('should release the lock when the scan throws', async () => {
      vi.mocked(prisma.$queryRaw).mockRejectedValueOnce(new Error('db down'));
      vi.mocked(prisma.userSyncState.findUnique).mockResolvedValue({
        snapshotData: null,
      } as any);
      vi.mocked(prisma.user.update).mockResolvedValue({} as any);

      await expect(service.updateStorageUsage(1)).rejects.toThrow('db down');

      // Lock must be cleared so the next call retries the scan rather than
      // returning the rejected promise forever.
      vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ total: BigInt(0) }]);
      await expect(service.updateStorageUsage(1)).resolves.toBeUndefined();
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    });

    it('should not deadlock when a reentrant caller hits an in-flight non-reentrant reconcile', async () => {
      // Regression for the deadlock between inflightReconciles and
      // runWithStorageUsageLock. The real-world race:
      //   1) Outside-the-lock caller D (e.g. a deferred cleanup reconcile)
      //      registers an inflightReconciles entry whose inner lock is queued
      //      behind whatever currently holds the lock.
      //   2) Route handler B is inside its runWithStorageUsageLock window.
      //   3) From inside B's fn, enforceStorageQuota calls updateStorageUsage.
      //      Pre-fix: B's call short-circuited to D's promise via the
      //      inflightReconciles map, then awaited a promise that needed the
      //      lock B holds → deadlock.
      // Simulate D directly by populating the map with a never-resolving
      // promise (no leaks: the map entry is removed when B falls through).
      const neverResolves = new Promise<void>(() => undefined);
      const inflightMap = (
        service as unknown as {
          inflightReconciles: Map<number, Promise<void>>;
        }
      ).inflightReconciles;
      inflightMap.set(1, neverResolves);

      vi.mocked(prisma.$queryRaw).mockResolvedValue([{ total: BigInt(42) }] as any);
      vi.mocked(prisma.userSyncState.findUnique).mockResolvedValue({
        snapshotData: null,
      } as any);
      vi.mocked(prisma.user.update).mockResolvedValue({} as any);

      const insideResult = await Promise.race([
        service.runWithStorageUsageLock(1, async () => {
          await service.updateStorageUsage(1);
          return 'inside';
        }),
        new Promise<string>((resolve) => setTimeout(() => resolve('TIMEOUT'), 200)),
      ]);

      expect(insideResult).toBe('inside');
      // The reentrant path ran the scan directly without going through the
      // dedupe map (and never awaited D's never-resolving promise).
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      // D's entry must NOT have been mutated by the reentrant call.
      expect(inflightMap.get(1)).toBe(neverResolves);

      // Cleanup so the never-resolving promise does not leak into other
      // tests (vi.clearAllMocks doesn't touch the new service instance,
      // but we share Maps with later beforeEach factory state — be tidy).
      inflightMap.delete(1);
    });

    it('should wait for an active storage mutation window before exact reconcile', async () => {
      const events: string[] = [];
      let releaseWindow: () => void = () => undefined;

      const activeWindow = service.runWithStorageUsageLock(1, async () => {
        events.push('upload-start');
        await new Promise<void>((resolve) => {
          releaseWindow = resolve;
        });
        events.push('upload-end');
      });
      await flushPromises();

      vi.mocked(prisma.$queryRaw).mockImplementation(async () => {
        events.push('scan');
        return [{ total: BigInt(123) }];
      });
      vi.mocked(prisma.userSyncState.findUnique).mockResolvedValue({
        snapshotData: null,
      } as any);
      vi.mocked(prisma.user.update).mockImplementation(async () => {
        events.push('write');
        return {} as any;
      });

      const reconcile = service.updateStorageUsage(1);
      await flushPromises();

      expect(events).toEqual(['upload-start']);
      releaseWindow();
      await Promise.all([activeWindow, reconcile]);
      expect(events).toEqual(['upload-start', 'upload-end', 'scan', 'write']);
    });
  });

  describe('runWithStorageUsageLock', () => {
    it('should serialize callbacks for the same user', async () => {
      const events: string[] = [];
      let releaseFirst: () => void = () => undefined;

      const first = service.runWithStorageUsageLock(1, async () => {
        events.push('first-start');
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        events.push('first-end');
        return 'first';
      });
      await flushPromises();

      const second = service.runWithStorageUsageLock(1, async () => {
        events.push('second-start');
        return 'second';
      });
      await flushPromises();

      expect(events).toEqual(['first-start']);
      releaseFirst();
      await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second']);
      expect(events).toEqual(['first-start', 'first-end', 'second-start']);
    });

    it('should allow nested callbacks for the same user', async () => {
      const result = await service.runWithStorageUsageLock(1, () =>
        service.runWithStorageUsageLock(1, async () => 'nested'),
      );

      expect(result).toBe('nested');
    });
  });

  describe('forced reconcile marker', () => {
    it('checkStorageQuota should run an exact reconcile first when the user is marked', async () => {
      // Marker indicates the cached counter is known stale (e.g. a previous
      // post-commit increment failed). Quota check must self-heal before
      // answering, otherwise drift accumulates until daily cleanup.
      vi.mocked(prisma.$queryRaw).mockResolvedValue([{ total: BigInt(10_000) }] as any);
      vi.mocked(prisma.userSyncState.findUnique).mockResolvedValue({
        snapshotData: null,
      } as any);
      vi.mocked(prisma.user.update).mockResolvedValue({} as any);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        storageQuotaBytes: BigInt(100_000),
        storageUsedBytes: BigInt(10_000),
      } as any);

      service.markNeedsReconcile(1);
      expect(service.needsReconcile(1)).toBe(true);

      await service.checkStorageQuota(1, 1000);

      // The scan (and write) must have run before the quota read.
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { storageUsedBytes: BigInt(10_000) },
      });
      // Marker self-clears after a successful reconcile.
      expect(service.needsReconcile(1)).toBe(false);
    });

    it('checkStorageQuota should not reconcile when the user is not marked', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        storageQuotaBytes: BigInt(100_000),
        storageUsedBytes: BigInt(50_000),
      } as any);

      await service.checkStorageQuota(1, 1000);

      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('checkStorageQuota should fall back to the cached read if the forced reconcile throws', async () => {
      vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error('db down'));
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        storageQuotaBytes: BigInt(100_000),
        storageUsedBytes: BigInt(50_000),
      } as any);

      service.markNeedsReconcile(1);

      const result = await service.checkStorageQuota(1, 1000);

      expect(result.allowed).toBe(true);
      expect(result.currentUsage).toBe(50_000);
      // Marker stays set so the next call retries the reconcile.
      expect(service.needsReconcile(1)).toBe(true);
    });
  });

  describe('clearForUser', () => {
    it('should not throw when no lock exists', () => {
      expect(() => service.clearForUser(42)).not.toThrow();
    });

    it('should clear inflightReconciles and forcedReconciles, but preserve storageUsageLocks chain', () => {
      // After a clean-slate / account wipe, stale entries in inflightReconciles
      // would block future reconciles via the dedupe map; stale forcedReconciles
      // would force a spurious extra scan on the next quota check. Both are
      // cleared. storageUsageLocks intentionally is NOT cleared here — deleting
      // a chain head while a follower is queued behind it lets a new caller
      // see no `previous` and race the in-flight chain on the counter. The
      // chain self-deletes on drain via the identity-guarded finally in
      // runWithStorageUsageLock.
      const internals = service as unknown as {
        inflightReconciles: Map<number, Promise<void>>;
        forcedReconciles: Set<number>;
        storageUsageLocks: Map<number, Promise<void>>;
      };
      internals.inflightReconciles.set(7, Promise.resolve());
      internals.forcedReconciles.add(7);
      internals.storageUsageLocks.set(7, Promise.resolve());

      service.clearForUser(7);

      expect(internals.inflightReconciles.has(7)).toBe(false);
      expect(internals.forcedReconciles.has(7)).toBe(false);
      expect(internals.storageUsageLocks.has(7)).toBe(true);
    });

    it('should not affect other users state', () => {
      const internals = service as unknown as {
        inflightReconciles: Map<number, Promise<void>>;
        forcedReconciles: Set<number>;
        storageUsageLocks: Map<number, Promise<void>>;
      };
      internals.inflightReconciles.set(7, Promise.resolve());
      internals.forcedReconciles.add(7);
      internals.storageUsageLocks.set(7, Promise.resolve());
      internals.inflightReconciles.set(8, Promise.resolve());
      internals.forcedReconciles.add(8);
      internals.storageUsageLocks.set(8, Promise.resolve());

      service.clearForUser(7);

      expect(internals.inflightReconciles.has(8)).toBe(true);
      expect(internals.forcedReconciles.has(8)).toBe(true);
      expect(internals.storageUsageLocks.has(8)).toBe(true);
    });

    it('should not break a queued mutex chain when clearForUser races with a waiting caller', async () => {
      // Regression: deleting storageUsageLocks[userId] mid-chain would let a
      // second caller arriving after the wipe start a fresh, concurrent chain.
      // After this fix clearForUser leaves storageUsageLocks alone, so the
      // chain stays intact and follow-on callers serialize behind the in-flight
      // operation.
      let aStarted = false;
      let aFinished = false;
      let bStarted = false;
      const releaseA = await new Promise<() => void>((resolveOuter) => {
        const promiseA = service.runWithStorageUsageLock(99, async () => {
          aStarted = true;
          await new Promise<void>((resolve) => {
            resolveOuter(resolve);
          });
          aFinished = true;
        });
        // Don't await promiseA — we want to race a concurrent caller.
        void promiseA;
      });
      // Yield so A's body runs.
      await new Promise((resolve) => setImmediate(resolve));
      expect(aStarted).toBe(true);
      service.clearForUser(99);
      const promiseB = service.runWithStorageUsageLock(99, async () => {
        bStarted = true;
        expect(aFinished).toBe(true);
      });
      await new Promise((resolve) => setImmediate(resolve));
      expect(bStarted).toBe(false); // B is queued behind A's chain, not racing
      releaseA();
      await promiseB;
      expect(bStarted).toBe(true);
    });
  });

  describe('incrementStorageUsage', () => {
    it('should atomically increment storage_used_bytes', async () => {
      vi.mocked(prisma.user.update).mockResolvedValue({} as any);

      await service.incrementStorageUsage(1, 4096);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { storageUsedBytes: { increment: BigInt(4096) } },
      });
    });

    it('should floor non-integer deltas', async () => {
      vi.mocked(prisma.user.update).mockResolvedValue({} as any);

      await service.incrementStorageUsage(1, 4096.9);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { storageUsedBytes: { increment: BigInt(4096) } },
      });
    });

    it.each([0, -1, NaN, Infinity, -Infinity])(
      'should be a no-op for non-positive or non-finite delta %p',
      async (delta) => {
        vi.mocked(prisma.user.update).mockResolvedValue({} as any);

        await service.incrementStorageUsage(1, delta);

        expect(prisma.user.update).not.toHaveBeenCalled();
      },
    );
  });

  describe('decrementStorageUsage', () => {
    it('should run a clamped UPDATE via $executeRaw', async () => {
      vi.mocked(prisma.$executeRaw).mockResolvedValue(1 as any);

      await service.decrementStorageUsage(1, 2048);

      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      const callArgs = vi.mocked(prisma.$executeRaw).mock.calls[0];
      // First arg is the tagged template TemplateStringsArray; subsequent args
      // are the interpolated values (delta BigInt + userId).
      const interpolatedValues = callArgs.slice(1);
      expect(interpolatedValues).toContain(BigInt(2048));
      expect(interpolatedValues).toContain(1);
    });

    it.each([0, -1, NaN, Infinity])(
      'should be a no-op for non-positive or non-finite delta %p',
      async (delta) => {
        vi.mocked(prisma.$executeRaw).mockResolvedValue(0 as any);

        await service.decrementStorageUsage(1, delta);

        expect(prisma.$executeRaw).not.toHaveBeenCalled();
      },
    );
  });

  describe('getStorageInfo', () => {
    it('should return storage info for user', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        storageQuotaBytes: BigInt(200000000),
        storageUsedBytes: BigInt(50000000),
      } as any);

      const result = await service.getStorageInfo(1);

      expect(result).toEqual({
        storageUsedBytes: 50000000,
        storageQuotaBytes: 200000000,
      });
    });

    it('should use defaults for missing user', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

      const result = await service.getStorageInfo(1);

      expect(result).toEqual({
        storageUsedBytes: 0,
        storageQuotaBytes: 100 * 1024 * 1024,
      });
    });
  });
});
