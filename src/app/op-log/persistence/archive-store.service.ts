import { Injectable } from '@angular/core';
import { IDBPDatabase, openDB } from 'idb';
import { ArchiveModel } from '../../features/time-tracking/time-tracking.model';
import { DB_NAME, DB_VERSION, STORE_NAMES, SINGLETON_KEY } from './db-keys.const';
import { runDbUpgrade } from './db-upgrade';
import { ARCHIVE_STORE_NOT_INITIALIZED } from './op-log-errors.const';

/**
 * Entry stored in archive_young or archive_old object stores.
 */
interface ArchiveStoreEntry {
  id: typeof SINGLETON_KEY;
  data: ArchiveModel;
  lastModified: number;
}

/**
 * Minimal schema for archive-only database access.
 * Only includes the stores this service needs.
 */
interface ArchiveDBSchema {
  [STORE_NAMES.ARCHIVE_YOUNG]: {
    key: string;
    value: ArchiveStoreEntry;
  };
  [STORE_NAMES.ARCHIVE_OLD]: {
    key: string;
    value: ArchiveStoreEntry;
  };
}

/**
 * Service for archive data persistence in IndexedDB.
 *
 * Manages the `archive_young` and `archive_old` object stores in the SUP_OPS database.
 * These stores hold archived task data, separated by age:
 * - `archive_young`: Recently archived tasks (< 21 days)
 * - `archive_old`: Older archived tasks (>= 21 days)
 *
 * @see DB_NAME, STORE_NAMES for database constants
 */
@Injectable({
  providedIn: 'root',
})
export class ArchiveStoreService {
  private _db?: IDBPDatabase<ArchiveDBSchema>;
  private _initPromise?: Promise<void>;

  private async _ensureInit(): Promise<void> {
    if (!this._db) {
      if (!this._initPromise) {
        this._initPromise = this._init();
      }
      await this._initPromise;
    }
  }

  /**
   * Opens the SUP_OPS database for archive operations.
   *
   * Uses shared runDbUpgrade() to ensure ALL stores are created if ArchiveStoreService
   * opens the database before OperationLogStoreService. IndexedDB only runs ONE upgrade
   * callback per version transition, so whichever service opens the DB first MUST create
   * all stores.
   */
  private async _init(): Promise<void> {
    this._db = await openDB<ArchiveDBSchema>(DB_NAME, DB_VERSION, {
      upgrade: (db, oldVersion, _newVersion, transaction) => {
        runDbUpgrade(db, oldVersion, transaction);
      },
    });
  }

  private get db(): IDBPDatabase<ArchiveDBSchema> {
    if (!this._db) {
      throw new Error(ARCHIVE_STORE_NOT_INITIALIZED);
    }
    return this._db;
  }

  // ============================================================
  // Archive Storage
  // ============================================================

  /**
   * Loads archiveYoung data from IndexedDB.
   * @returns The archive data, or undefined if not found.
   */
  async loadArchiveYoung(): Promise<ArchiveModel | undefined> {
    await this._ensureInit();
    const entry = await this.db.get(STORE_NAMES.ARCHIVE_YOUNG, SINGLETON_KEY);
    return entry?.data;
  }

  /**
   * Saves archiveYoung data to IndexedDB.
   * @param data The archive data to save.
   */
  async saveArchiveYoung(data: ArchiveModel): Promise<void> {
    await this._ensureInit();
    await this.db.put(STORE_NAMES.ARCHIVE_YOUNG, {
      id: SINGLETON_KEY,
      data,
      lastModified: Date.now(),
    });
  }

  /**
   * Loads archiveOld data from IndexedDB.
   * @returns The archive data, or undefined if not found.
   */
  async loadArchiveOld(): Promise<ArchiveModel | undefined> {
    await this._ensureInit();
    const entry = await this.db.get(STORE_NAMES.ARCHIVE_OLD, SINGLETON_KEY);
    return entry?.data;
  }

  /**
   * Saves archiveOld data to IndexedDB.
   * @param data The archive data to save.
   */
  async saveArchiveOld(data: ArchiveModel): Promise<void> {
    await this._ensureInit();
    await this.db.put(STORE_NAMES.ARCHIVE_OLD, {
      id: SINGLETON_KEY,
      data,
      lastModified: Date.now(),
    });
  }

  /**
   * Checks if archiveYoung exists in the database.
   * Used to determine if migration from legacy 'pf' database is needed.
   */
  async hasArchiveYoung(): Promise<boolean> {
    await this._ensureInit();
    const entry = await this.db.get(STORE_NAMES.ARCHIVE_YOUNG, SINGLETON_KEY);
    return !!entry;
  }

  /**
   * Checks if archiveOld exists in the database.
   * Used to determine if migration from legacy 'pf' database is needed.
   */
  async hasArchiveOld(): Promise<boolean> {
    await this._ensureInit();
    const entry = await this.db.get(STORE_NAMES.ARCHIVE_OLD, SINGLETON_KEY);
    return !!entry;
  }

  /**
   * Atomically saves both archiveYoung and archiveOld in a single transaction.
   *
   * This ensures that either both writes succeed or neither does, preventing
   * data loss if a failure occurs between the two writes.
   *
   * @param archiveYoung The archiveYoung data to save.
   * @param archiveOld The archiveOld data to save.
   */
  async saveArchivesAtomic(
    archiveYoung: ArchiveModel,
    archiveOld: ArchiveModel,
  ): Promise<void> {
    await this._ensureInit();
    const tx = this.db.transaction(
      [STORE_NAMES.ARCHIVE_YOUNG, STORE_NAMES.ARCHIVE_OLD],
      'readwrite',
    );
    const now = Date.now();
    await tx.objectStore(STORE_NAMES.ARCHIVE_YOUNG).put({
      id: SINGLETON_KEY,
      data: archiveYoung,
      lastModified: now,
    });
    await tx.objectStore(STORE_NAMES.ARCHIVE_OLD).put({
      id: SINGLETON_KEY,
      data: archiveOld,
      lastModified: now,
    });
    await tx.done;
  }

  /**
   * Clears all archive data. Used for testing only.
   * @internal
   */
  async _clearAllDataForTesting(): Promise<void> {
    await this._ensureInit();
    const tx = this.db.transaction(
      [STORE_NAMES.ARCHIVE_YOUNG, STORE_NAMES.ARCHIVE_OLD],
      'readwrite',
    );
    await tx.objectStore(STORE_NAMES.ARCHIVE_YOUNG).clear();
    await tx.objectStore(STORE_NAMES.ARCHIVE_OLD).clear();
    await tx.done;
  }
}
