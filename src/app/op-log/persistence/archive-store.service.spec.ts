import { TestBed } from '@angular/core/testing';
import { IDBPDatabase, unwrap } from 'idb';
import { forceCloseDatabase } from 'fake-indexeddb';
import { ArchiveStoreService } from './archive-store.service';
import { DB_NAME, DB_VERSION, STORE_NAMES } from './db-keys.const';
import { IndexedDBOpenError } from '../core/errors/indexed-db-open.error';

describe('ArchiveStoreService', () => {
  let service: ArchiveStoreService;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [ArchiveStoreService],
    });
    service = TestBed.inject(ArchiveStoreService);
    // Opens the connection and clears any data left by previous tests
    // (ArchiveStoreService shares the SUP_OPS database with other specs).
    await service._clearAllDataForTesting();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('connection lifecycle handlers', () => {
    // Open the connection through the lazy `_ensureInit()` path so `_initPromise`
    // is genuinely populated before the event is dispatched.
    const openViaLazyInit = async (): Promise<void> => {
      (service as any)._db = undefined;
      (service as any)._initPromise = undefined;
      await service.loadArchiveYoung();
    };

    it('closes the connection and clears cached state on versionchange, then reopens', async () => {
      await openViaLazyInit();
      expect((service as any)._db).toBeDefined();
      expect((service as any)._initPromise).toBeDefined();

      const raw = unwrap((service as any)._db as IDBPDatabase);
      // fake-indexeddb's FakeEventTarget rejects native DOM `Event` (no
      // `initialized` flag), so dispatch its own `IDBVersionChangeEvent`
      // (installed globally by `fake-indexeddb/auto`) which derives from
      // the polyfill's `FakeEvent`.
      raw.dispatchEvent(
        new IDBVersionChangeEvent('versionchange', { oldVersion: 1, newVersion: 2 }),
      );

      // The handler runs synchronously: cached state cleared and the
      // connection actually closed (so it cannot block a schema upgrade).
      expect((service as any)._db).toBeUndefined();
      expect((service as any)._initPromise).toBeUndefined();
      let txError: unknown;
      try {
        raw.transaction(STORE_NAMES.ARCHIVE_YOUNG, 'readonly');
      } catch (e) {
        txError = e;
      }
      expect((txError as DOMException | undefined)?.name).toBe('InvalidStateError');

      // The next access transparently reopens the connection.
      await expectAsync(service.loadArchiveYoung()).toBeResolved();
    });

    it('clears cached state on the browser close event, then reopens', async () => {
      await openViaLazyInit();

      const raw = unwrap((service as any)._db as IDBPDatabase);
      // Drive the spec-compliant forced-close path; fake-indexeddb fires a real
      // `close` event through its internal pipeline (unlike dispatchEvent of a
      // synthetic DOM Event, which its FakeEventTarget shim rejects). The cast
      // works around an incorrect `(db: typeof FDBDatabase)` type declaration
      // in fake-indexeddb's types.d.ts — the runtime expects an instance.
      forceCloseDatabase(raw as unknown as Parameters<typeof forceCloseDatabase>[0]);
      // Let queued tasks (connection bookkeeping) settle before reopening.
      await new Promise((r) => setTimeout(r, 0));

      expect((service as any)._db).toBeUndefined();
      expect((service as any)._initPromise).toBeUndefined();
      await expectAsync(service.loadArchiveYoung()).toBeResolved();
    });
  });

  // #9187: ArchiveStoreService keeps its own copy of the open-with-retry loop,
  // and it is a live path (both consumers only skip it for a self-managing
  // adapter). Driving a REAL downgrade beats spying a seam here — this service
  // inlines `openDB`, and the actual browser rejection is the better oracle.
  describe('downgrade barrier', () => {
    it('fails fast with a classified error when the DB is newer than this build', async () => {
      // Drop the connection opened by the beforeEach so it cannot block the
      // upgrade below.
      ((service as any)._db as IDBPDatabase | undefined)?.close();
      (service as any)._db = undefined;
      (service as any)._initPromise = undefined;

      // Push the on-disk version above what the service asks for.
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION + 1);
        req.onupgradeneeded = () => {};
        req.onsuccess = () => {
          req.result.close();
          resolve();
        };
        req.onerror = () => reject(req.error);
      });

      const startedAt = Date.now();
      let caught: unknown;
      try {
        await service.loadArchiveYoung();
      } catch (e) {
        caught = e;
      }

      expect(caught).toEqual(jasmine.any(IndexedDBOpenError));
      expect((caught as IndexedDBOpenError).isVersionError).toBe(true);
      // Without the fail-fast break this burns the non-lock budget
      // (1s+2s+4s) and dies on jasmine's 2s timeout before reaching here — so
      // the elapsed check is a second signal, not the only one. Do NOT
      // "repair" a slow run by raising DEFAULT_TIMEOUT_INTERVAL.
      //
      // 500ms, not 1500ms: the real path is ~1-20ms, and a PARTIAL regression
      // (break moved one iteration late = one 1000ms backoff) would clear a
      // 1500ms bound and the 2s timeout both, passing green.
      expect(Date.now() - startedAt).toBeLessThan(500);
    });
  });
});
