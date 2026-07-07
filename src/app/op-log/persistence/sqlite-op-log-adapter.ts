/**
 * SQLite implementation of {@link OpLogDbAdapter} — Phase B of the SQLite
 * migration (see docs/sync-and-op-log/sqlite-migration.md).
 *
 * This file talks to the minimal {@link SqliteDb} port rather than importing
 * `@capacitor-community/sqlite` directly, so it has NO native dependency and is
 * unit-testable against any SQLite engine (the spec drives it with sql.js). A
 * thin wrapper over the plugin's `SQLiteDBConnection` satisfies the port on
 * device.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * Generic table model
 * ──────────────────────────────────────────────────────────────────────────
 * IndexedDB stores structured-clone objects and extracts index keys from value
 * paths (e.g. `op.id`). SQLite has no nested columns, but the op-log never
 * queries *inside* an op — only by a few indexed fields. So every store maps to
 * a table with a JSON `value` column plus one extracted column per IDB index,
 * populated on write from the value:
 *   - byId           → `op_id TEXT UNIQUE`         from `$.op.id`
 *   - bySyncedAt     → `synced_at INTEGER`         from `$.syncedAt`
 *   - bySourceStatus → `source TEXT, application_status TEXT` (compound)
 *
 * Primary key, by store kind: autoIncrement (`ops`) →
 * `seq INTEGER PRIMARY KEY AUTOINCREMENT` (monotonic, never reused across
 * `clear()` — matches IDB + getLastSeq); keyPath/keyless stores →
 * `key TEXT PRIMARY KEY` (extracted from the keyPath, or supplied out-of-line).
 *
 * Transactions map to `BEGIN IMMEDIATE` … `COMMIT`/`ROLLBACK` — real ACID,
 * strictly stronger than IDB's auto-commit-on-microtask-gap. Errors are mapped
 * to the SAME `DOMException` names the store's existing catch blocks expect:
 * UNIQUE violation → `ConstraintError` (→ DUPLICATE_OPERATION_ERROR_MSG),
 * disk-full → `QuotaExceededError` (→ StorageQuotaExceededError).
 */

import {
  DbCursorAction,
  DbCursorVisitor,
  DbIterateOptions,
  DbKey,
  DbKeyRange,
  DbTxMode,
  OpLogDbAdapter,
  OpLogTx,
} from './op-log-db-adapter';
import { DbStoreSchema, OP_LOG_DB_SCHEMA, OpLogDbSchema } from './op-log-db-schema';
import { OPS_INDEXES } from './db-keys.const';

/** Column carrying the JSON-encoded stored object. */
export const VALUE_COLUMN = 'value';
/** Primary-key column for keyPath / keyless stores. */
export const KEY_COLUMN = 'key';
/** Primary-key column for the auto-increment (`ops`) store. */
export const SEQ_COLUMN = 'seq';

/** A SQL column that backs one IDB index path. */
export interface SqlIndexColumn {
  /** SQL column name. */
  column: string;
  /** JSON path within `value`, e.g. `$.op.id`. */
  jsonPath: string;
  /** Column affinity. */
  type: 'TEXT' | 'INTEGER';
  unique?: boolean;
}

/** A named index → its backing column(s) (for query translation). */
export interface SqlIndexPlan {
  name: string;
  columns: SqlIndexColumn[];
  unique: boolean;
}

/** Per-store physical layout derived from a {@link DbStoreSchema}. */
export interface SqlTablePlan {
  table: string;
  /** 'autoinc' → INTEGER PK AUTOINCREMENT; 'key' → TEXT PK. */
  primaryKey: 'autoinc' | 'key';
  /** The primary-key column name (`seq` or `key`). */
  pkColumn: string;
  /** For keyPath stores, the JSON path the PK is extracted from (e.g. `$.id`). */
  keyJsonPath?: string;
  /** Flat list of all extracted columns (drives DDL). */
  indexColumns: SqlIndexColumn[];
  /** Named indexes (drives index-query translation). */
  indexes: SqlIndexPlan[];
}

