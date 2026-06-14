/**
 * Native SQLite op-log backend wiring — B3 (DI flip) + C1 (one-time IDB→SQLite
 * data migration) of the SQLite migration (see
 * docs/sync-and-op-log/sqlite-migration.md).
 *
 * Everything here is gated behind {@link shouldUseNativeSqliteOpLogBackend} and
 * defaults OFF: on web/PWA/Electron, and on native until the feature flag is
 * flipped, the op-log stays on IndexedDB exactly as before. This module is dead
 * in production until a native build sets the flag, so it ships risk-free.
 *
 * Shape: the DI token vends one {@link OpLogDbAdapterFactory} per app. For the
 * native backend that factory closes over a SINGLE {@link CapacitorSqliteDb} (one
 * SQLite file, all tables) and hands every service its own adapter over that one
 * connection — mirroring how the IndexedDB services share one `SUP_OPS`
 * connection today. The first adapter `init()` triggers a one-time bootstrap:
 * create the schema, then (C1) copy any legacy `SUP_OPS` IndexedDB data across
 * with verify-before-commit, leaving the IDB copy untouched as a fallback.
 */
import type { OpLogDbAdapterFactory } from './op-log-db-adapter.token';
import { OpLogDbAdapter } from './op-log-db-adapter';
import { IndexedDbOpLogAdapter } from './indexed-db-op-log-adapter';
import { SqliteDb, SqliteOpLogAdapter } from './sqlite-op-log-adapter';
import { CapacitorSqliteDb } from './capacitor-sqlite-db';
import { migrateOpLogBackend } from './op-log-backend-migration';
import { DB_NAME, STORE_NAMES } from './db-keys.const';
import { IS_NATIVE_PLATFORM } from '../../util/is-native-platform';
import { Log } from '../../core/log';

/**
 * localStorage flag that opts a native build into the SQLite op-log backend.
 * Set `localStorage.setItem('SUP_USE_NATIVE_SQLITE_OP_LOG', 'true')` and restart.
 * Defaults off — staged dogfood rollout per docs/sync-and-op-log/sqlite-migration.md.
 */
export const NATIVE_SQLITE_OP_LOG_FLAG_KEY = 'SUP_USE_NATIVE_SQLITE_OP_LOG';

/**
 * Whether to bind the op-log persistence backend to SQLite. ONLY true on native
 * (the plugin's web build is WASM-on-IndexedDB and would reintroduce the
 * eviction risk) AND only when the opt-in flag is set.
 *
 * @param isNative test seam — defaults to the real platform constant. Karma runs
 * in a browser (`IS_NATIVE_PLATFORM === false`), so the native branch is only
 * reachable in tests by passing `true`.
 */
export const shouldUseNativeSqliteOpLogBackend = (
  isNative: boolean = IS_NATIVE_PLATFORM,
): boolean => {
  if (!isNative) {
    return false;
  }
  try {
    return localStorage.getItem(NATIVE_SQLITE_OP_LOG_FLAG_KEY) === 'true';
  } catch {
    // No localStorage (shouldn't happen on native WebView) → stay on IndexedDB.
    return false;
  }
};

// ── C1: one-time IDB → SQLite migration bootstrap ────────────────────────────

/**
 * Tiny key/value table for migration bookkeeping. Deliberately created
 * imperatively here and kept OUT of `OP_LOG_DB_SCHEMA`: it is SQLite-only
 * bookkeeping with no IndexedDB counterpart, so it must never be a store the
 * schema-drift guard expects on IDB nor a table `migrateOpLogBackend` tries to
 * copy (that iterates `STORE_NAMES` only).
 */
const META_TABLE = 'sup_op_log_meta';
const MIGRATION_DONE_KEY = 'idb_to_sqlite_migrated_at';

/**
 * Run a raw meta-table statement through the connection serializer when present.
 * The meta statements are bookkeeping outside the op-log schema, so they don't go
 * through the adapter (which is what normally routes ops through `runExclusive`).
 * Wrapping them here keeps the invariant "every statement on the shared
 * connection is serialized" true by construction — not merely by the bootstrap's
 * sequential awaiting — so it stays safe if concurrency is ever added around it.
 */
const metaExclusive = <T>(db: SqliteDb, fn: () => Promise<T>): Promise<T> =>
  db.runExclusive ? db.runExclusive(fn) : fn();

