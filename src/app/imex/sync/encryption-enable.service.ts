import { inject, Injectable } from '@angular/core';
import { SuperSyncPrivateCfg } from '../../op-log/sync-providers/super-sync/super-sync.model';
import { SyncLog } from '../../core/log';
import { SnapshotUploadService } from './snapshot-upload.service';
import { OperationEncryptionService } from '../../op-log/sync/operation-encryption.service';

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

    // Gather all data needed for upload (validates provider)
    const { syncProvider, existingCfg, state, vectorClock, clientId } =
      await this._snapshotUploadService.gatherSnapshotData(LOG_PREFIX);

    // Delete all server data (unencrypted ops can't be mixed with encrypted)
    SyncLog.normal(`${LOG_PREFIX}: Deleting server data...`);
    await syncProvider.deleteAllData();

    // Update local config BEFORE upload - enable encryption and set the key
    // This must happen BEFORE upload so the upload uses the new key
    SyncLog.normal(`${LOG_PREFIX}: Updating local config...`);
    await syncProvider.setPrivateCfg({
      ...existingCfg,
      encryptKey,
      isEncryptionEnabled: true,
    } as SuperSyncPrivateCfg);

    // Encrypt the snapshot payload
    SyncLog.normal(`${LOG_PREFIX}: Encrypting snapshot...`);
    const encryptedPayload = await this._encryptionService.encryptPayload(
      state,
      encryptKey,
    );

    // Upload encrypted snapshot
    SyncLog.normal(`${LOG_PREFIX}: Uploading encrypted snapshot...`);
    try {
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

      await syncProvider.setPrivateCfg({
        ...existingCfg,
        encryptKey: undefined,
        isEncryptionEnabled: false,
      } as SuperSyncPrivateCfg);

      throw new Error(
        'CRITICAL: Failed to upload encrypted snapshot after deleting server data. ' +
          'Your local data is safe. Encryption has been reverted. Please use "Sync Now" to re-upload your data. ' +
          `Original error: ${uploadError instanceof Error ? uploadError.message : uploadError}`,
      );
    }
  }
}
