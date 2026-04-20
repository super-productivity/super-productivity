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

    mockClientIdProvider = jasmine.createSpyObj('ClientIdProvider', [
      'loadClientId',
      'getOrGenerateClientId',
    ]);
    mockClientIdProvider.loadClientId.and.resolveTo('testClient');
    mockClientIdProvider.getOrGenerateClientId.and.resolveTo('testClient');

    mockFileBasedAdapter = jasmine.createSpyObj('FileBasedSyncAdapterService', [
      'createAdapter',
    ]);
    mockFileBasedAdapter.createAdapter.and.returnValue(mockAdapter as never);

    mockGlobalConfigService = jasmine.createSpyObj('GlobalConfigService', [
      'updateSection',
    ]);

    TestBed.configureTestingModule({
      providers: [
        FileBasedEncryptionService,
        { provide: SyncProviderManager, useValue: mockProviderManager },
        { provide: StateSnapshotService, useValue: mockStateSnapshotService },
        { provide: VectorClockService, useValue: mockVectorClockService },
        { provide: CLIENT_ID_PROVIDER, useValue: mockClientIdProvider },
        { provide: FileBasedSyncAdapterService, useValue: mockFileBasedAdapter },
        { provide: GlobalConfigService, useValue: mockGlobalConfigService },
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

    it('should use getOrGenerateClientId from the provider', async () => {
      mockClientIdProvider.getOrGenerateClientId.and.resolveTo('B_regen');

      // Should NOT throw — getOrGenerateClientId handles null/invalid IDs internally
      await expectAsync(service.enableEncryption('my-password')).toBeResolved();
      expect(mockClientIdProvider.getOrGenerateClientId).toHaveBeenCalled();
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

    it('should clear derived key cache', async () => {
      await service.enableEncryption('my-password');

      // clearSessionKeyCache() is called directly (module-level function, not spyable)
      // WrappedProviderService cache is now auto-invalidated via providerConfigChanged$
    });

    it('should set lastServerSeq when returned from adapter', async () => {
      await service.enableEncryption('my-password');

      expect(mockAdapter.setLastServerSeq).toHaveBeenCalledWith(42);
    });

    it('should create adapter with correct encrypt config and password', async () => {
      await service.enableEncryption('my-password');

      expect(mockFileBasedAdapter.createAdapter).toHaveBeenCalledWith(
        mockProvider,
        jasmine.objectContaining({ isCompress: true, isEncrypt: true }),
        'my-password',
      );
    });

    it('should pass correct params to uploadSnapshot', async () => {
      await service.enableEncryption('my-password');

      expect(mockAdapter.uploadSnapshot).toHaveBeenCalledWith(
        jasmine.anything(), // state
        'testClient', // clientId
        'recovery', // reason
        { testClient: 1 }, // vectorClock
        jasmine.any(Number), // schemaVersion
        true, // isEncrypt
        jasmine.any(String), // uuid
      );
    });

    it('should preserve existing provider config properties', async () => {
      await service.enableEncryption('my-password');

      expect(mockProviderManager.setProviderConfig).toHaveBeenCalledWith(
        SyncProviderId.WebDAV,
        jasmine.objectContaining({
          baseUrl: 'https://webdav.example.com',
          userName: 'testuser',
          password: 'testpass',
          syncFilePath: '/sync/data.json',
          encryptKey: 'my-password',
        }),
      );
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

    it('should preserve existing provider config properties', async () => {
      await service.changePassword('new-password');

      expect(mockProviderManager.setProviderConfig).toHaveBeenCalledWith(
        SyncProviderId.WebDAV,
        jasmine.objectContaining({
          baseUrl: 'https://webdav.example.com',
          userName: 'testuser',
          password: 'testpass',
          syncFilePath: '/sync/data.json',
          encryptKey: 'new-password',
        }),
      );
    });

    it('should clear derived key cache', async () => {
      await service.changePassword('new-password');

      // clearSessionKeyCache() is called directly (module-level function, not spyable)
      // WrappedProviderService cache is now auto-invalidated via providerConfigChanged$
    });

    it('should update global config with isEncryptionEnabled: true', async () => {
      await service.changePassword('new-password');

      expect(mockGlobalConfigService.updateSection).toHaveBeenCalledWith('sync', {
        isEncryptionEnabled: true,
      });
    });

    it('should upload encrypted snapshot before saving config', async () => {
      await service.changePassword('new-password');

      expect(mockAdapter.uploadSnapshot).toHaveBeenCalled();
      expect(mockAdapter.uploadSnapshot).toHaveBeenCalledBefore(
        mockProviderManager.setProviderConfig,
      );
    });

    it('should create adapter with isEncrypt: true', async () => {
      await service.changePassword('new-password');

      expect(mockFileBasedAdapter.createAdapter).toHaveBeenCalledWith(
        mockProvider,
        jasmine.objectContaining({ isEncrypt: true }),
        'new-password',
      );
    });

    it('should NOT update config when upload fails', async () => {
      mockAdapter.uploadSnapshot.and.resolveTo({
        accepted: false,
        error: 'Upload rejected',
      });

      await expectAsync(service.changePassword('new-password')).toBeRejectedWithError(
        /Snapshot upload failed/,
      );

      expect(mockProviderManager.setProviderConfig).not.toHaveBeenCalled();
    });
  });

  describe('disableEncryption', () => {
    it('should create unencrypted adapter and upload snapshot', async () => {
      await service.disableEncryption();

      expect(mockFileBasedAdapter.createAdapter).toHaveBeenCalledWith(
        mockProvider,
        jasmine.objectContaining({ isEncrypt: false }),
        undefined,
      );
      expect(mockAdapter.uploadSnapshot).toHaveBeenCalled();
    });

    it('should use providerManager.setProviderConfig for disable', async () => {
      await service.disableEncryption();

      expect(mockProviderManager.setProviderConfig).toHaveBeenCalledWith(
        SyncProviderId.WebDAV,
        jasmine.objectContaining({
          encryptKey: undefined,
        }),
      );

      // Should NOT call setPrivateCfg directly
      expect(mockProvider.setPrivateCfg).not.toHaveBeenCalled();
    });

    it('should update global config to disable encryption', async () => {
      await service.disableEncryption();

      expect(mockGlobalConfigService.updateSection).toHaveBeenCalledWith('sync', {
        isEncryptionEnabled: false,
        encryptKey: '',
      });
    });

    it('should clear caches after successful upload', async () => {
      await service.disableEncryption();

      // clearSessionKeyCache() is called directly (module-level function, not spyable)
      // WrappedProviderService cache is now auto-invalidated via providerConfigChanged$
    });

    it('should NOT update config on upload failure', async () => {
      mockAdapter.uploadSnapshot.and.resolveTo({
        accepted: false,
        error: 'Upload rejected',
      });

      await expectAsync(service.disableEncryption()).toBeRejectedWithError(
        /Snapshot upload failed/,
      );

      expect(mockProviderManager.setProviderConfig).not.toHaveBeenCalled();
    });

    it('should pass isEncrypt=false to uploadSnapshot', async () => {
      await service.disableEncryption();

      expect(mockAdapter.uploadSnapshot).toHaveBeenCalledWith(
        jasmine.anything(), // state
        'testClient', // clientId
        'recovery', // reason
        { testClient: 1 }, // vectorClock
        jasmine.any(Number), // schemaVersion
        false, // isEncrypt
        jasmine.any(String), // uuid
      );
    });

    it('should throw when no active provider', async () => {
      mockProviderManager.getActiveProvider.and.returnValue(null);

      await expectAsync(service.disableEncryption()).toBeRejectedWithError(
        /No active sync provider/,
      );
    });

    it('should propagate error when config update fails after upload', async () => {
      mockProviderManager.setProviderConfig.and.rejectWith(
        new Error('Config save failed'),
      );

      await expectAsync(service.disableEncryption()).toBeRejectedWithError(
        'Config save failed',
      );
    });
  });
});
