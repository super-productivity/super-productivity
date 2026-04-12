import { Injectable } from '@angular/core';
import { IDBPDatabase, openDB } from 'idb';
import { DB_NAME, DB_VERSION, STORE_NAMES, TRASH_INDEXES } from './db-keys.const';
import { runDbUpgrade } from './db-upgrade';
import { isConnectionClosingError } from './op-log-errors.const';
import { Log } from '../../core/log';
import {
  IDB_OPEN_RETRIES,
  IDB_OPEN_RETRY_BASE_DELAY_MS,
} from '../core/operation-log.const';
import { IndexedDBOpenError } from '../core/errors/indexed-db-open.error';
import { TrashEntityType, TrashedItem } from '../../features/trash/trash.model';

interface TrashDBSchema {
  [STORE_NAMES.TRASH]: {
    key: string;
    value: TrashedItem;
    indexes: {
      [TRASH_INDEXES.BY_ENTITY_TYPE]: string;
      [TRASH_INDEXES.BY_DELETED_AT]: number;
    };
  };
}

/**
 * IndexedDB access for the trash store.
 *
 * Unlike ArchiveStoreService (which stores a singleton blob), trash uses one
 * record per trashed item. Items are indexed by entityType (for filtered
 * queries) and deletedAt (for efficient range purge of expired items).
 */
@Injectable({ providedIn: 'root' })
export class TrashStoreService {
  private _db?: IDBPDatabase<TrashDBSchema>;
  private _initPromise?: Promise<void>;

  private async _ensureInit(): Promise<void> {
    if (!this._db) {
      if (!this._initPromise) {
        this._initPromise = this._init().catch((e) => {
          this._initPromise = undefined;
          throw e;
        });
      }
      await this._initPromise;
    }
  }

  private async _init(): Promise<void> {
    const db = await this._openDbWithRetry();
    db.addEventListener('close', () => {
      Log.warn(
        '[TrashStore] IndexedDB connection closed by browser. Will re-open on next access.',
      );
      this._db = undefined;
      this._initPromise = undefined;
    });
    this._db = db;
  }

  private async _openDbWithRetry(): Promise<IDBPDatabase<TrashDBSchema>> {
    const totalAttempts = 1 + IDB_OPEN_RETRIES;
    let lastError: unknown;

    for (let attempt = 1; attempt <= totalAttempts; attempt++) {
      try {
        return await openDB<TrashDBSchema>(DB_NAME, DB_VERSION, {
          upgrade: (db, oldVersion, _newVersion, transaction) => {
            runDbUpgrade(db, oldVersion, transaction);
          },
        });
      } catch (e) {
        lastError = e;
        if (attempt < totalAttempts) {
          const delay = IDB_OPEN_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
          Log.warn(
            `[TrashStore] IndexedDB open failed (attempt ${attempt}/${totalAttempts}), retrying in ${delay}ms...`,
            e,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw new IndexedDBOpenError(lastError);
  }

  private get db(): IDBPDatabase<TrashDBSchema> {
    if (!this._db) {
      throw new Error('TrashStore not initialized');
    }
    return this._db;
  }

  private async _withRetryOnClose<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (isConnectionClosingError(e)) {
        Log.warn('[TrashStore] Connection closing error detected, re-opening...', e);
        this._db = undefined;
        this._initPromise = undefined;
        return await fn();
      }
      throw e;
    }
  }

  /** Loads all trashed items. Used for initial hydration into NgRx state. */
  async getAll(): Promise<TrashedItem[]> {
    return this._withRetryOnClose(async () => {
      await this._ensureInit();
      return this.db.getAll(STORE_NAMES.TRASH);
    });
  }

  /** Loads all trashed items of a specific entity type via the entityType index. */
  async getAllByType(entityType: TrashEntityType): Promise<TrashedItem[]> {
    return this._withRetryOnClose(async () => {
      await this._ensureInit();
      return this.db.getAllFromIndex(
        STORE_NAMES.TRASH,
        TRASH_INDEXES.BY_ENTITY_TYPE,
        entityType,
      );
    });
  }

  async getById(id: string): Promise<TrashedItem | undefined> {
    return this._withRetryOnClose(async () => {
      await this._ensureInit();
      return this.db.get(STORE_NAMES.TRASH, id);
    });
  }

  /** Upserts one or more trashed items in a single transaction. */
  async put(items: TrashedItem[]): Promise<void> {
    if (items.length === 0) return;
    return this._withRetryOnClose(async () => {
      await this._ensureInit();
      const tx = this.db.transaction(STORE_NAMES.TRASH, 'readwrite');
      for (const item of items) {
        await tx.store.put(item);
      }
      await tx.done;
    });
  }

  /** Removes one or more trashed items by id. */
  async remove(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    return this._withRetryOnClose(async () => {
      await this._ensureInit();
      const tx = this.db.transaction(STORE_NAMES.TRASH, 'readwrite');
      for (const id of ids) {
        await tx.store.delete(id);
      }
      await tx.done;
    });
  }

  /**
   * Removes all items with deletedAt < beforeTimestamp via the deletedAt index.
   * Returns the list of ids that were removed so callers can update in-memory state.
   */
  async removeExpired(beforeTimestamp: number): Promise<string[]> {
    return this._withRetryOnClose(async () => {
      await this._ensureInit();
      const tx = this.db.transaction(STORE_NAMES.TRASH, 'readwrite');
      const index = tx.store.index(TRASH_INDEXES.BY_DELETED_AT);
      const range = IDBKeyRange.upperBound(beforeTimestamp, true);
      const removed: string[] = [];
      let cursor = await index.openCursor(range);
      while (cursor) {
        removed.push(cursor.value.id);
        await cursor.delete();
        cursor = await cursor.continue();
      }
      await tx.done;
      return removed;
    });
  }

  async clear(): Promise<void> {
    return this._withRetryOnClose(async () => {
      await this._ensureInit();
      await this.db.clear(STORE_NAMES.TRASH);
    });
  }
}
