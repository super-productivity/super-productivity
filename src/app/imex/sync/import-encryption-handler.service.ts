import { inject, Injectable } from '@angular/core';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { SyncProviderId } from '../../op-log/sync-providers/provider.const';
import { SuperSyncPrivateCfg } from '../../op-log/sync-providers/super-sync/super-sync.model';
import { SyncLog } from '../../core/log';
import { AppDataComplete } from '../../op-log/model/model-config';
import { OperationEncryptionService } from '../../op-log/sync/operation-encryption.service';
import { SnapshotUploadService } from './snapshot-upload.service';
import { isCryptoSubtleAvailable } from '../../op-log/encryption/encryption';

export interface EncryptionStateChangeResult {
  encryptionStateChanged: boolean;
  serverDataDeleted: boolean;
  snapshotUploaded: boolean;
  error?: string;
}

const LOG_PREFIX = 'ImportEncryptionHandlerService';

/**
 * Service for handling encryption state changes during data import.
 *
 * When importing data that has different encryption settings than the current
 * sync provider configuration, this service ensures:
 * 1. All server data is deleted (encrypted ops can't mix with unencrypted)
 * 2. The current state is uploaded as a fresh snapshot with correct encryption
 * 3. The sync provider config is updated to match the imported settings
 *
 * This is necessary because:
 * - Encrypted and unencrypted operations cannot coexist on the server
 * - A fresh snapshot ensures all clients get a consistent state
 * - The import represents a "tabula rasa" for the sync state
 */
@Injectable({
  providedIn: 'root',
})
export class ImportEncryptionHandlerService {
  private _providerManager = inject(SyncProviderManager);
  private _encryptionService = inject(OperationEncryptionService);
  private _snapshotUploadService = inject(SnapshotUploadService);

  /**
   * Checks if the imported data has different encryption settings than
   * the current sync provider configuration.
   *
   * @param importedData - The data being imported
   * @returns Object with comparison results
   */
  async checkEncryptionStateChange(importedData: AppDataComplete): Promise<{
    willChange: boolean;
    currentEnabled: boolean;
    importedEnabled: boolean;
    currentHasKey: boolean;
    importedHasKey: boolean;
  }> {
    const syncProvider = this._providerManager.getActiveProvider();

    // If not using SuperSync, no encryption handling needed
    if (!syncProvider || syncProvider.id !== SyncProviderId.SuperSync) {
      return {
        willChange: false,
        currentEnabled: false,
        importedEnabled: false,
        currentHasKey: false,
        importedHasKey: false,
      };
    }

    // Get current encryption state from provider config
    const currentCfg =
      (await syncProvider.privateCfg.load()) as SuperSyncPrivateCfg | null;
    const currentEnabled = currentCfg?.isEncryptionEnabled ?? false;
    const currentHasKey = !!currentCfg?.encryptKey;

    // Get imported encryption state from globalConfig
    const importedSuperSync = (
      importedData.globalConfig as {
        sync?: { superSync?: { isEncryptionEnabled?: boolean; encryptKey?: string } };
      }
    )?.sync?.superSync;
    const importedEnabled = importedSuperSync?.isEncryptionEnabled ?? false;
    const importedHasKey = !!importedSuperSync?.encryptKey;

    // Encryption state changes if enabled state differs
    const willChange = currentEnabled !== importedEnabled;

    return {
      willChange,
      currentEnabled,
      importedEnabled,
      currentHasKey,
      importedHasKey,
    };
  }

