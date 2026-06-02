/**
 * Test helper: a REAL SQLite engine (sql.js / WASM) behind the {@link SqliteDb}
 * port, so the {@link SqliteOpLogAdapter} contract can be validated against
 * actual SQLite — not just the in-memory translation-layer fake in
 * `sqlite-op-log-adapter.spec.ts`. This is the B2 "run against a real engine"
 * gate from docs/sync-and-op-log/sqlite-migration.md.
 *
 * sql.js is loaded as a Karma global (see src/karma.conf.js `files`), not
 * imported, because its universal build statically references `node:` builtins
 * the webpack Karma builder cannot bundle. The wasm is fetched from the proxied
 * `/sql-wasm.wasm`. Dev/test only — never imported by app code, so it never
 * reaches the app bundle (preserving the native-only SQLite rule).
 */
import { SqliteDb } from './sqlite-op-log-adapter';

// ── minimal slice of the sql.js API this helper drives (sql.js ships no types) ─
interface SqlJsStatement {
  bind(params: unknown[]): boolean;
  step(): boolean;
  getAsObject(): Record<string, unknown>;
  free(): boolean;
}
interface SqlJsDatabase {
  run(sql: string, params?: unknown[]): unknown;
  exec(sql: string): { columns: string[]; values: unknown[][] }[];
  prepare(sql: string): SqlJsStatement;
  getRowsModified(): number;
}
interface SqlJsStatic {
  Database: new () => SqlJsDatabase;
}
type InitSqlJs = (config?: {
  locateFile?: (file: string) => string;
}) => Promise<SqlJsStatic>;

declare const initSqlJs: InitSqlJs;

let _sqlJs: Promise<SqlJsStatic> | undefined;

const loadSqlJs = (): Promise<SqlJsStatic> => {
  if (typeof initSqlJs !== 'function') {
    throw new Error(
      'sql.js global not found — is the karma.conf.js `files` entry for sql-wasm.js present?',
    );
  }
  return (_sqlJs ??= initSqlJs({ locateFile: () => '/sql-wasm.wasm' }));
};

/**
 * A {@link SqliteDb} backed by sql.js. sql.js is synchronous once loaded; the
 * async port methods just wrap that. Mirrors what a thin native wrapper over
 * `@capacitor-community/sqlite`'s `SQLiteDBConnection` will do.
 */
class SqlJsDb implements SqliteDb {
  constructor(private readonly _db: SqlJsDatabase) {}

  async run(
    sql: string,
    params: unknown[] = [],
  ): Promise<{ changes: number; lastId?: number }> {
    this._db.run(sql, params);
    const changes = this._db.getRowsModified();
    // `lastId` is only consumed right after an INSERT (sqlAdd); reading it
    // otherwise would be a wasted round-trip on a real (bridged) engine.
    let lastId: number | undefined;
    if (/^\s*INSERT/i.test(sql)) {
      const res = this._db.exec('SELECT last_insert_rowid() AS id');
      const v = res[0]?.values[0]?.[0];
      lastId = typeof v === 'number' ? v : Number(v);
    }
    return { changes, lastId };
  }

  async query(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
    const stmt = this._db.prepare(sql);
    try {
      stmt.bind(params);
      const rows: Record<string, unknown>[] = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      return rows;
    } finally {
      stmt.free();
    }
  }
}

/** Create a fresh in-memory real-SQLite db satisfying the {@link SqliteDb} port. */
export const createSqlJsDb = async (): Promise<SqliteDb> => {
  const SQL = await loadSqlJs();
  return new SqlJsDb(new SQL.Database());
};
