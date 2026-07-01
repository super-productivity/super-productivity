/**
 * Native SQLite op-log backend wiring — B3 (DI flip) + C1 (one-time IDB→SQLite
 * data migration) of the SQLite migration (see
 * docs/sync-and-op-log/sqlite-migration.md).
 *
 * On Android the op-log moves to app-private SQLite to escape WebView IndexedDB
 * eviction (the documented data-loss root cause). The op-log is the app's
 * AUTHORITATIVE store — it is read during boot hydration — so this wiring must
 * never brick startup and never silently serve stale data:
 *
 * - {@link shouldUseNativeSqliteOpLogBackend} gates on a real Capacitor Android
 *   container with the native plugin registered — NOT the legacy online-mode
 *   WebView (which has no SQLite bridge) and not iOS (different WebView storage
 *   semantics; not validated here). web/PWA/Electron never reach this (the
 *   plugin's web build is WASM-on-IndexedDB, which would reintroduce the eviction
 *   risk). No opt-in flag — qualifying Android is on by default, ramped via Play
 *   Console staged rollout.
 * - The factory's `init()` bootstraps SQLite (schema + one-time migration) and,
 *   if that fails in a way we can prove is PRE-migration, transparently falls back
 *   to a self-opening IndexedDB adapter FOR THIS SESSION so the app still boots.
 *   The legacy IDB copy is still complete pre-migration, so the fallback is
 *   lossless. POST-migration (the durable in-SQLite marker is set) it never falls
 *   back — the IDB copy is then a stale snapshot and using it would drop every
 *   op written since the migration. When it cannot prove pre-migration, it fails
 *   loudly rather than risk that loss.
 */
import type { OpLogDbAdapterFactory } from './op-log-db-adapter.token';
import { OpLogDbAdapter } from './op-log-db-adapter';
import { IndexedDbOpLogAdapter } from './indexed-db-op-log-adapter';
import { SqliteDb, SqliteOpLogAdapter } from './sqlite-op-log-adapter';
import { CapacitorSqliteDb } from './capacitor-sqlite-db';
import { NativeOpLogAdapter } from './native-op-log-adapter';
import { migrateOpLogBackend } from './op-log-backend-migration';
import { DB_NAME, STORE_NAMES } from './db-keys.const';
import { Log } from '../../core/log';
// Re-exported so the spec and the dev-only benchmark keep importing the gate from
// here; the DI token imports it from './native-sqlite-gate' directly so it can
// decide synchronously without pulling this heavy module into the eager bundle.
export { shouldUseNativeSqliteOpLogBackend } from './native-sqlite-gate';

// ── C1: one-time IDB → SQLite migration bootstrap ────────────────────────────

/**
 * Tiny key/value table for migration bookkeeping. Deliberately created
 * imperatively here and kept OUT of `OP_LOG_DB_SCHEMA`: it is SQLite-only
 * bookkeeping with no IndexedDB counterpart, so it must never be a store the
 * schema-drift guard expects on IDB nor a table `migrateOpLogBackend` tries to
 * copy (that iterates `STORE_NAMES` only).
 *
 * The `MIGRATION_DONE_KEY` row is the DURABLE source of truth for "SQLite is
 * authoritative". It lives in the same app-private file as the data, so unlike a
 * localStorage flag it cannot be evicted independently of the data it guards.
 */
const META_TABLE = 'sup_op_log_meta';
const MIGRATION_DONE_KEY = 'idb_to_sqlite_migrated_at';

