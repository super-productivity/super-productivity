/**
 * Tests for the daily cleanup job.
 *
 * The cleanup system runs a single daily job that handles:
 * - Old operation cleanup (using retentionMs cutoff)
 * - Stale device cleanup (using retentionMs cutoff)
 * - Rate limit counter cleanup
 * - Request deduplication cleanup
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startCleanupJobs, stopCleanupJobs } from '../src/sync/cleanup';
import { DEFAULT_SYNC_CONFIG, MS_PER_DAY } from '../src/sync/sync.types';

// Mock the sync service
const mockSyncService = {
  deleteOldSyncedOpsForAllUsers: vi.fn().mockResolvedValue({
    totalDeleted: 0,
    affectedUserIds: [],
  }),
  deleteStaleDevices: vi.fn().mockResolvedValue(0),
  cleanupExpiredRateLimitCounters: vi.fn().mockReturnValue(0),
  cleanupExpiredRequestDedupEntries: vi.fn().mockReturnValue(0),
  updateStorageUsage: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../src/sync/sync.service', () => ({
  getSyncService: () => mockSyncService,
}));

// Mock logger to suppress output during tests
vi.mock('../src/logger', () => ({
  Logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('Cleanup Jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    stopCleanupJobs();
    vi.useRealTimers();
  });

  describe('startCleanupJobs', () => {
    it('should run initial cleanup after 10 seconds', async () => {
      startCleanupJobs();

      // Fast-forward 10 seconds
      await vi.advanceTimersByTimeAsync(10_000);

      // All cleanup methods should have been called
      expect(mockSyncService.deleteOldSyncedOpsForAllUsers).toHaveBeenCalled();
      expect(mockSyncService.deleteStaleDevices).toHaveBeenCalled();
      expect(mockSyncService.cleanupExpiredRateLimitCounters).toHaveBeenCalled();
      expect(mockSyncService.cleanupExpiredRequestDedupEntries).toHaveBeenCalled();
    });

    it('should use retentionMs for cutoff calculation', async () => {
      startCleanupJobs();

      // Fast-forward 10 seconds to trigger initial cleanup
      await vi.advanceTimersByTimeAsync(10_000);

      // Check that the cutoff time uses retentionMs
      const cutoffCall = mockSyncService.deleteOldSyncedOpsForAllUsers.mock.calls[0][0];
      const devicesCutoffCall = mockSyncService.deleteStaleDevices.mock.calls[0][0];

      // Both should use the same cutoff (within a few ms tolerance)
      expect(Math.abs(cutoffCall - devicesCutoffCall)).toBeLessThan(100);

      // Cutoff should be approximately Date.now() - retentionMs
      const expectedCutoff = Date.now() - DEFAULT_SYNC_CONFIG.retentionMs;
      expect(Math.abs(cutoffCall - expectedCutoff)).toBeLessThan(100);
    });

    it('should run cleanup daily', async () => {
      startCleanupJobs();

      // Fast-forward 10 seconds for initial cleanup
      await vi.advanceTimersByTimeAsync(10_000);
      expect(mockSyncService.deleteOldSyncedOpsForAllUsers).toHaveBeenCalledTimes(1);

      // Fast-forward 1 day
      await vi.advanceTimersByTimeAsync(MS_PER_DAY);
      expect(mockSyncService.deleteOldSyncedOpsForAllUsers).toHaveBeenCalledTimes(2);

      // Fast-forward another day
      await vi.advanceTimersByTimeAsync(MS_PER_DAY);
      expect(mockSyncService.deleteOldSyncedOpsForAllUsers).toHaveBeenCalledTimes(3);
    });

    it('should update storage usage for affected users after op cleanup', async () => {
      mockSyncService.deleteOldSyncedOpsForAllUsers.mockResolvedValueOnce({
        totalDeleted: 100,
        affectedUserIds: [1, 2, 3],
      });

      startCleanupJobs();
      await vi.advanceTimersByTimeAsync(10_000);

      // Should update storage for each affected user
      expect(mockSyncService.updateStorageUsage).toHaveBeenCalledTimes(3);
      expect(mockSyncService.updateStorageUsage).toHaveBeenCalledWith(1);
      expect(mockSyncService.updateStorageUsage).toHaveBeenCalledWith(2);
      expect(mockSyncService.updateStorageUsage).toHaveBeenCalledWith(3);
    });
  });

  describe('stopCleanupJobs', () => {
    it('should stop scheduled cleanup', async () => {
      startCleanupJobs();

      // Fast-forward 10 seconds for initial cleanup
      await vi.advanceTimersByTimeAsync(10_000);
      expect(mockSyncService.deleteOldSyncedOpsForAllUsers).toHaveBeenCalledTimes(1);

      // Stop cleanup jobs
      stopCleanupJobs();

      // Fast-forward 1 day - should not trigger another cleanup
      await vi.advanceTimersByTimeAsync(MS_PER_DAY);
      expect(mockSyncService.deleteOldSyncedOpsForAllUsers).toHaveBeenCalledTimes(1);
    });
  });

  describe('Error handling', () => {
    it('should continue cleanup even if one task fails', async () => {
      // Make ops cleanup fail
      mockSyncService.deleteOldSyncedOpsForAllUsers.mockRejectedValueOnce(
        new Error('DB error'),
      );

      startCleanupJobs();
      await vi.advanceTimersByTimeAsync(10_000);

      // Other cleanup tasks should still run
      expect(mockSyncService.deleteStaleDevices).toHaveBeenCalled();
      expect(mockSyncService.cleanupExpiredRateLimitCounters).toHaveBeenCalled();
      expect(mockSyncService.cleanupExpiredRequestDedupEntries).toHaveBeenCalled();
    });

    it('should continue cleanup even if device cleanup fails', async () => {
      mockSyncService.deleteStaleDevices.mockRejectedValueOnce(new Error('DB error'));

      startCleanupJobs();
      await vi.advanceTimersByTimeAsync(10_000);

      // Other cleanup tasks should still run
      expect(mockSyncService.deleteOldSyncedOpsForAllUsers).toHaveBeenCalled();
      expect(mockSyncService.cleanupExpiredRateLimitCounters).toHaveBeenCalled();
      expect(mockSyncService.cleanupExpiredRequestDedupEntries).toHaveBeenCalled();
    });
  });
});