/**
 * Minimal async SQLite surface this adapter needs. A thin wrapper over
 * `@capacitor-community/sqlite`'s `SQLiteDBConnection` satisfies it on device;
 * tests provide a fake backed by sql.js. Kept here (not imported from the
 * plugin) so this file has no native dependency.
 */
export interface SqliteDb {
  /** Run a statement with no result set (DDL, INSERT/UPDATE/DELETE). */
  run(sql: string, params?: unknown[]): Promise<{ changes: number; lastId?: number }>;
  /** Run a query, returning rows as plain objects. */
  query(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
}

/**
 * Known index keyPath → column mapping, keyed by the value path the IDB index
 * uses. A list (not an object literal) so dotted paths like `op.id` aren't
 * constrained by identifier naming rules.
 */
const INDEX_COLUMN_BY_PATH: ReadonlyArray<SqlIndexColumn & { keyPath: string }> = [
  { keyPath: 'op.id', column: 'op_id', jsonPath: '$.op.id', type: 'TEXT', unique: true },
  { keyPath: 'syncedAt', column: 'synced_at', jsonPath: '$.syncedAt', type: 'INTEGER' },
  { keyPath: 'source', column: 'source', jsonPath: '$.source', type: 'TEXT' },
  {
    keyPath: 'applicationStatus',
    column: 'application_status',
    jsonPath: '$.applicationStatus',
    type: 'TEXT',
  },
];

const indexColumnFor = (keyPath: string): SqlIndexColumn | undefined => {
  const m = INDEX_COLUMN_BY_PATH.find((c) => c.keyPath === keyPath);
  return m
    ? { column: m.column, jsonPath: m.jsonPath, type: m.type, unique: m.unique }
    : undefined;
};

/**
 * Derive a physical {@link SqlTablePlan} per store from the engine-agnostic
 * {@link OpLogDbSchema} — the bridge that lets one descriptor drive both the
 * IndexedDB upgrade and the SQLite DDL.
 */
export const planTables = (schema: OpLogDbSchema = OP_LOG_DB_SCHEMA): SqlTablePlan[] =>
  schema.stores.map((store) => planTable(store));

const planTable = (store: DbStoreSchema): SqlTablePlan => {
  const indexes: SqlIndexPlan[] = [];
  const indexColumns: SqlIndexColumn[] = [];
  for (const idx of store.indexes ?? []) {
    const paths = Array.isArray(idx.keyPath) ? idx.keyPath : [idx.keyPath];
    const cols: SqlIndexColumn[] = [];
    for (const path of paths) {
      const col = indexColumnFor(path);
      if (col) {
        // Uniqueness only applies to single-column unique indexes.
        const withUnique =
          idx.unique && paths.length === 1 ? { ...col, unique: true } : col;
        cols.push(withUnique);
        indexColumns.push(withUnique);
      }
    }
    if (cols.length) {
      indexes.push({
        name: idx.name,
        columns: cols,
        unique: !!idx.unique && cols.length === 1,
      });
    }
  }
  return {
    table: store.name,
    primaryKey: store.autoIncrement ? 'autoinc' : 'key',
    pkColumn: store.autoIncrement ? SEQ_COLUMN : KEY_COLUMN,
    keyJsonPath: store.keyPath ? `$.${store.keyPath}` : undefined,
    indexColumns,
    indexes,
  };
};

/**
 * Build the `CREATE TABLE` + `CREATE INDEX` DDL for a planned table. Pure and
 * dependency-free so it can be unit-tested without a database.
 */
export const buildDdl = (plan: SqlTablePlan): string[] => {
  const cols: string[] = [];
  cols.push(
    plan.primaryKey === 'autoinc'
      ? `${SEQ_COLUMN} INTEGER PRIMARY KEY AUTOINCREMENT`
      : `${KEY_COLUMN} TEXT PRIMARY KEY`,
  );
  cols.push(`${VALUE_COLUMN} TEXT NOT NULL`);
  for (const ic of plan.indexColumns) {
    cols.push(`${ic.column} ${ic.type}`);
  }
  const ddl: string[] = [`CREATE TABLE IF NOT EXISTS ${plan.table} (${cols.join(', ')})`];
  for (const idx of plan.indexes) {
    const unique = idx.unique ? 'UNIQUE ' : '';
    const colList = idx.columns.map((c) => c.column).join(', ');
    ddl.push(
      `CREATE ${unique}INDEX IF NOT EXISTS idx_${plan.table}_${idx.name} ` +
        `ON ${plan.table}(${colList})`,
    );
  }
  return ddl;
};

// ── value <-> row helpers ────────────────────────────────────────────────────

/** Walk a `$.a.b` JSON path on a decoded object. */
const extractPath = (value: unknown, jsonPath: string): unknown => {
  const parts = jsonPath.replace(/^\$\./, '').split('.');
  let cur: unknown = value;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
};

/** A SQLite value (sql.js accepts string/number/null). */
const toSqlValue = (v: unknown): string | number | null => {
  if (v == null) return null;
  if (typeof v === 'number' || typeof v === 'string') return v;
  // Booleans (e.g. nothing today) and anything else collapse to text.
  return String(v);
};

interface InsertPlan {
  columns: string[];
  params: (string | number | null)[];
}

/** Build the column/param lists for inserting `value` into `plan`. */
const buildInsert = (
  plan: SqlTablePlan,
  value: unknown,
  explicitKey?: DbKey,
): InsertPlan => {
  const columns: string[] = [];
  const params: (string | number | null)[] = [];
  if (plan.primaryKey === 'key') {
    const key = plan.keyJsonPath ? extractPath(value, plan.keyJsonPath) : explicitKey;
    columns.push(KEY_COLUMN);
    params.push(toSqlValue(key));
  } else {
    // autoinc (`ops`): bind `seq` only when the value already carries one — a
    // re-put (mark*/clearUnsynced) or an explicit-seq add — so ON CONFLICT(seq)
    // updates in place instead of inserting a duplicate. Otherwise omit it and
    // let AUTOINCREMENT assign a fresh, monotonic, never-reused seq, matching
    // IDB's keyPath+autoIncrement store.
    const seq = plan.keyJsonPath ? extractPath(value, plan.keyJsonPath) : undefined;
    if (seq != null) {
      columns.push(plan.pkColumn);
      params.push(toSqlValue(seq));
    }
  }
  columns.push(VALUE_COLUMN);
  params.push(JSON.stringify(value));
  for (const ic of plan.indexColumns) {
    columns.push(ic.column);
    params.push(toSqlValue(extractPath(value, ic.jsonPath)));
  }
  return { columns, params };
};

const decodeRow = <T>(plan: SqlTablePlan, row: Record<string, unknown>): T => {
  const value = JSON.parse(row[VALUE_COLUMN] as string) as Record<string, unknown>;
  // The autoinc PK (`seq`) lives in its own column, never the JSON `value` blob
  // — inject it back (from the `__pk` alias every read selects) so callers see
  // `.seq`, exactly like IDB's keyPath+autoIncrement store. keyPath stores keep
  // their key inside the value already, so they need no injection. The autoinc
  // keyPath is a top-level field (`seq`); strip the `$.` prefix like extractPath.
  if (plan.primaryKey === 'autoinc' && plan.keyJsonPath && '__pk' in row) {
    value[plan.keyJsonPath.replace(/^\$\./, '')] = row['__pk'] as number;
  }
  return value as T;
};

/** Map a sql.js error to the DOMException name the store's catch blocks expect. */
const mapSqliteError = (e: unknown): never => {
  const msg = e instanceof Error ? e.message : String(e);
  if (/UNIQUE constraint failed/i.test(msg)) {
    throw new DOMException(msg, 'ConstraintError');
  }
  if (/SQLITE_FULL|database or disk is full/i.test(msg)) {
    throw new DOMException(msg, 'QuotaExceededError');
  }
  throw e;
};

/** WHERE fragment for an exact key match against an index's column(s). */
const whereExact = (
  columns: SqlIndexColumn[],
  key: DbKey | DbKey[],
): { clause: string; params: (string | number | null)[] } => {
  const keys = Array.isArray(key) ? key : [key];
  const clause = columns.map((c) => `${c.column} = ?`).join(' AND ');
  return { clause, params: keys.map(toSqlValue) };
};

/** WHERE fragment for a {@link DbKeyRange} against one or more columns. */
const whereRange = (
  columns: string[],
  range?: DbKeyRange,
): { clause: string; params: (string | number | null)[] } => {
  if (!range) return { clause: '', params: [] };
  const lowers = Array.isArray(range.lower)
    ? range.lower
    : range.lower != null
      ? [range.lower]
      : [];
  const uppers = Array.isArray(range.upper)
    ? range.upper
    : range.upper != null
      ? [range.upper]
      : [];
  const parts: string[] = [];
  const params: (string | number | null)[] = [];
  columns.forEach((col, i) => {
    if (lowers[i] != null) {
      parts.push(`${col} ${range.lowerOpen ? '>' : '>='} ?`);
      params.push(toSqlValue(lowers[i]));
    }
    if (uppers[i] != null) {
      parts.push(`${col} ${range.upperOpen ? '<' : '<='} ?`);
      params.push(toSqlValue(uppers[i]));
    }
  });
  return { clause: parts.join(' AND '), params };
};

const whereClause = (clause: string): string => (clause ? ` WHERE ${clause}` : '');

// ── SQL operations (shared by the adapter and its transaction) ───────────────
//
// Every method takes a SqliteDb so the same code serves both the adapter
// (implicit per-call statements) and OpLogTx (statements inside BEGIN/COMMIT).

const sqlAdd = async (
  db: SqliteDb,
  plan: SqlTablePlan,
  value: unknown,
): Promise<number> => {
  const { columns, params } = buildInsert(plan, value);
  const sql = `INSERT INTO ${plan.table} (${columns.join(', ')}) VALUES (${columns
    .map(() => '?')
    .join(', ')})`;
  try {
    const res = await db.run(sql, params);
    return res.lastId ?? 0;
  } catch (e) {
    return mapSqliteError(e);
  }
};

const sqlPut = async (
  db: SqliteDb,
  plan: SqlTablePlan,
  value: unknown,
  key?: DbKey,
): Promise<void> => {
  const { columns, params } = buildInsert(plan, value, key);
  // Never overwrite the primary-key column on conflict (it is the match key).
  const updateCols = columns.filter((c) => c !== plan.pkColumn);
  const sql =
    `INSERT INTO ${plan.table} (${columns.join(', ')}) VALUES (${columns
      .map(() => '?')
      .join(', ')}) ` +
    `ON CONFLICT(${plan.pkColumn}) DO UPDATE SET ${updateCols
      .map((c) => `${c} = excluded.${c}`)
      .join(', ')}`;
  try {
    await db.run(sql, params);
  } catch (e) {
    mapSqliteError(e);
  }
};

const sqlGet = async <T>(
  db: SqliteDb,
  plan: SqlTablePlan,
  key: DbKey,
): Promise<T | undefined> => {
  const rows = await db.query(
    `SELECT ${plan.pkColumn} AS __pk, ${VALUE_COLUMN} FROM ${plan.table} WHERE ${plan.pkColumn} = ? LIMIT 1`,
    [toSqlValue(key)],
  );
  return rows.length ? decodeRow<T>(plan, rows[0]) : undefined;
};

const sqlGetAll = async <T>(
  db: SqliteDb,
  plan: SqlTablePlan,
  range?: DbKeyRange,
): Promise<T[]> => {
  const { clause, params } = whereRange([plan.pkColumn], range);
  const rows = await db.query(
    `SELECT ${plan.pkColumn} AS __pk, ${VALUE_COLUMN} FROM ${plan.table}${whereClause(clause)} ORDER BY ${plan.pkColumn} ASC`,
    params,
  );
  return rows.map((r) => decodeRow<T>(plan, r));
};

const sqlDelete = async (db: SqliteDb, plan: SqlTablePlan, key: DbKey): Promise<void> => {
  await db.run(`DELETE FROM ${plan.table} WHERE ${plan.pkColumn} = ?`, [toSqlValue(key)]);
};

const sqlClear = async (db: SqliteDb, plan: SqlTablePlan): Promise<void> => {
  await db.run(`DELETE FROM ${plan.table}`);
};

const sqlCount = async (
  db: SqliteDb,
  plan: SqlTablePlan,
  range?: DbKeyRange,
): Promise<number> => {
  const { clause, params } = whereRange([plan.pkColumn], range);
  const rows = await db.query(
    `SELECT COUNT(*) AS n FROM ${plan.table}${whereClause(clause)}`,
    params,
  );
  return Number(rows[0]?.['n'] ?? 0);
};

const indexPlan = (plan: SqlTablePlan, indexName: string): SqlIndexPlan => {
  const idx = plan.indexes.find((i) => i.name === indexName);
  if (!idx) {
    throw new Error(
      `SqliteOpLogAdapter: unknown index '${indexName}' on '${plan.table}'`,
    );
  }
  return idx;
};

const sqlGetFromIndex = async <T>(
  db: SqliteDb,
  plan: SqlTablePlan,
  indexName: string,
  key: DbKey | DbKey[],
): Promise<T | undefined> => {
  const idx = indexPlan(plan, indexName);
  const { clause, params } = whereExact(idx.columns, key);
  const rows = await db.query(
    `SELECT ${plan.pkColumn} AS __pk, ${VALUE_COLUMN} FROM ${plan.table} WHERE ${clause} LIMIT 1`,
    params,
  );
  return rows.length ? decodeRow<T>(plan, rows[0]) : undefined;
};

const sqlGetKeyFromIndex = async (
  db: SqliteDb,
  plan: SqlTablePlan,
  indexName: string,
  key: DbKey | DbKey[],
): Promise<DbKey | undefined> => {
  const idx = indexPlan(plan, indexName);
  const { clause, params } = whereExact(idx.columns, key);
  const rows = await db.query(
    `SELECT ${plan.pkColumn} AS k FROM ${plan.table} WHERE ${clause} LIMIT 1`,
    params,
  );
  return rows.length ? (rows[0]['k'] as DbKey) : undefined;
};

const sqlGetAllFromIndex = async <T>(
  db: SqliteDb,
  plan: SqlTablePlan,
  indexName: string,
  range?: DbKeyRange,
): Promise<T[]> => {
  const idx = indexPlan(plan, indexName);
  const { clause, params } = whereRange(
    idx.columns.map((c) => c.column),
    range,
  );
  const order = idx.columns.map((c) => c.column).join(', ');
  const rows = await db.query(
    `SELECT ${plan.pkColumn} AS __pk, ${VALUE_COLUMN} FROM ${plan.table}${whereClause(clause)} ORDER BY ${order} ASC`,
    params,
  );
  return rows.map((r) => decodeRow<T>(plan, r));
};

/**
 * Cursor walk: SELECT the matching rows in the requested order, invoke `visit`
 * per row (synchronously, honoring stop/delete/delete-stop), and DELETE any
 * marked rows by primary key. Callers run this inside a transaction when
 * deletes are possible (mode !== 'readonly').
 */
const sqlIterate = async <T>(
  db: SqliteDb,
  plan: SqlTablePlan,
  options: DbIterateOptions,
  visit: DbCursorVisitor<T>,
): Promise<void> => {
  const orderCols = options.index
    ? indexPlan(plan, options.index).columns.map((c) => c.column)
    : [plan.pkColumn];
  const dir = options.direction === 'prev' ? 'DESC' : 'ASC';

  let clause = '';
  let params: (string | number | null)[] = [];
  if (options.query !== undefined && options.index) {
    const ex = whereExact(indexPlan(plan, options.index).columns, options.query);
    clause = ex.clause;
    params = ex.params;
  }

  const rows = await db.query(
    `SELECT ${plan.pkColumn} AS __pk, ${VALUE_COLUMN} FROM ${plan.table}` +
      `${whereClause(clause)} ORDER BY ${orderCols.map((c) => `${c} ${dir}`).join(', ')}`,
    params,
  );

  const toDelete: DbKey[] = [];
  for (const row of rows) {
    const action: DbCursorAction = visit(decodeRow<T>(plan, row), row['__pk'] as DbKey);
    if (action === 'delete' || action === 'delete-stop') {
      // Honor the port contract: a delete under a readonly scan must reject
      // (parity with IDB, which throws ReadOnlyError) rather than silently
      // mutating outside any transaction.
      if (options.mode === 'readonly') {
        throw new DOMException(
          `Cannot delete during a readonly scan of '${plan.table}'`,
          'ReadOnlyError',
        );
      }
      toDelete.push(row['__pk'] as DbKey);
    }
    if (action === 'stop' || action === 'delete-stop') {
      break;
    }
  }
  for (const pk of toDelete) {
    await db.run(`DELETE FROM ${plan.table} WHERE ${plan.pkColumn} = ?`, [
      toSqlValue(pk),
    ]);
  }
};

// ── adapter ──────────────────────────────────────────────────────────────────

/**
 * One FIFO serialization chain **per physical `SqliteDb` connection**, keyed by
 * the connection object — NOT per adapter instance.
 *
 * The native rollout hands the op-log store and the archive store TWO separate
 * `SqliteOpLogAdapter` instances that share ONE `SqliteDb` (one file, all
 * tables — see docs/sync-and-op-log/sqlite-migration-followup.md B3). A queue
 * living on the adapter instance would only serialize each store against
 * itself, leaving an op-log `BEGIN` free to interleave with a concurrent
 * archive `BEGIN` on the shared connection — the exact corruption this guards
 * against. Keying the chain to the connection makes every adapter over that
 * connection share one queue. `WeakMap` so a closed connection's queue is
 * collected with it.
 */
const CONNECTION_QUEUES = new WeakMap<SqliteDb, { tail: Promise<unknown> }>();

const connectionQueue = (db: SqliteDb): { tail: Promise<unknown> } => {
  let q = CONNECTION_QUEUES.get(db);
  if (!q) {
    q = { tail: Promise.resolve() };
    CONNECTION_QUEUES.set(db, q);
  }
  return q;
};

/**
 * SQLite-backed {@link OpLogDbAdapter}. `adoptConnection` is intentionally
 * absent — SQLite self-manages its handle; the stores' `adoptConnection?.()`
 * calls are no-ops here.
 */
export class SqliteOpLogAdapter implements OpLogDbAdapter {
  private readonly _plans: Map<string, SqlTablePlan>;

