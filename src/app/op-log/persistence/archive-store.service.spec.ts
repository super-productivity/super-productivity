import { TestBed } from '@angular/core/testing';
import { IDBPDatabase, unwrap } from 'idb';
import { forceCloseDatabase } from 'fake-indexeddb';
import { ArchiveStoreService } from './archive-store.service';
import { STORE_NAMES } from './db-keys.const';

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
});
