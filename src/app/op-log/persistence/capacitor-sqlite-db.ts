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
import type { SQLiteDBConnection } from '@capacitor-community/sqlite';
import { SqliteDb } from './sqlite-op-log-adapter';

/** No-encryption mode string the plugin expects for `createConnection`. */
const NO_ENCRYPTION = 'no-encryption';

export class CapacitorSqliteDb implements SqliteDb {
  private _conn?: SQLiteDBConnection;
  private _openPromise?: Promise<SQLiteDBConnection>;

  constructor(private readonly _dbName: string) {}

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
    const readonly = false;
    // Reuse a connection left open by a previous WebView lifecycle instead of
    // failing with "connection already exists".
    const existing = await sqlite.isConnection(this._dbName, readonly);
    const conn = existing.result
      ? await sqlite.retrieveConnection(this._dbName, readonly)
      : await sqlite.createConnection(this._dbName, false, NO_ENCRYPTION, 1, readonly);
    if (!(await conn.isDBOpen()).result) {
      await conn.open();
    }
    return conn;
  }

  async run(
    sql: string,
    params: unknown[] = [],
  ): Promise<{ changes: number; lastId?: number }> {
    const conn = await this._ensureOpen();
    // transaction:false — the SqliteOpLogAdapter drives BEGIN/COMMIT/ROLLBACK.
    const res = await conn.run(sql, params as never[], false);
    return {
      changes: res.changes?.changes ?? 0,
      lastId: res.changes?.lastId,
    };
  }

  async query(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
    const conn = await this._ensureOpen();
    const res = await conn.query(sql, params as never[]);
    return (res.values ?? []) as Record<string, unknown>[];
  }
}
