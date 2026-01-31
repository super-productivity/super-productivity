import { inject, Injectable } from '@angular/core';
import { SuperSyncPrivateCfg } from '../../op-log/sync-providers/super-sync/super-sync.model';
import { SyncLog } from '../../core/log';
import { SnapshotUploadService } from './snapshot-upload.service';
import { WrappedProviderService } from '../../op-log/sync-providers/wrapped-provider.service';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { StateSnapshotService } from '../../op-log/backup/state-snapshot.service';
import { VectorClockService } from '../../op-log/sync/vector-clock.service';
import {
  CLIENT_ID_PROVIDER,
  ClientIdProvider,
} from '../../op-log/util/client-id.provider';
import { CURRENT_SCHEMA_VERSION } from '../../op-log/persistence/schema-migration.service';
import { uuidv7 } from '../../util/uuid-v7';
import { isFileBasedProvider } from '../../op-log/sync/operation-sync.util';
import { FileBasedSyncAdapterService } from '../../op-log/sync-providers/file-based/file-based-sync-adapter.service';
import { GlobalConfigService } from '../../features/config/global-config.service';

const LOG_PREFIX = 'EncryptionDisableService';

/**
 * Service for disabling encryption for sync providers.
 *
 * ## SuperSync
 * Disable encryption flow:
 * 1. Delete all data on server (encrypted operations can't be mixed with unencrypted)
 * 2. Upload current state as unencrypted snapshot
 * 3. Update local config to disable encryption and clear the key
 *
 * ## File-based providers (Dropbox, WebDAV, LocalFile)
 * Disable encryption flow:
 * 1. Get current local state snapshot
 * 2. Upload unencrypted snapshot (replace encrypted sync file)
 * 3. Update local config to disable encryption and clear the key
 */
@Injectable({
  providedIn: 'root',
})
export class EncryptionDisableService {
  private _snapshotUploadService = inject(SnapshotUploadService);
  private _wrappedProviderService = inject(WrappedProviderService);
  private _providerManager = inject(SyncProviderManager);
  private _stateSnapshotService = inject(StateSnapshotService);
  private _vectorClockService = inject(VectorClockService);
  private _clientIdProvider: ClientIdProvider = inject(CLIENT_ID_PROVIDER);
  private _fileBasedAdapter = inject(FileBasedSyncAdapterService);
  private _globalConfigService = inject(GlobalConfigService);

