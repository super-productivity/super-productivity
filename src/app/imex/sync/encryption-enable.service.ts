import { inject, Injectable } from '@angular/core';
import { SuperSyncPrivateCfg } from '../../op-log/sync-providers/super-sync/super-sync.model';
import { SuperSyncProvider } from '../../op-log/sync-providers/super-sync/super-sync';
import { SyncLog } from '../../core/log';
import { SnapshotUploadService } from './snapshot-upload.service';
import { OperationEncryptionService } from '../../op-log/sync/operation-encryption.service';
import { WrappedProviderService } from '../../op-log/sync-providers/wrapped-provider.service';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { SyncProviderId } from '../../op-log/sync-providers/provider.const';
import { isCryptoSubtleAvailable } from '../../op-log/encryption/encryption';
import { WebCryptoNotAvailableError } from '../../op-log/core/errors/sync-errors';

const LOG_PREFIX = 'EncryptionEnableService';

/**
 * Service for enabling encryption for SuperSync.
 *
 * Enable encryption flow:
 * 1. Delete all data on server (unencrypted operations can't be mixed with encrypted)
 * 2. Update local config BEFORE upload (so upload uses the new key)
 * 3. Upload current state as encrypted snapshot
 * 4. Revert config on failure
 */
@Injectable({
  providedIn: 'root',
})
export class EncryptionEnableService {
  private _snapshotUploadService = inject(SnapshotUploadService);
  private _encryptionService = inject(OperationEncryptionService);
  private _wrappedProviderService = inject(WrappedProviderService);
  private _providerManager = inject(SyncProviderManager);

  /**
   * Enables encryption by deleting all server data
   * and uploading a new encrypted snapshot.
   *
   * @param encryptKey The encryption key to use
   * @throws Error if sync provider is not SuperSync or not ready
   */
  async enableEncryption(encryptKey: string): Promise<void> {
    SyncLog.normal(`${LOG_PREFIX}: Starting encryption enable...`);

    if (!encryptKey) {
      throw new Error('Encryption key is required');
    }

    // CRITICAL: Check crypto availability BEFORE deleting server data
    // to prevent data loss if encryption will fail
    if (!isCryptoSubtleAvailable()) {
      throw new WebCryptoNotAvailableError(
        'Cannot enable encryption: WebCrypto API is not available. ' +
          'Encryption requires a secure context (HTTPS). ' +
          'On Android, encryption is not supported.',
      );
    }

    // Gather all data needed for upload (validates provider)
    const { syncProvider, existingCfg, state, vectorClock, clientId } =
      await this._snapshotUploadService.gatherSnapshotData(LOG_PREFIX);

    // Delete all server data (unencrypted ops can't be mixed with encrypted)
    SyncLog.normal(`${LOG_PREFIX}: Deleting server data...`);
    await syncProvider.deleteAllData();

    // Update local config BEFORE upload - enable encryption and set the key
    // This must happen BEFORE upload so the upload uses the new key
    // IMPORTANT: Use providerManager.setProviderConfig() instead of direct setPrivateCfg()
    // to ensure the currentProviderPrivateCfg$ observable is updated, which is needed
    // for the form to correctly show isEncryptionEnabled state.
    SyncLog.normal(`${LOG_PREFIX}: Updating local config...`);
    const newConfig = {
      ...existingCfg,
      encryptKey,
      isEncryptionEnabled: true,
      isAutoEncryptionEnabled: false,
      autoEncryptionKey: undefined,
    } as SuperSyncPrivateCfg;
    await this._providerManager.setProviderConfig(SyncProviderId.SuperSync, newConfig);

    // Clear cached adapters to ensure new encryption settings take effect
    this._wrappedProviderService.clearCache();

    // Upload encrypted snapshot
    SyncLog.normal(`${LOG_PREFIX}: Encrypting and uploading encrypted snapshot...`);
    try {
      // Encrypt inside try so revert fires on failure
      const encryptedPayload = await this._encryptionService.encryptPayload(
        state,
        encryptKey,
      );

      const result = await this._snapshotUploadService.uploadSnapshot(
        syncProvider,
        encryptedPayload,
        clientId,
        vectorClock,
        true, // isPayloadEncrypted = true
      );

      if (!result.accepted) {
        throw new Error(`Snapshot upload failed: ${result.error}`);
      }

      // Update lastServerSeq
      await this._snapshotUploadService.updateLastServerSeq(
        syncProvider,
        result.serverSeq,
        LOG_PREFIX,
      );

      SyncLog.normal(`${LOG_PREFIX}: Encryption enabled successfully!`);
    } catch (uploadError) {
      // CRITICAL: Server data was deleted but new snapshot failed to upload.
      // Revert local config to unencrypted state
      SyncLog.err(
        `${LOG_PREFIX}: Snapshot upload failed after deleting server data!`,
        uploadError,
      );

      // Use providerManager.setProviderConfig() to update both the stored config
      // AND the currentProviderPrivateCfg$ observable for proper form state
      const revertConfig = {
        ...existingCfg,
        encryptKey: undefined,
        isEncryptionEnabled: false,
        isAutoEncryptionEnabled: false,
        autoEncryptionKey: undefined,
      } as SuperSyncPrivateCfg;
      await this._providerManager.setProviderConfig(
        SyncProviderId.SuperSync,
        revertConfig,
      );

      // Clear cached adapters since encryption settings were reverted
      this._wrappedProviderService.clearCache();

      throw new Error(
        'CRITICAL: Failed to upload encrypted snapshot after deleting server data. ' +
          'Your local data is safe. Encryption has been reverted. Please use "Sync Now" to re-upload your data. ' +
          `Original error: ${uploadError instanceof Error ? uploadError.message : uploadError}`,
      );
    }
  }

