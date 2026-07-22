/**
 * IndexedDB implementation of {@link OpLogDbAdapter} (Phase A of the SQLite
 * migration — see docs/sync-and-op-log/sqlite-migration.md).
 *
 * A faithful wrapper of the behavior `OperationLogStoreService` /
 * `ArchiveStoreService` get from `idb` today: shared versioned upgrade,
 * open-retry with the existing budgets, `versionchange`/`close` re-open
 * handling, and the `IndexedDBOpenError` wrapper on exhausted retries. It does
 * NOT translate `ConstraintError` / `QuotaExceededError` — those stay
 * meaningful to callers, which already map them to domain errors. This keeps
 * the wrapper behavior-preserving: the store sees the same exceptions whether
 * it talks to `idb` directly or through this adapter.
 */

import { IDBPDatabase, openDB } from 'idb';
import {
  DbCursorDirection,
  DbCursorVisitor,
  DbIterateOptions,
  DbKey,
  DbKeyRange,
  DbTxMode,
  OpLogDbAdapter,
  OpLogTx,
} from './op-log-db-adapter';
import { OP_LOG_DB_SCHEMA, OpLogDbSchema } from './op-log-db-schema';
import { runDbUpgrade } from './db-upgrade';
import { Log } from '../../core/log';
import {
  IDB_OPEN_RETRIES,
  IDB_OPEN_RETRIES_NON_LOCK,
  IDB_OPEN_RETRY_BASE_DELAY_MS,
} from '../core/operation-log.const';
import { IndexedDBOpenError } from '../core/errors/indexed-db-open.error';
import { isIdbVersionError, isLockRelatedIdbOpenError } from './op-log-errors.const';

const ADAPTER_NOT_INITIALIZED =
  'IndexedDbOpLogAdapter not initialized. Ensure init() is called.';

/**
 * Minimal structural views over the `idb` cursor/store/index handles.
 *
 * `IDBPDatabase` opened without a compile-time schema (store names are dynamic
 * strings here) types `transaction(...).objectStore(name)` and the resulting
 * cursor as possibly-`undefined`, which the high-level `db.method(store, …)`
 * helpers avoid. We know the stores exist (created by `runDbUpgrade`), so we
 * narrow to these structural shapes instead of sprinkling non-null assertions
 * or `any`. They describe only the members this adapter calls.
 */
interface IdbCursorLike {
  readonly value: unknown;
  readonly primaryKey: IDBValidKey;
  delete(): Promise<void>;
  continue(): Promise<IdbCursorLike | null>;
}

interface IdbCursorSourceLike {
  openCursor(
    query?: IDBKeyRange | IDBValidKey | null,
    direction?: DbCursorDirection,
  ): Promise<IdbCursorLike | null>;
}

interface IdbIndexLike extends IdbCursorSourceLike {
  get(key: IDBValidKey): Promise<unknown>;
  getKey(key: IDBValidKey): Promise<IDBValidKey | undefined>;
  getAll(query?: IDBKeyRange): Promise<unknown[]>;
}

interface IdbStoreLike extends IdbCursorSourceLike {
  add(value: unknown, key?: IDBValidKey): Promise<IDBValidKey>;
  put(value: unknown, key?: IDBValidKey): Promise<IDBValidKey>;
  get(key: IDBValidKey): Promise<unknown>;
  getAll(query?: IDBKeyRange): Promise<unknown[]>;
  count(query?: IDBKeyRange): Promise<number>;
  delete(key: IDBValidKey): Promise<void>;
  clear(): Promise<void>;
  index(name: string): IdbIndexLike;
}

/** Minimal view of an `idb` transaction's `objectStore` accessor. */
interface IdbTxLike {
  objectStore(name: string): unknown;
}

/** Narrow a transaction's `objectStore(name)` to the members we use. */
const storeOf = (tx: IdbTxLike, store: string): IdbStoreLike =>
  tx.objectStore(store) as IdbStoreLike;