  constructor(
    private readonly _db: SqliteDb,
    schema: OpLogDbSchema = OP_LOG_DB_SCHEMA,
  ) {
    this._plans = new Map(planTables(schema).map((p) => [p.table, p]));
  }

  /**
   * Serialize `fn` after all previously-queued work on this connection — one
   * operation touches the connection at a time. SQLite (unlike IndexedDB) has no
   * nested transactions: a second `BEGIN` issued while one is open throws, and a
   * bare statement run mid-transaction silently joins — and rolls back with —
   * that foreign transaction. The op-log issues genuinely concurrent operations
   * (capture append vs. archive write vs. compaction, potentially from two
   * adapters over the same connection), so every entry point funnels through the
   * shared {@link connectionQueue}: a `transaction()` / writable `iterate()`
   * holds it for the whole `BEGIN…COMMIT`; a single statement holds it for its
   * one call.
   *
   * Re-entrancy precondition (unenforced — callers MUST honor it): work inside a
   * held slot (an {@link OpLogTx} callback, a `sqlIterate` visitor's deletes)
   * runs its statements directly on `_db`, never back through these public
   * methods. A `transaction()` callback that instead `await`s an adapter method
   * (e.g. `this._adapter.get(...)` rather than `tx.get(...)`) would enqueue
   * behind the very slot it runs in and deadlock. Enforcement belongs in a lint
   * rule, not a runtime guard: a runtime "in a slot" flag cannot distinguish an
   * illegal re-entrant call from a legal concurrent one (both arrive while a
   * slot executes), so it would reject the concurrency this queue exists to
   * serialize.
   */
  private _serialize<T>(fn: () => Promise<T>): Promise<T> {
    const q = connectionQueue(this._db);
    // `.then(fn, fn)` runs `fn` whether the prior slot resolved or rejected
    // (defensive — the tail below never rejects).
    const result = q.tail.then(fn, fn);
    // Keep the chain alive past a rejection and swallow it so the tail never
    // becomes an unhandled rejection — the real error still reaches the caller
    // via the returned `result`.
    q.tail = result.catch(() => undefined);
    return result;
  }

