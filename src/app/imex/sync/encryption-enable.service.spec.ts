import { TestBed } from '@angular/core/testing';
import { EncryptionEnableService } from './encryption-enable.service';
import { SnapshotUploadData, SnapshotUploadService } from './snapshot-upload.service';
import { OperationEncryptionService } from '../../op-log/sync/operation-encryption.service';
import { SyncProviderId } from '../../op-log/sync-providers/provider.const';
import {
  OperationSyncCapable,
  SyncProviderServiceInterface,
} from '../../op-log/sync-providers/provider.interface';
import { SuperSyncPrivateCfg } from '../../op-log/sync-providers/super-sync/super-sync.model';
import { WrappedProviderService } from '../../op-log/sync-providers/wrapped-provider.service';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';

describe('EncryptionEnableService', () => {
  let service: EncryptionEnableService;
  let mockSnapshotUploadService: jasmine.SpyObj<SnapshotUploadService>;
  let mockEncryptionService: jasmine.SpyObj<OperationEncryptionService>;
  let mockWrappedProviderService: jasmine.SpyObj<WrappedProviderService>;
  let mockProviderManager: jasmine.SpyObj<SyncProviderManager>;
  let mockSyncProvider: jasmine.SpyObj<
    SyncProviderServiceInterface<SyncProviderId> & OperationSyncCapable
  >;

  const mockExistingCfg: SuperSyncPrivateCfg = {
    baseUrl: 'https://test.example.com',
    accessToken: 'test-token',
    isEncryptionEnabled: false,
    encryptKey: undefined,
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

    mockEncryptionService = jasmine.createSpyObj('OperationEncryptionService', [
      'encryptPayload',
    ]);
    mockEncryptionService.encryptPayload.and.resolveTo('encrypted-data');

    mockWrappedProviderService = jasmine.createSpyObj('WrappedProviderService', [
      'clearCache',
    ]);

    mockProviderManager = jasmine.createSpyObj('SyncProviderManager', [
      'setProviderConfig',
    ]);
    mockProviderManager.setProviderConfig.and.resolveTo();

    TestBed.configureTestingModule({
      providers: [
        EncryptionEnableService,
        { provide: SnapshotUploadService, useValue: mockSnapshotUploadService },
        { provide: OperationEncryptionService, useValue: mockEncryptionService },
        { provide: WrappedProviderService, useValue: mockWrappedProviderService },
        { provide: SyncProviderManager, useValue: mockProviderManager },
      ],
    });

    service = TestBed.inject(EncryptionEnableService);
  });

  describe('enableEncryption', () => {
    it('should throw when encryptKey is empty', async () => {
      await expectAsync(service.enableEncryption('')).toBeRejectedWithError(
        'Encryption key is required',
      );
    });

    it('should delete server data before enabling encryption', async () => {
      await service.enableEncryption('my-secret-key');

      expect(mockSyncProvider.deleteAllData).toHaveBeenCalledTimes(1);
      expect(mockSyncProvider.deleteAllData).toHaveBeenCalledBefore(
        mockProviderManager.setProviderConfig,
      );
    });

    it('should update config with encryption enabled BEFORE upload', async () => {
      await service.enableEncryption('my-secret-key');

      expect(mockProviderManager.setProviderConfig).toHaveBeenCalledWith(
        SyncProviderId.SuperSync,
        jasmine.objectContaining({
          encryptKey: 'my-secret-key',
          isEncryptionEnabled: true,
        }),
      );
      expect(mockProviderManager.setProviderConfig).toHaveBeenCalledBefore(
        mockSnapshotUploadService.uploadSnapshot,
      );
    });

    it('should encrypt the state before uploading', async () => {
      await service.enableEncryption('my-secret-key');

      expect(mockEncryptionService.encryptPayload).toHaveBeenCalledWith(
        { task: [] },
        'my-secret-key',
      );
    });

    it('should upload encrypted snapshot with isPayloadEncrypted=true', async () => {
      await service.enableEncryption('my-secret-key');

      expect(mockSnapshotUploadService.uploadSnapshot).toHaveBeenCalledWith(
        mockSyncProvider as any,
        'encrypted-data',
        'testClient1',
        { testClient1: 1 },
        true, // isPayloadEncrypted
      );
    });

    it('should update lastServerSeq after successful upload', async () => {
      await service.enableEncryption('my-secret-key');

      expect(mockSnapshotUploadService.updateLastServerSeq).toHaveBeenCalledWith(
        mockSyncProvider as any,
        1,
        'EncryptionEnableService',
      );
    });

    it('should revert config on upload failure', async () => {
      mockSnapshotUploadService.uploadSnapshot.and.rejectWith(new Error('Network error'));

      await expectAsync(service.enableEncryption('my-secret-key')).toBeRejected();

      // Should have called setProviderConfig twice:
      // 1. Enable encryption before upload
      // 2. Revert to unencrypted on failure
      expect(mockProviderManager.setProviderConfig).toHaveBeenCalledTimes(2);

      // Second call should revert to unencrypted state
      const revertCall = mockProviderManager.setProviderConfig.calls.mostRecent();
      expect(revertCall.args[1]).toEqual(
        jasmine.objectContaining({
          encryptKey: undefined,
          isEncryptionEnabled: false,
        }),
      );
    });

    it('should throw with CRITICAL message on upload failure', async () => {
      mockSnapshotUploadService.uploadSnapshot.and.rejectWith(new Error('Network error'));

      await expectAsync(service.enableEncryption('my-secret-key')).toBeRejectedWithError(
        /CRITICAL.*Network error/,
      );
    });

    it('should revert config when upload returns not accepted', async () => {
      mockSnapshotUploadService.uploadSnapshot.and.resolveTo({
        accepted: false,
        error: 'Server rejected',
      });

      await expectAsync(service.enableEncryption('my-secret-key')).toBeRejected();

      // Second call should revert
      expect(mockProviderManager.setProviderConfig).toHaveBeenCalledTimes(2);
    });
  });
});
