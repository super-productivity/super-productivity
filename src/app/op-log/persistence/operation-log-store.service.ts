import { inject, Injectable } from '@angular/core';
import type { RemoteOperationApplyStorePort } from '@sp/sync-core';
import { DBSchema, IDBPDatabase, openDB } from 'idb';
import {
  Operation,
  OperationLogEntry,
  VectorClock,
  isFullStateOpType,
  FULL_STATE_OP_TYPES,
} from '../core/operation.types';
import { StorageQuotaExceededError } from '../core/errors/sync-errors';
import { toEntityKey } from '../util/entity-key.util';
import { getOpEntityIds } from '../util/get-op-entity-ids.util';
import {
  DB_NAME,
  DB_VERSION,
  STORE_NAMES,
  SINGLETON_KEY,
  BACKUP_KEY,
  FULL_STATE_OPS_META_KEY,
  OPS_INDEXES,
  ArchiveStoreEntry,
  ProfileDataStoreEntry,
} from './db-keys.const';
import {
  buildFullStateOpsMeta,
  FullStateOpRef,
  FullStateOpsMetaEntry,
} from './full-state-ops-meta';
import {
  DUPLICATE_OPERATION_ERROR_MSG,
  OPERATION_LOG_STORE_NOT_INITIALIZED,
  isLockRelatedIdbOpenError,
} from './op-log-errors.const';
import { runDbUpgrade } from './db-upgrade';
import { OpLogDbAdapter, OpLogTx } from './op-log-db-adapter';
import { OP_LOG_DB_ADAPTER_FACTORY } from './op-log-db-adapter.token';
import { Log } from '../../core/log';
import {
  IDB_OPEN_RETRIES,
  IDB_OPEN_RETRIES_NON_LOCK,
  IDB_OPEN_RETRY_BASE_DELAY_MS,
} from '../core/operation-log.const';
import { IndexedDBOpenError } from '../core/errors/indexed-db-open.error';
import { limitVectorClockSize, vectorClockToString } from '../../core/util/vector-clock';
import { CLIENT_ID_PROVIDER, ClientIdProvider } from '../util/client-id.provider';
import { CompactOperation } from './compact/compact-operation.types';
import {
  isCompactOperation,
  decodeOperation,
  encodeOperation,
} from './compact/operation-codec.service';

/**
 * Vector clock entry stored in the vector_clock object store.
 * Contains the clock and last update timestamp.
 */
interface VectorClockEntry {
  clock: VectorClock;
  lastUpdate: number;
}

/**
 * Shape stored in the `state_cache` store (keyPath `id`).
 *
 * `id` is optional in the type so the read-side return types stay assignable
 * from the looser snapshot shapes callers/tests construct (the pre-migration
 * return types did not surface `id`); the field is always present on rows
 * actually written here.
 */