  private _plan(store: string): SqlTablePlan {
    const plan = this._plans.get(store);
    if (!plan) {
      throw new Error(`SqliteOpLogAdapter: unknown store '${store}'`);
    }
    return plan;
  }

  init(): Promise<void> {
    // Apply DDL for every store. Idempotent via `IF NOT EXISTS`. Phase C adds
    // the one-time IDB→SQLite data copy ahead of first use.
    return this._serialize(async () => {
      for (const plan of this._plans.values()) {
        for (const stmt of buildDdl(plan)) {
          await this._db.run(stmt);
        }
      }
    });
  }

  close(): void {
    // The SqliteDb's open/close lifecycle is owned by whoever constructs it.
  }

  add(store: string, value: unknown): Promise<number> {
    const plan = this._plan(store);
    return this._serialize(() => sqlAdd(this._db, plan, value));
  }

  put(store: string, value: unknown, key?: DbKey): Promise<void> {
    const plan = this._plan(store);
    return this._serialize(() => sqlPut(this._db, plan, value, key));
  }

  get<T>(store: string, key: DbKey): Promise<T | undefined> {
    const plan = this._plan(store);
    return this._serialize(() => sqlGet<T>(this._db, plan, key));
  }

  getAll<T>(store: string, range?: DbKeyRange): Promise<T[]> {
    const plan = this._plan(store);
    return this._serialize(() => sqlGetAll<T>(this._db, plan, range));
  }