const ensureMetaTable = (db: SqliteDb): Promise<unknown> =>
  metaExclusive(db, () =>
    db.run(
      `CREATE TABLE IF NOT EXISTS ${META_TABLE} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    ),
  );

const isMigrationComplete = (db: SqliteDb): Promise<boolean> =>
  metaExclusive(db, async () => {
    const rows = await db.query(`SELECT value FROM ${META_TABLE} WHERE key = ?`, [
      MIGRATION_DONE_KEY,
    ]);
    return rows.length > 0;
  });

const markMigrationComplete = (db: SqliteDb): Promise<unknown> =>
  metaExclusive(db, () =>
    db.run(`INSERT OR REPLACE INTO ${META_TABLE} (key, value) VALUES (?, ?)`, [
      MIGRATION_DONE_KEY,
      new Date().toISOString(),
    ]),
  );

/**
 * Best-effort check for a legacy `SUP_OPS` IndexedDB so we don't materialise an
 * empty one when there is nothing to migrate. When `indexedDB.databases()` is
 * unavailable (older WebViews) we return `true` and let
 * {@link migrateOpLogBackend} no-op over an empty source.
 */
const legacyIdbSupOpsMayExist = async (): Promise<boolean> => {
  try {
    const idb = indexedDB as IDBFactory & {
      databases?: () => Promise<{ name?: string }[]>;
    };
    if (typeof idb.databases === 'function') {
      const dbs = await idb.databases();
      return dbs.some((d) => d.name === DB_NAME);
    }
  } catch {
    // Fall through — treat as "might exist".
  }
  return true;
};

/**
 * Create the SQLite schema and, on first launch only, copy the legacy `SUP_OPS`
 * IndexedDB into it. Idempotent: the meta marker (and a non-empty destination)
 * short-circuit subsequent launches. A failed/aborted migration leaves the
 * marker unset so it is retried next launch; verify-before-commit keeps a
 * partial copy from ever committing.
 */
export const bootstrapNativeOpLogBackend = async (db: SqliteDb): Promise<void> => {
  const dest = new SqliteOpLogAdapter(db);
  await dest.init();
  await ensureMetaTable(db);

  if (await isMigrationComplete(db)) {
    return;
  }
  // A non-empty destination means a prior copy committed but the process died
  // BEFORE `markMigrationComplete` (the copy + verify is one atomic transaction;
  // the marker write is the separate step right after). The data is already
  // here and verified — never merge on top (would risk seq/clock corruption);
  // just finish marking it done.
  if ((await dest.count(STORE_NAMES.OPS)) > 0) {
    await markMigrationComplete(db);
    return;
  }
  if (!(await legacyIdbSupOpsMayExist())) {
    await markMigrationComplete(db);
    return;
  }

  const source = new IndexedDbOpLogAdapter();
  try {
    const result = await migrateOpLogBackend(source, dest);
    Log.log({
      id: 'opLogSqliteMigration',
      lastSeq: result.lastSeq,
      copiedOps: result.copiedCounts[STORE_NAMES.OPS] ?? 0,
    });
  } catch (e) {
    // Privacy-safe breadcrumb only (log history is exportable): the error NAME,
    // never its message (a raw SQLite/DOMException message could echo a value).
    // verify-before-commit already rolled `dest` back, so the caller's retry
    // (ensureBootstrap resets on reject) re-runs cleanly next launch.
    Log.err({
      id: 'opLogSqliteMigrationFailed',
      name: e instanceof Error ? e.name : 'unknown',
    });
    throw e;
  } finally {
    source.close();
  }
  // The legacy IDB copy is intentionally left untouched as a >= 1-release
  // fallback (Track C2 removes it once SQLite is the sole native backend).
  await markMigrationComplete(db);
};

// ── B3: the DI factory ───────────────────────────────────────────────────────

/**
 * A {@link SqliteOpLogAdapter} whose `init()` runs the shared one-time backend
 * bootstrap (schema + C1 migration) instead of the bare DDL. Every other method
 * is inherited and runs against the shared connection.
 */
class BootstrappingSqliteOpLogAdapter extends SqliteOpLogAdapter {
  constructor(
    db: SqliteDb,
    private readonly _ensureBootstrap: () => Promise<void>,
  ) {
    super(db);
  }

  override init(): Promise<void> {
    return this._ensureBootstrap();
  }
}

/**
 * Build the native `OpLogDbAdapterFactory`. The returned factory hands every
 * caller (OperationLogStoreService, ArchiveStoreService) its own adapter over
 * ONE shared {@link SqliteDb}, and the bootstrap (schema + C1 migration) runs
 * exactly once regardless of how many adapters init.
 *
 * @param dbFactory test seam — defaults to the real Capacitor-backed connection.
 */
export const createNativeSqliteOpLogAdapterFactory = (
  dbFactory: () => SqliteDb = () => new CapacitorSqliteDb(DB_NAME),
): OpLogDbAdapterFactory => {
  const db = dbFactory();
  let bootstrap: Promise<void> | undefined;
  const ensureBootstrap = (): Promise<void> => {
    if (!bootstrap) {
      bootstrap = bootstrapNativeOpLogBackend(db).catch((e) => {
        // Reset so the next init() retries rather than caching the rejection.
        bootstrap = undefined;
        throw e;
      });
    }
    return bootstrap;
  };
  return (): OpLogDbAdapter => new BootstrappingSqliteOpLogAdapter(db, ensureBootstrap);
};
