import { IndexedDbOpLogAdapter } from './indexed-db-op-log-adapter';
import { SqliteOpLogAdapter, SqliteDb } from './sqlite-op-log-adapter';
import { createSqlJsDb } from './sql-js-db.test-helper';
import { createConnectionSerializer } from './connection-serializer';
import { STORE_NAMES, SINGLETON_KEY } from './db-keys.const';
import {
  bootstrapNativeOpLogBackend,
  createNativeSqliteOpLogAdapterFactory,
  shouldUseNativeSqliteOpLogBackend,
} from './native-sqlite-backend';
import { OpLogDbAdapter } from './op-log-db-adapter';
import { Log } from '../../core/log';

const ALL_STORES = Object.values(STORE_NAMES);

// The in-SQLite migration marker (see native-sqlite-backend META_TABLE). Mirrored
// here so tests can seed/observe the durable "SQLite is authoritative" state.
const META_TABLE = 'sup_op_log_meta';
const MIGRATION_DONE_KEY = 'idb_to_sqlite_migrated_at';

const makeOpEntry = (id: string): Record<string, unknown> => ({
  op: { id },
  appliedAt: 1,
  source: 'local',
  syncedAt: undefined,
  applicationStatus: undefined,
});

/** Count statements a SqliteDb runs, to prove the bootstrap is one-shot. */
const countingDb = (db: SqliteDb): { db: SqliteDb; migrationRuns: () => number } => {
  let migrationMarks = 0;
  const wrapped: SqliteDb = {
    run: (sql, params) => {
      if (/INSERT OR REPLACE INTO sup_op_log_meta/i.test(sql)) {
        migrationMarks++;
      }
      return db.run(sql, params);
    },
    query: (sql, params) => db.query(sql, params),
  };
  return { db: wrapped, migrationRuns: () => migrationMarks };
};

/**
 * Wrap a SqliteDb so the first `run` whose SQL matches `pattern` rejects, then
 * pass through — simulating a transient mid-bootstrap failure.
 */
const failOnceDb = (db: SqliteDb, pattern: RegExp): SqliteDb => {
  let failed = false;
  return {
    run: (sql, params) => {
      if (!failed && pattern.test(sql)) {
        failed = true;
        return Promise.reject(new Error('boom'));
      }
      return db.run(sql, params);
    },
    query: (sql, params) => db.query(sql, params),
  };
};

/** A connection that never opens — every statement rejects, as on a wedged DB. */
const unopenableDb = (fileExists: boolean): SqliteDb => ({
  run: () => Promise.reject(new DOMException('open failed', 'TimeoutError')),
  query: () => Promise.reject(new DOMException('open failed', 'TimeoutError')),
  databaseExists: () => Promise.resolve(fileExists),
});

/** Add the real production serializer to a SqliteDb (what CapacitorSqliteDb does). */
const withMutex = (db: SqliteDb): SqliteDb => ({
  run: (sql, params) => db.run(sql, params),
  query: (sql, params) => db.query(sql, params),
  runExclusive: createConnectionSerializer(),
});

