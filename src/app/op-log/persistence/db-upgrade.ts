/**
 * Shared IndexedDB upgrade logic for SUP_OPS database.
 *
 * CRITICAL: This upgrade function MUST be used by ALL services that open the SUP_OPS database.
 * IndexedDB only runs ONE upgrade callback per version transition - whichever service opens
 * the database first MUST create ALL stores.
 *
 * This shared function ensures schema consistency regardless of service initialization order.
 */

import { IDBPDatabase, IDBPTransaction, unwrap } from 'idb';
import { FULL_STATE_OPS_META_KEY, STORE_NAMES, OPS_INDEXES } from './db-keys.const';
import { isFullStateOpType } from '../core/operation.types';
import { buildFullStateOpsMeta, FullStateOpRef } from './full-state-ops-meta';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const getStoredOpId = (op: unknown): string | undefined => {
  if (!isRecord(op)) {
    return undefined;
  }
  return typeof op['id'] === 'string' ? op['id'] : undefined;
};

const getStoredOpType = (op: unknown): string | undefined => {
  if (!isRecord(op)) {
    return undefined;
  }
  const compactType = op['o'];
  if (typeof compactType === 'string') {
    return compactType;
  }
  const fullType = op['opType'];
  return typeof fullType === 'string' ? fullType : undefined;
};

const getFullStateRefFromStoredEntry = (
  storedEntry: unknown,
  seq: number,
): FullStateOpRef | undefined => {
  if (!isRecord(storedEntry)) {
    return undefined;
  }
  const op = storedEntry['op'];
  const opId = getStoredOpId(op);
  const opType = getStoredOpType(op);
  return opId && opType && isFullStateOpType(opType) ? { opId, seq } : undefined;
};

const populateFullStateOpsMetaDuringUpgrade = (
  transaction: IDBPTransaction<any, any, 'versionchange'>,
): void => {
  const opsStore = unwrap(transaction.objectStore(STORE_NAMES.OPS)) as IDBObjectStore;
  const metaStore = unwrap(transaction.objectStore(STORE_NAMES.META)) as IDBObjectStore;
  if (!opsStore?.openCursor || !metaStore?.put) {
    return;
  }
  const refs: FullStateOpRef[] = [];
  const request = opsStore.openCursor();

  request.onsuccess = (): void => {
    const cursor = request.result;
    if (!cursor) {
      metaStore.put(buildFullStateOpsMeta(refs), FULL_STATE_OPS_META_KEY);
      return;
    }

    const ref = getFullStateRefFromStoredEntry(cursor.value, Number(cursor.primaryKey));
    if (ref) {
      refs.push(ref);
    }
    cursor.continue();
  };
};

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

  // Version 6: Add client_id store for atomic clientId rotation.
  // Consolidates the sync clientId from legacy 'pf' (key '__client_id_') into
  // SUP_OPS so destructive-flow rotation joins runDestructiveStateReplacement's
  // atomic transaction. See issue #7732. The runtime copy from 'pf' happens in
  // ClientIdService (a versionchange tx cannot read another database).
  if (oldVersion < 6) {
    db.createObjectStore(STORE_NAMES.CLIENT_ID);
  }

  // Version 7: Add meta store for small derived pointers and seed it from
  // existing ops before any post-upgrade write can observe an empty meta row.
  if (oldVersion < 7) {
    db.createObjectStore(STORE_NAMES.META);
    populateFullStateOpsMetaDuringUpgrade(transaction);
  }
};