  delete(store: string, key: DbKey): Promise<void> {
    const plan = this._plan(store);
    return this._serialize(() => sqlDelete(this._db, plan, key));
  }

  clear(store: string): Promise<void> {
    const plan = this._plan(store);
    return this._serialize(() => sqlClear(this._db, plan));
  }

  count(store: string, range?: DbKeyRange): Promise<number> {
    const plan = this._plan(store);
    return this._serialize(() => sqlCount(this._db, plan, range));
  }

  getFromIndex<T>(
    store: string,
    index: string,
    key: DbKey | DbKey[],
  ): Promise<T | undefined> {
    const plan = this._plan(store);
    return this._serialize(() => sqlGetFromIndex<T>(this._db, plan, index, key));
  }

  getKeyFromIndex(
    store: string,
    index: string,
    key: DbKey | DbKey[],
  ): Promise<DbKey | undefined> {
    const plan = this._plan(store);
    return this._serialize(() => sqlGetKeyFromIndex(this._db, plan, index, key));
  }

  getAllFromIndex<T>(store: string, index: string, range?: DbKeyRange): Promise<T[]> {
    const plan = this._plan(store);
    return this._serialize(() => sqlGetAllFromIndex<T>(this._db, plan, index, range));
  }

  countFromIndex(store: string, index: string, range?: DbKeyRange): Promise<number> {
    const plan = this._plan(store);
    const idx = indexPlan(plan, index);
    const { clause, params } = whereRange(
      idx.columns.map((c) => c.column),
      range,
    );
    return this._serialize(() =>
      this._db
        .query(`SELECT COUNT(*) AS n FROM ${plan.table}${whereClause(clause)}`, params)
        .then((rows) => Number(rows[0]?.['n'] ?? 0)),
    );
  }

