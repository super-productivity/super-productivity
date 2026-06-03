import { openDB } from 'idb';
import { OP_LOG_DB_SCHEMA } from './op-log-db-schema';
import { runDbUpgrade } from './db-upgrade';
import { DB_NAME, DB_VERSION } from './db-keys.const';

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