/** Seed the durable in-SQLite "migration complete" marker. */
const seedMigratedMarker = async (db: SqliteDb): Promise<void> => {
  await db.run(
    `CREATE TABLE IF NOT EXISTS ${META_TABLE} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  );
  await db.run(`INSERT OR REPLACE INTO ${META_TABLE} (key, value) VALUES (?, ?)`, [
    MIGRATION_DONE_KEY,
    '2026-01-01T00:00:00.000Z',
  ]);
};

/** A spyable OpLogDbAdapter standing in for the IndexedDB fallback backend. */
const fakeIdbAdapter = (): jasmine.SpyObj<OpLogDbAdapter> => {
  const spy = jasmine.createSpyObj<OpLogDbAdapter>('idbFallback', [
    'init',
    'close',
    'add',
    'put',
    'get',
    'getAll',
    'delete',
    'clear',
    'count',
    'getFromIndex',
    'getKeyFromIndex',
    'getAllFromIndex',
    'countFromIndex',
    'iterate',
    'transaction',
  ]);
  spy.init.and.resolveTo(undefined);
  spy.count.and.resolveTo(0);
  spy.add.and.resolveTo(1);
  return spy;
};

describe('native-sqlite-backend', () => {
  describe('shouldUseNativeSqliteOpLogBackend', () => {
    it('is true on Android', () => {
      expect(shouldUseNativeSqliteOpLogBackend(true)).toBe(true);
    });

    it('is false off Android (web/PWA/Electron/iOS)', () => {
      expect(shouldUseNativeSqliteOpLogBackend(false)).toBe(false);
      // Karma runs in a browser → the real default constant is false.
      expect(shouldUseNativeSqliteOpLogBackend()).toBe(false);
    });
  });

  describe('bootstrapNativeOpLogBackend (C1)', () => {
    let src: IndexedDbOpLogAdapter;

    beforeEach(async () => {
      src = new IndexedDbOpLogAdapter();
      await src.init();
      for (const store of ALL_STORES) {
        await src.clear(store);
      }
    });

    afterEach(async () => {
      for (const store of ALL_STORES) {
        await src.clear(store);
      }
      src.close();
    });

    it('creates the schema and copies legacy IndexedDB ops on first launch', async () => {
      await src.add(STORE_NAMES.OPS, makeOpEntry('a'));
      await src.add(STORE_NAMES.OPS, makeOpEntry('b'));
      await src.put(STORE_NAMES.VECTOR_CLOCK, { clientA: 2 }, SINGLETON_KEY);

      const db = await createSqlJsDb();
      await bootstrapNativeOpLogBackend(db);

      const dest = new SqliteOpLogAdapter(db);
      expect(await dest.count(STORE_NAMES.OPS)).toBe(2);
      expect(await dest.get(STORE_NAMES.VECTOR_CLOCK, SINGLETON_KEY)).toEqual({
        clientA: 2,
      });
    });

    it('is idempotent — a second bootstrap does not re-run the migration', async () => {
      await src.add(STORE_NAMES.OPS, makeOpEntry('a'));

      const { db, migrationRuns } = countingDb(await createSqlJsDb());
      await bootstrapNativeOpLogBackend(db);
      // Add a fresh local op directly on SQLite after the migration "completed".
      const dest = new SqliteOpLogAdapter(db);
      await dest.add(STORE_NAMES.OPS, makeOpEntry('post'));

      await bootstrapNativeOpLogBackend(db);

      // Marker written exactly once; the second pass short-circuits.
      expect(migrationRuns()).toBe(1);
      // The post-migration op survives (no destructive re-copy).
      expect(await dest.count(STORE_NAMES.OPS)).toBe(2);
    });

    it('marks complete without copying when the source is empty', async () => {
      const db = await createSqlJsDb();
      await bootstrapNativeOpLogBackend(db);

      const dest = new SqliteOpLogAdapter(db);
      expect(await dest.count(STORE_NAMES.OPS)).toBe(0);
      // A second pass is a no-op (already marked).
      await bootstrapNativeOpLogBackend(db);
      expect(await dest.count(STORE_NAMES.OPS)).toBe(0);
    });

    it('leaves the marker unset on failure, then migrates cleanly on retry', async () => {
      await src.add(STORE_NAMES.OPS, makeOpEntry('a'));
      await src.add(STORE_NAMES.OPS, makeOpEntry('b'));
      const errSpy = spyOn(Log, 'err');

      const real = await createSqlJsDb();
      // Fail the first op-copy INSERT — the copy+verify is one transaction, so it
      // rolls back, leaving dest empty and the marker unwritten.
      await expectAsync(
        bootstrapNativeOpLogBackend(failOnceDb(real, /INSERT INTO ops/i)),
      ).toBeRejected();
      expect(errSpy).toHaveBeenCalledWith(
        jasmine.objectContaining({ id: 'opLogSqliteMigrationFailed' }),
      );
      const destAfterFail = new SqliteOpLogAdapter(real);
      expect(await destAfterFail.count(STORE_NAMES.OPS)).toBe(0);

      // Retry on the same db succeeds and copies everything.
      await bootstrapNativeOpLogBackend(real);
      expect(await destAfterFail.count(STORE_NAMES.OPS)).toBe(2);
    });

    it('marks done without re-copying a dest populated by a prior unmarked run', async () => {
      // Source has ops, but the dest is already populated and unmarked (the
      // crash-between-copy-and-mark window). Must NOT merge the source on top.
      await src.add(STORE_NAMES.OPS, makeOpEntry('from-source'));
      const db = await createSqlJsDb();
      const dest = new SqliteOpLogAdapter(db);
      await dest.init();
      await dest.add(STORE_NAMES.OPS, makeOpEntry('already-here'));

      const { db: counting, migrationRuns } = countingDb(db);
      await bootstrapNativeOpLogBackend(counting);

      expect(migrationRuns()).toBe(1); // marked done
      const ops = await dest.getAll<{ op: { id: string } }>(STORE_NAMES.OPS);
      expect(ops.map((o) => o.op.id)).toEqual(['already-here']); // no merge
    });

    it('skips the copy when databases() reports no legacy SUP_OPS', async () => {
      await src.add(STORE_NAMES.OPS, makeOpEntry('a'));
      spyOn(indexedDB, 'databases').and.resolveTo([{ name: 'something-else' }]);

      const db = await createSqlJsDb();
      await bootstrapNativeOpLogBackend(db);

      // Marked done without touching the (real) IDB source.
      expect(await new SqliteOpLogAdapter(db).count(STORE_NAMES.OPS)).toBe(0);
    });

    it('still migrates when databases() is unavailable/throws (older WebView)', async () => {
      await src.add(STORE_NAMES.OPS, makeOpEntry('a'));
      spyOn(indexedDB, 'databases').and.throwError('not supported');

      const db = await createSqlJsDb();
      await bootstrapNativeOpLogBackend(db);

      expect(await new SqliteOpLogAdapter(db).count(STORE_NAMES.OPS)).toBe(1);
    });

    it('logs only id + counts on success (no user content)', async () => {
      await src.add(STORE_NAMES.OPS, makeOpEntry('a'));
      const logSpy = spyOn(Log, 'log');

      await bootstrapNativeOpLogBackend(await createSqlJsDb());

      expect(logSpy).toHaveBeenCalledWith({
        id: 'opLogSqliteMigration',
        lastSeq: jasmine.any(Number),
        copiedOps: 1,
      });
    });

    it('runs the full bootstrap through a serialized (runExclusive) connection', async () => {
      // Exercises the meta-table + adapter paths under the real serializer, the
      // way CapacitorSqliteDb drives them on device.
      await src.add(STORE_NAMES.OPS, makeOpEntry('a'));
      const db = withMutex(await createSqlJsDb());

      await bootstrapNativeOpLogBackend(db);
      expect(await new SqliteOpLogAdapter(db).count(STORE_NAMES.OPS)).toBe(1);

      // A second pass short-circuits (marker read serialized too).
      await bootstrapNativeOpLogBackend(db);
      expect(await new SqliteOpLogAdapter(db).count(STORE_NAMES.OPS)).toBe(1);
    });
  });

  describe('createNativeSqliteOpLogAdapterFactory (B3 + in-session fallback)', () => {
    beforeEach(() => {
      // No legacy IDB to copy → bootstrap is schema + meta + mark only, keeping
      // the factory tests deterministic and off real IndexedDB.
      spyOn(indexedDB, 'databases').and.resolveTo([]);
    });

    it('vends adapters that share one connection and bootstrap once', async () => {
      let dbCreations = 0;
      const shared = await createSqlJsDb();
      const factory = createNativeSqliteOpLogAdapterFactory({
        dbFactory: () => {
          dbCreations++;
          return shared;
        },
      });

      const a = factory();
      const b = factory();
      await a.init();
      await b.init();

      // One shared db; a write through one adapter is visible through the other.
      expect(dbCreations).toBe(1);
      await a.add(STORE_NAMES.OPS, makeOpEntry('shared'));
      expect(await b.count(STORE_NAMES.OPS)).toBe(1);
    });

    it('falls back to IndexedDB in-session on a recoverable PRE-migration failure', async () => {
      const logSpy = spyOn(Log, 'log');
      const idb = fakeIdbAdapter();
      // Fail the meta-table create once → bootstrap rejects; the marker is unset,
      // so the fallback check confirms pre-migration and serves IDB this session.
      const db = failOnceDb(
        await createSqlJsDb(),
        /CREATE TABLE IF NOT EXISTS sup_op_log_meta/i,
      );
      const factory = createNativeSqliteOpLogAdapterFactory({
        dbFactory: () => db,
        idbFactory: () => idb,
      });

      const adapter = factory();
      await expectAsync(adapter.init()).toBeResolved();

      expect(idb.init).toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith({ id: 'opLogSqliteFellBackToIdb' });
      // Subsequent ops route to the IDB fallback, not SQLite.
      await adapter.add(STORE_NAMES.OPS, makeOpEntry('x'));
      expect(idb.add).toHaveBeenCalled();
    });

    it('falls back when the connection is unopenable AND no DB file exists', async () => {
      const idb = fakeIdbAdapter();
      const factory = createNativeSqliteOpLogAdapterFactory({
        dbFactory: () => unopenableDb(false),
        idbFactory: () => idb,
      });

      await expectAsync(factory().init()).toBeResolved();
      expect(idb.init).toHaveBeenCalled();
    });

    it('fails loudly (never serves stale IDB) when the marker is already set', async () => {
      const idb = fakeIdbAdapter();
      const real = await createSqlJsDb();
      await seedMigratedMarker(real);
      // Marker present = SQLite authoritative. Force a failure that bypasses the
      // short-circuit (fail the ops DDL) so the catch path is exercised.
      const db = failOnceDb(real, /CREATE TABLE IF NOT EXISTS ops/i);
      const factory = createNativeSqliteOpLogAdapterFactory({
        dbFactory: () => db,
        idbFactory: () => idb,
      });

      await expectAsync(factory().init()).toBeRejected();
      expect(idb.init).not.toHaveBeenCalled();
    });

    it('fails loudly when a verified copy is already committed but the marker write died', async () => {
      // copy committed (dest has ops) but `markMigrationComplete` then failed →
      // marker unset. Must NOT fall back: this session's IDB writes would be lost
      // when the next launch marks the (already-populated) SQLite authoritative.
      const idb = fakeIdbAdapter();
      const real = await createSqlJsDb();
      const seededDest = new SqliteOpLogAdapter(real);
      await seededDest.init();
      await seededDest.add(STORE_NAMES.OPS, makeOpEntry('committed'));
      // Fail the marker write → bootstrap rejects after the dest is already populated.
      const db = failOnceDb(real, /INSERT OR REPLACE INTO sup_op_log_meta/i);
      const factory = createNativeSqliteOpLogAdapterFactory({
        dbFactory: () => db,
        idbFactory: () => idb,
      });

      await expectAsync(factory().init()).toBeRejected();
      expect(idb.init).not.toHaveBeenCalled();
    });

    it('fails loudly when the connection is unopenable BUT a DB file exists', async () => {
      // A present-but-unopenable file might hold post-migration ops, so falling
      // back to the stale IDB copy would lose them — reject instead.
      const idb = fakeIdbAdapter();
      const factory = createNativeSqliteOpLogAdapterFactory({
        dbFactory: () => unopenableDb(true),
        idbFactory: () => idb,
      });

      await expectAsync(factory().init()).toBeRejected();
      expect(idb.init).not.toHaveBeenCalled();
    });

    it('retries the bootstrap after a non-recoverable failure (no cached rejection)', async () => {
      const idb = fakeIdbAdapter();
      const real = await createSqlJsDb();
      await seedMigratedMarker(real);
      const db = failOnceDb(real, /CREATE TABLE IF NOT EXISTS ops/i);
      const factory = createNativeSqliteOpLogAdapterFactory({
        dbFactory: () => db,
        idbFactory: () => idb,
      });

      // First init fails (ops DDL rejected once, marker present → no fallback).
      await expectAsync(factory().init()).toBeRejected();
      // Second init re-runs bootstrap (failOnce is spent) → SQLite succeeds.
      await expectAsync(factory().init()).toBeResolved();
      expect(idb.init).not.toHaveBeenCalled();
    });
  });
});
