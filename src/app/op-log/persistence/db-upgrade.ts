/**
 * Shared IndexedDB upgrade logic for SUP_OPS database.
 *
 * CRITICAL: This upgrade function MUST be used by ALL services that open the SUP_OPS database.
 * IndexedDB only runs ONE upgrade callback per version transition - whichever service opens
 * the database first MUST create ALL stores.
 *
 * This shared function ensures schema consistency regardless of service initialization order.
 */

import { IDBPDatabase, IDBPTransaction } from 'idb';
import { STORE_NAMES, OPS_INDEXES } from './db-keys.const';

/**
 * Performs the database upgrade for SUP_OPS.
 * Called from openDB's upgrade callback in both OperationLogStoreService and ArchiveStoreService.
 *
 * @param db The IDBPDatabase instance
 * @param oldVersion The previous version (0 for new databases)
 * @param transaction The upgrade transaction (needed to access existing stores)
 */
export const runDbUpgrade = (
  db: IDBPDatabase<any>,
  oldVersion: number,
  transaction: IDBPTransaction<any, any, 'versionchange'>,
): void => {
  // Version 1: Create initial stores
  if (oldVersion < 1) {
    const opStore = db.createObjectStore(STORE_NAMES.OPS, {
      keyPath: 'seq',
      autoIncrement: true,
    });
    opStore.createIndex(OPS_INDEXES.BY_ID, 'op.id', { unique: true });
    opStore.createIndex(OPS_INDEXES.BY_SYNCED_AT, 'syncedAt');

    db.createObjectStore(STORE_NAMES.STATE_CACHE, { keyPath: 'id' });
    db.createObjectStore(STORE_NAMES.IMPORT_BACKUP, { keyPath: 'id' });
  }

  // Version 2: Add vector_clock store for atomic writes
  // This consolidates the vector clock from pf.META_MODEL into SUP_OPS
  // to enable single-transaction writes (op + vector clock together)
  if (oldVersion < 2) {
    db.createObjectStore(STORE_NAMES.VECTOR_CLOCK);
  }

  // Version 3: Add compound index for efficient source+status queries
  // PERF: Enables O(results) queries for getPendingRemoteOps/getFailedRemoteOps
  // instead of O(all ops) full table scan
  if (oldVersion < 3) {
    const opStore = transaction.objectStore(STORE_NAMES.OPS);
    opStore.createIndex(OPS_INDEXES.BY_SOURCE_AND_STATUS, [
      'source',
      'applicationStatus',
    ]);
  }

  // Version 4: Add archive stores for archiveYoung and archiveOld
  // Consolidates archive data from legacy 'pf' database into SUP_OPS
  if (oldVersion < 4) {
    db.createObjectStore(STORE_NAMES.ARCHIVE_YOUNG, { keyPath: 'id' });
    db.createObjectStore(STORE_NAMES.ARCHIVE_OLD, { keyPath: 'id' });
  }

  // Version 5: Add profile_data store for user profile switching
  // Moves profile backup blobs from localStorage (5-10 MB quota) to IndexedDB
  if (oldVersion < 5) {
    db.createObjectStore(STORE_NAMES.PROFILE_DATA, { keyPath: 'id' });
  }
};
