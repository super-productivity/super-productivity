/**
 * Native {@link SqliteDb} backing the op-log over `@capacitor-community/sqlite`
 * — B1 of the SQLite migration (see docs/sync-and-op-log/sqlite-migration.md).
 *
 * This is the only file that talks to the plugin. It opens ONE app-private
 * SQLite database (`SUP_OPS` in `Directory.Data` / `databases/`) and exposes the
 * minimal `run`/`query` surface the {@link SqliteOpLogAdapter} drives. The
 * adapter owns all SQL + transaction control; this wrapper is a dumb bridge.
 *
 * ⚠️ NATIVE ONLY. The plugin's WEB build is WASM-SQLite persisted *into
 * IndexedDB* — i.e. it reintroduces the exact OS-eviction risk this migration
 * exists to escape. Callers MUST gate construction on `IS_NATIVE_PLATFORM`
 * (`shouldUseNativeSqliteOpLogBackend()` does this). The plugin itself is loaded
 * via a dynamic `import()` so it never enters the eager web bundle.
 *
 * ⚡ Perf (the JS↔native bridge is the dominant cost, not SQLite):
 * - `run(...)` returns the plugin's own `lastId` from the insert response — never
 *   a separate `SELECT last_insert_rowid()`, which would double every insert to
 *   two bridge crossings.
 * - `run` is issued with `transaction = false` so the adapter's explicit
 *   `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` are the single transaction in
 *   force; otherwise the plugin would wrap each statement in its own
 *   transaction and the adapter's `BEGIN` would fail.
 */
import type { SQLiteConnection, SQLiteDBConnection } from '@capacitor-community/sqlite';
import { SqliteDb } from './sqlite-op-log-adapter';
import { createConnectionSerializer } from './connection-serializer';

/**
 * No-encryption mode string the plugin expects for `createConnection`.
 * Deliberately matches the existing IndexedDB `SUP_OPS` posture (also
 * unencrypted-at-rest in the app-private store) — this migration moves the
 * op-log off an evictable store, it does not change its encryption stance.
 * Encryption-at-rest (SQLCipher) is a separate, future track.
 */
const NO_ENCRYPTION = 'no-encryption';

/**
 * Hard cap on the native open handshake. A wedged native SQLite connection can
 * leave `open()` (or the consistency/create calls) pending forever; because the
 * op-log is the app's authoritative store and is read during boot hydration, an
 * un-timed open would brick the app at startup with no recovery. On timeout the
 * open rejects so the native backend can fall back to IndexedDB (pre-migration)
 * or fail loudly (post-migration). NOT a cap on the migration itself — that is
 * bounded, progressing work and capping it risks never migrating a large account.
 */
const DEFAULT_OPEN_TIMEOUT_MS = 15_000;

/**
 * Hard cap on a single statement crossing the native bridge. The open timeout
 * only bounds connecting; a wedged connection can also hang an individual
 * `run`/`query` *after* opening (e.g. mid-migration), which would park the shared
 * connection serializer forever and brick the (boot-hydrated) op-log just the
 * same. Generous — far above any legitimate single statement — so it only ever
 * fires on a genuine wedge, converting it into a reject the adapter can roll back
 * / fall back from instead of an indefinite hang.
 */
const DEFAULT_STATEMENT_TIMEOUT_MS = 60_000;

/** Reject with a tagged error if `p` has not settled within `ms`. */
const withTimeout = <T>(p: Promise<T>, ms: number, label: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new DOMException(`${label} timed out after ${ms}ms`, 'TimeoutError')),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });

export class CapacitorSqliteDb implements SqliteDb {
  private _conn?: SQLiteDBConnection;
  private _openPromise?: Promise<SQLiteDBConnection>;
  private _sqlite?: SQLiteConnection;
  // Connection-level serializer (see SqliteDb.runExclusive). One SQLite
  // connection has one transaction context, so every adapter op over the shared
  // connection is chained — never interleaved.
  private readonly _runExclusive = createConnectionSerializer();

  constructor(
    private readonly _dbName: string,
    private readonly _openTimeoutMs: number = DEFAULT_OPEN_TIMEOUT_MS,
    private readonly _statementTimeoutMs: number = DEFAULT_STATEMENT_TIMEOUT_MS,
  ) {}

  /**
   * Whether the `SUP_OPS` SQLite file exists on disk, answered WITHOUT opening a
   * usable connection (so it is callable even after `open()` wedged). The native
   * backend uses it to gate the IndexedDB fallback: a missing file means no
   * migration can have committed, so the legacy IDB copy is still complete and
   * safe to use. A plugin-load failure resolves to `false` for the same reason —
   * SQLite has never been authoritative on a device where the plugin can't load.
   */
  async databaseExists(): Promise<boolean> {
    let sqlite: SQLiteConnection;
    try {
      const { CapacitorSQLite, SQLiteConnection: SQLiteConnectionCtor } =
        await import('@capacitor-community/sqlite');
      sqlite = new SQLiteConnectionCtor(CapacitorSQLite);
    } catch {
      // Plugin unavailable → SQLite has never been authoritative on this device,
      // so no migration can have committed → report "absent" (fallback is safe).
      return false;
    }
    try {
      const res = await withTimeout(
        sqlite.isDatabase(this._dbName),
        this._openTimeoutMs,
        'SQLite isDatabase',
      );
      return res.result === true;
    } catch {
      // The plugin loaded but the probe failed/hung — a migrated file MIGHT exist.
      // Bias toward "exists" so the caller fails loudly rather than risk serving a
      // stale IndexedDB snapshot over post-migration ops.
      return true;
    }
  }

  runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    return this._runExclusive(fn);
  }

  /**
   * Drop the connection so the next op reopens a clean handle (see
   * {@link SqliteDb.reset}). Best-effort: fully closes + removes the plugin's
   * connection entry so any lingering open transaction is rolled back; a close
   * failure is non-fatal because the next `_open()`'s consistency check + the
   * create/retrieve fallback re-establish the connection anyway.
   */
  async reset(): Promise<void> {
    const sqlite = this._sqlite;
    this._conn = undefined;
    this._openPromise = undefined;
    this._sqlite = undefined;
    if (!sqlite) {
      return;
    }
    try {
      // Bounded: a wedged connection can hang close() too, and reset() runs on the
      // recovery path — an un-timed close would defeat the recovery it enables.
      await withTimeout(
        sqlite.closeConnection(this._dbName, false),
        this._openTimeoutMs,
        'SQLite closeConnection',
      );
    } catch {
      // Non-fatal — the next _open() reconciles via checkConnectionsConsistency.
    }
  }

  /**
   * Delete the underlying SQLite database file (drops every table and removes it
   * from disk), then drop the cached handle so a later op reopens/recreates
   * cleanly. NOT part of the normal op-log lifecycle — the authoritative
   * `SUP_OPS` file is never deleted at runtime. This exists for the dev-only
   * op-log backend benchmark to tear down its throwaway bench DB, and is kept
   * here so all `@capacitor-community/sqlite` access stays in this one file.
   */
  async deleteDatabase(): Promise<void> {
    const conn = await this._ensureOpen();
    try {
      // delete() requires an open connection; it closes the connection natively
      // and removes the file. Bounded like every other native call so a wedged
      // teardown can't hang the benchmark indefinitely.
      await withTimeout(conn.delete(), this._statementTimeoutMs, 'SQLite delete');
    } finally {
      this._conn = undefined;
      this._openPromise = undefined;
      this._sqlite = undefined;
    }
  }

  private _ensureOpen(): Promise<SQLiteDBConnection> {
    if (this._conn) {
      return Promise.resolve(this._conn);
    }
    if (!this._openPromise) {
      this._openPromise = this._open()
        .then((conn) => {
          this._conn = conn;
          return conn;
        })
        .catch((e) => {
          // Allow a later call to retry the open rather than caching a rejection.
          this._openPromise = undefined;
          throw e;
        });
    }
    return this._openPromise;
  }

  private _open(): Promise<SQLiteDBConnection> {
    // Bound the whole native handshake: any of the bridge calls below can wedge
    // indefinitely on a broken native connection, and the op-log is read during
    // boot hydration, so an un-timed hang bricks startup (see DEFAULT_OPEN_TIMEOUT_MS).
    return withTimeout(this._openUntimed(), this._openTimeoutMs, 'SQLite open');
  }

  private async _openUntimed(): Promise<SQLiteDBConnection> {
    // Dynamic import: the plugin (and its web WASM fallback) must NOT be pulled
    // into the eager bundle — this code path only runs on native.
    const { CapacitorSQLite, SQLiteConnection } =
      await import('@capacitor-community/sqlite');
    const sqlite = new SQLiteConnection(CapacitorSQLite);
    // Kept so reset() can closeConnection() to roll back a wedged transaction.
    this._sqlite = sqlite;
    const readonly = false;
    // A fresh `SQLiteConnection` starts with an EMPTY JS connection map, but on a
    // WebView reload the NATIVE side may still hold an open `SUP_OPS` connection
    // from the previous JS runtime. Reconcile first, otherwise the create path
    // below rejects with "connection already exists". Best-effort — a failure
    // here is non-fatal (the create/retrieve fallback still covers it).
    await sqlite.checkConnectionsConsistency().catch(() => undefined);
    const conn = await this._createOrRetrieveConnection(sqlite, readonly);
    if (!(await conn.isDBOpen()).result) {
      await conn.open();
    }
    return conn;
  }

  /**
   * Get a `SUP_OPS` connection, reusing the existing one when the plugin already
   * tracks it. Falls back to `retrieveConnection` if `createConnection` still
   * reports the connection exists (a stale entry the consistency check above
   * didn't clear), so a reload can never wedge on "connection already exists".
   */
  private async _createOrRetrieveConnection(
    sqlite: SQLiteConnection,
    readonly: boolean,
  ): Promise<SQLiteDBConnection> {
    if ((await sqlite.isConnection(this._dbName, readonly)).result) {
      return sqlite.retrieveConnection(this._dbName, readonly);
    }
    try {
      return await sqlite.createConnection(
        this._dbName,
        false,
        NO_ENCRYPTION,
        1,
        readonly,
      );
    } catch (e) {
      if (/already exists/i.test(e instanceof Error ? e.message : String(e))) {
        return sqlite.retrieveConnection(this._dbName, readonly);
      }
      throw e;
    }
  }

  async run(
    sql: string,
    params: unknown[] = [],
  ): Promise<{ changes: number; lastId?: number }> {
    const conn = await this._ensureOpen();
    // transaction:false — the SqliteOpLogAdapter drives BEGIN/COMMIT/ROLLBACK.
    const res = await withTimeout(
      conn.run(sql, params, false),
      this._statementTimeoutMs,
      'SQLite run',
    );
    return {
      changes: res.changes?.changes ?? 0,
      lastId: res.changes?.lastId,
    };
  }

  async query(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
    const conn = await this._ensureOpen();
    const res = await withTimeout(
      conn.query(sql, params),
      this._statementTimeoutMs,
      'SQLite query',
    );
    return (res.values ?? []) as Record<string, unknown>[];
  }
}