  async iterate<T>(
    store: string,
    options: DbIterateOptions,
    visit: DbCursorVisitor<T>,
  ): Promise<void> {
    const plan = this._plan(store);
    // A delete-capable scan must be atomic; a pure read scan needs no BEGIN —
    // but both still serialize on the shared connection (`_serialize` /
    // `_inTransaction`) so they never interleave with another operation.
    if (options.mode === 'readonly') {
      await this._serialize(() => sqlIterate(this._db, plan, options, visit));
      return;
    }
    await this._inTransaction('IMMEDIATE', async () => {
      await sqlIterate(this._db, plan, options, visit);
    });
  }

  async transaction<T>(
    stores: string[],
    mode: DbTxMode,
    fn: (tx: OpLogTx) => Promise<T>,
  ): Promise<T> {
    return this._inTransaction(mode === 'readonly' ? 'DEFERRED' : 'IMMEDIATE', () =>
      fn(new SqliteOpLogTx(this._db, this._plans, new Set(stores), mode)),
    );
  }

  /**
   * BEGIN … COMMIT on resolve, ROLLBACK + rethrow (error-mapped) on throw.
   * Runs inside {@link _serialize}, so the whole `BEGIN…COMMIT` is exclusive on
   * the connection — no other operation can open a second transaction inside it.
   */
  private _inTransaction<T>(
    kind: 'IMMEDIATE' | 'DEFERRED',
    fn: () => Promise<T>,
  ): Promise<T> {
    return this._serialize(async () => {
      await this._db.run(`BEGIN ${kind}`);
      try {
        const result = await fn();
        await this._db.run('COMMIT');
        return result;
      } catch (e) {
        try {
          await this._db.run('ROLLBACK');
        } catch {
          // Already rolled back / no active transaction.
        }
        return mapSqliteError(e);
      }
    });
  }
}

/**
 * {@link OpLogTx} bound to the same connection inside an open transaction. All
 * statements run on `_db` between the enclosing BEGIN/COMMIT, so they share one
 * atomic unit.
 */
class SqliteOpLogTx implements OpLogTx {
  constructor(
    private readonly _db: SqliteDb,
    private readonly _plans: Map<string, SqlTablePlan>,
    private readonly _stores: ReadonlySet<string>,
    private readonly _mode: DbTxMode,
  ) {}

