import { inject, Injectable } from '@angular/core';
import { SuperSyncPrivateCfg } from '../../op-log/sync-providers/super-sync/super-sync.model';
import { SyncLog } from '../../core/log';
import { SnapshotUploadService } from './snapshot-upload.service';

const LOG_PREFIX = 'EncryptionDisableService';

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
  private _snapshotUploadService = inject(SnapshotUploadService);

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
}
