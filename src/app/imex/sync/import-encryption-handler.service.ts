import { inject, Injectable } from '@angular/core';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { SyncProviderId } from '../../op-log/sync-providers/provider.const';
import type { SuperSyncPrivateCfg } from '@sp/sync-providers/super-sync';
import { SyncLog } from '../../core/log';
import { AllModelConfig, AppDataComplete } from '../../op-log/model/model-config';
import type { CompleteBackup } from '../../op-log/core/types/sync.types';
import { SnapshotUploadService } from './snapshot-upload.service';

export interface EncryptionStateChangeResult {
  encryptionStateChanged: boolean;
  serverDataDeleted: boolean;
  snapshotUploaded: boolean;
  error?: string;
}

const LOG_PREFIX = 'ImportEncryptionHandlerService';

type ImportableAppData = AppDataComplete | CompleteBackup<AllModelConfig>;

const _unwrapCompleteBackup = (importedData: ImportableAppData): AppDataComplete =>
  'crossModelVersion' in importedData &&
  'timestamp' in importedData &&
  'data' in importedData
    ? importedData.data
    : importedData;

const _getImportedSuperSyncCfg = (
  importedData: ImportableAppData,
): { isEncryptionEnabled?: boolean; encryptKey?: string } | undefined => {
  const appData = _unwrapCompleteBackup(importedData);
  return (
    appData.globalConfig as {
      sync?: { superSync?: { isEncryptionEnabled?: boolean; encryptKey?: string } };
    }
  )?.sync?.superSync;
};

/**
 * Service for handling encryption state changes during data import.
 *
 * When importing data that has different encryption settings than the current
 * sync provider configuration, this service ensures:
 * 1. All server data is deleted (encrypted ops can't mix with unencrypted)
 * 2. The current state is uploaded as a fresh snapshot with correct encryption
 * 3. The sync provider config is updated to match the imported settings
 *
 * Delegates the delete-and-reupload mechanics to SnapshotUploadService.
 */
@Injectable({
  providedIn: 'root',
})
export class ImportEncryptionHandlerService {
  private _providerManager = inject(SyncProviderManager);
  private _snapshotUploadService = inject(SnapshotUploadService);

  /**
   * Checks if the imported data has different encryption settings than
   * the current sync provider configuration.
   *
   * @param importedData - The data being imported
   * @returns Object with comparison results
   */
  async checkEncryptionStateChange(importedData: ImportableAppData): Promise<{
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
    const importedSuperSync = _getImportedSuperSyncCfg(importedData);
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

    try {
      await this._snapshotUploadService.deleteAndReuploadWithNewEncryption({
        encryptKey: isEncryptionEnabled ? newEncryptKey : undefined,
        isEncryptionEnabled,
        logPrefix: LOG_PREFIX,
      });

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
    importedData: ImportableAppData,
  ): Promise<EncryptionStateChangeResult | null> {
    const checkResult = await this.checkEncryptionStateChange(importedData);

    if (!checkResult.willChange) {
      SyncLog.normal(
        'ImportEncryptionHandlerService: No encryption state change detected',
      );
      return null;
    }

    // Never let imports disable encryption — encryption is mandatory for SuperSync
    if (checkResult.currentEnabled && !checkResult.importedEnabled) {
      SyncLog.normal(
        'ImportEncryptionHandlerService: Import would disable encryption — skipping',
      );
      return null;
    }

    SyncLog.normal('ImportEncryptionHandlerService: Encryption state change detected', {
      from: checkResult.currentEnabled ? 'encrypted' : 'unencrypted',
      to: checkResult.importedEnabled ? 'encrypted' : 'unencrypted',
    });

    // Get the imported encryption key if encryption is being enabled
    const importedSuperSync = _getImportedSuperSyncCfg(importedData);
    const newEncryptKey = importedSuperSync?.encryptKey;

    return this.handleEncryptionStateChange(
      _unwrapCompleteBackup(importedData),
      newEncryptKey,
      checkResult.importedEnabled,
    );
  }
}