  /**
   * Disables encryption by deleting all server data
   * and uploading a new unencrypted snapshot.
   *
   * @throws Error if sync provider is not SuperSync or not ready
   */
  async disableEncryption(): Promise<void> {
    SyncLog.normal(`${LOG_PREFIX}: Starting encryption disable...`);

    // Gather all data needed for upload (validates provider)
    const { syncProvider, existingCfg, state, vectorClock, clientId } =
      await this._snapshotUploadService.gatherSnapshotData(LOG_PREFIX);

    // Delete all server data (encrypted ops can't be mixed with unencrypted)
    SyncLog.normal(`${LOG_PREFIX}: Deleting server data...`);
    await syncProvider.deleteAllData();

    // Upload unencrypted snapshot
    SyncLog.normal(`${LOG_PREFIX}: Uploading unencrypted snapshot...`);
    try {
      const result = await this._snapshotUploadService.uploadSnapshot(
        syncProvider,
        state,
        clientId,
        vectorClock,
        false, // isPayloadEncrypted = false
      );

      if (!result.accepted) {
        throw new Error(`Snapshot upload failed: ${result.error}`);
      }

      // Update local config AFTER successful upload - disable encryption and clear the key
      SyncLog.normal(`${LOG_PREFIX}: Updating local config...`);
      await syncProvider.setPrivateCfg({
        ...existingCfg,
        encryptKey: undefined,
        isEncryptionEnabled: false,
      } as SuperSyncPrivateCfg);

      // Clear cached adapters to ensure new encryption settings take effect
      this._wrappedProviderService.clearCache();

      // Update lastServerSeq
      await this._snapshotUploadService.updateLastServerSeq(
        syncProvider,
        result.serverSeq,
        LOG_PREFIX,
      );

      SyncLog.normal(`${LOG_PREFIX}: Encryption disabled successfully!`);
    } catch (uploadError) {
      // CRITICAL: Server data was deleted but new snapshot failed to upload.
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

  /**
   * Disables encryption for file-based sync providers (Dropbox, WebDAV, LocalFile).
   *
   * Flow:
   * 1. Validate provider is file-based and ready
   * 2. Get current local state snapshot
   * 3. Create unencrypted adapter and upload snapshot
   * 4. Update local config to disable encryption and clear the key
   * 5. Clear caches
   *
   * @throws Error if sync provider is not file-based or not ready
   */
  async disableEncryptionForFileBased(): Promise<void> {
    SyncLog.normal(
      `${LOG_PREFIX}: Starting encryption disable for file-based provider...`,
    );

    // Get active provider
    const provider = this._providerManager.getActiveProvider();
    if (!provider) {
      throw new Error('No active sync provider. Please enable sync first.');
    }

    // Validate it's a file-based provider
    if (!isFileBasedProvider(provider)) {
      throw new Error(
        `This operation is only supported for file-based providers (Dropbox, WebDAV, LocalFile). ` +
          `Current provider: ${provider.id}`,
      );
    }

    // Check provider is ready
    if (!(await provider.isReady())) {
      throw new Error('Sync provider is not ready. Please configure sync first.');
    }

    // Get current state
    SyncLog.normal(`${LOG_PREFIX}: Getting current state...`);
    const state = await this._stateSnapshotService.getStateSnapshotAsync();
    const vectorClock = await this._vectorClockService.getCurrentVectorClock();
    const clientId = await this._clientIdProvider.loadClientId();

    if (!clientId) {
      throw new Error('Client ID not available');
    }

    // Get existing config
    const existingCfg = await provider.privateCfg.load();

    // Create unencrypted adapter (pass undefined for encryptKey)
    SyncLog.normal(`${LOG_PREFIX}: Creating unencrypted adapter...`);
    const baseCfg = this._providerManager.getEncryptAndCompressCfg();
    const unencryptedCfg = {
      ...baseCfg,
      isEncrypt: false, // Explicitly disable encryption
    };

    const adapter = this._fileBasedAdapter.createAdapter(
      provider,
      unencryptedCfg,
      undefined, // No encryption key
    );

    // Upload unencrypted snapshot
    SyncLog.normal(`${LOG_PREFIX}: Uploading unencrypted snapshot...`);
    try {
      const result = await adapter.uploadSnapshot(
        state,
        clientId,
        'recovery',
        vectorClock,
        CURRENT_SCHEMA_VERSION,
        false, // isPayloadEncrypted = false
        uuidv7(),
      );

      if (!result.accepted) {
        throw new Error(`Snapshot upload failed: ${result.error}`);
      }

      // Update local config AFTER successful upload
      SyncLog.normal(`${LOG_PREFIX}: Updating local config...`);

      // Update provider's private config (encryptKey)
      await provider.setPrivateCfg({
        ...existingCfg,
        encryptKey: undefined,
      });

      // Update global sync config (isEncryptionEnabled, encryptKey)
      this._globalConfigService.updateSection('sync', {
        isEncryptionEnabled: false,
        encryptKey: '',
      });

      // Clear cached adapters to ensure new encryption settings take effect
      this._wrappedProviderService.clearCache();

      // Update lastServerSeq
      if (result.serverSeq !== undefined) {
        await adapter.setLastServerSeq(result.serverSeq);
      }

      SyncLog.normal(
        `${LOG_PREFIX}: Encryption disabled successfully for file-based provider!`,
      );
    } catch (uploadError) {
      SyncLog.err(`${LOG_PREFIX}: Failed to upload unencrypted snapshot!`, uploadError);

      throw new Error(
        'Failed to upload unencrypted snapshot. ' +
          'Your local data is safe. Please try again. ' +
          `Original error: ${uploadError instanceof Error ? uploadError.message : uploadError}`,
      );
    }
  }
}
