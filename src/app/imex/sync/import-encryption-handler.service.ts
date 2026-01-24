import { inject, Injectable } from '@angular/core';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { StateSnapshotService } from '../../op-log/backup/state-snapshot.service';
import { VectorClockService } from '../../op-log/sync/vector-clock.service';
import {
  CLIENT_ID_PROVIDER,
  ClientIdProvider,
} from '../../op-log/util/client-id.provider';
import { isOperationSyncCapable } from '../../op-log/sync/operation-sync.util';
import { SyncProviderId } from '../../op-log/sync-providers/provider.const';
import { SuperSyncPrivateCfg } from '../../op-log/sync-providers/super-sync/super-sync.model';
import { CURRENT_SCHEMA_VERSION } from '../../op-log/persistence/schema-migration.service';
import { SyncLog } from '../../core/log';
import { uuidv7 } from '../../util/uuid-v7';
import { AppDataComplete } from '../../op-log/model/model-config';
import { OperationEncryptionService } from '../../op-log/sync/operation-encryption.service';

export interface EncryptionStateChangeResult {
  encryptionStateChanged: boolean;
  serverDataDeleted: boolean;
  snapshotUploaded: boolean;
  error?: string;
}

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
  private _stateSnapshotService = inject(StateSnapshotService);
  private _vectorClockService = inject(VectorClockService);
  private _clientIdProvider: ClientIdProvider = inject(CLIENT_ID_PROVIDER);
  private _encryptionService = inject(OperationEncryptionService);

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
    SyncLog.normal(
      'ImportEncryptionHandlerService: Handling encryption state change...',
      { isEncryptionEnabled, hasKey: !!newEncryptKey },
    );

    const syncProvider = this._providerManager.getActiveProvider();
    if (!syncProvider || syncProvider.id !== SyncProviderId.SuperSync) {
      return {
        encryptionStateChanged: false,
        serverDataDeleted: false,
        snapshotUploaded: false,
        error: 'Not using SuperSync provider',
      };
    }

    if (!isOperationSyncCapable(syncProvider)) {
      return {
        encryptionStateChanged: false,
        serverDataDeleted: false,
        snapshotUploaded: false,
        error: 'Sync provider does not support operation sync',
      };
    }

    try {
      // 1. Delete all server data (encrypted ops can't mix with unencrypted)
      SyncLog.normal('ImportEncryptionHandlerService: Deleting server data...');
      await syncProvider.deleteAllData();

      // 2. Update sync provider config with new encryption settings BEFORE upload
      SyncLog.normal('ImportEncryptionHandlerService: Updating provider config...');
      const currentCfg =
        (await syncProvider.privateCfg.load()) as SuperSyncPrivateCfg | null;
      await syncProvider.setPrivateCfg({
        ...currentCfg,
        encryptKey: isEncryptionEnabled ? newEncryptKey : undefined,
        isEncryptionEnabled,
      } as SuperSyncPrivateCfg);

      // 3. Get current state snapshot
      const currentState = this._stateSnapshotService.getStateSnapshot();
      const vectorClock = await this._vectorClockService.getCurrentVectorClock();
      const clientId = await this._clientIdProvider.loadClientId();

      if (!clientId) {
        throw new Error('Client ID not available');
      }

      // 4. Upload snapshot (encrypted or not based on new settings)
      SyncLog.normal('ImportEncryptionHandlerService: Uploading fresh snapshot...');

      let snapshotPayload: unknown = currentState;

      // If encryption is enabled, encrypt the snapshot
      if (isEncryptionEnabled && newEncryptKey) {
        snapshotPayload = await this._encryptionService.encryptPayload(
          currentState,
          newEncryptKey,
        );
      }

      const response = await syncProvider.uploadSnapshot(
        snapshotPayload,
        clientId,
        'recovery', // Use recovery reason like password change
        vectorClock,
        CURRENT_SCHEMA_VERSION,
        isEncryptionEnabled && !!newEncryptKey, // isPayloadEncrypted
        uuidv7(),
      );

      if (!response.accepted) {
        throw new Error(`Snapshot upload failed: ${response.error}`);
      }

      // 5. Update lastServerSeq
      if (response.serverSeq !== undefined) {
        await syncProvider.setLastServerSeq(response.serverSeq);
      }

      SyncLog.normal(
        'ImportEncryptionHandlerService: Encryption state change handled successfully!',
      );

      return {
        encryptionStateChanged: true,
        serverDataDeleted: true,
        snapshotUploaded: true,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      SyncLog.err('ImportEncryptionHandlerService: Failed to handle encryption change', {
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
