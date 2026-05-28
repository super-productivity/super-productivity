import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { WrappedProviderService } from './wrapped-provider.service';
import { SyncProviderManager } from './provider-manager.service';
import { FileBasedSyncAdapterService } from './file-based/file-based-sync-adapter.service';
import { SyncProviderId } from './provider.const';
import {
  FileSyncProvider,
  OperationSyncCapable,
  SyncProviderBase,
} from './provider.interface';

describe('WrappedProviderService', () => {
  let service: WrappedProviderService;
  let mockProviderManager: jasmine.SpyObj<SyncProviderManager>;
  let mockFileBasedAdapter: jasmine.SpyObj<FileBasedSyncAdapterService>;
  let providerConfigChanged$: Subject<void>;

  const createMockBaseProvider = (
    id: SyncProviderId,
  ): jasmine.SpyObj<SyncProviderBase<SyncProviderId>> => {
    return jasmine.createSpyObj('SyncProvider', ['isReady'], {
      id,
      privateCfg: {
        load: jasmine
          .createSpy('load')
          .and.returnValue(Promise.resolve({ encryptKey: 'test-key' })),
      },
    });
  };

  const createMockFileProvider = (
    id: SyncProviderId,
  ): jasmine.SpyObj<FileSyncProvider<SyncProviderId>> => {
    const provider = jasmine.createSpyObj('SyncProvider', ['isReady'], {
      id,
      privateCfg: {
        load: jasmine
          .createSpy('load')
          .and.returnValue(Promise.resolve({ encryptKey: 'test-key' })),
      },
    });
    return provider;
  };

  const createMockOperationSyncProvider = (): jasmine.SpyObj<
    SyncProviderBase<SyncProviderId> & OperationSyncCapable<'superSyncOps'>
  > => {
    const provider = createMockBaseProvider(SyncProviderId.SuperSync) as jasmine.SpyObj<
      SyncProviderBase<SyncProviderId> & OperationSyncCapable<'superSyncOps'>
    >;
    provider.supportsOperationSync = true;
    provider.providerMode = 'superSyncOps';
    return provider;
  };

  const createMockSyncCapableAdapter = (): OperationSyncCapable<'fileSnapshotOps'> => ({
    supportsOperationSync: true,
    providerMode: 'fileSnapshotOps',
    uploadOps: jasmine.createSpy('uploadOps'),
    downloadOps: jasmine.createSpy('downloadOps'),
    getLastServerSeq: jasmine.createSpy('getLastServerSeq'),
    setLastServerSeq: jasmine.createSpy('setLastServerSeq'),
    uploadSnapshot: jasmine.createSpy('uploadSnapshot'),
    deleteAllData: jasmine.createSpy('deleteAllData'),
  });

  beforeEach(() => {
    providerConfigChanged$ = new Subject<void>();

    mockProviderManager = jasmine.createSpyObj(
      'SyncProviderManager',
      ['getEncryptAndCompressCfg'],
      { providerConfigChanged$ },
    );
    mockProviderManager.getEncryptAndCompressCfg.and.returnValue({
      isEncrypt: true,
      isCompress: true,
    });

    mockFileBasedAdapter = jasmine.createSpyObj('FileBasedSyncAdapterService', [
      'createAdapter',
    ]);

    TestBed.configureTestingModule({
      providers: [
        WrappedProviderService,
        { provide: SyncProviderManager, useValue: mockProviderManager },
        { provide: FileBasedSyncAdapterService, useValue: mockFileBasedAdapter },
      ],
    });

    service = TestBed.inject(WrappedProviderService);
  });

  describe('getOperationSyncCapable', () => {
    it('should return null for null provider', async () => {
      const result = await service.getOperationSyncCapable(null);
      expect(result).toBeNull();
    });

    it('should return SuperSync provider as-is (already implements OperationSyncCapable)', async () => {
      const superSyncProvider = createMockOperationSyncProvider();

      const result = await service.getOperationSyncCapable(superSyncProvider);

      expect(result).toBe(superSyncProvider as any);
      expect(mockFileBasedAdapter.createAdapter).not.toHaveBeenCalled();
    });

    it('should wrap Dropbox provider with FileBasedSyncAdapterService', async () => {
      const dropboxProvider = createMockFileProvider(SyncProviderId.Dropbox);
      const mockAdapter = createMockSyncCapableAdapter();
      mockFileBasedAdapter.createAdapter.and.returnValue(mockAdapter);

      const result = await service.getOperationSyncCapable(dropboxProvider);

      expect(result).toBe(mockAdapter);
      expect(mockFileBasedAdapter.createAdapter).toHaveBeenCalledWith(
        dropboxProvider,
        { isEncrypt: true, isCompress: true },
        'test-key',
      );
    });

    it('should wrap WebDAV provider with FileBasedSyncAdapterService', async () => {
      const webdavProvider = createMockFileProvider(SyncProviderId.WebDAV);
      const mockAdapter = createMockSyncCapableAdapter();
      mockFileBasedAdapter.createAdapter.and.returnValue(mockAdapter);

      const result = await service.getOperationSyncCapable(webdavProvider);

      expect(result).toBe(mockAdapter);
      expect(mockFileBasedAdapter.createAdapter).toHaveBeenCalled();
    });

    it('should wrap LocalFile provider with FileBasedSyncAdapterService', async () => {
      const localFileProvider = createMockFileProvider(SyncProviderId.LocalFile);
      const mockAdapter = createMockSyncCapableAdapter();
      mockFileBasedAdapter.createAdapter.and.returnValue(mockAdapter);

      const result = await service.getOperationSyncCapable(localFileProvider);

      expect(result).toBe(mockAdapter);
      expect(mockFileBasedAdapter.createAdapter).toHaveBeenCalled();
    });

    it('should cache wrapped adapters per provider ID', async () => {
      const dropboxProvider = createMockFileProvider(SyncProviderId.Dropbox);
      const mockAdapter = createMockSyncCapableAdapter();
      mockFileBasedAdapter.createAdapter.and.returnValue(mockAdapter);

      // First call - creates adapter
      const result1 = await service.getOperationSyncCapable(dropboxProvider);
      // Second call - should return cached adapter
      const result2 = await service.getOperationSyncCapable(dropboxProvider);

      expect(result1).toBe(mockAdapter);
      expect(result2).toBe(mockAdapter);
      expect(mockFileBasedAdapter.createAdapter).toHaveBeenCalledTimes(1);
    });

    it('should handle provider without encryptKey', async () => {
      const dropboxProvider = createMockFileProvider(SyncProviderId.Dropbox);
      (dropboxProvider.privateCfg.load as jasmine.Spy).and.returnValue(
        Promise.resolve(null),
      );
      const mockAdapter = createMockSyncCapableAdapter();
      mockFileBasedAdapter.createAdapter.and.returnValue(mockAdapter);

      await service.getOperationSyncCapable(dropboxProvider);

      expect(mockFileBasedAdapter.createAdapter).toHaveBeenCalledWith(
        dropboxProvider,
        { isEncrypt: false, isCompress: true },
        undefined,
      );
    });
  });

  describe('clearCache', () => {
    it('should clear cached adapters', async () => {
      const dropboxProvider = createMockFileProvider(SyncProviderId.Dropbox);
      const mockAdapter1 = createMockSyncCapableAdapter();
      const mockAdapter2 = createMockSyncCapableAdapter();
      mockFileBasedAdapter.createAdapter.and.returnValues(mockAdapter1, mockAdapter2);

      // First call - creates adapter1
      const result1 = await service.getOperationSyncCapable(dropboxProvider);
      expect(result1).toBe(mockAdapter1);

      // Clear cache
      service.clearCache();

      // Next call should create a new adapter
      const result2 = await service.getOperationSyncCapable(dropboxProvider);
      expect(result2).toBe(mockAdapter2);
      expect(mockFileBasedAdapter.createAdapter).toHaveBeenCalledTimes(2);
    });
  });

  describe('auto-invalidation on config change', () => {
    it('should auto-clear cache when providerConfigChanged$ emits', async () => {
      const dropboxProvider = createMockFileProvider(SyncProviderId.Dropbox);
      const mockAdapter1 = createMockSyncCapableAdapter();
      const mockAdapter2 = createMockSyncCapableAdapter();
      mockFileBasedAdapter.createAdapter.and.returnValues(mockAdapter1, mockAdapter2);

      // First call - creates and caches adapter1
      const result1 = await service.getOperationSyncCapable(dropboxProvider);
      expect(result1).toBe(mockAdapter1);

      // Simulate config change
      providerConfigChanged$.next();

      // Next call should create a new adapter (cache was auto-cleared)
      const result2 = await service.getOperationSyncCapable(dropboxProvider);
      expect(result2).toBe(mockAdapter2);
      expect(mockFileBasedAdapter.createAdapter).toHaveBeenCalledTimes(2);
    });
  });
});
