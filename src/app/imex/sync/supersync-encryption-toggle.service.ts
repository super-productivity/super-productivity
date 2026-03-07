import { inject, Injectable } from '@angular/core';
import { SuperSyncPrivateCfg } from '../../op-log/sync-providers/super-sync/super-sync.model';
import { SyncLog } from '../../core/log';
import { SnapshotUploadService } from './snapshot-upload.service';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { SyncProviderId } from '../../op-log/sync-providers/provider.const';

const LOG_PREFIX = 'SuperSyncEncryptionToggleService';

/**
 * Service for enabling/disabling encryption for SuperSync.
 *
 * Both enable and disable flows delegate to SnapshotUploadService.deleteAndReuploadWithNewEncryption()
 * which handles: gather state -> encrypt (if enabling) -> delete server data -> update config -> upload.
 * This service adds toggle-specific concerns: guard against duplicate enable, config revert on failure.
 */
@Injectable({
  providedIn: 'root',
})
export class SuperSyncEncryptionToggleService {
  private _snapshotUploadService = inject(SnapshotUploadService);
  private _providerManager = inject(SyncProviderManager);

  /**
   * Enables encryption:
   * 1. Guard against duplicate calls
   * 2. Delegate to deleteAndReuploadWithNewEncryption (encrypt, delete, config, upload)
   * 3. Clear cache on success, revert config on failure
   */
  async enableEncryption(encryptKey: string): Promise<void> {
    SyncLog.normal(`${LOG_PREFIX}: Starting encryption enable...`);

    if (!encryptKey) {
      throw new Error('Encryption key is required');
    }

    // Capture existing config BEFORE destructive call so we can revert on failure.
    // Also serves as guard against duplicate enable calls.
    const existingCfg = (await this._providerManager
      .getActiveProvider()
      ?.privateCfg.load()) as SuperSyncPrivateCfg | undefined;

    if (existingCfg?.isEncryptionEnabled && existingCfg?.encryptKey) {
      SyncLog.normal(
        `${LOG_PREFIX}: Encryption is already enabled, skipping duplicate enableEncryption call`,
      );
      return;
    }

    try {
      await this._snapshotUploadService.deleteAndReuploadWithNewEncryption({
        encryptKey,
        isEncryptionEnabled: true,
        logPrefix: LOG_PREFIX,
      });

      SyncLog.normal(`${LOG_PREFIX}: Encryption enabled successfully!`);
    } catch (error) {
      // Revert config on failure (server data is already deleted at this point)
      SyncLog.err(`${LOG_PREFIX}: Failed after deleting server data!`, error);

      // Best-effort revert: restore pre-enable config.
      // existingCfg was captured before enabling, so it already has isEncryptionEnabled: false
      // and no encryptKey. The explicit overrides ensure correctness even if the guard above
      // was bypassed (e.g., existingCfg was partially set).
      await this._providerManager.setProviderConfig(SyncProviderId.SuperSync, {
        ...existingCfg,
        encryptKey: undefined,
        isEncryptionEnabled: false,
      } as SuperSyncPrivateCfg);

      throw new Error(
        'CRITICAL: Failed to upload encrypted snapshot after deleting server data. ' +
          'Your local data is safe. Encryption has been reverted. Please use "Sync Now" to re-upload your data. ' +
          `Original error: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  /**
   * Disables encryption by deleting all server data and uploading an unencrypted snapshot.
   */
  async disableEncryption(): Promise<void> {
    SyncLog.normal(`${LOG_PREFIX}: Starting encryption disable...`);

    // Capture existing config BEFORE destructive call so we can revert on failure
    // (including the encryption key, which deleteAndReuploadWithNewEncryption clears)
    const existingCfg = (await this._providerManager
      .getActiveProvider()
      ?.privateCfg.load()) as SuperSyncPrivateCfg | undefined;

    try {
      await this._snapshotUploadService.deleteAndReuploadWithNewEncryption({
        encryptKey: undefined,
        isEncryptionEnabled: false,
        logPrefix: LOG_PREFIX,
      });

      SyncLog.normal(`${LOG_PREFIX}: Encryption disabled successfully!`);
    } catch (uploadError) {
      SyncLog.err(
        `${LOG_PREFIX}: Snapshot upload failed after deleting server data!`,
        uploadError,
      );

      // Best-effort revert: restore original config (including encryption key)
      if (existingCfg) {
        await this._providerManager.setProviderConfig(
          SyncProviderId.SuperSync,
          existingCfg,
        );
      }

      throw new Error(
        'CRITICAL: Failed to upload unencrypted snapshot after deleting server data. ' +
          'Your local data is safe. Encryption is still enabled. Please try disabling encryption again. ' +
          `Original error: ${uploadError instanceof Error ? uploadError.message : uploadError}`,
      );
    }
  }
}
