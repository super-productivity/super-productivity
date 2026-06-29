import { DBSchema, IDBPDatabase, openDB } from 'idb';
import { PluginLog } from '../../core/log';

/**
 * Local-only IndexedDB store for plugin secrets (passwords, API tokens, …).
 *
 * Mirrors the plugin OAuth token store: secrets live in a dedicated database
 * ('sup-plugin-secrets') that is NOT part of the op-log sync system, exports,
 * or backups. Each device stores its own secrets independently.
 *
 * Values are stored verbatim (plaintext at rest), exactly like OAuth tokens
 * today. OS-keychain encryption is a future, optional upgrade behind the same
 * PluginAPI surface and does not change this store's contract.
 */

const DB_NAME = 'sup-plugin-secrets';
const DB_STORE_NAME = 'secrets';
const DB_VERSION = 1;

interface PluginSecretDb extends DBSchema {
  [DB_STORE_NAME]: {
    key: string;
    value: string;
  };
}

let db: IDBPDatabase<PluginSecretDb> | undefined;
let initPromise: Promise<IDBPDatabase<PluginSecretDb>> | undefined;

const ensureDb = async (): Promise<IDBPDatabase<PluginSecretDb>> => {
  if (db) {
    return db;
  }
  if (!initPromise) {
    initPromise = openDB<PluginSecretDb>(DB_NAME, DB_VERSION, {
      upgrade: (database) => {
        if (!database.objectStoreNames.contains(DB_STORE_NAME)) {
          database.createObjectStore(DB_STORE_NAME);
        }
      },
    }).then((opened) => {
      db = opened;
      return opened;
    });
    // Don't cache a rejected open forever — clear it so a later call retries
    // instead of leaving the store bricked for the whole session.
    initPromise.catch(() => {
      initPromise = undefined;
    });
  }
  return initPromise;
};

export const saveSecret = async (entityId: string, value: string): Promise<void> => {
  try {
    const store = await ensureDb();
    await store.put(DB_STORE_NAME, value, entityId);
  } catch (error) {
    PluginLog.err('PluginSecretStore: Failed to save secret:', error);
    throw error;
  }
};

export const loadSecret = async (entityId: string): Promise<string | null> => {
  try {
    const store = await ensureDb();
    const result = await store.get(DB_STORE_NAME, entityId);
    return result ?? null;
  } catch (error) {
    PluginLog.err('PluginSecretStore: Failed to load secret:', error);
    throw error;
  }
};

export const deleteSecret = async (entityId: string): Promise<void> => {
  try {
    const store = await ensureDb();
    await store.delete(DB_STORE_NAME, entityId);
  } catch (error) {
    PluginLog.err('PluginSecretStore: Failed to delete secret:', error);
    throw error;
  }
};

export const getAllSecretKeys = async (): Promise<string[]> => {
  try {
    const store = await ensureDb();
    return await store.getAllKeys(DB_STORE_NAME);
  } catch (error) {
    PluginLog.err('PluginSecretStore: Failed to list secret keys:', error);
    throw error;
  }
};
