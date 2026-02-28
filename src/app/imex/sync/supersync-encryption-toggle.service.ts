import { inject, Injectable } from '@angular/core';
import { SuperSyncPrivateCfg } from '../../op-log/sync-providers/super-sync/super-sync.model';
import { SyncLog } from '../../core/log';
import { SnapshotUploadService } from './snapshot-upload.service';
import { OperationEncryptionService } from '../../op-log/sync/operation-encryption.service';
import { WrappedProviderService } from '../../op-log/sync-providers/wrapped-provider.service';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { SyncProviderId } from '../../op-log/sync-providers/provider.const';
import { isCryptoSubtleAvailable } from '../../op-log/encryption/encryption';
import { WebCryptoNotAvailableError } from '../../op-log/core/errors/sync-errors';

const LOG_PREFIX = 'SuperSyncEncryptionToggleService';

/**
 * Service for enabling/disabling encryption for SuperSync.
 *
 * Both flows follow the same pattern:
 * 1. Delete all data on server (encrypted and unencrypted ops can't be mixed)
 * 2. Upload current state as a new snapshot (encrypted or unencrypted)
 * 3. Update local config accordingly
 */
@Injectable({
  providedIn: 'root',
})
export class SuperSyncEncryptionToggleService {
  private _snapshotUploadService = inject(SnapshotUploadService);
  private _encryptionService = inject(OperationEncryptionService);
  private _wrappedProviderService = inject(WrappedProviderService);
  private _providerManager = inject(SyncProviderManager);

  /**
   * Enables encryption by deleting all server data and uploading a new encrypted snapshot.
   * Config is updated BEFORE upload so the upload uses the new key.
   * On failure, config is reverted.
   */
  async enableEncryption(encryptKey: string): Promise<void> {
    SyncLog.normal(`${LOG_PREFIX}: Starting encryption enable...`);

    if (!encryptKey) {
      throw new Error('Encryption key is required');
    }

    // Guard against concurrent calls
    const activeProvider = this._providerManager.getActiveProvider();
    if (activeProvider) {
      const currentCfg = (await activeProvider.privateCfg.load()) as
        | { isEncryptionEnabled?: boolean; encryptKey?: string }
        | undefined;
      if (currentCfg?.isEncryptionEnabled && currentCfg?.encryptKey) {
        SyncLog.normal(
          `${LOG_PREFIX}: Encryption is already enabled, skipping duplicate enableEncryption call`,
        );
        return;
      }
    }

    // Check crypto availability BEFORE deleting server data
    if (!isCryptoSubtleAvailable()) {
      throw new WebCryptoNotAvailableError(
        'Cannot enable encryption: WebCrypto API is not available. ' +
          'Encryption requires a secure context (HTTPS). ' +
          'On Android, encryption is not supported.',
      );
    }

    const { syncProvider, existingCfg, state, vectorClock, clientId } =
      await this._snapshotUploadService.gatherSnapshotData(LOG_PREFIX);

    SyncLog.normal(`${LOG_PREFIX}: Deleting server data...`);
    await syncProvider.deleteAllData();

    // Update config BEFORE upload so the upload uses the new key
    SyncLog.normal(`${LOG_PREFIX}: Updating local config...`);
    const newConfig = {
      ...existingCfg,
      encryptKey,
      isEncryptionEnabled: true,
    } as SuperSyncPrivateCfg;
    await this._providerManager.setProviderConfig(SyncProviderId.SuperSync, newConfig);

    this._wrappedProviderService.clearCache();

    SyncLog.normal(`${LOG_PREFIX}: Encrypting snapshot...`);
    const encryptedPayload = await this._encryptionService.encryptPayload(
      state,
      encryptKey,
    );

    try {
      await this._uploadAndFinalize(
        syncProvider,
        encryptedPayload,
        clientId,
        vectorClock,
        true,
      );
      SyncLog.normal(`${LOG_PREFIX}: Encryption enabled successfully!`);
    } catch (uploadError) {
      // Revert config on failure
      SyncLog.err(
        `${LOG_PREFIX}: Snapshot upload failed after deleting server data!`,
        uploadError,
      );

      const revertConfig = {
        ...existingCfg,
        encryptKey: undefined,
        isEncryptionEnabled: false,
      } as SuperSyncPrivateCfg;
      await this._providerManager.setProviderConfig(
        SyncProviderId.SuperSync,
        revertConfig,
      );
      this._wrappedProviderService.clearCache();

      throw new Error(
        'CRITICAL: Failed to upload encrypted snapshot after deleting server data. ' +
          'Your local data is safe. Encryption has been reverted. Please use "Sync Now" to re-upload your data. ' +
          `Original error: ${uploadError instanceof Error ? uploadError.message : uploadError}`,
      );
    }
  }

  /**
   * Disables encryption by deleting all server data and uploading an unencrypted snapshot.
   * Config is updated AFTER successful upload for safety.
   */
  async disableEncryption(): Promise<void> {
    SyncLog.normal(`${LOG_PREFIX}: Starting encryption disable...`);

    const { syncProvider, existingCfg, state, vectorClock, clientId } =
      await this._snapshotUploadService.gatherSnapshotData(LOG_PREFIX);

    SyncLog.normal(`${LOG_PREFIX}: Deleting server data...`);
    await syncProvider.deleteAllData();

    SyncLog.normal(`${LOG_PREFIX}: Uploading unencrypted snapshot...`);
    try {
      await this._uploadAndFinalize(syncProvider, state, clientId, vectorClock, false);

      // Update config AFTER successful upload
      // IMPORTANT: Use providerManager.setProviderConfig() instead of direct setPrivateCfg()
      // to ensure the currentProviderPrivateCfg$ observable is updated.
      SyncLog.normal(`${LOG_PREFIX}: Updating local config...`);
      await this._providerManager.setProviderConfig(SyncProviderId.SuperSync, {
        ...existingCfg,
        encryptKey: undefined,
        isEncryptionEnabled: false,
      } as SuperSyncPrivateCfg);

      this._wrappedProviderService.clearCache();
      SyncLog.normal(`${LOG_PREFIX}: Encryption disabled successfully!`);
    } catch (uploadError) {
      SyncLog.err(
        `${LOG_PREFIX}: Snapshot upload failed after deleting server data!`,
        uploadError,
      );

      throw new Error(
        'CRITICAL: Failed to upload unencrypted snapshot after deleting server data. ' +
          'Your local data is safe. Please use "Sync Now" to re-upload your data. ' +
          `Original error: ${uploadError instanceof Error ? uploadError.message : uploadError}`,
      );
    }
  }

  private async _uploadAndFinalize(
    syncProvider: Parameters<SnapshotUploadService['uploadSnapshot']>[0],
    payload: unknown,
    clientId: string,
    vectorClock: Record<string, number>,
    isPayloadEncrypted: boolean,
  ): Promise<void> {
    const result = await this._snapshotUploadService.uploadSnapshot(
      syncProvider,
      payload,
      clientId,
      vectorClock,
      isPayloadEncrypted,
    );

    if (!result.accepted) {
      throw new Error(`Snapshot upload failed: ${result.error}`);
    }

    await this._snapshotUploadService.updateLastServerSeq(
      syncProvider,
      result.serverSeq,
      LOG_PREFIX,
    );
  }
}
