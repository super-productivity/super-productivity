import 'fake-indexeddb/auto';
import { fakeAsync, tick } from '@angular/core/testing';
import { IDBPDatabase, openDB } from 'idb';
import { IndexedDbOpLogAdapter } from './indexed-db-op-log-adapter';
import { OP_LOG_DB_SCHEMA } from './op-log-db-schema';
import { STORE_NAMES, OPS_INDEXES, SINGLETON_KEY } from './db-keys.const';
import { runDbUpgrade } from './db-upgrade';
import {
  IDB_OPEN_RETRIES,
  IDB_OPEN_RETRIES_NON_LOCK,
  IDB_OPEN_RETRY_BASE_DELAY_MS,
} from '../core/operation-log.const';
import { IndexedDBOpenError } from '../core/errors/indexed-db-open.error';

/**
 * Verifies IndexedDbOpLogAdapter against a real (faked) IndexedDB: CRUD,
 * indexes/ranges, cursor iteration semantics, and — most importantly —
 * transaction atomicity (commit on resolve, roll back on throw), which is the
 * load-bearing guarantee both backends must share.
 */
describe('IndexedDbOpLogAdapter', () => {
  let adapter: IndexedDbOpLogAdapter;

  const makeOpEntry = (
    id: string,
    source: 'local' | 'remote',
    applicationStatus?: 'pending' | 'applied' | 'failed',
    syncedAt?: number,
  ): Record<string, unknown> => ({
    op: { id },
    appliedAt: Date.now(),
    source,
    syncedAt,
    applicationStatus,
  });

  beforeEach(async () => {
    adapter = new IndexedDbOpLogAdapter();
    await adapter.init();
  });

  afterEach(async () => {
    adapter.close();
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase(OP_LOG_DB_SCHEMA.name);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      req.onblocked = () => resolve();
    });
  });

  it('add() auto-increments seq and get() round-trips by key', async () => {
    const seq1 = await adapter.add(STORE_NAMES.OPS, makeOpEntry('a', 'local'));
    const seq2 = await adapter.add(STORE_NAMES.OPS, makeOpEntry('b', 'local'));
    expect(seq2).toBe(seq1 + 1);

    const got = await adapter.get<{ op: { id: string } }>(STORE_NAMES.OPS, seq1);
    expect(got?.op.id).toBe('a');
  });

  it('put()/get() works for keyless singleton stores (explicit out-of-line key)', async () => {
    await adapter.put(
      STORE_NAMES.VECTOR_CLOCK,
      { clock: { client1: 3 }, lastUpdate: 1 },
      SINGLETON_KEY,
    );
    const vc = await adapter.get<{ clock: Record<string, number> }>(
      STORE_NAMES.VECTOR_CLOCK,
      SINGLETON_KEY,
    );
    expect(vc?.clock['client1']).toBe(3);
  });

  it('enforces the unique byId index (duplicate op.id rejects)', async () => {
    await adapter.add(STORE_NAMES.OPS, makeOpEntry('dup', 'local'));
    await expectAsync(
      adapter.add(STORE_NAMES.OPS, makeOpEntry('dup', 'local')),
    ).toBeRejected();
  });

  it('getFromIndex(byId) finds the entry regardless of seq', async () => {
    await adapter.add(STORE_NAMES.OPS, makeOpEntry('x', 'local'));
    const entry = await adapter.getFromIndex<{ op: { id: string } }>(
      STORE_NAMES.OPS,
      OPS_INDEXES.BY_ID,
      'x',
    );
    expect(entry?.op.id).toBe('x');
  });

  it('getAllFromIndex with a lowerBound range filters by seq', async () => {
    const s1 = await adapter.add(
      STORE_NAMES.OPS,
      makeOpEntry('a', 'local', undefined, 10),
    );
    await adapter.add(STORE_NAMES.OPS, makeOpEntry('b', 'local', undefined, 20));
    // bySyncedAt index, only entries with syncedAt > s1's value
    const res = await adapter.getAllFromIndex<{ op: { id: string } }>(
      STORE_NAMES.OPS,
      OPS_INDEXES.BY_SYNCED_AT,
      { lower: 10, lowerOpen: true },
    );
    expect(res.map((r) => r.op.id)).toEqual(['b']);
    expect(s1).toBeGreaterThan(0);
  });

  it('iterate(prev) visits in descending key order and exposes the primary key', async () => {
    const s1 = await adapter.add(STORE_NAMES.OPS, makeOpEntry('a', 'local'));
    await adapter.add(STORE_NAMES.OPS, makeOpEntry('b', 'local'));
    const s3 = await adapter.add(STORE_NAMES.OPS, makeOpEntry('c', 'local'));

    const visited: Array<{ id: string; key: number }> = [];
    await adapter.iterate<{ op: { id: string } }>(
      STORE_NAMES.OPS,
      { direction: 'prev' },
      (v, key) => {
        visited.push({ id: v.op.id, key: key as number });
        return 'continue';
      },
    );
    // Full descending walk proves continue() advances in 'prev' order, and the
    // exposed primary key matches the auto-increment seq (the getLastSeq use).
    expect(visited.map((x) => x.id)).toEqual(['c', 'b', 'a']);
    expect(visited[0].key).toBe(s3);
    expect(visited[2].key).toBe(s1);
  });

  it('iterate(prev) stop returns only the latest entry', async () => {
    await adapter.add(STORE_NAMES.OPS, makeOpEntry('a', 'local'));
    await adapter.add(STORE_NAMES.OPS, makeOpEntry('c', 'local'));
    const visited: string[] = [];
    await adapter.iterate<{ op: { id: string } }>(
      STORE_NAMES.OPS,
      { direction: 'prev' },
      (v) => {
        visited.push(v.op.id);
        return 'stop';
      },
    );
    expect(visited).toEqual(['c']);
  });

  it("iterate with 'delete' prunes matching entries and keeps going", async () => {
    await adapter.add(STORE_NAMES.OPS, makeOpEntry('keep1', 'local'));
    await adapter.add(STORE_NAMES.OPS, makeOpEntry('drop', 'remote'));
    await adapter.add(STORE_NAMES.OPS, makeOpEntry('keep2', 'local'));

    await adapter.iterate<{ op: { id: string }; source: string }>(
      STORE_NAMES.OPS,
      {},
      (v) => (v.source === 'remote' ? 'delete' : 'continue'),
    );

    const remaining = await adapter.getAll<{ op: { id: string } }>(STORE_NAMES.OPS);
    expect(remaining.map((r) => r.op.id).sort()).toEqual(['keep1', 'keep2']);
  });

  it("iterate 'delete-stop' deletes exactly one entry then stops", async () => {
    await adapter.add(STORE_NAMES.OPS, makeOpEntry('first', 'remote'));
    await adapter.add(STORE_NAMES.OPS, makeOpEntry('second', 'remote'));

    let visitCount = 0;
    await adapter.iterate<{ op: { id: string } }>(STORE_NAMES.OPS, {}, () => {
      visitCount++;
      return 'delete-stop';
    });

    expect(visitCount).toBe(1);
    const remaining = await adapter.getAll<{ op: { id: string } }>(STORE_NAMES.OPS);
    expect(remaining.map((r) => r.op.id)).toEqual(['second']);
  });

  it('iterate over an index positioned at an exact key deletes that entry', async () => {
    await adapter.add(STORE_NAMES.OPS, makeOpEntry('alpha', 'local'));
    await adapter.add(STORE_NAMES.OPS, makeOpEntry('beta', 'local'));

    // Mirrors clearFullStateOpsExcept: open the byId index at a specific id.
    const seen: string[] = [];
    await adapter.iterate<{ op: { id: string } }>(
      STORE_NAMES.OPS,
      { index: OPS_INDEXES.BY_ID, query: 'beta' },
      (v) => {
        seen.push(v.op.id);
        return 'delete-stop';
      },
    );

    expect(seen).toEqual(['beta']); // query restricted the walk to the match
    const remaining = await adapter.getAll<{ op: { id: string } }>(STORE_NAMES.OPS);
    expect(remaining.map((r) => r.op.id)).toEqual(['alpha']);
  });

  it('iterate(mode:readonly) performs a pure read scan', async () => {
    await adapter.add(STORE_NAMES.OPS, makeOpEntry('a', 'local'));
    await adapter.add(STORE_NAMES.OPS, makeOpEntry('b', 'local'));
    const ids: string[] = [];
    await adapter.iterate<{ op: { id: string } }>(
      STORE_NAMES.OPS,
      { mode: 'readonly' },
      (v) => {
        ids.push(v.op.id);
        return 'continue';
      },
    );
    expect(ids.sort()).toEqual(['a', 'b']);
  });

  it('rejects a delete action under a readonly scan', async () => {
    await adapter.add(STORE_NAMES.OPS, makeOpEntry('x', 'local'));
    // A readonly tx must not permit cursor.delete() — surfaces ReadOnlyError
    // rather than silently mutating, so a misuse fails loudly.
    await expectAsync(
      adapter.iterate(STORE_NAMES.OPS, { mode: 'readonly' }, () => 'delete'),
    ).toBeRejected();
  });

  it('getKeyFromIndex returns the primary key for a unique index hit (and undefined on miss)', async () => {
    const seq = await adapter.add(STORE_NAMES.OPS, makeOpEntry('probe', 'local'));
    const key = await adapter.getKeyFromIndex(
      STORE_NAMES.OPS,
      OPS_INDEXES.BY_ID,
      'probe',
    );
    expect(key).toBe(seq);
    const miss = await adapter.getKeyFromIndex(
      STORE_NAMES.OPS,
      OPS_INDEXES.BY_ID,
      'nope',
    );
    expect(miss).toBeUndefined();
  });

  it('getAll with a primary-key range filters by seq (getOpsAfterSeq pattern)', async () => {
    const s1 = await adapter.add(STORE_NAMES.OPS, makeOpEntry('a', 'local'));
    await adapter.add(STORE_NAMES.OPS, makeOpEntry('b', 'local'));
    await adapter.add(STORE_NAMES.OPS, makeOpEntry('c', 'local'));

    const after = await adapter.getAll<{ op: { id: string } }>(STORE_NAMES.OPS, {
      lower: s1,
      lowerOpen: true,
    });
    expect(after.map((r) => r.op.id)).toEqual(['b', 'c']);
  });

  it('count reflects a primary-key range', async () => {
    await adapter.add(STORE_NAMES.OPS, makeOpEntry('a', 'local'));
    const s2 = await adapter.add(STORE_NAMES.OPS, makeOpEntry('b', 'local'));
    await adapter.add(STORE_NAMES.OPS, makeOpEntry('c', 'local'));
    expect(await adapter.count(STORE_NAMES.OPS)).toBe(3);
    expect(await adapter.count(STORE_NAMES.OPS, { lower: s2 })).toBe(2);
  });

  it('getAllFromIndex matches a compound-index exact key (bySourceAndStatus)', async () => {
    await adapter.add(STORE_NAMES.OPS, makeOpEntry('p1', 'remote', 'pending'));
    await adapter.add(STORE_NAMES.OPS, makeOpEntry('a1', 'remote', 'applied'));
    await adapter.add(STORE_NAMES.OPS, makeOpEntry('p2', 'remote', 'pending'));

    // Exact compound-key match expressed as a degenerate [k, k] range.
    const pending = await adapter.getAllFromIndex<{ op: { id: string } }>(
      STORE_NAMES.OPS,
      OPS_INDEXES.BY_SOURCE_AND_STATUS,
      { lower: ['remote', 'pending'], upper: ['remote', 'pending'] },
    );
    expect(pending.map((r) => r.op.id).sort()).toEqual(['p1', 'p2']);
  });

  it('delete() and clear() remove entries', async () => {
    const seq = await adapter.add(STORE_NAMES.OPS, makeOpEntry('x', 'local'));
    await adapter.add(STORE_NAMES.OPS, makeOpEntry('y', 'local'));
    await adapter.delete(STORE_NAMES.OPS, seq);
    expect((await adapter.getAll(STORE_NAMES.OPS)).length).toBe(1);
    await adapter.clear(STORE_NAMES.OPS);
    expect((await adapter.getAll(STORE_NAMES.OPS)).length).toBe(0);
  });

  it('get() / getFromIndex() return undefined for a miss', async () => {
    expect(await adapter.get(STORE_NAMES.OPS, 999)).toBeUndefined();
    expect(
      await adapter.getFromIndex(STORE_NAMES.OPS, OPS_INDEXES.BY_ID, 'absent'),
    ).toBeUndefined();
  });

  describe('transaction()', () => {
    it('commits a multi-store write atomically with the exact values written', async () => {
      await adapter.transaction(
        [STORE_NAMES.OPS, STORE_NAMES.VECTOR_CLOCK],
        'readwrite',
        async (tx) => {
          await tx.add(STORE_NAMES.OPS, makeOpEntry('tx', 'local'));
          await tx.put(
            STORE_NAMES.VECTOR_CLOCK,
            { clock: { c: 1 }, lastUpdate: 1 },
            SINGLETON_KEY,
          );
        },
      );

      const op = await adapter.getFromIndex<{ op: { id: string } }>(
        STORE_NAMES.OPS,
        OPS_INDEXES.BY_ID,
        'tx',
      );
      const vc = await adapter.get<{ clock: Record<string, number> }>(
        STORE_NAMES.VECTOR_CLOCK,
        SINGLETON_KEY,
      );
      expect(op?.op.id).toBe('tx');
      expect(vc?.clock['c']).toBe(1);
    });

    it('rolls back an add + put when the body throws (no partial commit)', async () => {
      await adapter.put(
        STORE_NAMES.VECTOR_CLOCK,
        { clock: { seed: 9 }, lastUpdate: 0 },
        SINGLETON_KEY,
      );

      await expectAsync(
        adapter.transaction(
          [STORE_NAMES.OPS, STORE_NAMES.VECTOR_CLOCK],
          'readwrite',
          async (tx) => {
            await tx.add(STORE_NAMES.OPS, makeOpEntry('shouldVanish', 'local'));
            await tx.put(
              STORE_NAMES.VECTOR_CLOCK,
              { clock: { changed: 1 }, lastUpdate: 1 },
              SINGLETON_KEY,
            );
            throw new Error('boom');
          },
        ),
      ).toBeRejectedWithError('boom');

      const op = await adapter.getFromIndex(
        STORE_NAMES.OPS,
        OPS_INDEXES.BY_ID,
        'shouldVanish',
      );
      expect(op).toBeUndefined();
      const vc = await adapter.get<{ clock: Record<string, number> }>(
        STORE_NAMES.VECTOR_CLOCK,
        SINGLETON_KEY,
      );
      expect(vc?.clock['seed']).toBe(9);
    });

    it('rolls back a destructive clear() + delete() on throw (runDestructiveStateReplacement shape)', async () => {
      // Seed data that the aborted transaction will try to wipe.
      await adapter.add(STORE_NAMES.OPS, makeOpEntry('survivor1', 'local'));
      await adapter.add(STORE_NAMES.OPS, makeOpEntry('survivor2', 'local'));
      await adapter.put(
        STORE_NAMES.VECTOR_CLOCK,
        { clock: { keep: 7 }, lastUpdate: 0 },
        SINGLETON_KEY,
      );

      await expectAsync(
        adapter.transaction(
          [STORE_NAMES.OPS, STORE_NAMES.VECTOR_CLOCK],
          'readwrite',
          async (tx) => {
            await tx.clear(STORE_NAMES.OPS); // destructive: wipe the log
            await tx.delete(STORE_NAMES.VECTOR_CLOCK, SINGLETON_KEY);
            await tx.add(STORE_NAMES.OPS, makeOpEntry('newBaseline', 'local'));
            throw new Error('interrupted');
          },
        ),
      ).toBeRejectedWithError('interrupted');

      // Everything must be exactly as seeded — clear AND delete rolled back.
      const ops = await adapter.getAll<{ op: { id: string } }>(STORE_NAMES.OPS);
      expect(ops.map((o) => o.op.id).sort()).toEqual(['survivor1', 'survivor2']);
      const vc = await adapter.get<{ clock: Record<string, number> }>(
        STORE_NAMES.VECTOR_CLOCK,
        SINGLETON_KEY,
      );
      expect(vc?.clock['keep']).toBe(7);
    });

    it('aborts the whole transaction when an inner op rejects (duplicate add)', async () => {
      await adapter.add(STORE_NAMES.OPS, makeOpEntry('dup', 'local'));

      await expectAsync(
        adapter.transaction([STORE_NAMES.OPS], 'readwrite', async (tx) => {
          await tx.add(STORE_NAMES.OPS, makeOpEntry('fresh', 'local'));
          // Unique byId violation rejects and aborts the tx.
          await tx.add(STORE_NAMES.OPS, makeOpEntry('dup', 'local'));
        }),
      ).toBeRejected();

      // 'fresh' must have been rolled back with the failed duplicate.
      const fresh = await adapter.getFromIndex(
        STORE_NAMES.OPS,
        OPS_INDEXES.BY_ID,
        'fresh',
      );
      expect(fresh).toBeUndefined();
    });

    it('exposes transactional reads, index reads and cursor iteration', async () => {
      await adapter.add(STORE_NAMES.OPS, makeOpEntry('r1', 'remote', 'pending'));
      await adapter.add(STORE_NAMES.OPS, makeOpEntry('r2', 'remote', 'pending'));

      const collected = await adapter.transaction(
        [STORE_NAMES.OPS],
        'readwrite',
        async (tx) => {
          const byIndex = await tx.getFromIndex<{ op: { id: string } }>(
            STORE_NAMES.OPS,
            OPS_INDEXES.BY_ID,
            'r1',
          );
          const all = await tx.getAll<{ op: { id: string } }>(STORE_NAMES.OPS);
          const ids: string[] = [];
          await tx.iterate<{ op: { id: string } }>(STORE_NAMES.OPS, {}, (v) => {
            ids.push(v.op.id);
            return 'continue';
          });
          return { byIndexId: byIndex?.op.id, allCount: all.length, ids };
        },
      );

      expect(collected.byIndexId).toBe('r1');
      expect(collected.allCount).toBe(2);
      expect(collected.ids.sort()).toEqual(['r1', 'r2']);
    });

    it('supports readonly transactions for reads', async () => {
      await adapter.add(STORE_NAMES.OPS, makeOpEntry('ro', 'local'));
      const id = await adapter.transaction([STORE_NAMES.OPS], 'readonly', async (tx) => {
        const entry = await tx.getFromIndex<{ op: { id: string } }>(
          STORE_NAMES.OPS,
          OPS_INDEXES.BY_ID,
          'ro',
        );
        return entry?.op.id;
      });
      expect(id).toBe('ro');
    });
  });

  it('init() is idempotent under concurrent callers', async () => {
    const fresh = new IndexedDbOpLogAdapter();
    await Promise.all([fresh.init(), fresh.init(), fresh.init()]);
    // A working DB after concurrent init proves no double-open/upgrade crash.
    const seq = await fresh.add(STORE_NAMES.OPS, makeOpEntry('concurrent', 'local'));
    expect(seq).toBeGreaterThan(0);
    fresh.close();
  });

  it('throws ADAPTER_NOT_INITIALIZED after close(), then init() re-opens', async () => {
    adapter.close();
    // No auto-reopen on a bare op — the documented behavioral cliff. (Production
    // auto-recovery is the store's job via its own _ensureInit, covered in the
    // store spec; here we only assert the adapter's cliff + explicit re-open.)
    await expectAsync(adapter.get(STORE_NAMES.OPS, 1)).toBeRejectedWithError(
      /not initialized/i,
    );
    await adapter.init();
    const seq = await adapter.add(STORE_NAMES.OPS, makeOpEntry('reopened', 'local'));
    expect(seq).toBeGreaterThan(0);
  });

  describe('adoptConnection (shared-connection seam)', () => {
    it('routes ops onto an externally-owned connection without calling init()', async () => {
      // Mirror the store: it owns the IDBPDatabase and hands it to the adapter.
      const owner = await openDB(OP_LOG_DB_SCHEMA.name, OP_LOG_DB_SCHEMA.version, {
        upgrade: (d, oldVersion, _newVersion, tx) => runDbUpgrade(d, oldVersion, tx),
      });
      const adopting = new IndexedDbOpLogAdapter();
      adopting.adoptConnection(owner as unknown as IDBPDatabase);

      const seq = await adopting.add(STORE_NAMES.OPS, makeOpEntry('adopted', 'local'));
      expect(seq).toBeGreaterThan(0);
      // Same physical connection — the owner observes the adapter's write.
      const got = (await owner.get(STORE_NAMES.OPS, seq)) as { op: { id: string } };
      expect(got.op.id).toBe('adopted');

      // adoptConnection(undefined) is the store's close/versionchange path: it
      // must return the adapter to the not-initialized cliff, not leave a stale
      // handle that would operate on a dead connection.
      adopting.adoptConnection(undefined);
      await expectAsync(adopting.get(STORE_NAMES.OPS, seq)).toBeRejectedWithError(
        /not initialized/i,
      );
      owner.close();
    });
  });

  describe('open retry (via _openDbOnce seam)', () => {
    // Access the private seam without `any`, mirroring the existing store spec.
    // fakeAsync + tick drive the exponential-backoff sleeps virtually (no real
    // 1+2+4s waits), so we can also assert the exact attempt budget.
    type Seam = { _openDbOnce: () => Promise<unknown> };
    const seamOf = (a: IndexedDbOpLogAdapter): Seam => a as unknown as Seam;
    const fakeDb = (): IDBPDatabase =>
      ({ addEventListener: () => {} }) as unknown as IDBPDatabase;

    it('retries a lock-related open failure, then succeeds', fakeAsync(() => {
      const a = new IndexedDbOpLogAdapter();
      const db = fakeDb();
      const openSpy = spyOn(seamOf(a), '_openDbOnce').and.returnValues(
        // InvalidStateError is classified lock-related -> full retry budget.
        Promise.reject(new DOMException('backing store locked', 'InvalidStateError')),
        Promise.resolve(db),
      );

      let resolved = false;
      a.init().then(() => {
        resolved = true;
      });

      // Backoff before attempt 2 is BASE * 2^0 = 1s.
      tick(IDB_OPEN_RETRY_BASE_DELAY_MS);
      tick();

      expect(openSpy).toHaveBeenCalledTimes(2);
      expect(resolved).toBe(true);
      expect((a as unknown as { _db?: IDBPDatabase })._db).toBe(db);
    }));

    it('makes 1 + IDB_OPEN_RETRIES_NON_LOCK attempts on a non-lock error, then wraps in IndexedDBOpenError', fakeAsync(() => {
      const a = new IndexedDbOpLogAdapter();
      const openSpy = spyOn(seamOf(a), '_openDbOnce').and.returnValue(
        // A non-lock error fails fast: it shrinks the budget after attempt 1.
        Promise.reject(new DOMException('boom', 'UnknownError')),
      );

      let caught: unknown;
      a.init().catch((e) => {
        caught = e;
      });

      // Drain each backoff window (1s, 2s, 4s) for the non-lock budget.
      for (let i = 1; i <= IDB_OPEN_RETRIES_NON_LOCK; i++) {
        tick(IDB_OPEN_RETRY_BASE_DELAY_MS * Math.pow(2, i - 1));
      }
      tick();

      expect(openSpy).toHaveBeenCalledTimes(1 + IDB_OPEN_RETRIES_NON_LOCK);
      expect(caught).toBeInstanceOf(IndexedDBOpenError);
    }));

    it('uses the full lock budget (1 + IDB_OPEN_RETRIES) before giving up', fakeAsync(() => {
      const a = new IndexedDbOpLogAdapter();
      const lockErr = new DOMException('Internal error.', 'InvalidStateError');
      const openSpy = spyOn(seamOf(a), '_openDbOnce').and.returnValue(
        Promise.reject(lockErr),
      );

      let caught: unknown;
      a.init().catch((e) => {
        caught = e;
      });

      for (let i = 1; i <= IDB_OPEN_RETRIES; i++) {
        tick(IDB_OPEN_RETRY_BASE_DELAY_MS * Math.pow(2, i - 1));
      }
      tick();

      expect(openSpy).toHaveBeenCalledTimes(1 + IDB_OPEN_RETRIES);
      expect(openSpy.calls.count()).toBeGreaterThan(1 + IDB_OPEN_RETRIES_NON_LOCK);
      expect(caught).toBeInstanceOf(IndexedDBOpenError);
    }));
  });
});
