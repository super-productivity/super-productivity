/**
 * Backend-agnostic persistence port for the op-log subsystem.
 *
 * Phase A of the SQLite migration (see docs/sync-and-op-log/sqlite-migration.md).
 * The op-log store currently talks to `idb` directly; this port lets the same
 * store run over either IndexedDB (web/PWA/Electron) or native SQLite
 * (Capacitor iOS/Android) without leaking either engine's semantics.
 *
 * Design constraints captured from the existing IndexedDB store:
 * - `ops` uses an auto-increment integer key (`seq`), a UNIQUE index on
 *   `op.id` (`byId`), a plain index on `syncedAt`, and a compound index on
 *   `[source, applicationStatus]`.
 * - Singleton stores (`vector_clock`, `client_id`, `state_cache`,
 *   `import_backup`, archive) are keyed by a known string key.
 * - Two flows require atomic multi-store writes:
 *   `appendWithVectorClockUpdate` (OPS + VECTOR_CLOCK) and
 *   `runDestructiveStateReplacement` (OPS + STATE_CACHE + VECTOR_CLOCK +
 *   CLIENT_ID + archive). Hence the callback-based {@link transaction}: commit
 *   on resolve, roll back on throw — the one shape both IDB auto-commit and
 *   SQLite BEGIN/COMMIT map onto cleanly.
 */

/** A value usable as a primary key in either backend. */
export type DbKey = string | number;

/** Half-open range query against an index (mirrors IDBKeyRange usage). */
export interface DbKeyRange {
  lower?: DbKey | DbKey[];
  upper?: DbKey | DbKey[];
  lowerOpen?: boolean;
  upperOpen?: boolean;
}

export type DbTxMode = 'readonly' | 'readwrite';

/** Iteration direction over a store's primary key or an index. */
export type DbCursorDirection = 'next' | 'prev';

/**
 * Per-entry decision returned from a {@link OpLogDbAdapter.iterate} visitor.
 * - `continue` — keep iterating;
 * - `stop` — end iteration (the common "find latest / first match" case);
 * - `delete` — delete the current entry and keep iterating (the cursor-delete
 *   pattern the op-log store uses to prune full-state ops);
 * - `delete-stop` — delete the current entry and end iteration.
 *
 * These four cases cover every cursor use in the IndexedDB store and each maps
 * onto a SQLite `SELECT … ORDER BY … (LIMIT)` (+ `DELETE`) without a live
 * cursor handle.
 */
export type DbCursorAction = 'continue' | 'stop' | 'delete' | 'delete-stop';

/**
 * Visitor invoked once per entry during {@link OpLogDbAdapter.iterate}.
 *
 * MUST be synchronous. IndexedDB keeps a transaction alive only while a request
 * is pending in the current microtask turn; awaiting real I/O inside a cursor
 * walk lets the transaction auto-commit and the next `cursor.continue()` throw
 * `TransactionInactiveError`. A synchronous visitor is also the only shape a
 * buffered SQLite implementation can honor without materializing the whole
 * result set. Both `value` and `key` (primary key, or index key when iterating
 * an index) are provided so callers like `getLastSeq` need not dig the key out
 * of the value.
 */
export type DbCursorVisitor<T> = (value: T, key: DbKey) => DbCursorAction;

export interface DbIterateOptions {
  /** Iterate over this index instead of the primary key. */
  index?: string;
  /** Default `next` (ascending). `prev` walks descending — e.g. latest first. */
  direction?: DbCursorDirection;
  /**
   * Restrict the walk to entries matching this exact key (or, for a compound
   * index, this key tuple). Mirrors `openCursor(key)` — used to position an
   * index cursor at a specific value for keyed deletes.
   */
  query?: DbKey | DbKey[];
  /**
   * Transaction mode for the (non-transactional) {@link OpLogDbAdapter.iterate}.
   * Defaults to `'readwrite'` so a visitor may return `delete`/`delete-stop`.
   * Pass `'readonly'` for pure read scans (latest-entry lookups, applied-id
   * scans) so they don't take a write lock — read-only IDB transactions run
   * concurrently, and the SQLite backend avoids `BEGIN IMMEDIATE` for reads.
   * A `delete` action under a `'readonly'` scan rejects. Ignored by
   * {@link OpLogTx.iterate}, where the enclosing transaction's mode governs.
   */
  mode?: DbTxMode;
}

