import { Injectable } from '@angular/core';
import { DBSchema, IDBPDatabase, openDB } from 'idb';
import {
  Operation,
  OperationLogEntry,
  OpType,
  VectorClock,
} from '../core/operation.types';
import { StorageQuotaExceededError } from '../core/errors/sync-errors';
import { toEntityKey } from '../util/entity-key.util';
import {
  encodeOperation,
  decodeOperation,
  isCompactOperation,
} from '../../core/persistence/operation-log/compact/operation-codec.service';
import { CompactOperation } from '../../core/persistence/operation-log/compact/compact-operation.types';
import { ArchiveModel } from '../../features/time-tracking/time-tracking.model';
import {
  DB_NAME,
  DB_VERSION,
  STORE_NAMES,
  SINGLETON_KEY,
  BACKUP_KEY,
  OPS_INDEXES,
} from './db-keys.const';
import {
  DUPLICATE_OPERATION_ERROR_MSG,
  OPERATION_LOG_STORE_NOT_INITIALIZED,
} from './op-log-errors.const';
import { runDbUpgrade } from './db-upgrade';
import { Log } from '../../core/log';
import {
  IDB_OPEN_RETRIES,
  IDB_OPEN_RETRY_BASE_DELAY_MS,
} from '../core/operation-log.const';
import { IndexedDBOpenError } from '../core/errors/indexed-db-open.error';
import { vectorClockToString } from '../../core/util/vector-clock';

/**
 * Vector clock entry stored in the vector_clock object store.
 * Contains the clock and last update timestamp.
 */
interface VectorClockEntry {
  clock: VectorClock;
  lastUpdate: number;
  /**
   * Client IDs that should never be pruned from vector clocks.
   * Used to preserve the SYNC_IMPORT/BACKUP_IMPORT/REPAIR client's entry,
   * which is needed for correct filtering of ops created after the import.
   *
   * Without this, pruning could remove low-counter entries (like an import's
   * client with counter=1), causing new ops to have clocks that appear
   * CONCURRENT with the import instead of GREATER_THAN.
   */
  protectedClientIds?: string[];
}

/**
 * Archive entry stored in archive_young or archive_old object stores.
 * Contains the archive data and last modification timestamp.
 */
interface ArchiveStoreEntry {
  id: 'current';
  data: ArchiveModel;
  lastModified: number;
}

/**
 * Stored operation log entry that can hold either compact or full operation format.
 * Used internally for backwards compatibility with existing data.
 */
interface StoredOperationLogEntry {
  seq: number;
  op: Operation | CompactOperation;
  appliedAt: number;
  source: 'local' | 'remote';
  syncedAt?: number;
  rejectedAt?: number;
  applicationStatus?: 'pending' | 'applied' | 'failed';
  retryCount?: number;
}

/**
 * Decodes a stored entry to a full OperationLogEntry.
 * Handles both compact and full operation formats for backwards compatibility.
 */
const decodeStoredEntry = (stored: StoredOperationLogEntry): OperationLogEntry => {
  const op = isCompactOperation(stored.op) ? decodeOperation(stored.op) : stored.op;
  return {
    seq: stored.seq,
    op,
    appliedAt: stored.appliedAt,
    source: stored.source,
    syncedAt: stored.syncedAt,
    rejectedAt: stored.rejectedAt,
    applicationStatus: stored.applicationStatus,
    retryCount: stored.retryCount,
  };
};

/**
 * Extracts the operation ID from either compact or full format.
 * Both formats use 'id' as the key for IndexedDB index compatibility.
 */
const getOpId = (op: Operation | CompactOperation): string => {
  return op.id;
};

// Note: DBSchema requires literal string keys matching STORE_NAMES values
interface OpLogDB extends DBSchema {
  [STORE_NAMES.OPS]: {
    key: number; // seq
    value: StoredOperationLogEntry;
    indexes: {
      [OPS_INDEXES.BY_ID]: string;
      [OPS_INDEXES.BY_SYNCED_AT]: number;
      // PERF: Compound index for efficient queries on remote ops by status
      [OPS_INDEXES.BY_SOURCE_AND_STATUS]: string;
    };
  };
  [STORE_NAMES.STATE_CACHE]: {
    key: string;
    value: {
      id: string;
      state: unknown;
      lastAppliedOpSeq: number;
      vectorClock: VectorClock;
      compactedAt: number;
      schemaVersion?: number;
      compactionCounter?: number; // Tracks ops since last compaction (persistent)
      snapshotEntityKeys?: string[]; // Entity keys that existed at compaction time
    };
  };
  [STORE_NAMES.IMPORT_BACKUP]: {
    key: string;
    value: {
      id: string;
      state: unknown;
      savedAt: number;
    };
  };
  /**
   * Stores the current vector clock for local changes.
   * This is the single source of truth for the vector clock, updated atomically
   * with operation writes to avoid multiple database transactions per action.
   */
  [STORE_NAMES.VECTOR_CLOCK]: {
    key: string; // SINGLETON_KEY ('current')
    value: VectorClockEntry;
  };
  /**
   * Stores archiveYoung data (recently archived tasks, < 21 days).
   * Migrated from legacy 'pf' database in version 4.
   */
  [STORE_NAMES.ARCHIVE_YOUNG]: {
    key: string; // SINGLETON_KEY ('current')
    value: ArchiveStoreEntry;
  };
  /**
   * Stores archiveOld data (older archived tasks, >= 21 days).
   * Migrated from legacy 'pf' database in version 4.
   */
  [STORE_NAMES.ARCHIVE_OLD]: {
    key: string; // SINGLETON_KEY ('current')
    value: ArchiveStoreEntry;
  };
}

/**
 * Manages the persistence of operations and state snapshots in IndexedDB.
 * It uses a dedicated IndexedDB database ('SUP_OPS') to store:
 * - A chronological log of all application changes (`ops` object store).
 * - Periodic snapshots of the application state (`state_cache` object store) for faster hydration.
 * This service provides methods for appending operations, retrieving them, marking them as synced,
 * and managing the state cache for compaction and hydration.
 */
@Injectable({
  providedIn: 'root',
})
export class OperationLogStoreService {
  private _db?: IDBPDatabase<OpLogDB>;
  private _initPromise?: Promise<void>;

  // Cache for getAppliedOpIds() to avoid full table scans on every download
  private _appliedOpIdsCache: Set<string> | null = null;
  private _cacheLastSeq: number = 0;

  // Cache for getUnsynced() to avoid full table scans on every sync
  private _unsyncedCache: OperationLogEntry[] | null = null;
  private _unsyncedCacheLastSeq: number = 0;

