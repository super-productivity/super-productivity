import { TestBed } from '@angular/core/testing';
import { FileBasedEncryptionService } from './file-based-encryption.service';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { StateSnapshotService } from '../../op-log/backup/state-snapshot.service';
import { VectorClockService } from '../../op-log/sync/vector-clock.service';
import {
  CLIENT_ID_PROVIDER,
  ClientIdProvider,
} from '../../op-log/util/client-id.provider';
import { FileBasedSyncAdapterService } from '../../op-log/sync-providers/file-based/file-based-sync-adapter.service';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { WrappedProviderService } from '../../op-log/sync-providers/wrapped-provider.service';
import { DerivedKeyCacheService } from '../../op-log/encryption/derived-key-cache.service';
import { SyncProviderId } from '../../op-log/sync-providers/provider.const';
import { SyncProviderServiceInterface } from '../../op-log/sync-providers/provider.interface';

describe('FileBasedEncryptionService', () => {
  let service: FileBasedEncryptionService;
  let mockProviderManager: jasmine.SpyObj<SyncProviderManager>;
  let mockStateSnapshotService: jasmine.SpyObj<StateSnapshotService>;
  let mockVectorClockService: jasmine.SpyObj<VectorClockService>;
  let mockClientIdProvider: jasmine.SpyObj<ClientIdProvider>;
  let mockFileBasedAdapter: jasmine.SpyObj<FileBasedSyncAdapterService>;
  let mockGlobalConfigService: jasmine.SpyObj<GlobalConfigService>;
  let mockWrappedProviderService: jasmine.SpyObj<WrappedProviderService>;
  let mockDerivedKeyCache: jasmine.SpyObj<DerivedKeyCacheService>;
  let mockProvider: SyncProviderServiceInterface<SyncProviderId>;
  let mockAdapter: {
    uploadSnapshot: jasmine.Spy;
    setLastServerSeq: jasmine.Spy;
  };

  const mockExistingCfg = {
    baseUrl: 'https://webdav.example.com',
    userName: 'testuser',
    password: 'testpass',
    syncFilePath: '/sync/data.json',
    encryptKey: undefined,
  };

  beforeEach(() => {
    // Create mock provider (file-based: WebDAV)
    mockProvider = {
      id: SyncProviderId.WebDAV,
      maxConcurrentRequests: 1,
      privateCfg: {
        load: jasmine.createSpy('load').and.resolveTo(mockExistingCfg),
      } as unknown as SyncProviderServiceInterface<SyncProviderId>['privateCfg'],
      isReady: jasmine.createSpy('isReady').and.resolveTo(true),
      setPrivateCfg: jasmine.createSpy('setPrivateCfg').and.resolveTo(),
      getFileRev: jasmine.createSpy('getFileRev'),
      downloadFile: jasmine.createSpy('downloadFile'),
      uploadFile: jasmine.createSpy('uploadFile'),
      removeFile: jasmine.createSpy('removeFile'),
    };

    // Create mock adapter
    mockAdapter = {
      uploadSnapshot: jasmine.createSpy('uploadSnapshot').and.resolveTo({
        accepted: true,
        serverSeq: 42,
      }),
      setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
    };

    mockProviderManager = jasmine.createSpyObj('SyncProviderManager', [
      'getActiveProvider',
      'getEncryptAndCompressCfg',
      'setProviderConfig',
    ]);
    mockProviderManager.getActiveProvider.and.returnValue(mockProvider);
    mockProviderManager.getEncryptAndCompressCfg.and.returnValue({
      isCompress: true,
      isEncrypt: false,
    });
    mockProviderManager.setProviderConfig.and.resolveTo();

    mockStateSnapshotService = jasmine.createSpyObj('StateSnapshotService', [
      'getStateSnapshotAsync',
    ]);
    mockStateSnapshotService.getStateSnapshotAsync.and.resolveTo({} as never);

    mockVectorClockService = jasmine.createSpyObj('VectorClockService', [
      'getCurrentVectorClock',
    ]);
    mockVectorClockService.getCurrentVectorClock.and.resolveTo({ testClient: 1 });

    mockClientIdProvider = jasmine.createSpyObj('ClientIdProvider', ['loadClientId']);
    mockClientIdProvider.loadClientId.and.resolveTo('testClient');

    mockFileBasedAdapter = jasmine.createSpyObj('FileBasedSyncAdapterService', [
      'createAdapter',
    ]);
    mockFileBasedAdapter.createAdapter.and.returnValue(mockAdapter as never);

    mockGlobalConfigService = jasmine.createSpyObj('GlobalConfigService', [
      'updateSection',
    ]);

    mockWrappedProviderService = jasmine.createSpyObj('WrappedProviderService', [
      'clearCache',
    ]);

    mockDerivedKeyCache = jasmine.createSpyObj('DerivedKeyCacheService', ['clearCache']);

    TestBed.configureTestingModule({
      providers: [
        FileBasedEncryptionService,
        { provide: SyncProviderManager, useValue: mockProviderManager },
        { provide: StateSnapshotService, useValue: mockStateSnapshotService },
        { provide: VectorClockService, useValue: mockVectorClockService },
        { provide: CLIENT_ID_PROVIDER, useValue: mockClientIdProvider },
        { provide: FileBasedSyncAdapterService, useValue: mockFileBasedAdapter },
        { provide: GlobalConfigService, useValue: mockGlobalConfigService },
        { provide: WrappedProviderService, useValue: mockWrappedProviderService },
        { provide: DerivedKeyCacheService, useValue: mockDerivedKeyCache },
      ],
    });

    service = TestBed.inject(FileBasedEncryptionService);
  });

  describe('enableEncryption', () => {
    it('should throw when encryptKey is empty', async () => {
      await expectAsync(service.enableEncryption('')).toBeRejectedWithError(
        'Encryption password is required',
      );
    });

    it('should throw when no active provider', async () => {
      mockProviderManager.getActiveProvider.and.returnValue(null);

      await expectAsync(service.enableEncryption('my-password')).toBeRejectedWithError(
        'No active sync provider. Please enable sync first.',
      );
    });

    it('should throw for non-file-based provider (SuperSync)', async () => {
      const superSyncProvider: SyncProviderServiceInterface<SyncProviderId> = {
        id: SyncProviderId.SuperSync,
        maxConcurrentRequests: 1,
        privateCfg: {} as never,
        isReady: jasmine.createSpy('isReady').and.resolveTo(true),
        setPrivateCfg: jasmine.createSpy('setPrivateCfg'),
        getFileRev: jasmine.createSpy('getFileRev'),
        downloadFile: jasmine.createSpy('downloadFile'),
        uploadFile: jasmine.createSpy('uploadFile'),
        removeFile: jasmine.createSpy('removeFile'),
      };
      mockProviderManager.getActiveProvider.and.returnValue(superSyncProvider);

      await expectAsync(service.enableEncryption('my-password')).toBeRejectedWithError(
        /only supported for file-based providers/,
      );
    });

    it('should throw when provider is not ready', async () => {
      (mockProvider.isReady as jasmine.Spy).and.resolveTo(false);

      await expectAsync(service.enableEncryption('my-password')).toBeRejectedWithError(
        'Sync provider is not ready. Please configure sync first.',
      );
    });

    it('should throw when client ID is not available', async () => {
      mockClientIdProvider.loadClientId.and.resolveTo(null);

      await expectAsync(service.enableEncryption('my-password')).toBeRejectedWithError(
        'Client ID not available',
      );
    });

    it('should upload encrypted snapshot before saving config', async () => {
      await service.enableEncryption('my-password');

      expect(mockAdapter.uploadSnapshot).toHaveBeenCalled();
      expect(mockAdapter.uploadSnapshot).toHaveBeenCalledBefore(
        mockProviderManager.setProviderConfig,
      );
    });

    it('should use providerManager.setProviderConfig instead of provider.setPrivateCfg', async () => {
      await service.enableEncryption('my-password');

      // This is the key test - ensures we use setProviderConfig which updates the observable
      expect(mockProviderManager.setProviderConfig).toHaveBeenCalledWith(
        SyncProviderId.WebDAV,
        jasmine.objectContaining({
          ...mockExistingCfg,
          encryptKey: 'my-password',
        }),
      );

      // Should NOT call setPrivateCfg directly
      expect(mockProvider.setPrivateCfg).not.toHaveBeenCalled();
    });

    it('should update global config with isEncryptionEnabled: true', async () => {
      await service.enableEncryption('my-password');

      expect(mockGlobalConfigService.updateSection).toHaveBeenCalledWith('sync', {
        isEncryptionEnabled: true,
      });
    });

    it('should clear derived key cache and wrapped provider cache', async () => {
      await service.enableEncryption('my-password');

      expect(mockDerivedKeyCache.clearCache).toHaveBeenCalled();
      expect(mockWrappedProviderService.clearCache).toHaveBeenCalled();
    });

    it('should set lastServerSeq when returned from adapter', async () => {
      await service.enableEncryption('my-password');

      expect(mockAdapter.setLastServerSeq).toHaveBeenCalledWith(42);
    });

    it('should throw when snapshot upload fails', async () => {
      mockAdapter.uploadSnapshot.and.resolveTo({
        accepted: false,
        error: 'Upload rejected',
      });

      await expectAsync(service.enableEncryption('my-password')).toBeRejectedWithError(
        /Snapshot upload failed.*Upload rejected/,
      );

      // Should NOT save config when upload fails
      expect(mockProviderManager.setProviderConfig).not.toHaveBeenCalled();
    });
  });

  describe('changePassword', () => {
    it('should use providerManager.setProviderConfig for password change', async () => {
      await service.changePassword('new-password');

      expect(mockProviderManager.setProviderConfig).toHaveBeenCalledWith(
        SyncProviderId.WebDAV,
        jasmine.objectContaining({
          encryptKey: 'new-password',
        }),
      );

      // Verify setPrivateCfg is NOT called directly
      expect(mockProvider.setPrivateCfg).not.toHaveBeenCalled();
    });
  });
});