/**
 * Walk a store (or index) with cursor semantics, honoring
 * {@link DbCursorAction}. Shared by every cursor caller in this file so the
 * stop/delete handling lives in exactly one place. The visitor is synchronous
 * by contract, so no `await` happens between entries — the transaction stays
 * alive across the walk (see {@link DbCursorVisitor}).
 */
const walkCursor = async <T>(
  source: IdbCursorSourceLike,
  options: DbIterateOptions,
  visit: DbCursorVisitor<T>,
): Promise<void> => {
  const query = options.query !== undefined ? (options.query as IDBValidKey) : null;
  let cursor = await source.openCursor(query, options.direction ?? 'next');
  while (cursor) {
    const action = visit(cursor.value as T, cursor.primaryKey as DbKey);
    if (action === 'delete' || action === 'delete-stop') {
      await cursor.delete();
    }
    if (action === 'stop' || action === 'delete-stop') {
      return;
    }
    cursor = await cursor.continue();
  }
};

/** Translate the engine-agnostic range into an IDBKeyRange (or undefined). */
const toIdbKeyRange = (range?: DbKeyRange): IDBKeyRange | undefined => {
  if (!range) {
    return undefined;
  }
  const { lower, upper, lowerOpen, upperOpen } = range;
  if (lower !== undefined && upper !== undefined) {
    return IDBKeyRange.bound(lower, upper, lowerOpen, upperOpen);
  }
  if (lower !== undefined) {
    return IDBKeyRange.lowerBound(lower, lowerOpen);
  }
  if (upper !== undefined) {
    return IDBKeyRange.upperBound(upper, upperOpen);
  }
  return undefined;
};

export class IndexedDbOpLogAdapter implements OpLogDbAdapter {
  private _db?: IDBPDatabase;
  private _initPromise?: Promise<void>;

  constructor(private readonly _schema: OpLogDbSchema = OP_LOG_DB_SCHEMA) {}

  async init(): Promise<void> {
    if (this._db) {
      return;
    }
    if (!this._initPromise) {
      this._initPromise = this._doInit().catch((e) => {
        this._initPromise = undefined;
        throw e;
      });
    }
    await this._initPromise;
  }

  /**
   * Operate on a connection owned by someone else (the existing
   * `OperationLogStoreService`) instead of opening our own.
   *
   * This is the seam for the incremental Phase A migration: the store keeps
   * owning/retrying/re-opening its single `IDBPDatabase`, and routes
   * already-migrated methods through this adapter so both share one connection.
   * It avoids a second connection to `SUP_OPS` (which would risk
   * `versionchange` deadlocks and doubled close/upgrade handling) during the
   * transition. Pass `undefined` when the owner drops its handle (close/
   * versionchange) so we don't operate on a dead connection.
   */
  adoptConnection(db: IDBPDatabase | undefined): void {
    this._db = db;
    this._initPromise = db ? Promise.resolve() : undefined;
  }

  private async _doInit(): Promise<void> {
    const db = await this._openDbWithRetry();
    // The browser can close the connection (tab eviction, iOS backgrounding).
    // Drop the cached handle so the next access transparently re-opens.
    db.addEventListener('close', () => {
      Log.warn(
        '[OpLogAdapter] IndexedDB connection closed. Will re-open on next access.',
      );
      this._db = undefined;
      this._initPromise = undefined;
    });
    // A newer tab is upgrading the DB; close so we don't block it.
    db.addEventListener('versionchange', () => {
      db.close();
      this._db = undefined;
      this._initPromise = undefined;
    });
    this._db = db;
  }

  /**
   * Single open attempt. Separate method so specs can inject failures without
   * mocking the `idb` import (mirrors the existing store's `_openDbOnce` seam).
   */
  private _openDbOnce(): Promise<IDBPDatabase> {
    return openDB(this._schema.name, this._schema.version, {
      upgrade: (db, oldVersion, _newVersion, transaction) => {
        runDbUpgrade(db, oldVersion, transaction);
      },
    });
  }

