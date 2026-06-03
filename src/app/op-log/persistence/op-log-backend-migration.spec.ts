import { IndexedDbOpLogAdapter } from './indexed-db-op-log-adapter';
import { SqliteOpLogAdapter } from './sqlite-op-log-adapter';
import { createSqlJsDb } from './sql-js-db.test-helper';
import {
  migrateOpLogBackend,
  OpLogBackendMigrationError,
} from './op-log-backend-migration';
import { OPS_INDEXES, SINGLETON_KEY, STORE_NAMES } from './db-keys.const';
import { DbTxMode, OpLogDbAdapter, OpLogTx } from './op-log-db-adapter';

const ALL_STORES = Object.values(STORE_NAMES);

const makeOpEntry = (
  id: string,
  source: 'local' | 'remote' = 'local',
): Record<string, unknown> => ({
  op: { id },
  appliedAt: 1,
  source,
  syncedAt: undefined,
  applicationStatus: undefined,
});

/**
 * Wrap a dest adapter so its migration transaction silently drops the first OPS
 * write — simulating a partial copy, to prove verify-before-commit rolls back.
 */
const makeLossyDest = (dest: OpLogDbAdapter): OpLogDbAdapter => {
  let dropped = false;
  const wrapTx = (tx: OpLogTx): OpLogTx => ({
    add: (s, v) => tx.add(s, v),
    put: (s, v, k) => {
      if (s === STORE_NAMES.OPS && !dropped) {
        dropped = true;
        return Promise.resolve();
      }
      return tx.put(s, v, k);
    },
    get: (s, k) => tx.get(s, k),
    getAll: (s, r) => tx.getAll(s, r),
    delete: (s, k) => tx.delete(s, k),
    clear: (s) => tx.clear(s),
    getFromIndex: (s, i, k) => tx.getFromIndex(s, i, k),
    getKeyFromIndex: (s, i, k) => tx.getKeyFromIndex(s, i, k),
    getAllFromIndex: (s, i, r) => tx.getAllFromIndex(s, i, r),
    iterate: (s, o, vis) => tx.iterate(s, o, vis),
  });
  return new Proxy(dest, {
    get: (target, prop, recv) => {
      if (prop === 'transaction') {
        return <T>(stores: string[], mode: DbTxMode, fn: (tx: OpLogTx) => Promise<T>) =>
          target.transaction(stores, mode, (tx) => fn(wrapTx(tx)));
      }
      const v = Reflect.get(target, prop, recv);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  }) as OpLogDbAdapter;
};

describe('migrateOpLogBackend (IndexedDB -> SQLite, C1)', () => {
  let src: IndexedDbOpLogAdapter;
  let dest: SqliteOpLogAdapter;

  beforeEach(async () => {
    // Real Chrome IndexedDB (shared SUP_OPS) — isolate from other specs/runs.
    src = new IndexedDbOpLogAdapter();
    await src.init();
    for (const store of ALL_STORES) {
      await src.clear(store);
    }
    dest = new SqliteOpLogAdapter(await createSqlJsDb());
    await dest.init();
  });

  afterEach(async () => {
    for (const store of ALL_STORES) {
      await src.clear(store);
    }
    src.close();
  });

  it('copies every store with op-seq, singleton and vector-clock fidelity', async () => {
    const s1 = await src.add(STORE_NAMES.OPS, makeOpEntry('a'));
    const s2 = await src.add(STORE_NAMES.OPS, makeOpEntry('b'));
    const s3 = await src.add(STORE_NAMES.OPS, makeOpEntry('c'));
    await src.delete(STORE_NAMES.OPS, s2); // leave a gap: seqs are s1, s3
    await src.put(STORE_NAMES.VECTOR_CLOCK, { clientA: 3, clientB: 7 }, SINGLETON_KEY);
    await src.put(STORE_NAMES.CLIENT_ID, { id: 'device-xyz' }, SINGLETON_KEY);
    await src.put(STORE_NAMES.STATE_CACHE, { id: SINGLETON_KEY, state: { tasks: 2 } });
    // archive_young uses an in-line key (keyPath `id`) — no out-of-line key.
    await src.put(STORE_NAMES.ARCHIVE_YOUNG, {
      id: SINGLETON_KEY,
      data: { foo: 1 },
      lastModified: 5,
    });

    const result = await migrateOpLogBackend(src, dest);

    expect(result.copiedCounts[STORE_NAMES.OPS]).toBe(2);
    expect(result.lastSeq).toBe(s3);

    // ops: both the seq values AND the gap are preserved (put, not add).
    const destOps = await dest.getAll<{ op: { id: string }; seq: number }>(
      STORE_NAMES.OPS,
    );
    expect(destOps.map((o) => o.seq).sort((a, b) => a - b)).toEqual([s1, s3]);
    expect(destOps.map((o) => o.op.id).sort()).toEqual(['a', 'c']);
    // the unique byId index is rebuilt on dest and resolves to the right seq.
    expect(
      (await dest.getFromIndex<{ seq: number }>(STORE_NAMES.OPS, OPS_INDEXES.BY_ID, 'c'))
        ?.seq,
    ).toBe(s3);

    expect(await dest.get(STORE_NAMES.VECTOR_CLOCK, SINGLETON_KEY)).toEqual({
      clientA: 3,
      clientB: 7,
    });
    expect(await dest.get(STORE_NAMES.CLIENT_ID, SINGLETON_KEY)).toEqual({
      id: 'device-xyz',
    });
    expect(
      (
        await dest.get<{ state: { tasks: number } }>(
          STORE_NAMES.STATE_CACHE,
          SINGLETON_KEY,
        )
      )?.state.tasks,
    ).toBe(2);
    expect(await dest.get(STORE_NAMES.ARCHIVE_YOUNG, SINGLETON_KEY)).toEqual({
      id: SINGLETON_KEY,
      data: { foo: 1 },
      lastModified: 5,
    });
  });

  it('a new local op after migration continues past the copied high-water seq', async () => {
    await src.add(STORE_NAMES.OPS, makeOpEntry('a'));
    const s2 = await src.add(STORE_NAMES.OPS, makeOpEntry('b'));

    await migrateOpLogBackend(src, dest);

    // AUTOINCREMENT must resume above the migrated seqs, never colliding.
    const next = await dest.add(STORE_NAMES.OPS, makeOpEntry('c'));
    expect(next).toBeGreaterThan(s2);
  });

  it('handles an empty source', async () => {
    const result = await migrateOpLogBackend(src, dest);
    expect(result.copiedCounts[STORE_NAMES.OPS]).toBe(0);
    expect(result.lastSeq).toBe(0);
    expect(await dest.count(STORE_NAMES.OPS)).toBe(0);
  });

  it('refuses to migrate into a non-empty destination', async () => {
    await src.add(STORE_NAMES.OPS, makeOpEntry('a'));
    await dest.add(STORE_NAMES.OPS, makeOpEntry('pre-existing'));
    await expectAsync(migrateOpLogBackend(src, dest)).toBeRejectedWith(
      jasmine.any(OpLogBackendMigrationError),
    );
  });

  it('rolls the destination back when verify-before-commit fails', async () => {
    await src.add(STORE_NAMES.OPS, makeOpEntry('a'));
    await src.add(STORE_NAMES.OPS, makeOpEntry('b'));
    await src.add(STORE_NAMES.OPS, makeOpEntry('c'));

    await expectAsync(migrateOpLogBackend(src, makeLossyDest(dest))).toBeRejectedWith(
      jasmine.any(OpLogBackendMigrationError),
    );
    // The whole copy rolled back — the real dest is left empty.
    expect(await dest.count(STORE_NAMES.OPS)).toBe(0);
  });
});