  /**
   * Enables auto-encryption using a server-derived key.
   * This provides encryption at rest with zero user friction.
   *
   * Flow:
   * 1. Fetch auto-encryption key from server
   * 2. Delete all server data (unencrypted ops can't be mixed with encrypted)
   * 3. Update local config with auto-encryption key
   * 4. Encrypt and upload current state
   * 5. Revert on failure
   */
  async enableAutoEncryption(): Promise<void> {
    SyncLog.normal(`${LOG_PREFIX}: Starting auto-encryption enable...`);

    // Check crypto availability BEFORE deleting server data
    if (!isCryptoSubtleAvailable()) {
      throw new WebCryptoNotAvailableError(
        'Cannot enable auto-encryption: WebCrypto API is not available. ' +
          'Encryption requires a secure context (HTTPS). ' +
          'On Android, encryption is not supported.',
      );
    }

    // Gather all data needed for upload (validates provider)
    const { syncProvider, existingCfg, state, vectorClock, clientId } =
      await this._snapshotUploadService.gatherSnapshotData(LOG_PREFIX);

    // Cast to SuperSyncProvider to access fetchAutoEncryptionKey()
    const superSyncProvider = syncProvider as unknown as SuperSyncProvider;

    // Fetch auto-encryption key from server
    SyncLog.normal(`${LOG_PREFIX}: Fetching auto-encryption key from server...`);
    const autoEncryptionKey = await superSyncProvider.fetchAutoEncryptionKey();

    // Delete all server data (unencrypted ops can't be mixed with encrypted)
    SyncLog.normal(`${LOG_PREFIX}: Deleting server data...`);
    await syncProvider.deleteAllData();

    // Update local config BEFORE upload
    SyncLog.normal(`${LOG_PREFIX}: Updating local config for auto-encryption...`);
    const newConfig = {
      ...existingCfg,
      isAutoEncryptionEnabled: true,
      autoEncryptionKey,
      isEncryptionEnabled: false,
      encryptKey: undefined,
    } as SuperSyncPrivateCfg;
    await this._providerManager.setProviderConfig(SyncProviderId.SuperSync, newConfig);

    // Clear cached adapters to ensure new encryption settings take effect
    this._wrappedProviderService.clearCache();

    // Upload encrypted snapshot
    SyncLog.normal(`${LOG_PREFIX}: Encrypting and uploading auto-encrypted snapshot...`);
    try {
      // Encrypt inside try so revert fires on failure
      const encryptedPayload = await this._encryptionService.encryptPayload(
        state,
        autoEncryptionKey,
      );

      const result = await this._snapshotUploadService.uploadSnapshot(
        syncProvider,
        encryptedPayload,
        clientId,
        vectorClock,
        true, // isPayloadEncrypted = true
      );

      if (!result.accepted) {
        throw new Error(`Snapshot upload failed: ${result.error}`);
      }

      // Update lastServerSeq
      await this._snapshotUploadService.updateLastServerSeq(
        syncProvider,
        result.serverSeq,
        LOG_PREFIX,
      );

      SyncLog.normal(`${LOG_PREFIX}: Auto-encryption enabled successfully!`);
    } catch (uploadError) {
      // Revert local config on failure
      SyncLog.err(`${LOG_PREFIX}: Auto-encrypted snapshot upload failed!`, uploadError);

      const revertConfig = {
        ...existingCfg,
        isAutoEncryptionEnabled: false,
        autoEncryptionKey: undefined,
      } as SuperSyncPrivateCfg;
      await this._providerManager.setProviderConfig(
        SyncProviderId.SuperSync,
        revertConfig,
      );

      this._wrappedProviderService.clearCache();

      throw new Error(
        'CRITICAL: Failed to upload auto-encrypted snapshot after deleting server data. ' +
          'Your local data is safe. Auto-encryption has been reverted. Please use "Sync Now" to re-upload your data. ' +
          `Original error: ${uploadError instanceof Error ? uploadError.message : uploadError}`,
      );
    }
  }
}