  // PERF: Cache for getVectorClock() to avoid IndexedDB read per operation
  private _vectorClockCache: VectorClock | null = null;

  async init(): Promise<void> {
    this._db = await this._openDbWithRetry();
  }

  /**
   * Opens IndexedDB with retry logic and exponential backoff.
   * Transient failures (file locks, temporary I/O issues) may resolve on retry.
   *
   * Total attempts = 1 initial + IDB_OPEN_RETRIES retries.
   * With IDB_OPEN_RETRIES=3: attempts at 0ms, 500ms, 1500ms, 3500ms (total ~3.5s worst case).
   *
   * @throws IndexedDBOpenError if all retry attempts fail
   * @see https://github.com/johannesjo/super-productivity/issues/6255
   */
  private async _openDbWithRetry(): Promise<IDBPDatabase<OpLogDB>> {
    const totalAttempts = 1 + IDB_OPEN_RETRIES;
    let lastError: unknown;

    for (let attempt = 1; attempt <= totalAttempts; attempt++) {
      try {
        return await openDB<OpLogDB>(DB_NAME, DB_VERSION, {
          upgrade: (db, oldVersion, _newVersion, transaction) => {
            runDbUpgrade(db, oldVersion, transaction);
          },
        });
      } catch (e) {
        lastError = e;

        if (attempt < totalAttempts) {
          // Exponential backoff: 500ms, 1000ms, 2000ms for retries 1, 2, 3
          const delay = IDB_OPEN_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
          Log.warn(
            `[OpLogStore] IndexedDB open failed (attempt ${attempt}/${totalAttempts}), retrying in ${delay}ms...`,
            e,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    // All retries exhausted - throw custom error with context
    throw new IndexedDBOpenError(lastError);
  }

  private get db(): IDBPDatabase<OpLogDB> {
    if (!this._db) {
      // We can't make this async, so we throw if accessed before init.
      // However, to fix the issue of it not being initialized, we should call init() eagerly
      // or make methods async-ready (they are already async).
      // But we can't await in a getter.
      // Let's change the pattern: check in every method.
      throw new Error(OPERATION_LOG_STORE_NOT_INITIALIZED);
    }
    return this._db;
  }

  private async _ensureInit(): Promise<void> {
    if (!this._db) {
      if (!this._initPromise) {
        this._initPromise = this.init();
      }
      await this._initPromise;
    }
  }

  async append(
    op: Operation,
    source: 'local' | 'remote' = 'local',
    options?: { pendingApply?: boolean },
  ): Promise<number> {
    await this._ensureInit();
    // Encode operation to compact format for storage efficiency
    const compactOp = encodeOperation(op);
    const entry: Omit<StoredOperationLogEntry, 'seq'> = {
      op: compactOp,
      appliedAt: Date.now(),
      source,
      syncedAt: source === 'remote' ? Date.now() : undefined,
      // For remote ops, track application status for crash recovery
      applicationStatus:
        source === 'remote' ? (options?.pendingApply ? 'pending' : 'applied') : undefined,
    };
    // seq is auto-incremented, returned for later reference
    try {
      return await this.db.add(STORE_NAMES.OPS, entry as StoredOperationLogEntry);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'QuotaExceededError') {
        throw new StorageQuotaExceededError();
      }
      throw e;
    }
  }

  async appendBatch(
    ops: Operation[],
    source: 'local' | 'remote' = 'local',
    options?: { pendingApply?: boolean },
  ): Promise<number[]> {
    await this._ensureInit();
    const tx = this.db.transaction(STORE_NAMES.OPS, 'readwrite');
    const store = tx.objectStore(STORE_NAMES.OPS);
    const seqs: number[] = [];

    try {
      for (const op of ops) {
        // Encode operation to compact format for storage efficiency
        const compactOp = encodeOperation(op);
        const entry: Omit<StoredOperationLogEntry, 'seq'> = {
          op: compactOp,
          appliedAt: Date.now(),
          source,
          syncedAt: source === 'remote' ? Date.now() : undefined,
          applicationStatus:
            source === 'remote'
              ? options?.pendingApply
                ? 'pending'
                : 'applied'
              : undefined,
        };
        const seq = await store.add(entry as StoredOperationLogEntry);
        seqs.push(seq as number);
      }

      await tx.done;
      return seqs;
    } catch (e) {
      // Cache is stale if we hit a constraint error - invalidate to force refresh
      // This handles the case where a previous sync partially wrote ops before failing,
      // leaving the cache out of sync with IndexedDB. See issue #6213.
      if (e instanceof DOMException && e.name === 'ConstraintError') {
        this._appliedOpIdsCache = null;
        this._cacheLastSeq = 0;
        throw new Error(DUPLICATE_OPERATION_ERROR_MSG);
      }
      if (e instanceof DOMException && e.name === 'QuotaExceededError') {
        throw new StorageQuotaExceededError();
      }
      throw e;
    }
  }

  /**
   * Appends operations to the store, silently skipping any that already exist.
   *
   * Unlike appendBatch(), this method does NOT throw on duplicate operations.
   * It checks each op's ID against the IndexedDB `byId` unique index within
   * the same readwrite transaction before inserting. This eliminates the
   * TOCTOU race between filterNewOps() and appendBatch() that caused
   * persistent "Duplicate operation detected" errors (issue #6343).
   *
   * @param ops Operations to append
   * @param source Whether these are local or remote operations
   * @param options Additional options (e.g., pendingApply for remote ops)
   * @returns Object with seqs of written ops, the written ops, and skipped count
   */
  async appendBatchSkipDuplicates(
    ops: Operation[],
    source: 'local' | 'remote' = 'local',
    options?: { pendingApply?: boolean },
  ): Promise<{ seqs: number[]; writtenOps: Operation[]; skippedCount: number }> {
    if (ops.length === 0) {
      return { seqs: [], writtenOps: [], skippedCount: 0 };
    }

    await this._ensureInit();
    const tx = this.db.transaction(STORE_NAMES.OPS, 'readwrite');
    const store = tx.objectStore(STORE_NAMES.OPS);
    const byIdIndex = store.index(OPS_INDEXES.BY_ID);
    const seqs: number[] = [];
    const writtenOps: Operation[] = [];
    let skippedCount = 0;

    try {
      for (const op of ops) {
        // Check if op already exists in the same transaction (atomic)
        const existingKey = await byIdIndex.getKey(op.id);
        if (existingKey !== undefined) {
          skippedCount++;
          continue;
        }

        const compactOp = encodeOperation(op);
        const entry: Omit<StoredOperationLogEntry, 'seq'> = {
          op: compactOp,
          appliedAt: Date.now(),
          source,
          syncedAt: source === 'remote' ? Date.now() : undefined,
          applicationStatus:
            source === 'remote'
              ? options?.pendingApply
                ? 'pending'
                : 'applied'
              : undefined,
        };
        const seq = await store.add(entry as StoredOperationLogEntry);
        seqs.push(seq as number);
        writtenOps.push(op);
      }

      await tx.done;

      if (skippedCount > 0) {
        Log.warn(
          `[OpLogStore] appendBatchSkipDuplicates: Skipped ${skippedCount} duplicate op(s) out of ${ops.length}`,
        );
      }

      return { seqs, writtenOps, skippedCount };
    } catch (e) {
      if (e instanceof DOMException && e.name === 'QuotaExceededError') {
        throw new StorageQuotaExceededError();
      }
      throw e;
    }
  }

  /**
   * Marks operations as successfully applied.
   * Called after remote operations have been dispatched to NgRx.
   * Also handles transitioning 'failed' ops to 'applied' when retrying succeeds.
   */
  async markApplied(seqs: number[]): Promise<void> {
    await this._ensureInit();
    const tx = this.db.transaction(STORE_NAMES.OPS, 'readwrite');
    const store = tx.objectStore(STORE_NAMES.OPS);
    for (const seq of seqs) {
      const entry = await store.get(seq);
      // Allow transitioning from 'pending' or 'failed' to 'applied'
      // 'failed' ops can be retried and need to be cleared when successful
      if (
        entry &&
        (entry.applicationStatus === 'pending' || entry.applicationStatus === 'failed')
      ) {
        entry.applicationStatus = 'applied';
        await store.put(entry);
      }
    }
    await tx.done;
  }

  /**
   * Gets remote operations that are pending application (for crash recovery).
   * These are ops that were stored but the app crashed before marking them applied.
   * PERF: Uses compound index for O(results) instead of O(all ops) scan.
   */
  async getPendingRemoteOps(): Promise<OperationLogEntry[]> {
    await this._ensureInit();
    let storedEntries: StoredOperationLogEntry[];
    try {
      // Type assertion needed for compound index key - idb's types don't fully support this
      storedEntries = await this.db.getAllFromIndex(
        STORE_NAMES.OPS,
        OPS_INDEXES.BY_SOURCE_AND_STATUS,
        ['remote', 'pending'] as any,
      );
    } catch (e) {
      // Fallback for databases created before version 3 index migration
      // This handles the case where the bySourceAndStatus index doesn't exist
      Log.warn(
        'OperationLogStoreService: bySourceAndStatus index not found, using fallback scan',
      );
      const allOps = await this.db.getAll(STORE_NAMES.OPS);
      storedEntries = allOps.filter(
        (entry) => entry.source === 'remote' && entry.applicationStatus === 'pending',
      );
    }
    // Decode compact operations for backwards compatibility
    return storedEntries.map(decodeStoredEntry);
  }

  async hasOp(id: string): Promise<boolean> {
    await this._ensureInit();
    const entry = await this.db.getFromIndex(STORE_NAMES.OPS, OPS_INDEXES.BY_ID, id);
    return !!entry;
  }

  /**
   * Filters out operations that already exist in the store.
   * More efficient than calling hasOp() for each op individually.
   * @returns Only the operations that don't already exist in the store
   */
  async filterNewOps(ops: Operation[]): Promise<Operation[]> {
    if (ops.length === 0) return [];
    const appliedIds = await this.getAppliedOpIds();
    return ops.filter((op) => !appliedIds.has(op.id));
  }

  /**
   * Gets an operation entry by its ID.
   * Returns undefined if the operation doesn't exist.
   */
  async getOpById(id: string): Promise<OperationLogEntry | undefined> {
    await this._ensureInit();
    const stored = await this.db.getFromIndex(STORE_NAMES.OPS, OPS_INDEXES.BY_ID, id);
    return stored ? decodeStoredEntry(stored) : undefined;
  }

  async getOpsAfterSeq(seq: number): Promise<OperationLogEntry[]> {
    await this._ensureInit();
    const storedEntries = await this.db.getAll(
      STORE_NAMES.OPS,
      IDBKeyRange.lowerBound(seq, true),
    );
    return storedEntries.map(decodeStoredEntry);
  }

  /**
   * Finds the latest full-state operation (SYNC_IMPORT, BACKUP_IMPORT, or REPAIR)
   * in the local operation log.
   *
   * This is used to filter incoming ops - any operation with a UUIDv7 timestamp
   * BEFORE the latest full-state op should be discarded, as it references state
   * that no longer exists.
   *
   * Uses cursor iteration for memory efficiency - avoids loading all ops into memory
   * at once, which matters on mobile devices with limited RAM. Trade-off is slightly
   * slower due to per-op cursor overhead vs bulk getAll().
   *
   * @returns The latest full-state operation, or undefined if none exists
   */
  async getLatestFullStateOp(): Promise<Operation | undefined> {
    await this._ensureInit();

    // Use reverse cursor to iterate from newest to oldest by seq
    // This is more memory-efficient than getAll() and we can exit early
    // once we've found a full-state op that's older than our current best
    let cursor = await this.db
      .transaction(STORE_NAMES.OPS)
      .store.openCursor(null, 'prev');

    let latestFullStateOp: Operation | undefined;

    while (cursor) {
      const entry = decodeStoredEntry(cursor.value);
      const isFullStateOp =
        entry.op.opType === OpType.SyncImport ||
        entry.op.opType === OpType.BackupImport ||
        entry.op.opType === OpType.Repair;

      if (isFullStateOp) {
        // Track the latest by UUIDv7 (lexicographic comparison works for UUIDv7)
        if (!latestFullStateOp || entry.op.id > latestFullStateOp.id) {
          latestFullStateOp = entry.op;
        }
        // NOTE: We don't early-exit here because UUIDv7 order may differ from seq order
        // if remote ops with earlier timestamps arrive later. We must check all full-state
        // ops to find the one with the latest UUIDv7 ID. However, we continue using
        // reverse cursor to still benefit from early exit if the first full-state op found
        // has the highest UUIDv7 (which is the common case).
      }

      cursor = await cursor.continue();
    }

    return latestFullStateOp;
  }

  /**
   * Finds the latest full-state operation (SYNC_IMPORT, BACKUP_IMPORT, or REPAIR)
   * in the local operation log, including its entry metadata.
   *
   * This extended version returns the full OperationLogEntry, which includes:
   * - `source`: 'local' or 'remote' (was this import created locally or downloaded?)
   * - `syncedAt`: timestamp when the op was synced (undefined if not yet synced)
   *
   * These fields are needed to determine if the import requires user confirmation:
   * - Local unsynced imports (source='local', no syncedAt) → show dialog
   * - Remote/synced imports → silently filter old ops (already accepted)
   *
   * @returns The latest full-state operation entry, or undefined if none exists
   */
  async getLatestFullStateOpEntry(): Promise<OperationLogEntry | undefined> {
    await this._ensureInit();

    let cursor = await this.db
      .transaction(STORE_NAMES.OPS)
      .store.openCursor(null, 'prev');

    let latestEntry: OperationLogEntry | undefined;

    while (cursor) {
      const entry = decodeStoredEntry(cursor.value);
      const isFullStateOp =
        entry.op.opType === OpType.SyncImport ||
        entry.op.opType === OpType.BackupImport ||
        entry.op.opType === OpType.Repair;

      if (isFullStateOp) {
        // Track the latest by UUIDv7 (lexicographic comparison works for UUIDv7)
        if (!latestEntry || entry.op.id > latestEntry.op.id) {
          latestEntry = entry;
        }
      }

      cursor = await cursor.continue();
    }

    return latestEntry;
  }

  /**
   * Deletes all full-state operations (SYNC_IMPORT, BACKUP_IMPORT, REPAIR) from the local store.
   *
   * This is used when force-downloading remote state (USE_REMOTE in conflict resolution).
   * The local import operation must be removed so that incoming remote ops aren't filtered
   * against it.
   *
   * @returns Number of operations deleted
   */
  async clearFullStateOps(): Promise<number> {
    await this._ensureInit();

    const opsToDelete: string[] = [];

    // Find all full-state ops
    let cursor = await this.db.transaction(STORE_NAMES.OPS).store.openCursor();

    while (cursor) {
      const entry = decodeStoredEntry(cursor.value);
      const isFullStateOp =
        entry.op.opType === OpType.SyncImport ||
        entry.op.opType === OpType.BackupImport ||
        entry.op.opType === OpType.Repair;

      if (isFullStateOp) {
        opsToDelete.push(entry.op.id);
      }

      cursor = await cursor.continue();
    }

    // Delete them in a write transaction
    if (opsToDelete.length > 0) {
      const tx = this.db.transaction(STORE_NAMES.OPS, 'readwrite');
      for (const id of opsToDelete) {
        await tx.store
          .index(OPS_INDEXES.BY_ID)
          .openCursor(id)
          .then((c) => c?.delete());
      }
      await tx.done;
      this._invalidateUnsyncedCache();
    }

    return opsToDelete.length;
  }

  /**
   * Deletes all full-state operations (SYNC_IMPORT, BACKUP_IMPORT, REPAIR) from the local store,
   * EXCEPT for the operation(s) with the specified ID(s).
   *
   * This is used when applying a new remote full-state operation. After successfully storing
   * the new full-state op, we remove the old ones to prevent them from being used for filtering.
   *
   * The problem this solves:
   * 1. Client A has old SYNC_IMPORT from client X with minimal clock {X:1}
   * 2. Client B uploads new SYNC_IMPORT
   * 3. Client A downloads and stores B's SYNC_IMPORT
   * 4. Without clearing, getLatestFullStateOpEntry might return X's old import (if newer by UUIDv7)
   * 5. New operations would appear CONCURRENT with X's import and get filtered
   *
   * @param excludeIds - IDs of operations to NOT delete (typically the newly stored import)
   * @returns Number of operations deleted
   */
  async clearFullStateOpsExcept(excludeIds: string[]): Promise<number> {
    await this._ensureInit();

    const excludeIdSet = new Set(excludeIds);
    const opsToDelete: string[] = [];

    // Find all full-state ops except the excluded ones
    let cursor = await this.db.transaction(STORE_NAMES.OPS).store.openCursor();

    while (cursor) {
      const entry = decodeStoredEntry(cursor.value);
      const isFullStateOp =
        entry.op.opType === OpType.SyncImport ||
        entry.op.opType === OpType.BackupImport ||
        entry.op.opType === OpType.Repair;

      if (isFullStateOp && !excludeIdSet.has(entry.op.id)) {
        opsToDelete.push(entry.op.id);
      }

      cursor = await cursor.continue();
    }

    // Delete them in a write transaction
    if (opsToDelete.length > 0) {
      const tx = this.db.transaction(STORE_NAMES.OPS, 'readwrite');
      for (const id of opsToDelete) {
        await tx.store
          .index(OPS_INDEXES.BY_ID)
          .openCursor(id)
          .then((c) => c?.delete());
      }
      await tx.done;
      this._invalidateUnsyncedCache();
    }

    return opsToDelete.length;
  }

  async getUnsynced(): Promise<OperationLogEntry[]> {
    await this._ensureInit();

    const currentLastSeq = await this.getLastSeq();

    // Return cache if valid (no new operations since last cache build)
    if (this._unsyncedCache && this._unsyncedCacheLastSeq === currentLastSeq) {
      return [...this._unsyncedCache];
    }

    // If cache exists but is stale (new ops added), incrementally add new unsynced ops
    if (this._unsyncedCache && this._unsyncedCacheLastSeq > 0) {
      const newStoredEntries = await this.db.getAll(
        STORE_NAMES.OPS,
        IDBKeyRange.lowerBound(this._unsyncedCacheLastSeq, true),
      );
      const newUnsynced = newStoredEntries
        .filter((e) => !e.syncedAt && !e.rejectedAt)
        .map(decodeStoredEntry);
      this._unsyncedCache.push(...newUnsynced);
      this._unsyncedCacheLastSeq = currentLastSeq;
      return [...this._unsyncedCache];
    }

    // Initial cache build - full scan required
    const all = await this.db.getAll(STORE_NAMES.OPS);
    this._unsyncedCache = all
      .filter((e) => !e.syncedAt && !e.rejectedAt)
      .map(decodeStoredEntry);
    this._unsyncedCacheLastSeq = currentLastSeq;

    return [...this._unsyncedCache];
  }

  /**
   * Invalidates the unsynced cache. Called when operations are marked synced/rejected.
   */
  private _invalidateUnsyncedCache(): void {
    this._unsyncedCache = null;
    this._unsyncedCacheLastSeq = 0;
  }

  async getUnsyncedByEntity(): Promise<Map<string, Operation[]>> {
    await this._ensureInit();
    const unsynced = await this.getUnsynced();
    const map = new Map<string, Operation[]>();
    for (const entry of unsynced) {
      const ids = entry.op.entityIds || (entry.op.entityId ? [entry.op.entityId] : []);
      for (const id of ids) {
        const key = toEntityKey(entry.op.entityType, id);
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(entry.op);
      }
    }
    return map;
  }

  async getAppliedOpIds(): Promise<Set<string>> {
    await this._ensureInit();

    const currentLastSeq = await this.getLastSeq();

    // Return cache if valid (no new operations since last cache build)
    if (this._appliedOpIdsCache && this._cacheLastSeq === currentLastSeq) {
      return new Set(this._appliedOpIdsCache);
    }

    // If cache exists but is stale, incrementally add new IDs
    if (this._appliedOpIdsCache && this._cacheLastSeq > 0) {
      const newEntries = await this.db.getAll(
        STORE_NAMES.OPS,
        IDBKeyRange.lowerBound(this._cacheLastSeq, true),
      );
      for (const entry of newEntries) {
        // Handle both compact and full operation formats
        this._appliedOpIdsCache.add(getOpId(entry.op));
      }
      this._cacheLastSeq = currentLastSeq;
      return new Set(this._appliedOpIdsCache);
    }

    // Initial cache build - full scan required
    const entries = await this.db.getAll(STORE_NAMES.OPS);
    // Handle both compact and full operation formats
    this._appliedOpIdsCache = new Set(entries.map((e) => getOpId(e.op)));
    this._cacheLastSeq = currentLastSeq;

    return new Set(this._appliedOpIdsCache);
  }

  async markSynced(seqs: number[]): Promise<void> {
    await this._ensureInit();
    const tx = this.db.transaction(STORE_NAMES.OPS, 'readwrite');
    const store = tx.objectStore(STORE_NAMES.OPS);
    const now = Date.now();
    for (const seq of seqs) {
      const entry = await store.get(seq);
      if (entry) {
        entry.syncedAt = now;
        await store.put(entry);
      }
    }
    await tx.done;
    this._invalidateUnsyncedCache();
  }

  async markRejected(opIds: string[]): Promise<void> {
    await this._ensureInit();

    const tx = this.db.transaction(STORE_NAMES.OPS, 'readwrite');
    const store = tx.objectStore(STORE_NAMES.OPS);
    const index = store.index('byId');
    const now = Date.now();

    for (const opId of opIds) {
      const entry = await index.get(opId);
      if (entry) {
        entry.rejectedAt = now;
        await store.put(entry);
      }
    }
    await tx.done;
    this._invalidateUnsyncedCache();
  }

  /**
   * Clears all unsynced local operations by marking them as rejected.
   * Used when force-downloading remote state to discard local changes.
   */
  async clearUnsyncedOps(): Promise<void> {
    await this._ensureInit();

    const unsynced = await this.getUnsynced();
    if (unsynced.length === 0) return;

    const tx = this.db.transaction(STORE_NAMES.OPS, 'readwrite');
    const store = tx.objectStore(STORE_NAMES.OPS);
    const now = Date.now();

    for (const entry of unsynced) {
      const stored = await store.get(entry.seq);
      if (stored) {
        stored.rejectedAt = now;
        await store.put(stored);
      }
    }
    await tx.done;
    this._invalidateUnsyncedCache();
  }

  /**
   * Marks operations as failed (can be retried later).
   * Increments the retry count for each operation.
   * If maxRetries is provided and reached, marks as rejected instead.
   */
  async markFailed(opIds: string[], maxRetries?: number): Promise<void> {
    await this._ensureInit();
    const tx = this.db.transaction(STORE_NAMES.OPS, 'readwrite');
    const store = tx.objectStore(STORE_NAMES.OPS);
    const index = store.index('byId');
    const now = Date.now();

    for (const opId of opIds) {
      const entry = await index.get(opId);
      if (entry) {
        const newRetryCount = (entry.retryCount ?? 0) + 1;

        // If max retries reached, mark as rejected permanently
        if (maxRetries !== undefined && newRetryCount >= maxRetries) {
          entry.rejectedAt = now;
          entry.applicationStatus = undefined;
        } else {
          entry.applicationStatus = 'failed';
          entry.retryCount = newRetryCount;
        }
        await store.put(entry);
      }
    }
    await tx.done;
  }

  /**
   * Gets remote operations that failed and can be retried.
   * These are ops that were attempted but failed (e.g., missing dependency).
   * PERF: Uses compound index to reduce scan scope, then filters by rejectedAt.
   */
  async getFailedRemoteOps(): Promise<OperationLogEntry[]> {
    await this._ensureInit();
    let storedEntries: StoredOperationLogEntry[];
    try {
      // Type assertion needed for compound index key - idb's types don't fully support this
      storedEntries = await this.db.getAllFromIndex(
        STORE_NAMES.OPS,
        OPS_INDEXES.BY_SOURCE_AND_STATUS,
        ['remote', 'failed'] as any,
      );
    } catch (e) {
      // Fallback for databases created before version 3 index migration
      Log.warn(
        'OperationLogStoreService: bySourceAndStatus index not found, using fallback scan',
      );
      const allOps = await this.db.getAll(STORE_NAMES.OPS);
      storedEntries = allOps.filter(
        (entry) => entry.source === 'remote' && entry.applicationStatus === 'failed',
      );
    }
    // Decode and filter out rejected ops
    return storedEntries.filter((e) => !e.rejectedAt).map(decodeStoredEntry);
  }

  async deleteOpsWhere(predicate: (entry: OperationLogEntry) => boolean): Promise<void> {
    await this._ensureInit();
    // This requires iterating and deleting.
    // Ideally we delete by range (older than X).
    // The predicate in plan: syncedAt && appliedAt < old && seq <= lastSeq
    // We can iterate via cursor.
    const tx = this.db.transaction(STORE_NAMES.OPS, 'readwrite');
    const store = tx.objectStore(STORE_NAMES.OPS);
    let cursor = await store.openCursor();
    let deletedCount = 0;
    while (cursor) {
      // Decode stored entry before applying predicate
      const decoded = decodeStoredEntry(cursor.value);
      if (predicate(decoded)) {
        await cursor.delete();
        deletedCount++;
      }
      cursor = await cursor.continue();
    }
    await tx.done;

    // Invalidate caches if any ops were deleted to prevent stale data
    if (deletedCount > 0) {
      this._appliedOpIdsCache = null;
      this._cacheLastSeq = 0;
      this._invalidateUnsyncedCache();
    }
  }

  async getLastSeq(): Promise<number> {
    await this._ensureInit();
    const cursor = await this.db
      .transaction(STORE_NAMES.OPS)
      .store.openCursor(null, 'prev');
    return cursor ? (cursor.key as number) : 0;
  }

  /**
   * Checks if there are any operations that have been synced to the server.
   * Used to distinguish between:
   * - Fresh client (only local ops, never synced) → NOT a server migration
   * - Client that previously synced (has synced ops) → Server migration scenario
   *
   * NOTE: Excludes MIGRATION and RECOVERY entity types from the check.
   * These are special ops created during local migration from legacy data and
   * don't represent real sync history with a remote server. Including them
   * would incorrectly trigger server migration when multiple clients with
   * legacy data join a new sync group.
   */
  async hasSyncedOps(): Promise<boolean> {
    await this._ensureInit();
    // Use the bySyncedAt index to find synced ops, but exclude MIGRATION/RECOVERY
    let cursor = await this.db
      .transaction(STORE_NAMES.OPS)
      .store.index(OPS_INDEXES.BY_SYNCED_AT)
      .openCursor();

    while (cursor) {
      const op = cursor.value.op;
      // Handle both compact format ('e') and full format ('entityType')
      const entityType = isCompactOperation(op) ? op.e : (op as Operation).entityType;
      // Skip MIGRATION and RECOVERY entity types - they're not real sync history
      if (entityType !== 'MIGRATION' && entityType !== 'RECOVERY') {
        return true; // Found a real synced op
      }
      cursor = await cursor.continue();
    }
    return false;
  }

  async saveStateCache(snapshot: {
    state: unknown;
    lastAppliedOpSeq: number;
    vectorClock: VectorClock;
    compactedAt: number;
    schemaVersion?: number;
    snapshotEntityKeys?: string[];
  }): Promise<void> {
    await this._ensureInit();
    await this.db.put(STORE_NAMES.STATE_CACHE, {
      id: SINGLETON_KEY,
      ...snapshot,
    });
  }

  async loadStateCache(): Promise<{
    state: unknown;
    lastAppliedOpSeq: number;
    vectorClock: VectorClock;
    compactedAt: number;
    schemaVersion?: number;
    snapshotEntityKeys?: string[];
  } | null> {
    await this._ensureInit();
    const cache = await this.db.get(STORE_NAMES.STATE_CACHE, SINGLETON_KEY);
    // Return null if cache doesn't exist or if state is null/undefined.
    // incrementCompactionCounter() may create a cache entry with state: null
    // just to track the counter - this shouldn't be treated as a valid snapshot.
    if (!cache || cache.state === null || cache.state === undefined) {
      return null;
    }
    return cache;
  }

  // ============================================================
  // Migration Safety Backup (A.7.12)
  // ============================================================

  /**
   * Saves a backup of the current state cache before running migrations.
   * If a migration crashes mid-process, this backup can be restored.
   */
  async saveStateCacheBackup(): Promise<void> {
    await this._ensureInit();
    const current = await this.db.get(STORE_NAMES.STATE_CACHE, SINGLETON_KEY);
    if (current) {
      await this.db.put(STORE_NAMES.STATE_CACHE, {
        ...current,
        id: BACKUP_KEY,
      });
    }
  }

  /**
   * Loads the backup state cache, if one exists.
   * Used for crash recovery during migration.
   */
  async loadStateCacheBackup(): Promise<{
    state: unknown;
    lastAppliedOpSeq: number;
    vectorClock: VectorClock;
    compactedAt: number;
    schemaVersion?: number;
    snapshotEntityKeys?: string[];
  } | null> {
    await this._ensureInit();
    const backup = await this.db.get(STORE_NAMES.STATE_CACHE, BACKUP_KEY);
    return backup || null;
  }

  /**
   * Clears the backup state cache after successful migration.
   */
  async clearStateCacheBackup(): Promise<void> {
    await this._ensureInit();
    await this.db.delete(STORE_NAMES.STATE_CACHE, BACKUP_KEY);
  }

  /**
   * Checks if a backup exists (indicates interrupted migration).
   */
  async hasStateCacheBackup(): Promise<boolean> {
    await this._ensureInit();
    const backup = await this.db.get(STORE_NAMES.STATE_CACHE, BACKUP_KEY);
    return !!backup;
  }

  /**
   * Restores the backup as the current state cache.
   * Used when migration fails and we need to rollback.
   */
  async restoreStateCacheFromBackup(): Promise<void> {
    await this._ensureInit();
    const backup = await this.db.get(STORE_NAMES.STATE_CACHE, BACKUP_KEY);
    if (backup) {
      await this.db.put(STORE_NAMES.STATE_CACHE, {
        ...backup,
        id: SINGLETON_KEY,
      });
      await this.db.delete(STORE_NAMES.STATE_CACHE, BACKUP_KEY);
    }
  }

  // ============================================================
  // Persistent Compaction Counter
  // ============================================================

  /**
   * Gets the current compaction counter value.
   * Returns 0 if no counter exists yet.
   */
  async getCompactionCounter(): Promise<number> {
    await this._ensureInit();
    const cache = await this.db.get(STORE_NAMES.STATE_CACHE, SINGLETON_KEY);
    return cache?.compactionCounter ?? 0;
  }

  /**
   * Atomically increments the compaction counter and returns the new value.
   * Uses a transaction to ensure the read-modify-write is atomic across tabs.
   * Used to track operations since last compaction across tabs/restarts.
   */
  async incrementCompactionCounter(): Promise<number> {
    await this._ensureInit();
    const tx = this.db.transaction(STORE_NAMES.STATE_CACHE, 'readwrite');
    const store = tx.objectStore(STORE_NAMES.STATE_CACHE);
    const cache = await store.get('current');

    if (!cache) {
      // No state cache yet - create one with counter starting at 1
      // Provide default values for required schema fields
      await store.put({
        id: SINGLETON_KEY,
        state: null,
        lastAppliedOpSeq: 0,
        vectorClock: {},
        compactedAt: 0,
        compactionCounter: 1,
      });
      await tx.done;
      return 1;
    }

    const newCount = (cache.compactionCounter ?? 0) + 1;
    await store.put({
      ...cache,
      compactionCounter: newCount,
    });
    await tx.done;
    return newCount;
  }

  /**
   * Resets the compaction counter to 0.
   * Called after successful compaction.
   */
  async resetCompactionCounter(): Promise<void> {
    await this._ensureInit();
    const cache = await this.db.get(STORE_NAMES.STATE_CACHE, SINGLETON_KEY);
    if (cache) {
      await this.db.put(STORE_NAMES.STATE_CACHE, {
        ...cache,
        compactionCounter: 0,
      });
    }
  }

  /**
   * Clears all data from the database. Used for testing purposes only.
   * @internal
   */
  async _clearAllDataForTesting(): Promise<void> {
    await this._ensureInit();
    const tx = this.db.transaction(
      [
        STORE_NAMES.OPS,
        STORE_NAMES.STATE_CACHE,
        STORE_NAMES.IMPORT_BACKUP,
        STORE_NAMES.VECTOR_CLOCK,
        STORE_NAMES.ARCHIVE_YOUNG,
        STORE_NAMES.ARCHIVE_OLD,
      ],
      'readwrite',
    );
    await tx.objectStore(STORE_NAMES.OPS).clear();
    await tx.objectStore(STORE_NAMES.STATE_CACHE).clear();
    await tx.objectStore(STORE_NAMES.IMPORT_BACKUP).clear();
    await tx.objectStore(STORE_NAMES.VECTOR_CLOCK).clear();
    await tx.objectStore(STORE_NAMES.ARCHIVE_YOUNG).clear();
    await tx.objectStore(STORE_NAMES.ARCHIVE_OLD).clear();
    await tx.done;
    // Invalidate all caches
    this._appliedOpIdsCache = null;
    this._cacheLastSeq = 0;
    this._unsyncedCache = null;
    this._unsyncedCacheLastSeq = 0;
    this._vectorClockCache = null;
  }

  // ============================================================
  // Import Backup (pre-import state preservation)
  // ============================================================

  /**
   * Saves a backup of the current state before an import operation.
   * This allows manual recovery if the import causes issues.
   */
  async saveImportBackup(state: unknown): Promise<void> {
    await this._ensureInit();
    await this.db.put(STORE_NAMES.IMPORT_BACKUP, {
      id: SINGLETON_KEY,
      state,
      savedAt: Date.now(),
    });
  }

  /**
   * Loads the import backup, if one exists.
   */
  async loadImportBackup(): Promise<{ state: unknown; savedAt: number } | null> {
    await this._ensureInit();
    const backup = await this.db.get(STORE_NAMES.IMPORT_BACKUP, SINGLETON_KEY);
    return backup ? { state: backup.state, savedAt: backup.savedAt } : null;
  }

  /**
   * Clears the import backup.
   */
  async clearImportBackup(): Promise<void> {
    await this._ensureInit();
    await this.db.delete(STORE_NAMES.IMPORT_BACKUP, SINGLETON_KEY);
  }

  /**
   * Checks if an import backup exists.
   */
  async hasImportBackup(): Promise<boolean> {
    await this._ensureInit();
    const backup = await this.db.get(STORE_NAMES.IMPORT_BACKUP, SINGLETON_KEY);
    return !!backup;
  }

  /**
   * Clears all operations from the operation log.
   * Used when importing data to avoid accumulating old SYNC_IMPORT operations.
   * NOTE: This does NOT clear the state_cache - that should be updated separately.
   */
  async clearAllOperations(): Promise<void> {
    await this._ensureInit();
    const tx = this.db.transaction(STORE_NAMES.OPS, 'readwrite');
    await tx.objectStore(STORE_NAMES.OPS).clear();
    await tx.done;
    // Invalidate caches since we cleared all ops
    this._appliedOpIdsCache = null;
    this._cacheLastSeq = 0;
    this._invalidateUnsyncedCache();
  }

  // ============================================================
  // Vector Clock Management (Performance Optimization)
  // ============================================================

  /**
   * Gets the current vector clock from the SUP_OPS database.
   * Returns null if no vector clock has been stored yet.
   * PERF: Uses in-memory cache to avoid IndexedDB read on every operation.
   */
  async getVectorClock(): Promise<VectorClock | null> {
    if (this._vectorClockCache !== null) {
      return { ...this._vectorClockCache };
    }
    await this._ensureInit();
    const entry = await this.db.get(STORE_NAMES.VECTOR_CLOCK, SINGLETON_KEY);
    this._vectorClockCache = entry?.clock ?? null;
    return this._vectorClockCache ? { ...this._vectorClockCache } : null;
  }

  /**
   * Sets the vector clock directly. Used for:
   * - Migration from pf.META_MODEL on upgrade
   * - Sync import when receiving full state
   */
  async setVectorClock(clock: VectorClock): Promise<void> {
    await this._ensureInit();
    // Preserve existing protectedClientIds when updating the clock
    // This is important because setVectorClock is called during hydration,
    // and we don't want to lose the protected IDs that were set by a previous
    // SYNC_IMPORT/BACKUP_IMPORT/REPAIR operation.
    const existingEntry = await this.db.get(STORE_NAMES.VECTOR_CLOCK, SINGLETON_KEY);
    const protectedClientIds = existingEntry?.protectedClientIds ?? [];
    await this.db.put(
      STORE_NAMES.VECTOR_CLOCK,
      { clock, lastUpdate: Date.now(), protectedClientIds },
      SINGLETON_KEY,
    );
    this._vectorClockCache = clock;
  }

  /**
   * Clears the in-memory vector clock cache, forcing next read to fetch from IndexedDB.
   *
   * MULTI-TAB SAFETY: Each browser tab maintains its own in-memory cache. When Tab A
   * writes a new operation and updates its cache, Tab B's cache remains stale.
   * Call this before reading the vector clock inside a Web Lock to ensure freshness
   * after other tabs may have written.
   *
   * The typical pattern is:
   * ```
   * await lockService.request(OPERATION_LOG, async () => {
   *   opLogStore.clearVectorClockCache(); // Force fresh read
   *   const clock = await vectorClockService.getCurrentVectorClock();
   *   // ... create operation with correct clock
   * });
   * ```
   */
  clearVectorClockCache(): void {
    this._vectorClockCache = null;
  }

  /**
   * Merges remote operations' vector clocks into the local vector clock.
   *
   * CRITICAL: This must be called after applying remote operations to ensure
   * subsequent local operations have vector clocks that dominate the remote ops.
   *
   * Without this, the following bug occurs:
   * 1. Client A does SYNC_IMPORT with clock {A: 1}
   * 2. Client B downloads and applies the import
   * 3. Client B's vector clock is NOT updated (missing A's clock entry)
   * 4. Client B creates new ops with clock {B: 1} (missing A's entry)
   * 5. These ops are compared as CONCURRENT with the import, not GREATER_THAN
   * 6. SyncImportFilterService incorrectly filters them as "invalidated by import"
   *
   * @param ops Remote operations whose clocks should be merged into local clock
   */
  async mergeRemoteOpClocks(ops: Operation[]): Promise<void> {
    if (ops.length === 0) return;

    await this._ensureInit();

    // Get current local clock
    const currentClock = (await this.getVectorClock()) ?? {};

    // DIAGNOSTIC LOGGING: Log current clock before merge
    Log.debug(
      `[OpLogStore] mergeRemoteOpClocks: BEFORE merge\n` +
        `  Current clock: ${vectorClockToString(currentClock)}\n` +
        `  Merging ${ops.length} remote ops`,
    );

    // Merge all remote ops' clocks into the local clock
    const mergedClock = { ...currentClock };
    for (const op of ops) {
      // Log each op's clock being merged (especially important for SYNC_IMPORT)
      if (op.opType === OpType.SyncImport || op.opType === OpType.BackupImport) {
        Log.log(
          `[OpLogStore] mergeRemoteOpClocks: Merging FULL-STATE op ${op.opType}\n` +
            `  Op ID:         ${op.id}\n` +
            `  Op clientId:   ${op.clientId}\n` +
            `  Op clock:      ${vectorClockToString(op.vectorClock)}`,
        );
      }
      for (const [clientId, counter] of Object.entries(op.vectorClock)) {
        mergedClock[clientId] = Math.max(mergedClock[clientId] ?? 0, counter);
      }
    }

    // Preserve existing protectedClientIds when updating the clock
    // This is critical: without this, vector clock pruning will remove the SYNC_IMPORT
    // client ID, causing new ops to appear CONCURRENT with the import instead of GREATER_THAN
    const existingEntry = await this.db.get(STORE_NAMES.VECTOR_CLOCK, SINGLETON_KEY);
    const protectedClientIds = existingEntry?.protectedClientIds ?? [];

    // DIAGNOSTIC LOGGING: Log merged clock after merge
    Log.debug(
      `[OpLogStore] mergeRemoteOpClocks: AFTER merge\n` +
        `  Merged clock:        ${vectorClockToString(mergedClock)}\n` +
        `  Protected clientIds: ${JSON.stringify(protectedClientIds)}`,
    );

    // Update the vector clock store
    await this.db.put(
      STORE_NAMES.VECTOR_CLOCK,
      { clock: mergedClock, lastUpdate: Date.now(), protectedClientIds },
      SINGLETON_KEY,
    );
    this._vectorClockCache = mergedClock;
  }

  /**
   * Gets the full vector clock entry including lastUpdate timestamp.
   * Used by legacy sync bridge to sync vector clock to pf.META_MODEL.
   */
  async getVectorClockEntry(): Promise<VectorClockEntry | null> {
    await this._ensureInit();
    const entry = await this.db.get(STORE_NAMES.VECTOR_CLOCK, SINGLETON_KEY);
    return entry ?? null;
  }

  /**
   * Gets the protected client IDs that should never be pruned from vector clocks.
   * These are client IDs from the latest SYNC_IMPORT/BACKUP_IMPORT/REPAIR operation.
   *
   * @returns Array of protected client IDs, or empty array if none set
   */
  async getProtectedClientIds(): Promise<string[]> {
    await this._ensureInit();
    const entry = await this.db.get(STORE_NAMES.VECTOR_CLOCK, SINGLETON_KEY);
    return entry?.protectedClientIds ?? [];
  }

  /**
   * Sets the protected client IDs that should never be pruned from vector clocks.
   * Called after applying a full-state operation (SYNC_IMPORT/BACKUP_IMPORT/REPAIR)
   * to ensure the import client's entry is preserved through future pruning.
   *
   * @param clientIds Client IDs to protect from pruning
   */
  async setProtectedClientIds(clientIds: string[]): Promise<void> {
    await this._ensureInit();
    const entry = await this.db.get(STORE_NAMES.VECTOR_CLOCK, SINGLETON_KEY);
    if (entry) {
      await this.db.put(
        STORE_NAMES.VECTOR_CLOCK,
        { ...entry, protectedClientIds: clientIds },
        SINGLETON_KEY,
      );
    } else {
      // No vector clock entry yet - create one with just the protected IDs
      await this.db.put(
        STORE_NAMES.VECTOR_CLOCK,
        { clock: {}, lastUpdate: Date.now(), protectedClientIds: clientIds },
        SINGLETON_KEY,
      );
    }
  }

  /**
   * Appends an operation AND updates the vector clock in a SINGLE atomic transaction.
   *
   * PERFORMANCE: This is the key optimization for mobile devices. Previously, each action
   * required two separate IndexedDB transactions (one to SUP_OPS, one to pf.META_MODEL).
   * By consolidating the vector clock into SUP_OPS, we can write both in a single transaction,
   * reducing disk I/O by ~50%.
   *
   * NOTE: The operation's vectorClock field should already contain the incremented clock
   * (incremented by the caller). This method stores that clock as the current vector clock,
   * it does NOT increment again.
   *
   * @param op The operation to append (with vectorClock already set)
   * @param source Whether this is a local or remote operation
   * @param options Additional options (e.g., pendingApply for remote ops)
   * @returns The sequence number of the appended operation
   */
  async appendWithVectorClockUpdate(
    op: Operation,
    source: 'local' | 'remote' = 'local',
    options?: { pendingApply?: boolean },
  ): Promise<number> {
    await this._ensureInit();

    const tx = this.db.transaction(
      [STORE_NAMES.OPS, STORE_NAMES.VECTOR_CLOCK],
      'readwrite',
    );
    const opsStore = tx.objectStore(STORE_NAMES.OPS);
    const vcStore = tx.objectStore(STORE_NAMES.VECTOR_CLOCK);

    // 1. Append operation to ops store (encoded to compact format)
    const compactOp = encodeOperation(op);
    const entry: Omit<StoredOperationLogEntry, 'seq'> = {
      op: compactOp,
      appliedAt: Date.now(),
      source,
      syncedAt: source === 'remote' ? Date.now() : undefined,
      applicationStatus:
        source === 'remote' ? (options?.pendingApply ? 'pending' : 'applied') : undefined,
    };
    const seq = await opsStore.add(entry as StoredOperationLogEntry);

    // 2. Update vector clock to match the operation's clock (only for local ops)
    // The op.vectorClock already contains the incremented value from the caller.
    // We store it as the current clock so subsequent operations can build on it.
    // IMPORTANT: Preserve protectedClientIds when updating the clock
    if (source === 'local') {
      const existingEntry = await vcStore.get(SINGLETON_KEY);
      const protectedClientIds = existingEntry?.protectedClientIds ?? [];
      await vcStore.put(
        { clock: op.vectorClock, lastUpdate: Date.now(), protectedClientIds },
        SINGLETON_KEY,
      );
      this._vectorClockCache = op.vectorClock;
    }

    await tx.done;
    return seq as number;
  }
}

// Note: Archive storage methods have been moved to ArchiveStoreService.
// See src/app/op-log/store/archive-store.service.ts