  /**
   * Handles encryption state change during import by wiping server data
   * and uploading a fresh snapshot with the new encryption settings.
   *
   * This should be called AFTER the import has been applied to the NgRx store
   * but BEFORE the next automatic sync.
   *
   * @param importedData - The imported data (now in the store)
   * @param newEncryptKey - The encryption key from the imported data (if any)
   * @param isEncryptionEnabled - Whether encryption should be enabled
   */
  async handleEncryptionStateChange(
    importedData: AppDataComplete,
    newEncryptKey: string | undefined,
    isEncryptionEnabled: boolean,
  ): Promise<EncryptionStateChangeResult> {
    SyncLog.normal(`${LOG_PREFIX}: Handling encryption state change...`, {
      isEncryptionEnabled,
      hasKey: !!newEncryptKey,
    });

    // Validate provider - use try/catch since this service returns results instead of throwing
    let snapshotData;
    try {
      snapshotData = await this._snapshotUploadService.gatherSnapshotData(LOG_PREFIX);
    } catch (validationError) {
      const errorMessage =
        validationError instanceof Error
          ? validationError.message
          : 'Provider validation failed';
      return {
        encryptionStateChanged: false,
        serverDataDeleted: false,
        snapshotUploaded: false,
        error: errorMessage,
      };
    }

    const { syncProvider, existingCfg, state, vectorClock, clientId } = snapshotData;

    // CRITICAL: Check crypto availability BEFORE deleting server data
    // to prevent data loss if encryption will fail (only needed when enabling encryption)
    if (isEncryptionEnabled && !isCryptoSubtleAvailable()) {
      return {
        encryptionStateChanged: false,
        serverDataDeleted: false,
        snapshotUploaded: false,
        error:
          'Cannot enable encryption: WebCrypto API is not available. ' +
          'Encryption requires a secure context (HTTPS). ' +
          'On Android, encryption is not supported.',
      };
    }

    try {
      // 1. Delete all server data (encrypted ops can't mix with unencrypted)
      SyncLog.normal(`${LOG_PREFIX}: Deleting server data...`);
      await syncProvider.deleteAllData();

      // 2. Update sync provider config with new encryption settings BEFORE upload
      // IMPORTANT: Use providerManager.setProviderConfig() instead of direct setPrivateCfg()
      // to ensure the currentProviderPrivateCfg$ observable is updated, which is needed
      // for the settings form to correctly show isEncryptionEnabled state.
      SyncLog.normal(`${LOG_PREFIX}: Updating provider config...`);
      await this._providerManager.setProviderConfig(SyncProviderId.SuperSync, {
        ...existingCfg,
        encryptKey: isEncryptionEnabled ? newEncryptKey : undefined,
        isEncryptionEnabled,
      } as SuperSyncPrivateCfg);

      // 3. Prepare snapshot payload (encrypt if needed)
      SyncLog.normal(`${LOG_PREFIX}: Uploading fresh snapshot...`);
      let snapshotPayload: unknown = state;

      // If encryption is enabled, manually encrypt the snapshot
      // (unlike other services, import handler encrypts explicitly)
      if (isEncryptionEnabled && newEncryptKey) {
        snapshotPayload = await this._encryptionService.encryptPayload(
          state,
          newEncryptKey,
        );
      }

      // 4. Upload snapshot
      const result = await this._snapshotUploadService.uploadSnapshot(
        syncProvider,
        snapshotPayload,
        clientId,
        vectorClock,
        isEncryptionEnabled && !!newEncryptKey,
      );

      if (!result.accepted) {
        throw new Error(`Snapshot upload failed: ${result.error}`);
      }

      // 5. Update lastServerSeq
      await this._snapshotUploadService.updateLastServerSeq(
        syncProvider,
        result.serverSeq,
        LOG_PREFIX,
      );

      SyncLog.normal(`${LOG_PREFIX}: Encryption state change handled successfully!`);

      return {
        encryptionStateChanged: true,
        serverDataDeleted: true,
        snapshotUploaded: true,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      SyncLog.err(`${LOG_PREFIX}: Failed to handle encryption change`, {
        error: errorMessage,
      });

      return {
        encryptionStateChanged: true,
        serverDataDeleted: false,
        snapshotUploaded: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Convenience method that checks for encryption state change and handles it if needed.
   * Call this after importing data.
   *
   * @param importedData - The imported data (already in the store)
   */
  async handleImportEncryptionIfNeeded(
    importedData: AppDataComplete,
  ): Promise<EncryptionStateChangeResult | null> {
    const checkResult = await this.checkEncryptionStateChange(importedData);

    if (!checkResult.willChange) {
      SyncLog.normal(
        'ImportEncryptionHandlerService: No encryption state change detected',
      );
      return null;
    }

    SyncLog.normal('ImportEncryptionHandlerService: Encryption state change detected', {
      from: checkResult.currentEnabled ? 'encrypted' : 'unencrypted',
      to: checkResult.importedEnabled ? 'encrypted' : 'unencrypted',
    });

    // Get the imported encryption key if encryption is being enabled
    const importedSuperSync = (
      importedData.globalConfig as {
        sync?: { superSync?: { isEncryptionEnabled?: boolean; encryptKey?: string } };
      }
    )?.sync?.superSync;
    const newEncryptKey = importedSuperSync?.encryptKey;

    return this.handleEncryptionStateChange(
      importedData,
      newEncryptKey,
      checkResult.importedEnabled,
    );
  }
}
