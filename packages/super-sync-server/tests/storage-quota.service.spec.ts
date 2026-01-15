import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StorageQuotaService } from '../src/sync/services/storage-quota.service';

// Mock prisma
vi.mock('../src/db', () => ({
  prisma: {
    $queryRaw: vi.fn(),
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
