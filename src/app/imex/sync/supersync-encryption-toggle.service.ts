import { inject, Injectable } from '@angular/core';
import type { SuperSyncPrivateCfg } from '@sp/sync-providers/super-sync';
import { clearSessionKeyCache } from '@sp/sync-core';
import { SyncLog } from '../../core/log';
import { SnapshotUploadService } from './snapshot-upload.service';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { SyncProviderId } from '../../op-log/sync-providers/provider.const';

const LOG_PREFIX = 'SuperSyncEncryptionToggleService';

/**
 * Extracts a user-friendly message from an error, stripping raw JSON payloads.
 * e.g. "SuperSync API error: 429 Too Many Requests - {"statusCode":429,...}"
 *   -> "SuperSync API error: 429 Too Many Requests"
 */
const _friendlyErrorMessage = (error: unknown): string => {
  const raw = error instanceof Error ? error.message : String(error);
  // Strip JSON body appended after " - {" by the SuperSync provider
  const jsonStart = raw.indexOf(' - {');
  return jsonStart > 0 ? raw.substring(0, jsonStart) : raw;
};

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

      // Drop any cached derived key from the pre-toggle password; subsequent
      // sync cycles must re-derive against the new `encryptKey`.
      clearSessionKeyCache();

      SyncLog.normal(`${LOG_PREFIX}: Encryption enabled successfully!`);
    } catch (error) {
      // IMPORTANT: Do NOT revert to a keyless config here.
      // deleteAndReuploadWithNewEncryption deletes all server data and persists the new
      // key config BEFORE the upload that just failed, so the server is now empty. Reverting
      // to `encryptKey: undefined` would leave a mandatory-encryption provider with no key —
      // the op-log upload guard then skips EVERY future upload, so the wiped server can never
      // be repopulated and the advertised "Sync Now" recovery is a no-op (account stranded).
      // Keep the new key (as the password-change flow does) so the next sync re-uploads the
      // local data, encrypted. If the failure happened before the config was persisted, the
      // config is simply still the original — nothing to revert either way.
      SyncLog.err(
        `${LOG_PREFIX}: Upload failed after deleting server data — keeping new encryption key for retry`,
        error,
      );

      throw new Error(
        'Failed to upload encrypted snapshot after deleting server data. ' +
          'Your local data is safe and encryption stays enabled. ' +
          'Your data will re-upload (encrypted) on the next sync — or click "Sync Now" to retry now. ' +
          `Reason: ${_friendlyErrorMessage(error)}`,
        { cause: error },
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

      // Drop any cached derived key now that encryption is off.
      clearSessionKeyCache();

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
        'Failed to upload unencrypted snapshot after deleting server data. ' +
          'Your local data is safe. Encryption is still enabled. Please try disabling encryption again. ' +
          `Reason: ${_friendlyErrorMessage(uploadError)}`,
        { cause: uploadError },
      );
    }
  }
}
