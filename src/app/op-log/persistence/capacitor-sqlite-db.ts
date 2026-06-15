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

export class CapacitorSqliteDb implements SqliteDb {
  private _conn?: SQLiteDBConnection;
  private _openPromise?: Promise<SQLiteDBConnection>;
  private _sqlite?: SQLiteConnection;
  // Connection-level serializer (see SqliteDb.runExclusive). One SQLite
  // connection has one transaction context, so every adapter op over the shared
  // connection is chained — never interleaved.
  private readonly _runExclusive = createConnectionSerializer();

  constructor(private readonly _dbName: string) {}

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
      await sqlite.closeConnection(this._dbName, false);
    } catch {
      // Non-fatal — the next _open() reconciles via checkConnectionsConsistency.
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

  private async _open(): Promise<SQLiteDBConnection> {
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
    const res = await conn.run(sql, params, false);
    return {
      changes: res.changes?.changes ?? 0,
      lastId: res.changes?.lastId,
    };
  }

  async query(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
    const conn = await this._ensureOpen();
    const res = await conn.query(sql, params);
    return (res.values ?? []) as Record<string, unknown>[];
  }
}
