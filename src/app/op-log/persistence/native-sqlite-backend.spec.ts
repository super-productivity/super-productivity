import { IndexedDbOpLogAdapter } from './indexed-db-op-log-adapter';
import { SqliteOpLogAdapter, SqliteDb } from './sqlite-op-log-adapter';
import { createSqlJsDb } from './sql-js-db.test-helper';
import { STORE_NAMES, SINGLETON_KEY } from './db-keys.const';
import {
  bootstrapNativeOpLogBackend,
  createNativeSqliteOpLogAdapterFactory,
  shouldUseNativeSqliteOpLogBackend,
  NATIVE_SQLITE_OP_LOG_FLAG_KEY,
} from './native-sqlite-backend';
import { Log } from '../../core/log';

const ALL_STORES = Object.values(STORE_NAMES);

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
 * pass through — simulating a transient mid-migration failure.
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

/** Add a real promise-chain serializer to a SqliteDb (what CapacitorSqliteDb does). */
const withMutex = (db: SqliteDb): SqliteDb => {
  let chain: Promise<unknown> = Promise.resolve();
  return {
    run: (sql, params) => db.run(sql, params),
    query: (sql, params) => db.query(sql, params),
    runExclusive: <T>(fn: () => Promise<T>): Promise<T> => {
      const result = chain.then(fn, fn);
      chain = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
};

describe('native-sqlite-backend', () => {
  describe('shouldUseNativeSqliteOpLogBackend', () => {
    afterEach(() => localStorage.removeItem(NATIVE_SQLITE_OP_LOG_FLAG_KEY));

    it('is false on a non-native platform regardless of the flag', () => {
      // Karma runs in a browser → IS_NATIVE_PLATFORM is false.
      localStorage.setItem(NATIVE_SQLITE_OP_LOG_FLAG_KEY, 'true');
      expect(shouldUseNativeSqliteOpLogBackend()).toBe(false);
      // Explicit native=false is also false even with the flag set.
      expect(shouldUseNativeSqliteOpLogBackend(false)).toBe(false);
    });

    it('is true only on native AND with the flag set', () => {
      expect(shouldUseNativeSqliteOpLogBackend(true)).toBe(false);
      localStorage.setItem(NATIVE_SQLITE_OP_LOG_FLAG_KEY, 'true');
      expect(shouldUseNativeSqliteOpLogBackend(true)).toBe(true);
    });

    it('stays on IndexedDB if localStorage throws', () => {
      spyOn(localStorage, 'getItem').and.throwError('blocked');
      expect(shouldUseNativeSqliteOpLogBackend(true)).toBe(false);
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

  describe('createNativeSqliteOpLogAdapterFactory (B3)', () => {
    it('vends adapters that share one connection and bootstrap once', async () => {
      let dbCreations = 0;
      const shared = await createSqlJsDb();
      const factory = createNativeSqliteOpLogAdapterFactory(() => {
        dbCreations++;
        return shared;
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
  });
});
