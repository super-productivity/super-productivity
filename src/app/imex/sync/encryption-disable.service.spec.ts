import { TestBed } from '@angular/core/testing';
import { EncryptionDisableService } from './encryption-disable.service';
import { SnapshotUploadData, SnapshotUploadService } from './snapshot-upload.service';
import { SyncProviderId } from '../../op-log/sync-providers/provider.const';
import {
  OperationSyncCapable,
  SyncProviderServiceInterface,
} from '../../op-log/sync-providers/provider.interface';
import { SuperSyncPrivateCfg } from '../../op-log/sync-providers/super-sync/super-sync.model';
import { WrappedProviderService } from '../../op-log/sync-providers/wrapped-provider.service';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { StateSnapshotService } from '../../op-log/backup/state-snapshot.service';
import { VectorClockService } from '../../op-log/sync/vector-clock.service';
import { CLIENT_ID_PROVIDER } from '../../op-log/util/client-id.provider';
import { FileBasedSyncAdapterService } from '../../op-log/sync-providers/file-based/file-based-sync-adapter.service';
import { GlobalConfigService } from '../../features/config/global-config.service';

describe('EncryptionDisableService', () => {
  let service: EncryptionDisableService;
  let mockSnapshotUploadService: jasmine.SpyObj<SnapshotUploadService>;
  let mockWrappedProviderService: jasmine.SpyObj<WrappedProviderService>;
  let mockProviderManager: jasmine.SpyObj<SyncProviderManager>;
  let mockStateSnapshotService: jasmine.SpyObj<StateSnapshotService>;
  let mockVectorClockService: jasmine.SpyObj<VectorClockService>;
  let mockFileBasedAdapter: jasmine.SpyObj<FileBasedSyncAdapterService>;
  let mockGlobalConfigService: jasmine.SpyObj<GlobalConfigService>;
  let mockSyncProvider: jasmine.SpyObj<
    SyncProviderServiceInterface<SyncProviderId> & OperationSyncCapable
  >;

  const mockExistingCfg: SuperSyncPrivateCfg = {
    baseUrl: 'https://test.example.com',
    accessToken: 'test-token',
    isEncryptionEnabled: true,
    encryptKey: 'existing-key',
  };

  beforeEach(() => {
    mockSyncProvider = jasmine.createSpyObj('SyncProvider', [
      'deleteAllData',
      'setPrivateCfg',
    ]);
    mockSyncProvider.id = SyncProviderId.SuperSync;
    mockSyncProvider.deleteAllData.and.resolveTo({ success: true });
    mockSyncProvider.setPrivateCfg.and.resolveTo();

    mockSnapshotUploadService = jasmine.createSpyObj('SnapshotUploadService', [
      'gatherSnapshotData',
      'uploadSnapshot',
      'updateLastServerSeq',
    ]);
    mockSnapshotUploadService.gatherSnapshotData.and.resolveTo({
      syncProvider: mockSyncProvider,
      existingCfg: mockExistingCfg,
      state: { task: [] },
      vectorClock: { testClient1: 1 },
      clientId: 'testClient1',
    } as unknown as SnapshotUploadData);
    mockSnapshotUploadService.uploadSnapshot.and.resolveTo({
      accepted: true,
      serverSeq: 1,
    });
    mockSnapshotUploadService.updateLastServerSeq.and.resolveTo();

    mockWrappedProviderService = jasmine.createSpyObj('WrappedProviderService', [
      'clearCache',
    ]);

    mockProviderManager = jasmine.createSpyObj('SyncProviderManager', [
      'getActiveProvider',
      'getEncryptAndCompressCfg',
    ]);
    mockProviderManager.getActiveProvider.and.returnValue(null);
    mockProviderManager.getEncryptAndCompressCfg.and.returnValue({
      isEncrypt: false,
      isCompress: true,
    });

    mockStateSnapshotService = jasmine.createSpyObj('StateSnapshotService', [
      'getStateSnapshotAsync',
    ]);
    mockStateSnapshotService.getStateSnapshotAsync.and.resolveTo({ task: [] } as any);

    mockVectorClockService = jasmine.createSpyObj('VectorClockService', [
      'getCurrentVectorClock',
    ]);
    mockVectorClockService.getCurrentVectorClock.and.resolveTo({ testClient1: 1 });

    mockFileBasedAdapter = jasmine.createSpyObj('FileBasedSyncAdapterService', [
      'createAdapter',
    ]);

    mockGlobalConfigService = jasmine.createSpyObj('GlobalConfigService', [
      'updateSection',
    ]);

    TestBed.configureTestingModule({
      providers: [
        EncryptionDisableService,
        { provide: SnapshotUploadService, useValue: mockSnapshotUploadService },
        { provide: WrappedProviderService, useValue: mockWrappedProviderService },
        { provide: SyncProviderManager, useValue: mockProviderManager },
        { provide: StateSnapshotService, useValue: mockStateSnapshotService },
        { provide: VectorClockService, useValue: mockVectorClockService },
        {
          provide: CLIENT_ID_PROVIDER,
          useValue: { loadClientId: () => Promise.resolve('testClient1') },
        },
        { provide: FileBasedSyncAdapterService, useValue: mockFileBasedAdapter },
        { provide: GlobalConfigService, useValue: mockGlobalConfigService },
      ],
    });

    service = TestBed.inject(EncryptionDisableService);
  });

  describe('disableEncryption', () => {
    it('should delete server data before disabling encryption', async () => {
      await service.disableEncryption();

      expect(mockSyncProvider.deleteAllData).toHaveBeenCalledTimes(1);
      expect(mockSyncProvider.deleteAllData).toHaveBeenCalledBefore(
        mockSnapshotUploadService.uploadSnapshot,
      );
    });

    it('should upload unencrypted snapshot with isPayloadEncrypted=false', async () => {
      await service.disableEncryption();

      expect(mockSnapshotUploadService.uploadSnapshot).toHaveBeenCalledWith(
        mockSyncProvider as any,
        { task: [] }, // Raw state, not encrypted
        'testClient1',
        { testClient1: 1 },
        false, // isPayloadEncrypted
      );
    });

    it('should update config with encryption disabled AFTER successful upload', async () => {
      await service.disableEncryption();

      expect(mockSnapshotUploadService.uploadSnapshot).toHaveBeenCalledBefore(
        mockSyncProvider.setPrivateCfg,
      );
      expect(mockSyncProvider.setPrivateCfg).toHaveBeenCalledWith(
        jasmine.objectContaining({
          encryptKey: undefined,
          isEncryptionEnabled: false,
        }),
      );
    });

    it('should update lastServerSeq after successful upload', async () => {
      await service.disableEncryption();

      expect(mockSnapshotUploadService.updateLastServerSeq).toHaveBeenCalledWith(
        mockSyncProvider as any,
        1,
        'EncryptionDisableService',
      );
    });

    it('should NOT update config on upload failure', async () => {
      mockSnapshotUploadService.uploadSnapshot.and.rejectWith(new Error('Network error'));

      await expectAsync(service.disableEncryption()).toBeRejected();

      // Config should NOT be updated when upload fails
      expect(mockSyncProvider.setPrivateCfg).not.toHaveBeenCalled();
    });

    it('should throw with CRITICAL message on upload failure', async () => {
      mockSnapshotUploadService.uploadSnapshot.and.rejectWith(new Error('Network error'));

      await expectAsync(service.disableEncryption()).toBeRejectedWithError(
        /CRITICAL.*Network error/,
      );
    });

    it('should throw when upload returns not accepted', async () => {
      mockSnapshotUploadService.uploadSnapshot.and.resolveTo({
        accepted: false,
        error: 'Server rejected',
      });

      await expectAsync(service.disableEncryption()).toBeRejectedWithError(
        /CRITICAL.*Server rejected/,
      );
    });

    it('should preserve other config properties when disabling encryption', async () => {
      await service.disableEncryption();

      expect(mockSyncProvider.setPrivateCfg).toHaveBeenCalledWith(
        jasmine.objectContaining({
          baseUrl: 'https://test.example.com',
          accessToken: 'test-token',
        }),
      );
    });
  });

  describe('disableEncryptionForFileBased', () => {
    let mockFileBasedProvider: jasmine.SpyObj<
      SyncProviderServiceInterface<SyncProviderId>
    >;
    let mockAdapter: jasmine.SpyObj<OperationSyncCapable>;

    beforeEach(() => {
      mockFileBasedProvider = jasmine.createSpyObj('FileBasedProvider', [
        'isReady',
        'setPrivateCfg',
      ]);
      mockFileBasedProvider.id = SyncProviderId.Dropbox;
      mockFileBasedProvider.isReady.and.resolveTo(true);
      mockFileBasedProvider.setPrivateCfg.and.resolveTo();
      mockFileBasedProvider.privateCfg = {
        load: () => Promise.resolve({ encryptKey: 'test-key' }),
      } as any;

      mockAdapter = jasmine.createSpyObj('Adapter', [
        'uploadSnapshot',
        'setLastServerSeq',
      ]);
      mockAdapter.uploadSnapshot.and.resolveTo({
        accepted: true,
        serverSeq: 1,
      });
      mockAdapter.setLastServerSeq.and.resolveTo();

      mockProviderManager.getActiveProvider.and.returnValue(mockFileBasedProvider);
      mockFileBasedAdapter.createAdapter.and.returnValue(mockAdapter);
    });

    it('should throw when no active provider', async () => {
      mockProviderManager.getActiveProvider.and.returnValue(null);

      await expectAsync(service.disableEncryptionForFileBased()).toBeRejectedWithError(
        /No active sync provider/,
      );
    });

    it('should throw when provider is SuperSync (not file-based)', async () => {
      const superSyncProvider = jasmine.createSpyObj('SuperSyncProvider', ['isReady']);
      superSyncProvider.id = SyncProviderId.SuperSync;
      mockProviderManager.getActiveProvider.and.returnValue(superSyncProvider);

      await expectAsync(service.disableEncryptionForFileBased()).toBeRejectedWithError(
        /only supported for file-based providers/,
      );
    });

    it('should throw when provider is not ready', async () => {
      mockFileBasedProvider.isReady.and.resolveTo(false);

      await expectAsync(service.disableEncryptionForFileBased()).toBeRejectedWithError(
        /not ready/,
      );
    });

    it('should create unencrypted adapter and upload snapshot', async () => {
      await service.disableEncryptionForFileBased();

      expect(mockFileBasedAdapter.createAdapter).toHaveBeenCalledWith(
        mockFileBasedProvider,
        jasmine.objectContaining({ isEncrypt: false }),
        undefined, // No encryption key
      );
      expect(mockAdapter.uploadSnapshot).toHaveBeenCalled();
    });

    it('should update config after successful upload', async () => {
      await service.disableEncryptionForFileBased();

      expect(mockFileBasedProvider.setPrivateCfg).toHaveBeenCalledWith(
        jasmine.objectContaining({
          encryptKey: undefined,
        }),
      );
    });

    it('should NOT update config on upload failure', async () => {
      mockAdapter.uploadSnapshot.and.rejectWith(new Error('Network error'));

      await expectAsync(service.disableEncryptionForFileBased()).toBeRejected();

      expect(mockFileBasedProvider.setPrivateCfg).not.toHaveBeenCalled();
    });

    it('should clear cache after successful upload', async () => {
      await service.disableEncryptionForFileBased();

      expect(mockWrappedProviderService.clearCache).toHaveBeenCalled();
    });

    it('should update global config to disable encryption', async () => {
      await service.disableEncryptionForFileBased();

      expect(mockGlobalConfigService.updateSection).toHaveBeenCalledWith('sync', {
        isEncryptionEnabled: false,
        encryptKey: '',
      });
    });
  });
});
