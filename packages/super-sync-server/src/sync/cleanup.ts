import { getSyncService } from './sync.service';
import { Logger } from '../logger';
import { DEFAULT_SYNC_CONFIG, MS_PER_DAY } from './sync.types';

let cleanupTimer: NodeJS.Timeout | null = null;

/**
 * Runs all cleanup tasks in a single daily job.
 * Uses the unified retentionMs for all time-based cleanup.
 */
const runDailyCleanup = async (): Promise<void> => {
  const syncService = getSyncService();
  const cutoffTime = Date.now() - DEFAULT_SYNC_CONFIG.retentionMs;

  // 1. Delete old operations (covered by snapshots)
  try {
    const { totalDeleted, affectedUserIds } =
      await syncService.deleteOldSyncedOpsForAllUsers(cutoffTime);
    if (totalDeleted > 0) {
      Logger.info(`Cleanup [old-ops]: removed ${totalDeleted} entries`);
    }
    // Update storage usage for affected users
    for (const userId of affectedUserIds) {
      await syncService.updateStorageUsage(userId);
    }
  } catch (error) {
    Logger.error(`Cleanup [old-ops] failed: ${error}`);
  }

  // 2. Delete stale devices (not seen within retention period)
  try {
    const deleted = await syncService.deleteStaleDevices(cutoffTime);
    if (deleted > 0) {
      Logger.info(`Cleanup [stale-devices]: removed ${deleted} entries`);
    }
  } catch (error) {
    Logger.error(`Cleanup [stale-devices] failed: ${error}`);
  }

  // 3. Clean up expired rate limit counters
  try {
    const deleted = syncService.cleanupExpiredRateLimitCounters();
    if (deleted > 0) {
      Logger.info(`Cleanup [rate-limits]: removed ${deleted} entries`);
    }
  } catch (error) {
    Logger.error(`Cleanup [rate-limits] failed: ${error}`);
  }

  // 4. Clean up expired request deduplication entries
  try {
    const deleted = syncService.cleanupExpiredRequestDedupEntries();
    if (deleted > 0) {
      Logger.info(`Cleanup [request-dedup]: removed ${deleted} entries`);
    }
  } catch (error) {
    Logger.error(`Cleanup [request-dedup] failed: ${error}`);
  }
};

export const startCleanupJobs = (): void => {
  Logger.info('Starting daily cleanup job...');

  // Run initial cleanup after a short delay
  setTimeout(() => {
    void runDailyCleanup();
  }, 10_000);

  // Schedule recurring daily cleanup
  cleanupTimer = setInterval(() => {
    void runDailyCleanup();
  }, MS_PER_DAY);

  Logger.info('Daily cleanup job scheduled');
};

export const stopCleanupJobs = (): void => {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
  Logger.info('Cleanup jobs stopped');
};
