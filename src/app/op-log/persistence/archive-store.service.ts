import { inject, Injectable } from '@angular/core';
import { IDBPDatabase, openDB } from 'idb';
import { ArchiveModel } from '../../features/time-tracking/time-tracking.model';
import {
  DB_NAME,
  DB_VERSION,
  STORE_NAMES,
  SINGLETON_KEY,
  ArchiveStoreEntry,
} from './db-keys.const';
import { runDbUpgrade } from './db-upgrade';
import { OpLogDbAdapter } from './op-log-db-adapter';
import { OP_LOG_DB_ADAPTER_FACTORY } from './op-log-db-adapter.token';
import {
  isConnectionClosingError,
  isIdbVersionError,
  isLockRelatedIdbOpenError,
} from './op-log-errors.const';
import { Log } from '../../core/log';
import {
  IDB_OPEN_RETRIES,
  IDB_OPEN_RETRIES_NON_LOCK,
  IDB_OPEN_RETRY_BASE_DELAY_MS,
} from '../core/operation-log.const';
import { IndexedDBOpenError } from '../core/errors/indexed-db-open.error';

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
  // Phase A migration seam: archive reads/writes route through this adapter,
  // which operates on this service's own SUP_OPS connection (adopted in
  // _init, released on close/versionchange and on the iOS connection-closing
  // retry path). Phase B: backend comes from DI.
  private readonly _adapter: OpLogDbAdapter = inject(OP_LOG_DB_ADAPTER_FACTORY)();

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

  /**
   * Opens the SUP_OPS database for archive operations.
   *
   * Uses shared runDbUpgrade() to ensure ALL stores are created if ArchiveStoreService
   * opens the database before OperationLogStoreService. IndexedDB only runs ONE upgrade
   * callback per version transition, so whichever service opens the DB first MUST create
   * all stores.
   */
  private async _init(): Promise<void> {
    // Self-managing backends (e.g. SQLite) own their handle and create their own
    // schema via the adapter — no WebView IndexedDB connection needed. Mirrors
    // OperationLogStoreService.init(); only the adopt-connection (IndexedDB)
    // backend opens/owns a connection here.
    if (!this._adapter.adoptConnection) {
      await this._adapter.init();
      return;
    }
    const db = await this._openDbWithRetry();
    db.addEventListener('close', () => {
      Log.warn(
        '[ArchiveStore] IndexedDB connection closed by browser. Will re-open on next access.',
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
    this._adapter.adoptConnection?.(db);
  }

  /**
   * See OperationLogStoreService._openDbWithRetry for the rationale behind the
   * lock-vs-non-lock retry budget split.
   *
   * @see https://github.com/super-productivity/super-productivity/issues/7191
   */
  private async _openDbWithRetry(): Promise<IDBPDatabase<ArchiveDBSchema>> {
    let maxRetries = IDB_OPEN_RETRIES;
    let attempt = 1;
    let lastError: unknown;

    while (attempt <= 1 + maxRetries) {
      try {
        return await openDB<ArchiveDBSchema>(DB_NAME, DB_VERSION, {
          upgrade: (db, oldVersion, _newVersion, transaction) => {
            runDbUpgrade(db, oldVersion, transaction);
          },
        });
      } catch (e) {
        lastError = e;

        // Downgrade barrier: retrying can't change the on-disk version (#9187).
        if (isIdbVersionError(e)) {
          break;
        }

        // Non-lock errors fall back to a short retry budget so we don't block
        // the op-log subsystem for 31s before surfacing the error to the user.
        // See OperationLogStoreService._openDbWithRetry for details.
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
            `[ArchiveStore] IndexedDB open failed (attempt ${attempt}/${totalAttempts}), retrying in ${delay}ms...`,
            e,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }

        attempt++;
      }
    }

    // Final-failure log. The wrapper's `.message` already carries the original
    // error name + message (see IndexedDBOpenError), and `originalError`
    // carries the raw object — so logging the wrapper exposes the underlying
    // cause needed for diagnostics (e.g. distinguishing Chromium LevelDB locks
    // from WebKit's iOS "Connection to Indexed Database server lost", #7415).
    const err = new IndexedDBOpenError(lastError);
    // See OperationLogStoreService: the barrier path stops retrying (#9187).
    Log.err('[ArchiveStore] IndexedDB open failed.', err);
    throw err;
  }

  /**
   * Wraps an operation with retry logic for iOS "connection is closing" errors.
   * If the operation fails because iOS closed the connection, invalidates the
   * cached db reference and retries once after re-opening.
   *
   * @see https://github.com/johannesjo/super-productivity/issues/6643
   */
  private async _withRetryOnClose<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (isConnectionClosingError(e)) {
        Log.warn('[ArchiveStore] Connection closing error detected, re-opening...', e);
        this._db = undefined;
        this._initPromise = undefined;
        this._adapter.adoptConnection?.(undefined);
        return await fn();
      }
      throw e;
    }
  }

  // ============================================================
  // Archive Storage
  // ============================================================

  /**
   * Shared store name type for archive_young and archive_old.
   * Used by the private helpers below to parameterize the store.
   */
  private _loadFromStore(
    storeName: typeof STORE_NAMES.ARCHIVE_YOUNG | typeof STORE_NAMES.ARCHIVE_OLD,
  ): Promise<ArchiveModel | undefined> {
    return this._withRetryOnClose(async () => {
      await this._ensureInit();
      const entry = await this._adapter.get<ArchiveStoreEntry>(storeName, SINGLETON_KEY);
      return entry?.data;
    });
  }

  private _saveToStore(
    storeName: typeof STORE_NAMES.ARCHIVE_YOUNG | typeof STORE_NAMES.ARCHIVE_OLD,
    data: ArchiveModel,
  ): Promise<void> {
    return this._withRetryOnClose(async () => {
      await this._ensureInit();
      await this._adapter.put(storeName, {
        id: SINGLETON_KEY,
        data,
        lastModified: Date.now(),
      });
    });
  }

  private _hasEntry(
    storeName: typeof STORE_NAMES.ARCHIVE_YOUNG | typeof STORE_NAMES.ARCHIVE_OLD,
  ): Promise<boolean> {
    return this._withRetryOnClose(async () => {
      await this._ensureInit();
      const entry = await this._adapter.get(storeName, SINGLETON_KEY);
      return !!entry;
    });
  }

  async loadArchiveYoung(): Promise<ArchiveModel | undefined> {
    return this._loadFromStore(STORE_NAMES.ARCHIVE_YOUNG);
  }

  async saveArchiveYoung(data: ArchiveModel): Promise<void> {
    return this._saveToStore(STORE_NAMES.ARCHIVE_YOUNG, data);
  }

  async loadArchiveOld(): Promise<ArchiveModel | undefined> {
    return this._loadFromStore(STORE_NAMES.ARCHIVE_OLD);
  }

  async saveArchiveOld(data: ArchiveModel): Promise<void> {
    return this._saveToStore(STORE_NAMES.ARCHIVE_OLD, data);
  }

  async hasArchiveYoung(): Promise<boolean> {
    return this._hasEntry(STORE_NAMES.ARCHIVE_YOUNG);
  }

  async hasArchiveOld(): Promise<boolean> {
    return this._hasEntry(STORE_NAMES.ARCHIVE_OLD);
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
    return this._withRetryOnClose(async () => {
      await this._ensureInit();
      const now = Date.now();
      await this._adapter.transaction(
        [STORE_NAMES.ARCHIVE_YOUNG, STORE_NAMES.ARCHIVE_OLD],
        'readwrite',
        async (tx) => {
          await tx.put(STORE_NAMES.ARCHIVE_YOUNG, {
            id: SINGLETON_KEY,
            data: archiveYoung,
            lastModified: now,
          });
          await tx.put(STORE_NAMES.ARCHIVE_OLD, {
            id: SINGLETON_KEY,
            data: archiveOld,
            lastModified: now,
          });
        },
      );
    });
  }

  /**
   * Clears all archive data. Used for testing only.
   * @internal
   */
  async _clearAllDataForTesting(): Promise<void> {
    return this._withRetryOnClose(async () => {
      await this._ensureInit();
      await this._adapter.transaction(
        [STORE_NAMES.ARCHIVE_YOUNG, STORE_NAMES.ARCHIVE_OLD],
        'readwrite',
        async (tx) => {
          await tx.clear(STORE_NAMES.ARCHIVE_YOUNG);
          await tx.clear(STORE_NAMES.ARCHIVE_OLD);
        },
      );
    });
  }
}
