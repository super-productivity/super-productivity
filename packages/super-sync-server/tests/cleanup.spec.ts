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
import { Logger } from '../src/logger';

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

    it('should not call full-scan updateStorageUsage after op cleanup', async () => {
      // The daily cleanup used to call updateStorageUsage(userId) for every
      // affected user, which forced a full-payload TOAST scan and caused the
      // production disk-I/O DoS. The cached counter is deliberately left
      // stale-high until a quota miss reconciles that user's exact usage.
      mockSyncService.deleteOldSyncedOpsForAllUsers.mockResolvedValueOnce({
        totalDeleted: 100,
        affectedUserIds: [1, 2, 3],
      });

      startCleanupJobs();
      await vi.advanceTimersByTimeAsync(10_000);

      expect(mockSyncService.updateStorageUsage).not.toHaveBeenCalled();
    });

    it('should reconcile stalest-first and warn when affected users exceed the budget', async () => {
      // RECONCILE_BUDGET_MS / RECONCILE_INTERVAL_MS = 720. With more affected
      // users than that, the cleanup pass reconciles the first 720 — relying
      // on `deleteOldSyncedOpsForAllUsers` to return ids stalest-first
      // (orderBy snapshotAt asc). The fresh tail rolls over to the next pass.
      const totalUsers = 1000;
      // Stalest first, mimicking what the service now returns.
      const userIds = Array.from({ length: totalUsers }, (_, i) => i + 1);
      mockSyncService.deleteOldSyncedOpsForAllUsers.mockResolvedValueOnce({
        totalDeleted: totalUsers,
        affectedUserIds: userIds,
      });

      startCleanupJobs();
      await vi.advanceTimersByTimeAsync(10_000);

      // Warning is emitted with both numbers so operators can see the gap.
      expect(Logger.warn).toHaveBeenCalledWith(expect.stringContaining('720/1000 users'));

      // Run all 720 deferred reconciles (1h budget worth of timers).
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
      expect(mockSyncService.updateStorageUsage).toHaveBeenCalledTimes(720);

      // Stalest-first ordering is preserved: callers see the first 720 ids
      // from `affectedUserIds` in input order.
      const calledOrder = mockSyncService.updateStorageUsage.mock.calls.map(
        (c) => c[0] as number,
      );
      expect(calledOrder).toEqual(userIds.slice(0, 720));
    });

    it('should not warn or shuffle when affected users fit in the budget', async () => {
      mockSyncService.deleteOldSyncedOpsForAllUsers.mockResolvedValueOnce({
        totalDeleted: 3,
        affectedUserIds: [10, 20, 30],
      });

      startCleanupJobs();
      await vi.advanceTimersByTimeAsync(10_000);

      // No starvation warning when everyone fits.
      const warnCalls = (Logger.warn as ReturnType<typeof vi.fn>).mock.calls;
      expect(warnCalls.some((c) => String(c[0]).includes('budget covers'))).toBe(false);

      // Drain the 3 deferred reconciles (3 × 5s).
      await vi.advanceTimersByTimeAsync(3 * 5_000);
      const calledOrder = mockSyncService.updateStorageUsage.mock.calls.map(
        (c) => c[0] as number,
      );
      // When the budget covers everyone the original order is preserved.
      expect(calledOrder).toEqual([10, 20, 30]);
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
