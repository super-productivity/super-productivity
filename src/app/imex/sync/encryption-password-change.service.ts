import { inject, Injectable } from '@angular/core';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { isOperationSyncCapable } from '../../op-log/sync/operation-sync.util';
import { SyncProviderId } from '../../op-log/sync-providers/provider.const';
import { SuperSyncPrivateCfg } from '../../op-log/sync-providers/super-sync/super-sync.model';
import { SyncLog } from '../../core/log';
import { DerivedKeyCacheService } from '../../op-log/encryption/derived-key-cache.service';
import { CleanSlateService } from '../../op-log/clean-slate/clean-slate.service';
import { OperationLogUploadService } from '../../op-log/sync/operation-log-upload.service';
import { SyncWrapperService } from './sync-wrapper.service';
import { OperationLogStoreService } from '../../op-log/persistence/operation-log-store.service';
import { isFullStateOpType } from '../../op-log/core/operation.types';
import { WrappedProviderService } from '../../op-log/sync-providers/wrapped-provider.service';

/**
 * Service for changing the encryption password for SuperSync.
 *
 * Password change flow (using clean slate):
 * 1. Create clean slate locally (generates new client ID, fresh SYNC_IMPORT)
 * 2. Update local config with new password
 * 3. Upload SYNC_IMPORT with isCleanSlate=true flag (server deletes all data first)
 */
@Injectable({
  providedIn: 'root',
})
export class EncryptionPasswordChangeService {
  private _providerManager = inject(SyncProviderManager);
  private _cleanSlateService = inject(CleanSlateService);
  private _uploadService = inject(OperationLogUploadService);
  private _derivedKeyCache = inject(DerivedKeyCacheService);
  private _syncWrapper = inject(SyncWrapperService);
  private _opLogStore = inject(OperationLogStoreService);
  private _wrappedProviderService = inject(WrappedProviderService);

  /**
   * Changes the encryption password using the clean slate approach.
   *
   * Clean slate flow:
   * 1. Wait for any ongoing sync to complete and block new syncs
   * 2. Check for unsynced operations (inside lock to prevent race conditions)
   * 3. Create local clean slate (new client ID, fresh SYNC_IMPORT operation)
   * 4. Update config with new encryption password
   * 5. Upload with isCleanSlate=true flag (server deletes all data first)
   *
   * This approach is simpler and more robust than the old approach because:
   * - Server deletion and upload happen atomically in one transaction
   * - No need for complex recovery logic
   * - Fresh client ID prevents any stale operation conflicts
   * - Sync is blocked during the entire operation to prevent race conditions
   *
   * @param newPassword - The new encryption password
   * @throws Error if sync provider is not SuperSync or not ready
   */
  async changePassword(
    newPassword: string,
    options?: { allowUnsyncedOps?: boolean },
  ): Promise<void> {
    SyncLog.normal('EncryptionPasswordChangeService: Starting password change...');

    // Get the sync provider
    const syncProvider = this._providerManager.getActiveProvider();
    if (!syncProvider || syncProvider.id !== SyncProviderId.SuperSync) {
      throw new Error('Password change is only supported for SuperSync');
    }

    if (!isOperationSyncCapable(syncProvider)) {
      throw new Error('Sync provider does not support operation sync');
    }

    // Run the entire password change with sync blocked to prevent race conditions.
    // This waits for any ongoing sync to complete, then blocks new syncs.
    await this._syncWrapper.runWithSyncBlocked(async () => {
      // CRITICAL: Check for unsynced operations INSIDE the lock to prevent race conditions.
      // If we check outside, a background operation could add unsynced ops between
      // the check and acquiring the lock, and those ops would be lost.
      const unsyncedOps = await this._opLogStore.getUnsynced();
      const unsyncedUserOps = unsyncedOps.filter(
        (entry) => !isFullStateOpType(entry.op.opType),
      );
      if (unsyncedUserOps.length > 0 && !options?.allowUnsyncedOps) {
        throw new Error(
          `Cannot change password: ${unsyncedUserOps.length} operation(s) have not been synced yet. ` +
            'Please wait for sync to complete or manually trigger a sync before changing the password.',
        );
      }
      if (unsyncedUserOps.length > 0 && options?.allowUnsyncedOps) {
        SyncLog.warn(
          `EncryptionPasswordChangeService: Proceeding with password change despite ` +
            `${unsyncedUserOps.length} unsynced operation(s) (force overwrite).`,
        );
      }

      // Get current config
      const existingCfg =
        (await syncProvider.privateCfg.load()) as SuperSyncPrivateCfg | null;

      // STEP 1: Create clean slate locally
      // This generates a new client ID, clears local ops, and creates a fresh SYNC_IMPORT
      SyncLog.normal('EncryptionPasswordChangeService: Creating clean slate...');
      await this._cleanSlateService.createCleanSlate('ENCRYPTION_CHANGE');

      // STEP 2: Verify the SYNC_IMPORT was stored
      // This catches any IndexedDB timing issues before we proceed
      const pendingOps = await this._opLogStore.getUnsynced();
      if (pendingOps.length === 0) {
        throw new Error(
          'Clean slate creation failed - no SYNC_IMPORT operation was stored. ' +
            'This may indicate a database issue. Please try again.',
        );
      }
      SyncLog.normal('EncryptionPasswordChangeService: Verified SYNC_IMPORT stored', {
        pendingOpsCount: pendingOps.length,
      });

      // STEP 3: Update config with new password BEFORE upload
      // This ensures the upload will use the new password for encryption
      SyncLog.normal('EncryptionPasswordChangeService: Updating encryption config...');
      await syncProvider.setPrivateCfg({
        ...existingCfg,
        encryptKey: newPassword,
        isEncryptionEnabled: true,
      } as SuperSyncPrivateCfg);

      // Clear cached encryption keys to force re-derivation with new password
      this._derivedKeyCache.clearCache();
      // Clear cached adapters to ensure new encryption settings take effect
      this._wrappedProviderService.clearCache();

      // STEP 4: Upload the SYNC_IMPORT with isCleanSlate=true flag
      // The server will delete all existing data before accepting the operation
      SyncLog.normal(
        'EncryptionPasswordChangeService: Uploading clean slate with new encryption...',
      );
      try {
        const result = await this._uploadService.uploadPendingOps(syncProvider, {
          isCleanSlate: true,
        });

        if (result.uploadedCount === 0) {
          throw new Error('No operations uploaded - upload may have failed silently');
        }

        if (result.rejectedCount > 0) {
          throw new Error(
            `Clean slate upload was rejected by server: ${result.rejectedOps[0]?.error || 'Unknown error'}`,
          );
        }

        SyncLog.normal('EncryptionPasswordChangeService: Password change complete!');
      } catch (uploadError) {
        // IMPORTANT: Do NOT revert the password config on upload failure.
        // At this point:
        // - Clean slate has been created (old operations cleared)
        // - SYNC_IMPORT is stored locally (unencrypted in IndexedDB)
        // - Config has new password
        //
        // If we revert to old password, the next sync attempt would encrypt the
        // SYNC_IMPORT with the old password, but the user expects it to use the
        // new password they entered. Keep the new password and let user retry.
        SyncLog.err(
          'EncryptionPasswordChangeService: Upload failed - keeping new password config for retry',
          uploadError,
        );

        throw new Error(
          `Password change failed during upload: ${uploadError instanceof Error ? uploadError.message : uploadError}. ` +
            'Your new password has been saved locally. Please click "Change Password" again with the SAME password to retry the upload. ' +
            'If problems persist, you may need to re-import your data from backup.',
        );
      }
    });
  }
}
