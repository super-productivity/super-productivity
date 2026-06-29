import { Injectable } from '@angular/core';
import { PluginLog } from '../../core/log';
import {
  assertPluginPersistenceKey,
  composeId,
  isPluginIdMatch,
} from '../util/plugin-persistence-key.util';
import {
  deleteSecret,
  getAllSecretKeys,
  loadSecret,
  saveSecret,
} from './plugin-secret-store';

/**
 * Per-plugin local-only secret storage.
 *
 * Secrets are namespaced by `pluginId` (the host injects it — a plugin can
 * never address another plugin's keys) and persisted to a dedicated IndexedDB
 * that is never synced, exported, or backed up. Use for credentials that must
 * not leave the device (IMAP passwords, API tokens), NOT `persistDataSynced`.
 */

/**
 * Upper bound on a single secret value. Credentials are small; this only
 * exists to stop a compromised iframe from writing megabytes into the store.
 * Measured in UTF-16 code units (string length) — exact bytes don't matter
 * for an abuse guard.
 */
export const MAX_PLUGIN_SECRET_LENGTH = 16 * 1024;

@Injectable({ providedIn: 'root' })
export class PluginSecretService {
  async setSecret(pluginId: string, key: string, value: string): Promise<void> {
    const entityId = this._entityId(pluginId, key);
    if (typeof value !== 'string') {
      throw new Error('Plugin secret value must be a string');
    }
    if (value.length > MAX_PLUGIN_SECRET_LENGTH) {
      throw new Error(
        `Plugin secret exceeds maximum length of ${MAX_PLUGIN_SECRET_LENGTH} characters`,
      );
    }
    await saveSecret(entityId, value);
  }

  async getSecret(pluginId: string, key: string): Promise<string | null> {
    return loadSecret(this._entityId(pluginId, key));
  }

  async deleteSecret(pluginId: string, key: string): Promise<void> {
    await deleteSecret(this._entityId(pluginId, key));
  }

  /**
   * Purge every secret owned by a plugin. Called on uninstall so credentials
   * never outlive the plugin that owned them.
   */
  async removeSecretsForPlugin(pluginId: string): Promise<void> {
    const allKeys = await getAllSecretKeys();
    const owned = allKeys.filter((entityId) => isPluginIdMatch(entityId, pluginId));
    for (const entityId of owned) {
      await deleteSecret(entityId);
    }
    if (owned.length > 0) {
      PluginLog.log('PluginSecretService: Removed secrets on cleanup', {
        pluginId,
        count: owned.length,
      });
    }
  }

  /**
   * Compose + validate the storage id. `key` is required and non-empty for
   * secrets (unlike the optional persistence key), and `composeId` throws if
   * the pluginId itself contains the reserved ':' delimiter.
   */
  private _entityId(pluginId: string, key: string): string {
    if (typeof key !== 'string' || key === '') {
      throw new Error('Plugin secret key must be a non-empty string');
    }
    assertPluginPersistenceKey(key);
    return composeId(pluginId, key);
  }
}