  /**
   * Open with exponential backoff. Lock-related errors get the full retry
   * window (they may clear); other errors fail faster so the hydrator can
   * surface the problem. Preserves the budgets/semantics of the existing store.
   *
   * NOTE: dormant in production today. Both stores call `_adapter.init()` only
   * behind `if (!this._adapter.adoptConnection)`, and this adapter defines
   * `adoptConnection` — so it runs on the connection the store hands it and
   * never opens the database itself. Kept in step with the two live loops
   * (`OperationLogStoreService`, `ArchiveStoreService`) so the path is already
   * correct if the adapter ever takes ownership of the open.
   */
  private async _openDbWithRetry(): Promise<IDBPDatabase> {
    let maxRetries = IDB_OPEN_RETRIES;
    let attempt = 1;
    let lastError: unknown;

    while (attempt <= 1 + maxRetries) {
      try {
        return await this._openDbOnce();
      } catch (e) {
        lastError = e;
        // Downgrade barrier: retrying can't change the on-disk version (#9187).
        if (isIdbVersionError(e)) {
          break;
        }
        if (attempt === 1 && !isLockRelatedIdbOpenError(e)) {
          maxRetries = IDB_OPEN_RETRIES_NON_LOCK;
        }
        const totalAttempts = 1 + maxRetries;
        if (attempt < totalAttempts) {
          const delay = IDB_OPEN_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
          Log.warn(
            `[OpLogAdapter] IndexedDB open failed (attempt ${attempt}/${totalAttempts}), retrying in ${delay}ms...`,
            e,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
        attempt++;
      }
    }

    const err = new IndexedDBOpenError(lastError);
    // See OperationLogStoreService: the barrier path stops retrying (#9187).
    Log.err('[OpLogAdapter] IndexedDB open failed.', err);
    throw err;
  }

  private get _database(): IDBPDatabase {
    if (!this._db) {
      throw new Error(ADAPTER_NOT_INITIALIZED);
    }
    return this._db;
  }

  /**
   * Close the underlying connection and drop the cached handle. A subsequent
   * call re-opens via {@link init}. Primarily a testing/teardown hook; runtime
   * code relies on the `close`/`versionchange` listeners instead.
   */
  close(): void {
    this._db?.close();
    this._db = undefined;
    this._initPromise = undefined;
  }

  // ── single-store convenience ops ──────────────────────────────────────────

  async add(store: string, value: unknown): Promise<number> {
    return (await this._database.add(store, value)) as number;
  }

  async put(store: string, value: unknown, key?: DbKey): Promise<void> {
    await this._database.put(store, value, key);
  }

  async get<T>(store: string, key: DbKey): Promise<T | undefined> {
    return (await this._database.get(store, key)) as T | undefined;
  }

  async getAll<T>(store: string, range?: DbKeyRange): Promise<T[]> {
    return (await this._database.getAll(store, toIdbKeyRange(range))) as T[];
  }

  async delete(store: string, key: DbKey): Promise<void> {
    await this._database.delete(store, key);
  }

  async clear(store: string): Promise<void> {
    await this._database.clear(store);
  }

  async count(store: string, range?: DbKeyRange): Promise<number> {
    return this._database.count(store, toIdbKeyRange(range));
  }

  async getFromIndex<T>(
    store: string,
    index: string,
    key: DbKey | DbKey[],
  ): Promise<T | undefined> {
    return (await this._database.getFromIndex(store, index, key as IDBValidKey)) as
      | T
      | undefined;
  }

  async getKeyFromIndex(
    store: string,
    index: string,
    key: DbKey | DbKey[],
  ): Promise<DbKey | undefined> {
    return (await this._database.getKeyFromIndex(store, index, key as IDBValidKey)) as
      | DbKey
      | undefined;
  }

  async getAllFromIndex<T>(
    store: string,
    index: string,
    range?: DbKeyRange,
  ): Promise<T[]> {
    return (await this._database.getAllFromIndex(
      store,
      index,
      toIdbKeyRange(range),
    )) as T[];
  }

  async countFromIndex(
    store: string,
    index: string,
    range?: DbKeyRange,
  ): Promise<number> {
    return this._database.countFromIndex(store, index, toIdbKeyRange(range));
  }

  async iterate<T>(
    store: string,
    options: DbIterateOptions,
    visit: DbCursorVisitor<T>,
  ): Promise<void> {
    // Default 'readwrite' so a delete-walk works; callers pass mode:'readonly'
    // for pure reads to avoid a write lock (see DbIterateOptions.mode).
    const tx = this._database.transaction(store, options.mode ?? 'readwrite');
    const objectStore = storeOf(tx, store);
    const source: IdbCursorSourceLike = options.index
      ? objectStore.index(options.index)
      : objectStore;
    await walkCursor(source, options, visit);
    await tx.done;
  }

  // ── atomic transactions ───────────────────────────────────────────────────

  async transaction<T>(
    stores: string[],
    mode: DbTxMode,
    fn: (tx: OpLogTx) => Promise<T>,
  ): Promise<T> {
    const tx = this._database.transaction(stores, mode);
    const opLogTx = new IdbOpLogTx(tx);
    // Run the body and the implicit commit (`tx.done`) together. If the body
    // throws, abort the transaction so nothing partial commits, then rethrow.
    try {
      const result = await fn(opLogTx);
      await tx.done;
      return result;
    } catch (e) {
      try {
        tx.abort();
      } catch {
        // Already aborted/committed — nothing to undo.
      }
      throw e;
    }
  }
}

/**
 * {@link OpLogTx} backed by a live `idb` transaction. All calls go through the
 * single transaction `tx`, so they share one atomic unit.
 */
class IdbOpLogTx implements OpLogTx {
  constructor(private readonly _tx: IdbTxLike) {}

  async add(store: string, value: unknown): Promise<number> {
    return (await storeOf(this._tx, store).add(value)) as number;
  }

  async put(store: string, value: unknown, key?: DbKey): Promise<void> {
    await storeOf(this._tx, store).put(value, key as IDBValidKey | undefined);
  }

  async get<T>(store: string, key: DbKey): Promise<T | undefined> {
    return (await storeOf(this._tx, store).get(key as IDBValidKey)) as T | undefined;
  }

  async getAll<T>(store: string, range?: DbKeyRange): Promise<T[]> {
    return (await storeOf(this._tx, store).getAll(toIdbKeyRange(range))) as T[];
  }

  async delete(store: string, key: DbKey): Promise<void> {
    await storeOf(this._tx, store).delete(key as IDBValidKey);
  }

  async clear(store: string): Promise<void> {
    await storeOf(this._tx, store).clear();
  }

  async getFromIndex<T>(
    store: string,
    index: string,
    key: DbKey | DbKey[],
  ): Promise<T | undefined> {
    return (await storeOf(this._tx, store)
      .index(index)
      .get(key as IDBValidKey)) as T | undefined;
  }

  async getKeyFromIndex(
    store: string,
    index: string,
    key: DbKey | DbKey[],
  ): Promise<DbKey | undefined> {
    return (await storeOf(this._tx, store)
      .index(index)
      .getKey(key as IDBValidKey)) as DbKey | undefined;
  }

  async getAllFromIndex<T>(
    store: string,
    index: string,
    range?: DbKeyRange,
  ): Promise<T[]> {
    return (await storeOf(this._tx, store)
      .index(index)
      .getAll(toIdbKeyRange(range))) as T[];
  }

  async iterate<T>(
    store: string,
    options: DbIterateOptions,
    visit: DbCursorVisitor<T>,
  ): Promise<void> {
    const objectStore = storeOf(this._tx, store);
    const source: IdbCursorSourceLike = options.index
      ? objectStore.index(options.index)
      : objectStore;
    await walkCursor(source, options, visit);
  }
}