  private _plan(store: string): SqlTablePlan {
    // Enforce the transaction's declared store scope (parity with IDB, where a
    // store omitted from transaction(stores) throws when touched).
    if (!this._stores.has(store)) {
      throw new Error(
        `SqliteOpLogTx: store '${store}' is outside this transaction's declared scope`,
      );
    }
    const plan = this._plans.get(store);
    if (!plan) {
      throw new Error(`SqliteOpLogTx: unknown store '${store}'`);
    }
    return plan;
  }

  add(store: string, value: unknown): Promise<number> {
    return sqlAdd(this._db, this._plan(store), value);
  }

  put(store: string, value: unknown, key?: DbKey): Promise<void> {
    return sqlPut(this._db, this._plan(store), value, key);
  }

  get<T>(store: string, key: DbKey): Promise<T | undefined> {
    return sqlGet<T>(this._db, this._plan(store), key);
  }

  getAll<T>(store: string, range?: DbKeyRange): Promise<T[]> {
    return sqlGetAll<T>(this._db, this._plan(store), range);
  }

  delete(store: string, key: DbKey): Promise<void> {
    return sqlDelete(this._db, this._plan(store), key);
  }

  clear(store: string): Promise<void> {
    return sqlClear(this._db, this._plan(store));
  }

  getFromIndex<T>(
    store: string,
    index: string,
    key: DbKey | DbKey[],
  ): Promise<T | undefined> {
    return sqlGetFromIndex<T>(this._db, this._plan(store), index, key);
  }

  getKeyFromIndex(
    store: string,
    index: string,
    key: DbKey | DbKey[],
  ): Promise<DbKey | undefined> {
    return sqlGetKeyFromIndex(this._db, this._plan(store), index, key);
  }

  getAllFromIndex<T>(store: string, index: string, range?: DbKeyRange): Promise<T[]> {
    return sqlGetAllFromIndex<T>(this._db, this._plan(store), index, range);
  }

  iterate<T>(
    store: string,
    options: DbIterateOptions,
    visit: DbCursorVisitor<T>,
  ): Promise<void> {
    // Already inside the enclosing transaction — no nested BEGIN. The
    // transaction's mode governs (so a delete inside a readonly tx rejects)
    // unless the caller overrides it per-scan.
    return sqlIterate(
      this._db,
      this._plan(store),
      { ...options, mode: options.mode ?? this._mode },
      visit,
    );
  }
}

/** Re-exported so the eventual native wrapper can reference the index names. */
export const OP_LOG_INDEX_NAMES = OPS_INDEXES;
