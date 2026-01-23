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

/**
 * Service for disabling encryption for SuperSync.
 *
 * Disable encryption flow:
 * 1. Delete all data on server (encrypted operations can't be mixed with unencrypted)
 * 2. Upload current state as unencrypted snapshot
 * 3. Update local config to disable encryption and clear the key
 */
@Injectable({
  providedIn: 'root',
})
export class EncryptionDisableService {
  private _providerManager = inject(SyncProviderManager);
  private _stateSnapshotService = inject(StateSnapshotService);
  private _vectorClockService = inject(VectorClockService);
  private _clientIdProvider: ClientIdProvider = inject(CLIENT_ID_PROVIDER);

  /**
   * Disables encryption by deleting all server data
   * and uploading a new unencrypted snapshot.
   *
   * @throws Error if sync provider is not SuperSync or not ready
   */
  async disableEncryption(): Promise<void> {
    SyncLog.normal('EncryptionDisableService: Starting encryption disable...');

    // Get the sync provider
    const syncProvider = this._providerManager.getActiveProvider();
    if (!syncProvider || syncProvider.id !== SyncProviderId.SuperSync) {
      throw new Error('Disable encryption is only supported for SuperSync');
    }

    if (!isOperationSyncCapable(syncProvider)) {
      throw new Error('Sync provider does not support operation sync');
    }

    // Get current config
    const existingCfg =
      (await syncProvider.privateCfg.load()) as SuperSyncPrivateCfg | null;

    // Get current state
    SyncLog.normal('EncryptionDisableService: Getting current state...');
    const currentState = this._stateSnapshotService.getStateSnapshot();
    const vectorClock = await this._vectorClockService.getCurrentVectorClock();
    const clientId = await this._clientIdProvider.loadClientId();
    if (!clientId) {
      throw new Error('Client ID not available');
    }

    // Delete all server data (encrypted ops can't be mixed with unencrypted)
    SyncLog.normal('EncryptionDisableService: Deleting server data...');
    await syncProvider.deleteAllData();

    // Upload unencrypted snapshot
    SyncLog.normal('EncryptionDisableService: Uploading unencrypted snapshot...');
    try {
      const response = await syncProvider.uploadSnapshot(
        currentState,
        clientId,
        'recovery',
        vectorClock,
        CURRENT_SCHEMA_VERSION,
        false, // isPayloadEncrypted = false
        uuidv7(), // opId - server must use this ID
      );

      if (!response.accepted) {
        throw new Error(`Snapshot upload failed: ${response.error}`);
      }

      // Update local config - disable encryption and clear the key
      SyncLog.normal('EncryptionDisableService: Updating local config...');
      await syncProvider.setPrivateCfg({
        ...existingCfg,
        encryptKey: undefined,
        isEncryptionEnabled: false,
      } as SuperSyncPrivateCfg);

      // Update lastServerSeq to the new snapshot's seq
      if (response.serverSeq !== undefined) {
        await syncProvider.setLastServerSeq(response.serverSeq);
      } else {
        SyncLog.err(
          'EncryptionDisableService: Snapshot accepted but serverSeq is missing. ' +
            'Sync state may be inconsistent - consider using "Sync Now" to verify.',
        );
      }

      SyncLog.normal('EncryptionDisableService: Encryption disabled successfully!');
    } catch (uploadError) {
      // CRITICAL: Server data was deleted but new snapshot failed to upload.
      SyncLog.err(
        'EncryptionDisableService: Snapshot upload failed after deleting server data!',
        uploadError,
      );

      throw new Error(
        'CRITICAL: Failed to upload unencrypted snapshot after deleting server data. ' +
          'Your local data is safe. Please use "Sync Now" to re-upload your data. ' +
          `Original error: ${uploadError instanceof Error ? uploadError.message : uploadError}`,
      );
    }
  }
}
