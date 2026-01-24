import { inject, Injectable } from '@angular/core';
import { SnackService } from '../../core/snack/snack.service';
import { SyncProviderId } from '../../op-log/sync-providers/provider.const';
import { SuperSyncProvider } from '../../op-log/sync-providers/super-sync/super-sync';
import {
  RestoreCapable,
  RestorePoint,
} from '../../op-log/sync-providers/provider.interface';
import { AppDataComplete } from '../../op-log/model/model-config';
import { T } from '../../t.const';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { BackupService } from '../../op-log/backup/backup.service';

/**
 * Service for restoring state from Super Sync server history.
 * Uses the operation log stored on the server to reconstruct past states.
 */
@Injectable({ providedIn: 'root' })
export class SuperSyncRestoreService {
  private _snackService = inject(SnackService);
  private _providerManager = inject(SyncProviderManager);
  private _backupService = inject(BackupService);

  /**
   * Check if Super Sync restore is available.
   * Returns true if Super Sync is the active provider and is ready.
   */
  async isAvailable(): Promise<boolean> {
    const provider = this._getProvider();
    if (!provider) {
      return false;
    }
    return provider.isReady();
  }

  /**
   * Get available restore points from the server.
   * Returns a list of points in time that can be restored to.
   */
  async getRestorePoints(limit: number = 30): Promise<RestorePoint[]> {
    const provider = this._getRestoreCapableProvider();
    return provider.getRestorePoints(limit);
  }

  /**
   * Restore state to a specific point in time.
   * @param serverSeq The server sequence to restore to
   */
  async restoreToPoint(serverSeq: number): Promise<void> {
    const provider = this._getRestoreCapableProvider();

    let retryCount = 0;
    const MAX_RETRIES = 2;

    while (retryCount <= MAX_RETRIES) {
      try {
        // 1. Fetch state at the specified serverSeq
        const snapshot = await provider.getStateAtSeq(serverSeq);

        // 2. Import with isForceConflict=true to generate fresh vector clock
        // This ensures the restored state syncs cleanly to all devices
        await this._backupService.importCompleteBackup(
          snapshot.state as AppDataComplete,
          true, // isSkipLegacyWarnings
          true, // isSkipReload - no page reload needed
          true, // isForceConflict - generates fresh vector clock
        );

        this._snackService.open({
          type: 'SUCCESS',
          msg: T.F.SYNC.S.RESTORE_SUCCESS,
        });
        return;
      } catch (error) {
        const errorMsg = (error as Error).message?.toLowerCase() || '';
        const isNetworkError =
          errorMsg.includes('timeout') ||
          errorMsg.includes('504') ||
          errorMsg.includes('failed to fetch') ||
          errorMsg.includes('network');

        if (isNetworkError && retryCount < MAX_RETRIES) {
          retryCount++;
          console.warn(
            `Restore failed due to network error, retrying (${retryCount}/${MAX_RETRIES}):`,
            error,
          );
          // Exponential backoff: 2s, 4s
          await new Promise((resolve) => setTimeout(resolve, 2000 * retryCount));
          continue;
        }

        console.error('Failed to restore from point:', error);
        this._snackService.open({
          type: 'ERROR',
          msg: T.F.SYNC.S.RESTORE_ERROR,
        });
        throw error;
      }
    }
  }

  /**
   * Get the Super Sync provider if it's the active provider.
   */
  private _getProvider(): SuperSyncProvider | null {
    const provider = this._providerManager.getActiveProvider();
    if (!provider || provider.id !== SyncProviderId.SuperSync) {
      return null;
    }
    return provider as SuperSyncProvider;
  }

  /**
   * Get the provider and verify it supports restore operations.
   * Throws if Super Sync is not active.
   */
  private _getRestoreCapableProvider(): SuperSyncProvider & RestoreCapable {
    const provider = this._getProvider();
    if (!provider) {
      throw new Error('Super Sync is not the active sync provider');
    }
    return provider;
  }
}
