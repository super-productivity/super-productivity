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

describe('native-sqlite-backend', () => {
  describe('shouldUseNativeSqliteOpLogBackend', () => {
    afterEach(() => localStorage.removeItem(NATIVE_SQLITE_OP_LOG_FLAG_KEY));

    it('is false on a non-native platform regardless of the flag', () => {
      // Karma runs in a browser → IS_NATIVE_PLATFORM is false.
      localStorage.setItem(NATIVE_SQLITE_OP_LOG_FLAG_KEY, 'true');
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
