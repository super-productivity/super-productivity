import { openDB } from 'idb';
import { OP_LOG_DB_SCHEMA } from './op-log-db-schema';
import { runDbUpgrade } from './db-upgrade';
import { DB_NAME, DB_VERSION } from './db-keys.const';
import { planTables } from './sqlite-op-log-adapter';

/**
 * Drift guard for the declarative {@link OP_LOG_DB_SCHEMA} descriptor.
 *
 * The descriptor is NOT yet used to create stores — `runDbUpgrade` (imperative)
 * still does that — yet the SQLite backend (Phase B) will be built against the
 * descriptor. So the descriptor must stay byte-for-byte faithful to what
 * `runDbUpgrade` actually produces. These tests fail loudly the moment the two
 * (or the `db-keys.const` version) diverge.
 */
describe('OP_LOG_DB_SCHEMA', () => {
  it('reuses DB_NAME/DB_VERSION (no third source of truth)', () => {
    expect(OP_LOG_DB_SCHEMA.name).toBe(DB_NAME);
    expect(OP_LOG_DB_SCHEMA.version).toBe(DB_VERSION);
  });

  it('matches the stores and indexes runDbUpgrade actually creates', async () => {
    const db = await openDB(OP_LOG_DB_SCHEMA.name, OP_LOG_DB_SCHEMA.version, {
      upgrade: (d, oldVersion, _newVersion, transaction) =>
        runDbUpgrade(d, oldVersion, transaction),
    });

    try {
      // Same set of object stores.
      expect(Array.from(db.objectStoreNames).sort()).toEqual(
        OP_LOG_DB_SCHEMA.stores.map((s) => s.name).sort(),
      );

      const tx = db.transaction(
        Array.from(db.objectStoreNames) as unknown as string[],
        'readonly',
      );

      for (const declared of OP_LOG_DB_SCHEMA.stores) {
        const store = tx.objectStore(declared.name);

        // keyPath: IndexedDB reports `null` for keyless (singleton) stores,
        // which the descriptor models as an omitted `keyPath`.
        const actualKeyPath = store.keyPath === null ? undefined : store.keyPath;
        expect(actualKeyPath)
          .withContext(`${declared.name}.keyPath`)
          .toEqual(declared.keyPath);

        expect(store.autoIncrement)
          .withContext(`${declared.name}.autoIncrement`)
          .toBe(!!declared.autoIncrement);

        const declaredIndexes = declared.indexes ?? [];
        expect(Array.from(store.indexNames).sort())
          .withContext(`${declared.name} index names`)
          .toEqual(declaredIndexes.map((i) => i.name).sort());

        for (const idx of declaredIndexes) {
          const index = store.index(idx.name);
          expect(index.keyPath)
            .withContext(`${declared.name}.${idx.name}.keyPath`)
            .toEqual(idx.keyPath);
          expect(index.unique)
            .withContext(`${declared.name}.${idx.name}.unique`)
            .toBe(!!idx.unique);
        }
      }

      await tx.done;
    } finally {
      db.close();
    }
  });
});

/**
 * Drift guard for the SQLite side of the descriptor. `planTables` derives the
 * physical SQLite table/index plan from {@link OP_LOG_DB_SCHEMA} by resolving
 * each index keyPath through `INDEX_COLUMN_BY_PATH`. A keyPath missing from that
 * map is dropped SILENTLY — `planTable` skips the unknown column with no error,
 * and a compound index can end up partially built or absent entirely. On Android
 * that turns an index query into a full scan or, worse, returns wrong rows →
 * silent sync divergence, invisible to CI (which only exercises the IndexedDB /
 * sql.js path). Fail loudly here instead: every declared index must resolve to a
 * full set of backing SQLite columns.
 */
describe('OP_LOG_DB_SCHEMA → SQLite plan', () => {
  it('backs every declared index with a SQLite column (no silent drop)', () => {
    const planByStore = new Map(planTables(OP_LOG_DB_SCHEMA).map((p) => [p.table, p]));

    for (const store of OP_LOG_DB_SCHEMA.stores) {
      const plan = planByStore.get(store.name);
      expect(plan).withContext(`no SQLite plan for store '${store.name}'`).toBeDefined();

      for (const idx of store.indexes ?? []) {
        const planned = plan!.indexes.find((i) => i.name === idx.name);
        expect(planned)
          .withContext(
            `index '${idx.name}' on '${store.name}' is silently dropped from SQLite ` +
              `(add its keyPath to INDEX_COLUMN_BY_PATH in sqlite-op-log-adapter.ts)`,
          )
          .toBeDefined();

        const keyPathCount = Array.isArray(idx.keyPath) ? idx.keyPath.length : 1;
        expect(planned!.columns.length)
          .withContext(
            `index '${idx.name}' on '${store.name}' is missing backing columns ` +
              `(${planned ? planned.columns.length : 0}/${keyPathCount} keyPaths mapped ` +
              `in INDEX_COLUMN_BY_PATH)`,
          )
          .toBe(keyPathCount);
      }
    }
  });
});