interface StateCacheEntry {
  id?: string;
  state: unknown;
  lastAppliedOpSeq: number;
  vectorClock: VectorClock;
  compactedAt: number;
  schemaVersion?: number;
  compactionCounter?: number;
  snapshotEntityKeys?: string[];
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

const getStoredOpType = (op: Operation | CompactOperation): string =>
  isCompactOperation(op) ? op.o : op.opType;

// Note: DBSchema requires literal string keys matching STORE_NAMES values
interface OpLogDB extends DBSchema {
  [STORE_NAMES.OPS]: {
    key: number; // seq
    value: StoredOperationLogEntry;
    indexes: {
      [OPS_INDEXES.BY_ID]: string;
      [OPS_INDEXES.BY_SYNCED_AT]: number;
      // PERF: Compound index for efficient queries on remote ops by status
      [OPS_INDEXES.BY_SOURCE_AND_STATUS]: [string, string];
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
  /**
   * Stores profile data (CompleteBackup) for user profile switching.
   * Moved from localStorage to avoid 5-10 MB quota limits.
   */
  [STORE_NAMES.PROFILE_DATA]: {
    key: string; // profile ID
    value: ProfileDataStoreEntry;
  };
  /**
   * Stores the sync clientId (device identity). Consolidated from legacy 'pf'
   * in version 6 so destructive-flow rotation joins the atomic transaction in
   * runDestructiveStateReplacement. See issue #7732.
   */
  [STORE_NAMES.CLIENT_ID]: {
    key: string; // SINGLETON_KEY ('current')
    value: string; // the clientId
  };
  /**
   * Stores small derived metadata records. Full-state op refs live here so sync
   * filtering does not need to scan and decode the full ops table every call.
   */
  [STORE_NAMES.META]: {
    key: string;
    value: FullStateOpsMetaEntry;
  };
}

type OpLogStoreName = (typeof STORE_NAMES)[keyof typeof STORE_NAMES];

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
export class OperationLogStoreService implements RemoteOperationApplyStorePort<Operation> {
  private clientIdProvider: ClientIdProvider = inject(CLIENT_ID_PROVIDER);
  private _db?: IDBPDatabase<OpLogDB>;
  private _initPromise?: Promise<void>;
  // Phase A migration seam: methods migrated off direct `idb` route through
  // this adapter, which operates on the SAME connection adopted in init().
  // Phase B: the backend (IndexedDB vs SQLite) comes from DI.
  private readonly _adapter: OpLogDbAdapter = inject(OP_LOG_DB_ADAPTER_FACTORY)();

  // Cache for getAppliedOpIds() to avoid full table scans on every download
  private _appliedOpIdsCache: Set<string> | null = null;
  private _cacheLastSeq: number = 0;

  // Cache for getUnsynced() to avoid full table scans on every sync
  private _unsyncedCache: OperationLogEntry[] | null = null;
  private _unsyncedCacheLastSeq: number = 0;

  // PERF: Cache for getVectorClock() to avoid IndexedDB read per operation
  private _vectorClockCache: VectorClock | null = null;

  async init(): Promise<void> {
    // Self-managing backends (e.g. SQLite) own their handle and create their own
    // schema via the adapter — they need no WebView IndexedDB connection. Opening
    // one would both leave the adapter's tables uncreated AND still touch the
    // evictable WebView store this migration exists to escape. Only the
    // adopt-connection (IndexedDB) backend opens/owns a connection here.
    if (!this._adapter.adoptConnection) {
      await this._adapter.init();
      return;
    }
    const db = await this._openDbWithRetry();
    db.addEventListener('close', () => {
      Log.warn(
        '[OpLogStore] IndexedDB connection closed by browser. Will re-open on next access.',
      );
      this._db = undefined;
      this._initPromise = undefined;
      this._adapter.adoptConnection?.(undefined);
    });
    // A newer tab is upgrading SUP_OPS (a future schema bump). Close now so this
    // connection does not block the upgrade; the next access reopens
    // transparently via _ensureInit().
    db.addEventListener('versionchange', () => {
      db.close();
      this._db = undefined;
      this._initPromise = undefined;
      this._adapter.adoptConnection?.(undefined);
    });
    this._db = db;
    // Route already-migrated methods through the shared adapter on this same
    // connection (Phase A incremental migration; see indexed-db-op-log-adapter).
    this._adapter.adoptConnection?.(db);
  }

  /**
   * Wraps a single `openDB` call. Exists as a testing seam so specs can
   * `spyOn(service as any, '_openDbOnce')` to inject failures without mocking
   * the `idb` module import. Not intended to be called directly outside the
   * retry loop.
   */
  private _openDbOnce(): Promise<IDBPDatabase<OpLogDB>> {
    return openDB<OpLogDB>(DB_NAME, DB_VERSION, {
      upgrade: (db, oldVersion, _newVersion, transaction) => {
        runDbUpgrade(db, oldVersion, transaction);
      },
    });
  }

  /**
   * Opens IndexedDB with retry logic and exponential backoff.
   * Transient failures (file locks, temporary I/O issues) may resolve on retry.
   *
   * The retry budget depends on the error:
   * - Lock-related errors (InvalidStateError, "backing store"): use the full
   *   IDB_OPEN_RETRIES window (~31s) to outlast stale LevelDB locks from a
   *   previous session. See issue #7191.
   * - Other errors: fall back to IDB_OPEN_RETRIES_NON_LOCK (~7s). Every op-log
   *   read/write awaits `_ensureInit()`, so a 31s retry window on a non-lock
   *   error blocks the entire op-log subsystem for 31s before the hydrator's
   *   alert dialog reaches the user. There's no expectation that waiting
   *   helps for non-lock errors, so fail fast.
   *
   * @throws IndexedDBOpenError if all retry attempts fail
   * @see https://github.com/johannesjo/super-productivity/issues/6255
   * @see https://github.com/super-productivity/super-productivity/issues/7191
   */
  private async _openDbWithRetry(): Promise<IDBPDatabase<OpLogDB>> {
    let maxRetries = IDB_OPEN_RETRIES;
    let attempt = 1;
    let lastError: unknown;

    // Loop until either openDB succeeds or we exhaust the retry budget for the
    // observed error class. `maxRetries` may shrink after the first failure if
    // the error doesn't look lock-related.
    while (attempt <= 1 + maxRetries) {
      try {
        return await this._openDbOnce();
      } catch (e) {
        lastError = e;

        // Classify the error on the first failure. If it doesn't look
        // lock-related, shrink the retry budget so we fail fast and let the
        // hydrator surface the error instead of hanging for the full window.
        if (attempt === 1 && !isLockRelatedIdbOpenError(e)) {
          maxRetries = IDB_OPEN_RETRIES_NON_LOCK;
        }

        const totalAttempts = 1 + maxRetries;
        if (attempt < totalAttempts) {
          // Exponential backoff: BASE * 2^(attempt-1). Lock errors retry up to
          // IDB_OPEN_RETRIES times (~31s total); non-lock errors truncate at
          // IDB_OPEN_RETRIES_NON_LOCK (~7s total).
          const delay = IDB_OPEN_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
          Log.warn(
            `[OpLogStore] IndexedDB open failed (attempt ${attempt}/${totalAttempts}), retrying in ${delay}ms...`,
            e,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }

        attempt++;
      }
    }

    // All retries exhausted - log original error details (name + message)
    // explicitly before wrapping, so future bug reports include the underlying
    // cause and we can distinguish Chromium LevelDB locks from WebKit's iOS
    // "Connection to Indexed Database server lost" (WebKit bug 273827, see
    // issue #7415), quota errors, etc. The wrapper's `.message` already
    // carries the formatted original detail, so logging the wrapper exposes
    // everything we need.
    const err = new IndexedDBOpenError(lastError);
    Log.err('[OpLogStore] IndexedDB open failed after all retries.', err);
    throw err;
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
        this._initPromise = this.init().catch((e) => {
          this._initPromise = undefined;
          throw e;
        });
      }
      await this._initPromise;
    }
  }

  /**
   * Builds a StoredOperationLogEntry (minus auto-incremented seq) from an
   * Operation, encoding it to compact format. Shared by append/appendBatch/
   * appendBatchSkipDuplicates/appendWithVectorClockUpdate.
   */
  private _buildStoredEntry(
    op: Operation,
    source: 'local' | 'remote',
    options?: { pendingApply?: boolean },
  ): Omit<StoredOperationLogEntry, 'seq'> {
    return {
      op: encodeOperation(op),
      appliedAt: Date.now(),
      source,
      syncedAt: source === 'remote' ? Date.now() : undefined,
      applicationStatus:
        source === 'remote' ? (options?.pendingApply ? 'pending' : 'applied') : undefined,
    };
  }

  /**
   * Shared error handler for append operations.
   * Translates IndexedDB DOMExceptions into typed application errors.
   * ConstraintError also invalidates the applied-op-ids cache (issue #6213).
   */
  private _handleAppendError(e: unknown): never {
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

  /**
   * Invalidates all caches (applied op IDs, unsynced, vector clock cache
   * is NOT touched here). Called after bulk mutations that affect the
   * entire ops store (clearAllOperations, runDestructiveStateReplacement,
   * deleteOpsWhere).
   */
  private _invalidateAppliedAndUnsyncedCaches(): void {
    this._appliedOpIdsCache = null;
    this._cacheLastSeq = 0;
    this._invalidateUnsyncedCache();
  }

  private _getFullStateRef(
    op: Operation | CompactOperation,
    seq: number,
  ): FullStateOpRef | undefined {
    return isFullStateOpType(getStoredOpType(op))
      ? { opId: getOpId(op), seq }
      : undefined;
  }

  private _normalizeFullStateOpsMeta(meta: unknown): FullStateOpsMetaEntry | undefined {
    if (typeof meta !== 'object' || meta === null || !('refs' in meta)) {
      return undefined;
    }
    const refs = (meta as { refs: unknown }).refs;
    if (!Array.isArray(refs)) {
      return undefined;
    }

    const normalizedRefs: FullStateOpRef[] = [];
    for (const ref of refs) {
      if (
        typeof ref !== 'object' ||
        ref === null ||
        !('opId' in ref) ||
        !('seq' in ref)
      ) {
        return undefined;
      }
      const { opId, seq } = ref as { opId: unknown; seq: unknown };
      if (typeof opId !== 'string' || typeof seq !== 'number') {
        return undefined;
      }
      normalizedRefs.push({ opId, seq });
    }

    return buildFullStateOpsMeta(normalizedRefs);
  }

  private _withFullStateRef(
    meta: FullStateOpsMetaEntry | undefined,
    ref: FullStateOpRef,
  ): FullStateOpsMetaEntry {
    const refs = [...(meta?.refs ?? []).filter((r) => r.opId !== ref.opId), ref];
    return buildFullStateOpsMeta(refs);
  }

  private _withoutFullStateRefs(
    meta: FullStateOpsMetaEntry | undefined,
    opIdsToRemove: Set<string>,
  ): FullStateOpsMetaEntry {
    const refs = (meta?.refs ?? []).filter((ref) => !opIdsToRemove.has(ref.opId));
    return buildFullStateOpsMeta(refs);
  }

  private async _rebuildFullStateOpsMetaInTx(
    tx: OpLogTx,
  ): Promise<FullStateOpsMetaEntry> {
    const refs: FullStateOpRef[] = [];
    await tx.iterate<StoredOperationLogEntry>(STORE_NAMES.OPS, {}, (value, key) => {
      const ref = this._getFullStateRef(value.op, key as number);
      if (ref) {
        refs.push(ref);
      }
      return 'continue';
    });

    const meta = buildFullStateOpsMeta(refs);
    await tx.put(STORE_NAMES.META, meta, FULL_STATE_OPS_META_KEY);
    return meta;
  }

  private async _getFullStateOpsMetaInTxOrRebuild(
    tx: OpLogTx,
  ): Promise<FullStateOpsMetaEntry> {
    const meta = this._normalizeFullStateOpsMeta(
      await tx.get<unknown>(STORE_NAMES.META, FULL_STATE_OPS_META_KEY),
    );
    return meta ?? (await this._rebuildFullStateOpsMetaInTx(tx));
  }

  private async _recordFullStateOpInTx(
    tx: OpLogTx,
    op: Operation | CompactOperation,
    seq: number,
  ): Promise<void> {
    const ref = this._getFullStateRef(op, seq);
    if (!ref) {
      return;
    }

    const meta = await this._getFullStateOpsMetaInTxOrRebuild(tx);
    await tx.put(
      STORE_NAMES.META,
      this._withFullStateRef(meta, ref),
      FULL_STATE_OPS_META_KEY,
    );
  }

  private async _rebuildFullStateOpsMeta(): Promise<FullStateOpsMetaEntry> {
    const refs: FullStateOpRef[] = [];
    await this._adapter.iterate<StoredOperationLogEntry>(
      STORE_NAMES.OPS,
      { mode: 'readonly' },
      (value, key) => {
        const ref = this._getFullStateRef(value.op, key as number);
        if (ref) {
          refs.push(ref);
        }
        return 'continue';
      },
    );

    const meta = buildFullStateOpsMeta(refs);
    await this._adapter.put(STORE_NAMES.META, meta, FULL_STATE_OPS_META_KEY);
    return meta;
  }

  private async _getFullStateOpsMetaOrRebuild(): Promise<FullStateOpsMetaEntry> {
    return (
      this._normalizeFullStateOpsMeta(
        await this._adapter.get<unknown>(STORE_NAMES.META, FULL_STATE_OPS_META_KEY),
      ) ?? (await this._rebuildFullStateOpsMeta())
    );
  }

  async append(
    op: Operation,
    source: 'local' | 'remote' = 'local',
    options?: { pendingApply?: boolean },
  ): Promise<number> {
    await this._ensureInit();
    try {
      if (isFullStateOpType(op.opType)) {
        return await this._adapter.transaction(
          [STORE_NAMES.OPS, STORE_NAMES.META],
          'readwrite',
          async (tx) => {
            const entry = this._buildStoredEntry(op, source, options);
            const seq = await tx.add(STORE_NAMES.OPS, entry);
            await this._recordFullStateOpInTx(tx, entry.op, seq);
            return seq;
          },
        );
      }
      return await this._adapter.add(
        STORE_NAMES.OPS,
        this._buildStoredEntry(op, source, options),
      );
    } catch (e) {
      this._handleAppendError(e);
    }
  }

  async appendBatch(
    ops: Operation[],
    source: 'local' | 'remote' = 'local',
    options?: { pendingApply?: boolean },
  ): Promise<number[]> {
    await this._ensureInit();
    try {
      const storeNames: OpLogStoreName[] = [STORE_NAMES.OPS];
      if (ops.some((op) => isFullStateOpType(op.opType))) {
        storeNames.push(STORE_NAMES.META);
      }
      return await this._adapter.transaction(storeNames, 'readwrite', async (tx) => {
        const seqs: number[] = [];
        for (const op of ops) {
          const entry = this._buildStoredEntry(op, source, options);
          const seq = await tx.add(STORE_NAMES.OPS, entry);
          await this._recordFullStateOpInTx(tx, entry.op, seq);
          seqs.push(seq);
        }
        return seqs;
      });
    } catch (e) {
      this._handleAppendError(e);
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
    try {
      const seqs: number[] = [];
      const writtenOps: Operation[] = [];
      let skippedCount = 0;

      const storeNames: OpLogStoreName[] = [STORE_NAMES.OPS];
      if (ops.some((op) => isFullStateOpType(op.opType))) {
        storeNames.push(STORE_NAMES.META);
      }

      await this._adapter.transaction(storeNames, 'readwrite', async (tx) => {
        for (const op of ops) {
          // Check if op already exists in the same transaction (atomic)
          const existingKey = await tx.getKeyFromIndex(
            STORE_NAMES.OPS,
            OPS_INDEXES.BY_ID,
            op.id,
          );
          if (existingKey !== undefined) {
            skippedCount++;
            continue;
          }

          const entry = this._buildStoredEntry(op, source, options);
          const seq = await tx.add(STORE_NAMES.OPS, entry);
          await this._recordFullStateOpInTx(tx, entry.op, seq);
          seqs.push(seq);
          writtenOps.push(op);
        }
      });

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
    await this._adapter.transaction([STORE_NAMES.OPS], 'readwrite', async (tx) => {
      for (const seq of seqs) {
        const entry = await tx.get<StoredOperationLogEntry>(STORE_NAMES.OPS, seq);
        // Allow transitioning from 'pending' or 'failed' to 'applied'
        // 'failed' ops can be retried and need to be cleared when successful
        if (
          entry &&
          (entry.applicationStatus === 'pending' || entry.applicationStatus === 'failed')
        ) {
          entry.applicationStatus = 'applied';
          await tx.put(STORE_NAMES.OPS, entry);
        }
      }
    });
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
      // Exact compound-key match expressed as a degenerate [k, k] range.
      storedEntries = await this._adapter.getAllFromIndex<StoredOperationLogEntry>(
        STORE_NAMES.OPS,
        OPS_INDEXES.BY_SOURCE_AND_STATUS,
        { lower: ['remote', 'pending'], upper: ['remote', 'pending'] },
      );
    } catch (e) {
      // Fallback for databases created before version 3 index migration
      // This handles the case where the bySourceAndStatus index doesn't exist
      Log.warn(
        'OperationLogStoreService: bySourceAndStatus index not found, using fallback scan',
      );
      const allOps = await this._adapter.getAll<StoredOperationLogEntry>(STORE_NAMES.OPS);
      storedEntries = allOps.filter(
        (entry) => entry.source === 'remote' && entry.applicationStatus === 'pending',
      );
    }
    // Decode compact operations for backwards compatibility
    return storedEntries.map(decodeStoredEntry);
  }

  async hasOp(id: string): Promise<boolean> {
    await this._ensureInit();
    const entry = await this._adapter.getFromIndex(
      STORE_NAMES.OPS,
      OPS_INDEXES.BY_ID,
      id,
    );
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
    const stored = await this._adapter.getFromIndex<StoredOperationLogEntry>(
      STORE_NAMES.OPS,
      OPS_INDEXES.BY_ID,
      id,
    );
    return stored ? decodeStoredEntry(stored) : undefined;
  }

  async getOpsAfterSeq(seq: number): Promise<OperationLogEntry[]> {
    await this._ensureInit();
    const storedEntries = await this._adapter.getAll<StoredOperationLogEntry>(
      STORE_NAMES.OPS,
      { lower: seq, lowerOpen: true },
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
   * Convenience wrapper over {@link getLatestFullStateOpEntry} returning only the op.
   *
   * @returns The latest full-state operation, or undefined if none exists
   */
  async getLatestFullStateOp(): Promise<Operation | undefined> {
    return (await this.getLatestFullStateOpEntry())?.op;
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
   * Uses the persistent full-state metadata pointer. Existing databases rebuild
   * that metadata once on first read, then future calls are O(1).
   *
   * @returns The latest full-state operation entry, or undefined if none exists
   */
  async getLatestFullStateOpEntry(): Promise<OperationLogEntry | undefined> {
    await this._ensureInit();

    const meta = await this._getFullStateOpsMetaOrRebuild();
    if (!meta.latest) {
      return undefined;
    }

    const stored = await this._adapter.get<StoredOperationLogEntry>(
      STORE_NAMES.OPS,
      meta.latest.seq,
    );
    if (
      stored &&
      getOpId(stored.op) === meta.latest.opId &&
      isFullStateOpType(getStoredOpType(stored.op))
    ) {
      return decodeStoredEntry(stored);
    }

    const rebuiltMeta = await this._rebuildFullStateOpsMeta();
    if (!rebuiltMeta.latest) {
      return undefined;
    }
    const rebuiltStored = await this._adapter.get<StoredOperationLogEntry>(
      STORE_NAMES.OPS,
      rebuiltMeta.latest.seq,
    );
    return rebuiltStored ? decodeStoredEntry(rebuiltStored) : undefined;
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
    // Deleting all full-state ops is the no-exclusion case of clearFullStateOpsExcept.
    return this.clearFullStateOpsExcept([]);
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
    let deletedCount = 0;
    await this._adapter.transaction(
      [STORE_NAMES.OPS, STORE_NAMES.META],
      'readwrite',
      async (tx) => {
        // Read meta INSIDE the tx so a full-state append committed between the
        // read and the write can't be clobbered by a stale snapshot. The
        // OPS deletes and the META update then stay atomic, matching
        // deleteOpsWhere — no reliance on the OPERATION_LOG lock for safety.
        const meta = await this._getFullStateOpsMetaInTxOrRebuild(tx);
        const refsToDelete = meta.refs.filter((ref) => !excludeIdSet.has(ref.opId));
        if (refsToDelete.length === 0) {
          return;
        }

        const opIdsToDelete = new Set(refsToDelete.map((ref) => ref.opId));
        for (const ref of refsToDelete) {
          const stored = await tx.get<StoredOperationLogEntry>(STORE_NAMES.OPS, ref.seq);
          if (
            stored &&
            getOpId(stored.op) === ref.opId &&
            isFullStateOpType(getStoredOpType(stored.op))
          ) {
            await tx.delete(STORE_NAMES.OPS, ref.seq);
            deletedCount++;
          }
        }
        await tx.put(
          STORE_NAMES.META,
          this._withoutFullStateRefs(meta, opIdsToDelete),
          FULL_STATE_OPS_META_KEY,
        );
      },
    );
    if (deletedCount > 0) {
      this._invalidateUnsyncedCache();
    }
    return deletedCount;
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
      const newStoredEntries = await this._adapter.getAll<StoredOperationLogEntry>(
        STORE_NAMES.OPS,
        { lower: this._unsyncedCacheLastSeq, lowerOpen: true },
      );
      const newUnsynced = newStoredEntries
        .filter((e) => !e.syncedAt && !e.rejectedAt)
        .map(decodeStoredEntry);
      this._unsyncedCache.push(...newUnsynced);
      this._unsyncedCacheLastSeq = currentLastSeq;
      return [...this._unsyncedCache];
    }

    // Initial cache build - full scan required
    const all = await this._adapter.getAll<StoredOperationLogEntry>(STORE_NAMES.OPS);
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
      const ids = getOpEntityIds(entry.op);
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
      const newEntries = await this._adapter.getAll<StoredOperationLogEntry>(
        STORE_NAMES.OPS,
        { lower: this._cacheLastSeq, lowerOpen: true },
      );
      for (const entry of newEntries) {
        // Handle both compact and full operation formats
        this._appliedOpIdsCache.add(getOpId(entry.op));
      }
      this._cacheLastSeq = currentLastSeq;
      return new Set(this._appliedOpIdsCache);
    }

    // Initial cache build - full scan required
    const entries = await this._adapter.getAll<StoredOperationLogEntry>(STORE_NAMES.OPS);
    // Handle both compact and full operation formats
    this._appliedOpIdsCache = new Set(entries.map((e) => getOpId(e.op)));
    this._cacheLastSeq = currentLastSeq;

    return new Set(this._appliedOpIdsCache);
  }

  async markSynced(seqs: number[]): Promise<void> {
    await this._ensureInit();
    const now = Date.now();
    await this._adapter.transaction([STORE_NAMES.OPS], 'readwrite', async (tx) => {
      for (const seq of seqs) {
        const entry = await tx.get<StoredOperationLogEntry>(STORE_NAMES.OPS, seq);
        if (entry) {
          entry.syncedAt = now;
          await tx.put(STORE_NAMES.OPS, entry);
        }
      }
    });
    this._invalidateUnsyncedCache();
  }

  async markRejected(opIds: string[]): Promise<void> {
    await this._ensureInit();
    const now = Date.now();
    await this._adapter.transaction([STORE_NAMES.OPS], 'readwrite', async (tx) => {
      for (const opId of opIds) {
        const entry = await tx.getFromIndex<StoredOperationLogEntry>(
          STORE_NAMES.OPS,
          OPS_INDEXES.BY_ID,
          opId,
        );
        if (entry) {
          entry.rejectedAt = now;
          await tx.put(STORE_NAMES.OPS, entry);
        }
      }
    });
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

    const now = Date.now();
    await this._adapter.transaction([STORE_NAMES.OPS], 'readwrite', async (tx) => {
      for (const entry of unsynced) {
        const stored = await tx.get<StoredOperationLogEntry>(STORE_NAMES.OPS, entry.seq);
        if (stored) {
          stored.rejectedAt = now;
          await tx.put(STORE_NAMES.OPS, stored);
        }
      }
    });
    this._invalidateUnsyncedCache();
  }

  /**
   * Marks operations as failed (can be retried later).
   * Increments the retry count for each operation.
   * If maxRetries is provided and reached, marks as rejected instead.
   */
  async markFailed(opIds: string[], maxRetries?: number): Promise<void> {
    await this._ensureInit();
    const now = Date.now();
    let terminallyRejected = false;
    await this._adapter.transaction([STORE_NAMES.OPS], 'readwrite', async (tx) => {
      for (const opId of opIds) {
        const entry = await tx.getFromIndex<StoredOperationLogEntry>(
          STORE_NAMES.OPS,
          OPS_INDEXES.BY_ID,
          opId,
        );
        if (entry) {
          const newRetryCount = (entry.retryCount ?? 0) + 1;

          // If max retries reached, mark as rejected permanently
          if (maxRetries !== undefined && newRetryCount >= maxRetries) {
            entry.rejectedAt = now;
            entry.applicationStatus = undefined;
            terminallyRejected = true;
          } else {
            entry.applicationStatus = 'failed';
            entry.retryCount = newRetryCount;
          }
          await tx.put(STORE_NAMES.OPS, entry);
        }
      }
    });
    if (terminallyRejected) {
      this._invalidateUnsyncedCache();
    }
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
      // Exact compound-key match expressed as a degenerate [k, k] range.
      storedEntries = await this._adapter.getAllFromIndex<StoredOperationLogEntry>(
        STORE_NAMES.OPS,
        OPS_INDEXES.BY_SOURCE_AND_STATUS,
        { lower: ['remote', 'failed'], upper: ['remote', 'failed'] },
      );
    } catch (e) {
      // Fallback for databases created before version 3 index migration
      Log.warn(
        'OperationLogStoreService: bySourceAndStatus index not found, using fallback scan',
      );
      const allOps = await this._adapter.getAll<StoredOperationLogEntry>(STORE_NAMES.OPS);
      storedEntries = allOps.filter(
        (entry) => entry.source === 'remote' && entry.applicationStatus === 'failed',
      );
    }
    // Decode and filter out rejected ops
    return storedEntries.filter((e) => !e.rejectedAt).map(decodeStoredEntry);
  }

  async deleteOpsWhere(predicate: (entry: OperationLogEntry) => boolean): Promise<void> {
    await this._ensureInit();
    // Iterate the whole store, deleting entries that match the predicate.
    // (A range delete isn't possible — the predicate is on decoded fields.)
    let deletedCount = 0;
    const deletedFullStateOpIds = new Set<string>();
    await this._adapter.transaction(
      [STORE_NAMES.OPS, STORE_NAMES.META],
      'readwrite',
      async (tx) => {
        await tx.iterate<StoredOperationLogEntry>(STORE_NAMES.OPS, {}, (value) => {
          // Decode stored entry before applying predicate
          const decoded = decodeStoredEntry(value);
          if (predicate(decoded)) {
            deletedCount++;
            if (isFullStateOpType(decoded.op.opType)) {
              deletedFullStateOpIds.add(decoded.op.id);
            }
            return 'delete';
          }
          return 'continue';
        });

        if (deletedFullStateOpIds.size > 0) {
          const meta = await this._getFullStateOpsMetaInTxOrRebuild(tx);
          await tx.put(
            STORE_NAMES.META,
            this._withoutFullStateRefs(meta, deletedFullStateOpIds),
            FULL_STATE_OPS_META_KEY,
          );
        }
      },
    );

    // Invalidate caches if any ops were deleted to prevent stale data
    if (deletedCount > 0) {
      this._invalidateAppliedAndUnsyncedCaches();
    }
  }

  async getLastSeq(): Promise<number> {
    await this._ensureInit();
    let lastSeq = 0;
    await this._adapter.iterate<StoredOperationLogEntry>(
      STORE_NAMES.OPS,
      // Pure read on the hottest path (getUnsynced/getAppliedOpIds); readonly
      // so it doesn't take an exclusive write lock that serializes appends.
      { direction: 'prev', mode: 'readonly' },
      (_value, key) => {
        lastSeq = key as number;
        return 'stop';
      },
    );
    return lastSeq;
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
    let foundRealSyncedOp = false;
    await this._adapter.iterate<StoredOperationLogEntry>(
      STORE_NAMES.OPS,
      // Pure read: readonly avoids a write lock on the hot ops store.
      { index: OPS_INDEXES.BY_SYNCED_AT, mode: 'readonly' },
      (value) => {
        const op = value.op;
        // Handle both compact format ('e') and full format ('entityType')
        const entityType = isCompactOperation(op) ? op.e : (op as Operation).entityType;
        // Skip MIGRATION and RECOVERY entity types - they're not real sync history
        if (entityType !== 'MIGRATION' && entityType !== 'RECOVERY') {
          foundRealSyncedOp = true;
          return 'stop';
        }
        return 'continue';
      },
    );
    return foundRealSyncedOp;
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
    await this._adapter.put(STORE_NAMES.STATE_CACHE, {
      id: SINGLETON_KEY,
      ...snapshot,
    });
  }

  async loadStateCache(): Promise<StateCacheEntry | null> {
    await this._ensureInit();
    const cache = await this._adapter.get<StateCacheEntry>(
      STORE_NAMES.STATE_CACHE,
      SINGLETON_KEY,
    );
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
    const current = await this._adapter.get<StateCacheEntry>(
      STORE_NAMES.STATE_CACHE,
      SINGLETON_KEY,
    );
    if (current) {
      await this._adapter.put(STORE_NAMES.STATE_CACHE, {
        ...current,
        id: BACKUP_KEY,
      });
    }
  }

  /**
   * Loads the backup state cache, if one exists.
   * Used for crash recovery during migration.
   */
  async loadStateCacheBackup(): Promise<StateCacheEntry | null> {
    await this._ensureInit();
    const backup = await this._adapter.get<StateCacheEntry>(
      STORE_NAMES.STATE_CACHE,
      BACKUP_KEY,
    );
    return backup || null;
  }

  /**
   * Clears the backup state cache after successful migration.
   */
  async clearStateCacheBackup(): Promise<void> {
    await this._ensureInit();
    await this._adapter.delete(STORE_NAMES.STATE_CACHE, BACKUP_KEY);
  }

  /**
   * Checks if a backup exists (indicates interrupted migration).
   */
  async hasStateCacheBackup(): Promise<boolean> {
    await this._ensureInit();
    const backup = await this._adapter.get(STORE_NAMES.STATE_CACHE, BACKUP_KEY);
    return !!backup;
  }

  /**
   * Restores the backup as the current state cache.
   * Used when migration fails and we need to rollback.
   */
  async restoreStateCacheFromBackup(): Promise<void> {
    await this._ensureInit();
    const backup = await this._adapter.get<StateCacheEntry>(
      STORE_NAMES.STATE_CACHE,
      BACKUP_KEY,
    );
    if (backup) {
      await this._adapter.put(STORE_NAMES.STATE_CACHE, {
        ...backup,
        id: SINGLETON_KEY,
      });
      await this._adapter.delete(STORE_NAMES.STATE_CACHE, BACKUP_KEY);
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
    const cache = await this._adapter.get<StateCacheEntry>(
      STORE_NAMES.STATE_CACHE,
      SINGLETON_KEY,
    );
    return cache?.compactionCounter ?? 0;
  }

  /**
   * Atomically increments the compaction counter and returns the new value.
   * Uses a transaction to ensure the read-modify-write is atomic across tabs.
   * Used to track operations since last compaction across tabs/restarts.
   */
  async incrementCompactionCounter(): Promise<number> {
    await this._ensureInit();
    return this._adapter.transaction(
      [STORE_NAMES.STATE_CACHE],
      'readwrite',
      async (tx) => {
        const cache = await tx.get<StateCacheEntry>(
          STORE_NAMES.STATE_CACHE,
          SINGLETON_KEY,
        );

        if (!cache) {
          // No state cache yet - create one with counter starting at 1
          // Provide default values for required schema fields
          await tx.put(STORE_NAMES.STATE_CACHE, {
            id: SINGLETON_KEY,
            state: null,
            lastAppliedOpSeq: 0,
            vectorClock: {},
            compactedAt: 0,
            compactionCounter: 1,
          });
          return 1;
        }

        const newCount = (cache.compactionCounter ?? 0) + 1;
        await tx.put(STORE_NAMES.STATE_CACHE, {
          ...cache,
          compactionCounter: newCount,
        });
        return newCount;
      },
    );
  }

  /**
   * Resets the compaction counter to 0.
   * Called after successful compaction.
   */
  async resetCompactionCounter(): Promise<void> {
    await this._ensureInit();
    await this._adapter.transaction(
      [STORE_NAMES.STATE_CACHE],
      'readwrite',
      async (tx) => {
        const cache = await tx.get<StateCacheEntry>(
          STORE_NAMES.STATE_CACHE,
          SINGLETON_KEY,
        );
        if (cache) {
          await tx.put(STORE_NAMES.STATE_CACHE, {
            ...cache,
            compactionCounter: 0,
          });
        }
      },
    );
  }

  /**
   * Clears all data from the database. Used for testing purposes only.
   * @internal
   */
  async _clearAllDataForTesting(): Promise<void> {
    await this._ensureInit();
    const allStores = [
      STORE_NAMES.OPS,
      STORE_NAMES.STATE_CACHE,
      STORE_NAMES.IMPORT_BACKUP,
      STORE_NAMES.VECTOR_CLOCK,
      STORE_NAMES.ARCHIVE_YOUNG,
      STORE_NAMES.ARCHIVE_OLD,
      STORE_NAMES.PROFILE_DATA,
      STORE_NAMES.CLIENT_ID,
      STORE_NAMES.META,
    ];
    await this._adapter.transaction(allStores, 'readwrite', async (tx) => {
      for (const store of allStores) {
        await tx.clear(store);
      }
    });
    this._invalidateAppliedAndUnsyncedCaches();
    this._vectorClockCache = null;
  }

  // ============================================================
  // Import Backup (pre-import state preservation)
  // ============================================================

  /**
   * Saves a backup of the current state before an import operation.
   * This allows manual recovery if the import causes issues.
   *
   * Migrated to route through `_adapter` (Phase A). Behavior is identical:
   * the adapter operates on the same connection adopted in `init()`.
   */
  async saveImportBackup(state: unknown): Promise<number> {
    await this._ensureInit();
    const savedAt = Date.now();
    await this._adapter.put(STORE_NAMES.IMPORT_BACKUP, {
      id: SINGLETON_KEY,
      state,
      savedAt,
    });
    // Returned so callers can later confirm the (single-slot) backup is still
    // the one they captured before restoring it — see BackupService. (#8107)
    return savedAt;
  }

  /**
   * Loads the import backup, if one exists.
   */
  async loadImportBackup(): Promise<{ state: unknown; savedAt: number } | null> {
    await this._ensureInit();
    const backup = await this._adapter.get<{ state: unknown; savedAt: number }>(
      STORE_NAMES.IMPORT_BACKUP,
      SINGLETON_KEY,
    );
    return backup ? { state: backup.state, savedAt: backup.savedAt } : null;
  }

  /**
   * Clears the import backup.
   */
  async clearImportBackup(): Promise<void> {
    await this._ensureInit();
    await this._adapter.delete(STORE_NAMES.IMPORT_BACKUP, SINGLETON_KEY);
  }

  /**
   * Checks if an import backup exists.
   */
  async hasImportBackup(): Promise<boolean> {
    await this._ensureInit();
    const backup = await this._adapter.get(STORE_NAMES.IMPORT_BACKUP, SINGLETON_KEY);
    return !!backup;
  }

  /**
   * Clears all operations from the operation log.
   * Used when importing data to avoid accumulating old SYNC_IMPORT operations.
   * NOTE: This does NOT clear the state_cache - that should be updated separately.
   */
  async clearAllOperations(): Promise<void> {
    await this._ensureInit();
    await this._adapter.transaction(
      [STORE_NAMES.OPS, STORE_NAMES.META],
      'readwrite',
      async (tx) => {
        await tx.clear(STORE_NAMES.OPS);
        await tx.put(
          STORE_NAMES.META,
          buildFullStateOpsMeta([]),
          FULL_STATE_OPS_META_KEY,
        );
      },
    );
    this._invalidateAppliedAndUnsyncedCaches();
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
    const entry = await this._adapter.get<VectorClockEntry>(
      STORE_NAMES.VECTOR_CLOCK,
      SINGLETON_KEY,
    );
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
    await this._adapter.put(
      STORE_NAMES.VECTOR_CLOCK,
      { clock, lastUpdate: Date.now() },
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
   * NOTE: When a full-state op (SYNC_IMPORT/BACKUP_IMPORT/REPAIR) is present,
   * its clock REPLACES (not merges with) the local clock. Callers must not mix
   * pre-import and post-import ops in a single call — all ops in the batch
   * should belong to the same "epoch" (post-import or no import).
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

    // Check if any op is a full-state operation (SYNC_IMPORT / BACKUP_IMPORT / REPAIR).
    // Full-state ops represent a complete state reset — old clock entries are irrelevant.
    // Using the import's clock as the base (REPLACE) instead of the current clock (MERGE)
    // prevents clock bloat that causes server-side pruning to drop the import's entry,
    // which would make subsequent ops appear CONCURRENT with the import.
    const fullStateOp = ops.find((op) => FULL_STATE_OP_TYPES.has(op.opType));

    const mergedClock = fullStateOp
      ? { ...fullStateOp.vectorClock }
      : { ...currentClock };

    if (fullStateOp) {
      Log.log(
        `[OpLogStore] mergeRemoteOpClocks: REPLACING clock for FULL-STATE op ${fullStateOp.opType}\n` +
          `  Op ID:         ${fullStateOp.id}\n` +
          `  Op clientId:   ${fullStateOp.clientId}\n` +
          `  Old clock (${Object.keys(currentClock).length} entries): ${vectorClockToString(currentClock)}\n` +
          `  New base clock: ${vectorClockToString(fullStateOp.vectorClock)}`,
      );
    }

    for (const op of ops) {
      for (const [clientId, counter] of Object.entries(op.vectorClock)) {
        mergedClock[clientId] = Math.max(mergedClock[clientId] ?? 0, counter);
      }
    }

    const currentClientId = await this.clientIdProvider.loadClientId();
    if (!currentClientId) {
      Log.warn(
        '[OpLogStore] mergeRemoteOpClocks: Cannot prune clock - no client ID available. ' +
          'This is unexpected during sync and may indicate data corruption.',
      );
    }

    let clockToStore: Record<string, number>;

    if (fullStateOp && currentClientId) {
      // CLOCK RESET: After a full-state op (SYNC_IMPORT / BACKUP_IMPORT / REPAIR),
      // reset the working clock to minimal — only the import client's entry and our
      // own entry. This prevents dead client IDs from accumulating in the clock.
      //
      // The full import clock is preserved in the stored operation for
      // SyncImportFilterService to use when filtering pre-import ops.
      // Post-import ops are recognized by having the import client's counter
      // (see SyncImportFilterService's import-client-counter exception).
      clockToStore = {};
      const importClientId = fullStateOp.clientId;
      if (mergedClock[importClientId] !== undefined) {
        clockToStore[importClientId] = mergedClock[importClientId];
      }
      if (currentClientId !== importClientId) {
        // Preserve our own counter using the maximum of:
        // - mergedClock[currentClientId]: from any of the incoming remote ops
        // - currentClock[currentClientId]: our own counter BEFORE the merge
        //
        // This matters when our own ops (e.g. GLOBAL_CONFIG) created a counter
        // that is NOT reflected in the incoming full-state op's clock (because the
        // full-state op was created by another client and doesn't know about our ops).
        // Without this, the reset would drop our own counter, causing subsequent ops
        // to reuse the same counter value and appear as EQUAL (duplicate) to remote
        // clients that have already seen our earlier op with that counter.
        const myCounter = Math.max(
          mergedClock[currentClientId] ?? 0,
          currentClock[currentClientId] ?? 0,
        );
        if (myCounter > 0) {
          clockToStore[currentClientId] = myCounter;
        }
      }
      Log.log(
        `[OpLogStore] mergeRemoteOpClocks: RESET clock to minimal after ${fullStateOp.opType}\n` +
          `  Full merged clock (${Object.keys(mergedClock).length} entries): ${vectorClockToString(mergedClock)}\n` +
          `  Minimal clock (${Object.keys(clockToStore).length} entries): ${vectorClockToString(clockToStore)}`,
      );
    } else {
      // Normal case: prune the merged clock to MAX_VECTOR_CLOCK_SIZE to break the
      // inflate/prune cycle: without this, the union of all downloaded ops'
      // clocks re-introduces pruned client IDs, exceeding the limit again.
      // The server already prunes with the same algorithm on upload.
      clockToStore = currentClientId
        ? limitVectorClockSize(mergedClock, currentClientId)
        : mergedClock;
    }

    // DIAGNOSTIC LOGGING: Log merged clock after merge
    Log.debug(
      `[OpLogStore] mergeRemoteOpClocks: AFTER merge\n` +
        `  Merged clock: ${vectorClockToString(clockToStore)}`,
    );

    // Update the vector clock store
    await this._adapter.put(
      STORE_NAMES.VECTOR_CLOCK,
      { clock: clockToStore, lastUpdate: Date.now() },
      SINGLETON_KEY,
    );
    this._vectorClockCache = clockToStore;
  }

  /**
   * Gets the full vector clock entry including lastUpdate timestamp.
   * Used by legacy sync bridge to sync vector clock to pf.META_MODEL.
   */
  async getVectorClockEntry(): Promise<VectorClockEntry | null> {
    await this._ensureInit();
    const entry = await this._adapter.get<VectorClockEntry>(
      STORE_NAMES.VECTOR_CLOCK,
      SINGLETON_KEY,
    );
    return entry ?? null;
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

    try {
      const storeNames: OpLogStoreName[] = [STORE_NAMES.OPS, STORE_NAMES.VECTOR_CLOCK];
      if (isFullStateOpType(op.opType)) {
        storeNames.push(STORE_NAMES.META);
      }
      return await this._adapter.transaction(storeNames, 'readwrite', async (tx) => {
        // 1. Append operation to ops store (encoded to compact format)
        const entry = this._buildStoredEntry(op, source, options);
        const seq = await tx.add(STORE_NAMES.OPS, entry);
        await this._recordFullStateOpInTx(tx, entry.op, seq);

        // 2. Update vector clock to match the operation's clock (only for
        // local ops). The op.vectorClock already contains the incremented
        // value from the caller; we store it as the current clock so
        // subsequent operations can build on it.
        if (source === 'local') {
          await tx.put(
            STORE_NAMES.VECTOR_CLOCK,
            { clock: op.vectorClock, lastUpdate: Date.now() },
            SINGLETON_KEY,
          );
          this._vectorClockCache = op.vectorClock;
        }

        return seq;
      });
    } catch (e) {
      this._handleAppendError(e);
    }
  }

  /**
   * Atomically replace local op-log + state_cache + vector_clock with a new
   * full-state baseline. Used by destructive flows (clean-slate, backup-restore)
   * to fix issue #7709 — interrupted destructive sequences could otherwise
   * leave OPS empty and state_cache stale, tripping the
   * `isWhollyFreshClient + meaningful store data` branch on next launch.
   *
   * If any step throws, the IndexedDB transaction aborts and no committed
   * change to OPS / STATE_CACHE / VECTOR_CLOCK / CLIENT_ID survives.
   *
   * The clientId now lives in `SUP_OPS` (`client_id` store, since schema v6),
   * so the rotated id on `syncImportOp.clientId` is written inside this same
   * transaction and rotates atomically with OPS / STATE_CACHE / VECTOR_CLOCK.
   * No cross-database two-phase commit is needed (issue #7732).
   *
   * The new baseline is taken entirely from `syncImportOp`: its `payload` is
   * written to OPS (the snapshot the uploader sends) and re-used as the
   * STATE_CACHE state (what `isWhollyFreshClient` reads next launch); its
   * `vectorClock` and `schemaVersion` populate both stores. A single source
   * object makes it impossible for OPS and STATE_CACHE to disagree.
   */
  async runDestructiveStateReplacement(opts: {
    syncImportOp: Operation;
    snapshotEntityKeys: string[];
    archiveYoung?: ArchiveStoreEntry['data'];
    archiveOld?: ArchiveStoreEntry['data'];
  }): Promise<void> {
    await this._ensureInit();

    const { syncImportOp, snapshotEntityKeys, archiveYoung, archiveOld } = opts;
    const newState = syncImportOp.payload;
    const newVectorClock = syncImportOp.vectorClock;
    const compactedAt = Date.now();
    const storeNames: OpLogStoreName[] = [
      STORE_NAMES.OPS,
      STORE_NAMES.STATE_CACHE,
      STORE_NAMES.VECTOR_CLOCK,
      // Unconditional: both callers (clean-slate, backup-restore) always rotate
      // the clientId. Unlike the archive stores it is never conditional.
      STORE_NAMES.CLIENT_ID,
      STORE_NAMES.META,
    ];
    if (archiveYoung != null) {
      storeNames.push(STORE_NAMES.ARCHIVE_YOUNG);
    }
    if (archiveOld != null) {
      storeNames.push(STORE_NAMES.ARCHIVE_OLD);
    }

    try {
      // The adapter's transaction() commits on resolve and aborts on throw,
      // replacing the hand-rolled try/abort below. The interrupt integration
      // tests (#7709) spy on the shared connection's `transaction` and poison
      // `opsStore.add`; that still fires here because the adapter operates on
      // that same adopted connection.
      await this._adapter.transaction(storeNames, 'readwrite', async (tx) => {
        // Rotate the clientId first, inside this same atomic transaction.
        // Writing it before the OPS clear means an interrupt injected into a
        // later step still aborts this queued put — exercising the genuine
        // "queued -> tx aborts -> client_id unchanged" path. Atomicity itself
        // is order-independent.
        await tx.put(STORE_NAMES.CLIENT_ID, syncImportOp.clientId, SINGLETON_KEY);

        await tx.clear(STORE_NAMES.OPS);

        const seq = await tx.add(
          STORE_NAMES.OPS,
          this._buildStoredEntry(syncImportOp, 'local'),
        );
        // syncImportOp is always a full-state op (both callers pass SYNC_IMPORT);
        // OPS was just cleared, so the pointer is exactly this one op. Use the
        // shared builder so `latest` is derived, never hand-asserted.
        await tx.put(
          STORE_NAMES.META,
          buildFullStateOpsMeta([{ opId: syncImportOp.id, seq }]),
          FULL_STATE_OPS_META_KEY,
        );

        await tx.put(
          STORE_NAMES.VECTOR_CLOCK,
          { clock: newVectorClock, lastUpdate: Date.now() },
          SINGLETON_KEY,
        );

        await tx.put(STORE_NAMES.STATE_CACHE, {
          id: SINGLETON_KEY,
          state: newState,
          lastAppliedOpSeq: seq,
          vectorClock: newVectorClock,
          compactedAt,
          schemaVersion: syncImportOp.schemaVersion,
          snapshotEntityKeys,
        });

        if (archiveYoung != null) {
          await tx.put(STORE_NAMES.ARCHIVE_YOUNG, {
            id: SINGLETON_KEY,
            data: archiveYoung,
            lastModified: compactedAt,
          });
        }

        if (archiveOld != null) {
          await tx.put(STORE_NAMES.ARCHIVE_OLD, {
            id: SINGLETON_KEY,
            data: archiveOld,
            lastModified: compactedAt,
          });
        }
      });

      // Reached only on a committed transaction.
      this._invalidateAppliedAndUnsyncedCaches();
      this._vectorClockCache = newVectorClock;
      // The clientId rotated atomically with the stores above. Invalidate the
      // ClientIdService cache so the next read sees the rotated value. On
      // abort the transaction() above throws, so this is not reached and the
      // cache correctly keeps the old id.
      this.clientIdProvider.clearCache();
    } catch (e) {
      if (e instanceof DOMException && e.name === 'QuotaExceededError') {
        throw new StorageQuotaExceededError();
      }
      throw e;
    }
  }
  // ============================================================
  // Profile Data Storage
  // ============================================================

  /**
   * Saves profile data (CompleteBackup) for a specific profile.
   */
  async saveProfileData(
    profileId: string,
    data: ProfileDataStoreEntry['data'],
  ): Promise<void> {
    await this._ensureInit();
    await this._adapter.put(STORE_NAMES.PROFILE_DATA, {
      id: profileId,
      data,
      lastModified: Date.now(),
    });
  }

  /**
   * Loads profile data (CompleteBackup) for a specific profile.
   * Returns null if no data exists for the given profile ID.
   */
  async loadProfileData(
    profileId: string,
  ): Promise<ProfileDataStoreEntry['data'] | null> {
    await this._ensureInit();
    const entry = await this._adapter.get<ProfileDataStoreEntry>(
      STORE_NAMES.PROFILE_DATA,
      profileId,
    );
    return entry?.data ?? null;
  }

  /**
   * Deletes profile data for a specific profile.
   */
  async deleteProfileData(profileId: string): Promise<void> {
    await this._ensureInit();
    await this._adapter.delete(STORE_NAMES.PROFILE_DATA, profileId);
  }
}

// Note: Archive storage methods have been moved to ArchiveStoreService.
// See src/app/op-log/store/archive-store.service.ts
