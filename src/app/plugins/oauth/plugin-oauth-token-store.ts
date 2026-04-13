import { DBSchema, IDBPDatabase, openDB } from 'idb';
import { PluginLog } from '../../core/log';

/**
 * Local-only IndexedDB store for plugin OAuth tokens.
 *
 * Tokens are stored in a dedicated database ('sup-plugin-oauth') that is
 * NOT part of the op-log sync system. Each device authenticates independently.
 */

const DB_NAME = 'sup-plugin-oauth';
const DB_STORE_NAME = 'tokens';
const DB_VERSION = 1;

interface PluginOAuthDb extends DBSchema {
  [DB_STORE_NAME]: {
    key: string;
    value: string;
  };
}

let db: IDBPDatabase<PluginOAuthDb> | undefined;
let initPromise: Promise<IDBPDatabase<PluginOAuthDb>> | undefined;

const ensureDb = async (): Promise<IDBPDatabase<PluginOAuthDb>> => {
  if (db) {
    return db;
  }
  if (!initPromise) {
    initPromise = openDB<PluginOAuthDb>(DB_NAME, DB_VERSION, {
      upgrade: (database) => {
        if (!database.objectStoreNames.contains(DB_STORE_NAME)) {
          database.createObjectStore(DB_STORE_NAME);
        }
      },
    }).then((opened) => {
      db = opened;
      return opened;
    });
  }
  return initPromise;
};

export const saveOAuthTokens = async (key: string, data: string): Promise<void> => {
  try {
    const store = await ensureDb();
    await store.put(DB_STORE_NAME, data, key);
  } catch (error) {
    PluginLog.err('PluginOAuthTokenStore: Failed to save tokens:', error);
    throw error;
  }
};

export const loadOAuthTokens = async (key: string): Promise<string | null> => {
  try {
    const store = await ensureDb();
    const result = await store.get(DB_STORE_NAME, key);
    return result ?? null;
  } catch (error) {
    PluginLog.err('PluginOAuthTokenStore: Failed to load tokens:', error);
    throw error;
  }
};

export const deleteOAuthTokens = async (key: string): Promise<void> => {
  try {
    const store = await ensureDb();
    await store.delete(DB_STORE_NAME, key);
  } catch (error) {
    PluginLog.err('PluginOAuthTokenStore: Failed to delete tokens:', error);
    throw error;
  }
};
