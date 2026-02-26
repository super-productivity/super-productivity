import { inject, Injectable } from '@angular/core';
import { SyncLog } from '../../core/log';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { SyncProviderId } from '../../op-log/sync-providers/provider.const';
import { SuperSyncProvider } from '../../op-log/sync-providers/super-sync/super-sync';
import { SuperSyncPrivateCfg } from '../../op-log/sync-providers/super-sync/super-sync.model';
import { isCryptoSubtleAvailable } from '../../op-log/encryption/encryption';
import { EncryptionEnableService } from './encryption-enable.service';

const LOG_PREFIX = 'AutoEncryptionMigration';

/**
 * Handles automatic migration to server-derived encryption for SuperSync.
 *
 * Auto-encryption is enabled by default for all SuperSync users.
 * This service runs during the sync cycle (before the first download/upload)
 * and ensures the user's data is encrypted automatically.
 *
 * Skip conditions:
 * - Manual encryption is active (stronger protection, user-chosen passphrase)
 * - Auto-encryption is already enabled
 * - Provider is not SuperSync
 * - WebCrypto is not available (e.g., Android insecure context)
 * - Server doesn't support the endpoint (old server version → 404)
 */
@Injectable({
  providedIn: 'root',
})
export class AutoEncryptionMigrationService {
  private _providerManager = inject(SyncProviderManager);
  private _encryptionEnableService = inject(EncryptionEnableService);

  /** Session-level flag: stop retrying after a 404 (old server without endpoint) */
  private _serverDoesNotSupportAutoEncryption = false;

  /** Session-level flag: migration already completed successfully this session */
  private _migrationCompleted = false;

  /**
   * Ensures auto-encryption is enabled for the current SuperSync user.
   * Called automatically before the sync download/upload cycle.
   *
   * This is a no-op if:
   * - Manual encryption is active
   * - Auto-encryption is already enabled
   * - Provider is not SuperSync
   * - WebCrypto is unavailable
   */
  async ensureAutoEncryption(): Promise<boolean> {
    const provider = this._providerManager.getActiveProvider();
    if (!provider || provider.id !== SyncProviderId.SuperSync) {
      return false;
    }

    const superSyncProvider = provider as unknown as SuperSyncProvider;
    const cfg = (await superSyncProvider.privateCfg.load()) as SuperSyncPrivateCfg | null;
    if (!cfg) {
      return false;
    }

    // Skip if manual encryption is active (stronger protection)
    if (cfg.isEncryptionEnabled && cfg.encryptKey) {
      return false;
    }

    // Skip if auto-encryption already enabled
    if (cfg.isAutoEncryptionEnabled && cfg.autoEncryptionKey) {
      return false;
    }

    // Skip if migration already completed this session
    if (this._migrationCompleted) {
      return false;
    }

    // Skip if server doesn't support the endpoint (detected in a previous sync)
    if (this._serverDoesNotSupportAutoEncryption) {
      return false;
    }

    // Skip if WebCrypto is not available (e.g., Android insecure context)
    if (!isCryptoSubtleAvailable()) {
      SyncLog.warn(
        `${LOG_PREFIX}: WebCrypto not available, skipping auto-encryption migration`,
      );
      return false;
    }

    SyncLog.normal(`${LOG_PREFIX}: Migrating to auto-encryption...`);
    try {
      await this._encryptionEnableService.enableAutoEncryption();
      this._migrationCompleted = true;
      SyncLog.normal(`${LOG_PREFIX}: Auto-encryption migration complete`);
      return true;
    } catch (err) {
      // Graceful degradation: if server doesn't support the endpoint (404),
      // or any other error occurs, log and continue without encryption.
      // Migration will be retried on the next sync cycle.
      const errMsg = err instanceof Error ? err.message : String(err);

      if (errMsg.includes('404')) {
        this._serverDoesNotSupportAutoEncryption = true;
        SyncLog.warn(
          `${LOG_PREFIX}: Server does not support auto-encryption endpoint (404). ` +
            `Skipping for this session. Consider upgrading the server.`,
        );
      } else {
        SyncLog.err(
          `${LOG_PREFIX}: Auto-encryption migration failed, will retry next sync`,
          err,
        );
      }
      return false;
    }
  }
}