/**
 * Run a raw meta-table statement through the connection serializer when present.
 * The meta statements are bookkeeping outside the op-log schema, so they don't go
 * through the adapter (which is what normally routes ops through `runExclusive`).
 * Wrapping them here keeps the invariant "every statement on the shared
 * connection is serialized" true by construction.
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
    // re-runs cleanly next launch.
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

// ── B3: the DI factory + in-session fallback ─────────────────────────────────

/**
 * After a bootstrap failure we could not recover from, is it SAFE to serve the
 * legacy IndexedDB copy this session? Only when SQLite is NOT yet authoritative
 * (no committed migration) — otherwise the IDB copy is a stale snapshot and using
 * it would silently drop every post-migration op.
 *
 * - If the connection opens, the durable in-SQLite marker is the truth: absent →
 *   pre-migration → safe. A non-empty destination is ALSO authoritative even with
 *   the marker unset — that is the "copy committed but the separate
 *   `markMigrationComplete` write died" window; falling back then could let this
 *   session's IDB writes be lost when the next launch marks SQLite authoritative.
 * - If the connection cannot open (the marker is unreadable), fall back ONLY when
 *   the DB file does not exist (so a migration can never have committed). A
 *   present-but-unopenable file might hold post-migration ops → not safe.
 */
const canFallBackToIdb = async (db: SqliteDb): Promise<boolean> => {
  try {
    await ensureMetaTable(db);
    if (await isMigrationComplete(db)) {
      return false;
    }
    // Marker unset but the dest already holds a (verified) copy → treat as
    // authoritative, not pre-migration. Safe to fall back only when dest is empty.
    return (await new SqliteOpLogAdapter(db).count(STORE_NAMES.OPS)) === 0;
  } catch {
    // Connection is unopenable — the on-disk file is the only signal left.
    const exists = db.databaseExists ? await db.databaseExists() : false;
    return exists === false;
  }
};

export interface NativeSqliteOpLogFactoryOptions {
  /** Test seam — defaults to the real Capacitor-backed connection. */
  dbFactory?: () => SqliteDb;
  /** Test seam — the legacy IndexedDB fallback backend. */
  idbFactory?: () => OpLogDbAdapter;
}

/**
 * Build the ONE shared backend resolver: a memoized `() => Promise<OpLogDbAdapter>`
 * that runs the SQLite bootstrap (schema + C1 migration) and the fallback choice
 * exactly once, then hands the same resolved adapter to every caller. The DI token
 * dynamic-imports this (so the heavy SQLite graph stays out of the web/PWA/Electron
 * bundle) and shares the returned resolver across both stores.
 */
export const createSharedNativeBackendResolver = (
  options: NativeSqliteOpLogFactoryOptions = {},
): (() => Promise<OpLogDbAdapter>) => {
  const dbFactory = options.dbFactory ?? (() => new CapacitorSqliteDb(DB_NAME));
  const idbFactory = options.idbFactory ?? (() => new IndexedDbOpLogAdapter());
  const db = dbFactory();

  let backend: Promise<OpLogDbAdapter> | undefined;
  return (): Promise<OpLogDbAdapter> => {
    if (!backend) {
      backend = bootstrapNativeOpLogBackend(db)
        .then((): OpLogDbAdapter => new SqliteOpLogAdapter(db))
        .catch(async (e) => {
          Log.err({
            id: 'opLogSqliteBootstrapFailed',
            name: e instanceof Error ? e.name : 'unknown',
          });
          if (await canFallBackToIdb(db)) {
            // Pre-migration: the legacy IDB copy is still complete. Serve it this
            // session so the app boots; SQLite is retried on the next launch.
            const idb = idbFactory();
            await idb.init();
            Log.log({ id: 'opLogSqliteFellBackToIdb' });
            return idb;
          }
          // Possibly post-migration: never serve a stale IDB snapshot. Reset so
          // the next init() retries SQLite rather than caching this rejection.
          backend = undefined;
          throw e;
        });
    }
    return backend;
  };
};

/**
 * Build the native `OpLogDbAdapterFactory`. The returned factory hands every
 * caller (OperationLogStoreService, ArchiveStoreService) a {@link NativeOpLogAdapter}
 * over ONE shared backend decision: the bootstrap (schema + C1 migration) and the
 * fallback choice run exactly once regardless of how many adapters init.
 */
export const createNativeSqliteOpLogAdapterFactory = (
  options: NativeSqliteOpLogFactoryOptions = {},
): OpLogDbAdapterFactory => {
  const resolveBackend = createSharedNativeBackendResolver(options);
  return (): OpLogDbAdapter => new NativeOpLogAdapter(resolveBackend);
};
