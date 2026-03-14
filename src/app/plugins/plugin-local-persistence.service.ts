import { Injectable } from '@angular/core';
import { DBSchema, IDBPDatabase, openDB } from 'idb';
import { PluginLog } from '../core/log';
import {
  MAX_PLUGIN_DATA_SIZE,
  MIN_PLUGIN_PERSIST_INTERVAL_MS,
} from './plugin-persistence.model';

const DB_NAME = 'sup-plugin-local';
const DB_STORE_NAME = 'local-data';
const DB_VERSION = 1;
const KEY_PREFIX = '__sp_plugin_local_';

interface PluginLocalDb extends DBSchema {
  [DB_STORE_NAME]: {
    key: string;
    value: string;
  };
}

/**
 * Simple IndexedDB wrapper for local-only plugin data.
 * This data does NOT sync — it stays on the device.
 * Intended for credentials, tokens, and other device-specific config.
 */
@Injectable({
  providedIn: 'root',
})
export class PluginLocalPersistenceService {
  private _db?: IDBPDatabase<PluginLocalDb>;
  private _initPromise?: Promise<void>;
  private _lastPersistTime = new Map<string, number>();

  async persistLocalData(pluginId: string, dataStr: string): Promise<void> {
    const dataSize = new Blob([dataStr]).size;
    if (dataSize > MAX_PLUGIN_DATA_SIZE) {
      throw new Error(
        `Plugin local data exceeds maximum size of ${MAX_PLUGIN_DATA_SIZE / 1024}KB. Current size: ${Math.round(dataSize / 1024)}KB`,
      );
    }

    const now = Date.now();
    const lastPersist = this._lastPersistTime.get(pluginId) || 0;
    if (now - lastPersist < MIN_PLUGIN_PERSIST_INTERVAL_MS) {
      throw new Error(
        `Plugin local data persist rate limited. Please wait ${MIN_PLUGIN_PERSIST_INTERVAL_MS}ms between calls.`,
      );
    }
    this._lastPersistTime.set(pluginId, now);

    const db = await this._ensureDb();
    await db.put(DB_STORE_NAME, dataStr, KEY_PREFIX + pluginId);
  }

  async loadLocalData(pluginId: string): Promise<string | null> {
    const db = await this._ensureDb();
    const result = await db.get(DB_STORE_NAME, KEY_PREFIX + pluginId);
    return result ?? null;
  }

  async removeLocalData(pluginId: string): Promise<void> {
    const db = await this._ensureDb();
    await db.delete(DB_STORE_NAME, KEY_PREFIX + pluginId);
    PluginLog.log(`Removed local data for plugin ${pluginId}`);
  }

  private async _ensureDb(): Promise<IDBPDatabase<PluginLocalDb>> {
    if (!this._db) {
      if (!this._initPromise) {
        this._initPromise = this._initDb();
      }
      await this._initPromise;
    }
    return this._db!;
  }

  private async _initDb(): Promise<void> {
    this._db = await openDB<PluginLocalDb>(DB_NAME, DB_VERSION, {
      upgrade: (database) => {
        if (!database.objectStoreNames.contains(DB_STORE_NAME)) {
          database.createObjectStore(DB_STORE_NAME);
        }
      },
    });
  }
}