/**
 * Operations available inside a {@link OpLogDbAdapter.transaction} callback.
 *
 * Scoped to the stores requested when the transaction was opened. The
 * implementation guarantees every call here participates in the same atomic
 * unit: if the callback throws (or any call rejects) nothing is committed.
 */
export interface OpLogTx {
  /** Insert a value into an auto-increment store; resolves to the new key. */
  add(store: string, value: unknown): Promise<number>;
  /** Insert/replace a value, optionally at an explicit key (for keyless stores). */
  put(store: string, value: unknown, key?: DbKey): Promise<void>;
  get<T>(store: string, key: DbKey): Promise<T | undefined>;
  /** Get all values, optionally restricted to a primary-key range. */
  getAll<T>(store: string, range?: DbKeyRange): Promise<T[]>;
  delete(store: string, key: DbKey): Promise<void>;
  clear(store: string): Promise<void>;
  getFromIndex<T>(
    store: string,
    index: string,
    key: DbKey | DbKey[],
  ): Promise<T | undefined>;
  /** Return the primary key of the first index entry matching `key`, or undefined. */
  getKeyFromIndex(
    store: string,
    index: string,
    key: DbKey | DbKey[],
  ): Promise<DbKey | undefined>;
  getAllFromIndex<T>(store: string, index: string, range?: DbKeyRange): Promise<T[]>;
  /**
   * Walk entries in key (or index) order, invoking `visit` per entry. See
   * {@link DbCursorAction} for how to continue / stop / delete and
   * {@link DbCursorVisitor} for why it must be synchronous.
   */
  iterate<T>(
    store: string,
    options: DbIterateOptions,
    visit: DbCursorVisitor<T>,
  ): Promise<void>;
}

/**
 * The persistence backend. One instance owns one logical database (`SUP_OPS`).
 *
 * Non-transactional methods are convenience single-store operations (each runs
 * in its own implicit transaction); use {@link transaction} whenever two or
 * more writes must be atomic.
 */
export interface OpLogDbAdapter {
  /**
   * Open/create the database against {@link OpLogDbSchema}. Idempotent: safe to
   * call concurrently; implementations dedupe via an in-flight promise.
   */
  init(): Promise<void>;

  /**
   * Close the underlying connection and drop the cached handle. A subsequent
   * operation re-opens transparently. Mainly a teardown hook.
   */
  close(): void;

  /**
   * Transitional bridge: operate on a connection/handle owned by the calling
   * service instead of opening one. Only meaningful for the IndexedDB backend
   * during the incremental Phase A/B migration, where the store/archive
   * services still own their own `IDBPDatabase` and lend it here so both share
   * one connection. Backends that fully self-manage their handle (e.g. SQLite)
   * leave this undefined; callers guard with `adapter.adoptConnection?.(…)`.
   *
   * @param connection the owner's handle, or `undefined` to release it.
   */
  adoptConnection?(connection: unknown): void;

  add(store: string, value: unknown): Promise<number>;
  put(store: string, value: unknown, key?: DbKey): Promise<void>;
  get<T>(store: string, key: DbKey): Promise<T | undefined>;
  /** Get all values, optionally restricted to a primary-key range. */
  getAll<T>(store: string, range?: DbKeyRange): Promise<T[]>;
  delete(store: string, key: DbKey): Promise<void>;
  clear(store: string): Promise<void>;
  /** Count entries in a store, optionally restricted to a primary-key range. */
  count(store: string, range?: DbKeyRange): Promise<number>;

  getFromIndex<T>(
    store: string,
    index: string,
    key: DbKey | DbKey[],
  ): Promise<T | undefined>;
  /** Return the primary key of the first index entry matching `key`, or undefined. */
  getKeyFromIndex(
    store: string,
    index: string,
    key: DbKey | DbKey[],
  ): Promise<DbKey | undefined>;
  getAllFromIndex<T>(store: string, index: string, range?: DbKeyRange): Promise<T[]>;
  countFromIndex(store: string, index: string, range?: DbKeyRange): Promise<number>;

  /** See {@link OpLogTx.iterate}. */
  iterate<T>(
    store: string,
    options: DbIterateOptions,
    visit: DbCursorVisitor<T>,
  ): Promise<void>;

  /**
   * Run `fn` as a single atomic transaction over `stores`. The transaction
   * commits when the returned promise resolves and rolls back if it rejects.
   * Only the listed stores may be touched via the provided {@link OpLogTx}.
   */
  transaction<T>(
    stores: string[],
    mode: DbTxMode,
    fn: (tx: OpLogTx) => Promise<T>,
  ): Promise<T>;
}
