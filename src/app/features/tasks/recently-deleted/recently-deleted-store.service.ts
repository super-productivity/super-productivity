import { Injectable } from '@angular/core';
import { DBSchema, IDBPDatabase, openDB } from 'idb';
import { LS } from '../../../core/persistence/storage-keys.const';
import { RecentlyDeletedEntry } from './recently-deleted.util';

// A database of its own rather than a new SUP_OPS store: adding a store to
// SUP_OPS needs a DB_VERSION bump, which is a downgrade barrier (#9187). This
// data is device-local and never synced, backed up or snapshotted.
const DB_NAME = 'SUP_RECENTLY_DELETED';
const DB_VERSION = 1;
const STORE_NAME = 'entries';

interface RecentlyDeletedDb extends DBSchema {
  [STORE_NAME]: {
    key: string;
    value: RecentlyDeletedEntry;
  };
}

@Injectable({
  providedIn: 'root',
})
export class RecentlyDeletedStoreService {
  private _dbPromise?: Promise<IDBPDatabase<RecentlyDeletedDb>>;

  async getAll(): Promise<RecentlyDeletedEntry[]> {
    return (await this._db()).getAll(STORE_NAME);
  }

  /** Applies puts and deletes in one transaction, deletes last. */
  async applyChanges(puts: RecentlyDeletedEntry[], deleteIds: string[]): Promise<void> {
    if (!puts.length && !deleteIds.length) return;
    const tx = (await this._db()).transaction(STORE_NAME, 'readwrite');
    await Promise.all([
      ...puts.map((entry) => tx.store.put(entry)),
      ...deleteIds.map((id) => tx.store.delete(id)),
      tx.done,
    ]);
  }

  /** When the trash was last emptied on this device, 0 if never. */
  getEmptiedAt(): number {
    const emptiedAt = Number(localStorage.getItem(LS.RECENTLY_DELETED_EMPTIED_AT));
    return Number.isFinite(emptiedAt) ? emptiedAt : 0;
  }

  async clear(emptiedAt: number): Promise<void> {
    // Kept outside the database, so it holds even if the clear below fails.
    localStorage.setItem(LS.RECENTLY_DELETED_EMPTIED_AT, String(emptiedAt));
    await (await this._db()).clear(STORE_NAME);
  }

  private _db(): Promise<IDBPDatabase<RecentlyDeletedDb>> {
    if (!this._dbPromise) {
      this._dbPromise = openDB<RecentlyDeletedDb>(DB_NAME, DB_VERSION, {
        upgrade: (db) => {
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          }
        },
        // Reopen on next access if the browser closes the connection, or
        // close it so a newer tab's upgrade of this database is not blocked.
        terminated: () => {
          this._dbPromise = undefined;
        },
        blocking: () => {
          const dbPromise = this._dbPromise;
          this._dbPromise = undefined;
          void dbPromise?.then((db) => db.close());
        },
      }).catch((e) => {
        this._dbPromise = undefined;
        throw e;
      });
    }
    return this._dbPromise;
  }
}
