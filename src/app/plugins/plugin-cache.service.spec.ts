import { TestBed } from '@angular/core/testing';
import { IDBFactory, IDBVersionChangeEvent, forceCloseDatabase } from 'fake-indexeddb';
import { CachedPlugin, PluginCacheService } from './plugin-cache.service';

const successfulRequest = <T>(result: T): IDBRequest<T> => {
  const request: Partial<IDBRequest<T>> = {
    result,
    onsuccess: null,
    onerror: null,
  };

  setTimeout(() => {
    request.onsuccess?.call(request as IDBRequest<T>, new Event('success'));
  });

  return request as IDBRequest<T>;
};

type MockIdbObjectStore = Record<
  'put' | 'get' | 'delete' | 'getAll' | 'clear',
  jasmine.Spy
>;

describe('PluginCacheService connection lifecycle', () => {
  let service: PluginCacheService;
  let connection: IDBDatabase;
  let open: jasmine.Spy;

  beforeEach(() => {
    const factory = new IDBFactory();
    open = spyOn(indexedDB, 'open').and.callFake((name, version) => {
      const request = factory.open(name, version);
      request.addEventListener('success', () => (connection = request.result));
      return request;
    });
    TestBed.configureTestingModule({ providers: [PluginCacheService] });
    service = TestBed.inject(PluginCacheService);
  });

  afterEach(() => connection?.close());

  it('reopens a browser-closed connection and preserves cached plugins', async () => {
    await service.storePlugin('plugin-1', '{}', 'code');
    expect((await service.getPlugin('plugin-1'))?.code).toBe('code');
    const closed = new Promise<void>((resolve) =>
      connection.addEventListener('close', () => resolve(), { once: true }),
    );
    // fake-indexeddb types this argument as a constructor instead of a connection.
    forceCloseDatabase(connection as unknown as Parameters<typeof forceCloseDatabase>[0]);
    await closed;

    expect((await service.getPlugin('plugin-1'))?.code).toBe('code');
    await service.storePlugin('plugin-2', '{}', 'new code');
    await service.removePlugin('plugin-1');
    expect(await service.getPlugin('plugin-1')).toBeNull();
    expect((await service.getPlugin('plugin-2'))?.code).toBe('new code');
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('closes on versionchange and reopens on the next access', async () => {
    await service.storePlugin('plugin-1', '{}', 'code');
    const oldConnection = connection;
    const close = spyOn(oldConnection, 'close').and.callThrough();
    oldConnection.dispatchEvent(new IDBVersionChangeEvent('versionchange'));

    expect((await service.getPlugin('plugin-1'))?.code).toBe('code');
    expect(close).toHaveBeenCalledTimes(1);
    expect(connection).not.toBe(oldConnection);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('reuses a healthy connection', async () => {
    await service.storePlugin('plugin-1', '{}', 'code');
    await service.getPlugin('plugin-1');
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe('PluginCacheService', () => {
  let service: PluginCacheService;
  let mockDb: jasmine.SpyObj<IDBDatabase>;
  let mockTransaction: jasmine.SpyObj<IDBTransaction>;
  let mockStore: MockIdbObjectStore;

  beforeEach(() => {
    mockStore = jasmine.createSpyObj('IDBObjectStore', [
      'put',
      'get',
      'delete',
      'getAll',
      'clear',
    ]) as MockIdbObjectStore;
    mockTransaction = jasmine.createSpyObj<IDBTransaction>('IDBTransaction', [
      'objectStore',
    ]);
    mockDb = jasmine.createSpyObj<IDBDatabase>('IDBDatabase', ['transaction']);

    mockDb.transaction.and.returnValue(mockTransaction);
    mockTransaction.objectStore.and.returnValue(mockStore as unknown as IDBObjectStore);

    TestBed.configureTestingModule({
      providers: [PluginCacheService],
    });

    service = TestBed.inject(PluginCacheService);
    (service as unknown as { _db: IDBDatabase | null })._db = mockDb;
  });

  it('stores complete plugin data in IndexedDB', async () => {
    mockStore.put.and.returnValue(successfulRequest<IDBValidKey>(1));

    await service.storePlugin(
      'plugin-1',
      '{"id":"plugin-1"}',
      'console.log("plugin")',
      '<main></main>',
      '<svg></svg>',
      { en: '{"title":"Plugin"}' },
      '{"type":"object"}',
    );

    expect(mockDb.transaction).toHaveBeenCalledWith(['plugins'], 'readwrite');
    expect(mockStore.put).toHaveBeenCalledTimes(1);
    const storedPlugin = mockStore.put.calls.mostRecent().args[0] as CachedPlugin;
    expect(storedPlugin).toEqual(
      jasmine.objectContaining({
        id: 'plugin-1',
        manifest: '{"id":"plugin-1"}',
        code: 'console.log("plugin")',
        indexHtml: '<main></main>',
        icon: '<svg></svg>',
        translations: { en: '{"title":"Plugin"}' },
        configSchema: '{"type":"object"}',
      }),
    );
    expect(storedPlugin.uploadDate).toEqual(jasmine.any(Number));
  });

  it('returns a cached plugin by id', async () => {
    const cachedPlugin: CachedPlugin = {
      id: 'plugin-1',
      manifest: '{}',
      code: 'code',
      uploadDate: 123,
    };
    mockStore.get.and.returnValue(successfulRequest(cachedPlugin));

    await expectAsync(service.getPlugin('plugin-1')).toBeResolvedTo(cachedPlugin);
    expect(mockDb.transaction).toHaveBeenCalledWith(['plugins'], 'readonly');
    expect(mockStore.get).toHaveBeenCalledOnceWith('plugin-1');
  });

  it('returns null for a missing plugin', async () => {
    mockStore.get.and.returnValue(successfulRequest(undefined));

    await expectAsync(service.getPlugin('missing-plugin')).toBeResolvedTo(null);
  });

  it('removes a plugin by id', async () => {
    mockStore.delete.and.returnValue(successfulRequest(undefined));

    await service.removePlugin('plugin-1');

    expect(mockDb.transaction).toHaveBeenCalledWith(['plugins'], 'readwrite');
    expect(mockStore.delete).toHaveBeenCalledOnceWith('plugin-1');
  });

  it('clears all cached plugins', async () => {
    mockStore.clear.and.returnValue(successfulRequest(undefined));

    await service.clearCache();

    expect(mockDb.transaction).toHaveBeenCalledWith(['plugins'], 'readwrite');
    expect(mockStore.clear).toHaveBeenCalledTimes(1);
  });
});
