import { TestBed } from '@angular/core/testing';
import { SuperSyncEncryptionToggleService } from './supersync-encryption-toggle.service';
import { SnapshotUploadData, SnapshotUploadService } from './snapshot-upload.service';
import { OperationEncryptionService } from '../../op-log/sync/operation-encryption.service';
import { WrappedProviderService } from '../../op-log/sync-providers/wrapped-provider.service';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { SyncProviderId } from '../../op-log/sync-providers/provider.const';
import {
  OperationSyncCapable,
  SyncProviderServiceInterface,
} from '../../op-log/sync-providers/provider.interface';
import { SuperSyncPrivateCfg } from '../../op-log/sync-providers/super-sync/super-sync.model';

describe('SuperSyncEncryptionToggleService', () => {
  let service: SuperSyncEncryptionToggleService;
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

  const mockState = { task: [], project: [] };
  const mockVectorClock = { testClient1: 1 };
  const mockClientId = 'testClient1';

  beforeEach(() => {
    mockSyncProvider = jasmine.createSpyObj('SyncProvider', [
      'deleteAllData',
      'setPrivateCfg',
    ]);
    mockSyncProvider.id = SyncProviderId.SuperSync;
    mockSyncProvider.deleteAllData.and.resolveTo({ success: true });
    mockSyncProvider.setPrivateCfg.and.resolveTo();
    mockSyncProvider.privateCfg = {
      load: jasmine.createSpy('load').and.resolveTo(mockExistingCfg),
    } as any;
    (mockSyncProvider as any).supportsOperationSync = true;

    mockProviderManager = jasmine.createSpyObj('SyncProviderManager', [
      'getActiveProvider',
      'setProviderConfig',
    ]);
    mockProviderManager.getActiveProvider.and.returnValue(mockSyncProvider as any);
    mockProviderManager.setProviderConfig.and.resolveTo();

    mockSnapshotUploadService = jasmine.createSpyObj('SnapshotUploadService', [
      'gatherSnapshotData',
      'uploadSnapshot',
      'updateLastServerSeq',
    ]);
    mockSnapshotUploadService.gatherSnapshotData.and.resolveTo({
      syncProvider: mockSyncProvider,
      existingCfg: mockExistingCfg,
      state: mockState,
      vectorClock: mockVectorClock,
      clientId: mockClientId,
    } as unknown as SnapshotUploadData);
    mockSnapshotUploadService.uploadSnapshot.and.resolveTo({
      accepted: true,
      serverSeq: 42,
    });
    mockSnapshotUploadService.updateLastServerSeq.and.resolveTo();

    mockEncryptionService = jasmine.createSpyObj('OperationEncryptionService', [
      'encryptPayload',
    ]);
    mockEncryptionService.encryptPayload.and.resolveTo('encrypted-state-data');

    mockWrappedProviderService = jasmine.createSpyObj('WrappedProviderService', [
      'clearCache',
    ]);

    TestBed.configureTestingModule({
      providers: [
        SuperSyncEncryptionToggleService,
        { provide: SnapshotUploadService, useValue: mockSnapshotUploadService },
        { provide: OperationEncryptionService, useValue: mockEncryptionService },
        { provide: WrappedProviderService, useValue: mockWrappedProviderService },
        { provide: SyncProviderManager, useValue: mockProviderManager },
      ],
    });

    service = TestBed.inject(SuperSyncEncryptionToggleService);
  });

  describe('enableEncryption', () => {
    it('should throw when encryptKey is empty', async () => {
      await expectAsync(service.enableEncryption('')).toBeRejectedWithError(
        'Encryption key is required',
      );
    });

    it('should skip when encryption is already enabled', async () => {
      (mockSyncProvider.privateCfg.load as jasmine.Spy).and.resolveTo({
        ...mockExistingCfg,
        isEncryptionEnabled: true,
        encryptKey: 'existing-key',
      });

      await service.enableEncryption('new-key');

      expect(mockSnapshotUploadService.gatherSnapshotData).not.toHaveBeenCalled();
    });

    it('should delete server data before enabling encryption', async () => {
      await service.enableEncryption('my-secret-key');

      expect(mockSyncProvider.deleteAllData).toHaveBeenCalledTimes(1);
      expect(mockSyncProvider.deleteAllData).toHaveBeenCalledBefore(
        mockSnapshotUploadService.uploadSnapshot,
      );
    });

    it('should update config BEFORE upload via providerManager.setProviderConfig', async () => {
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
        mockState,
        'my-secret-key',
      );
    });

    it('should upload encrypted snapshot with isPayloadEncrypted=true', async () => {
      await service.enableEncryption('my-secret-key');

      expect(mockSnapshotUploadService.uploadSnapshot).toHaveBeenCalledWith(
        mockSyncProvider as any,
        'encrypted-state-data',
        mockClientId,
        mockVectorClock,
        true,
      );
    });

    it('should update lastServerSeq after successful upload', async () => {
      await service.enableEncryption('my-secret-key');

      expect(mockSnapshotUploadService.updateLastServerSeq).toHaveBeenCalledWith(
        mockSyncProvider as any,
        42,
        'SuperSyncEncryptionToggleService',
      );
    });

    it('should clear wrapped provider cache after config update', async () => {
      await service.enableEncryption('my-secret-key');

      expect(mockWrappedProviderService.clearCache).toHaveBeenCalled();
    });

    it('should revert config on upload failure', async () => {
      mockSnapshotUploadService.uploadSnapshot.and.resolveTo({
        accepted: false,
        error: 'Server rejected',
      });

      await expectAsync(service.enableEncryption('my-secret-key')).toBeRejectedWithError(
        /CRITICAL/,
      );

      // First call: set new config (before upload)
      expect(mockProviderManager.setProviderConfig).toHaveBeenCalledWith(
        SyncProviderId.SuperSync,
        jasmine.objectContaining({
          encryptKey: 'my-secret-key',
          isEncryptionEnabled: true,
        }),
      );

      // Second call: revert config (after upload failure)
      expect(mockProviderManager.setProviderConfig).toHaveBeenCalledWith(
        SyncProviderId.SuperSync,
        jasmine.objectContaining({
          encryptKey: undefined,
          isEncryptionEnabled: false,
        }),
      );

      expect(mockProviderManager.setProviderConfig).toHaveBeenCalledTimes(2);
    });

    it('should throw with CRITICAL message on upload failure', async () => {
      mockSnapshotUploadService.uploadSnapshot.and.resolveTo({
        accepted: false,
        error: 'Server rejected',
      });

      await expectAsync(service.enableEncryption('my-secret-key')).toBeRejectedWithError(
        /CRITICAL: Failed to upload encrypted snapshot after deleting server data/,
      );
    });

    it('should throw with CRITICAL message when uploadSnapshot throws', async () => {
      mockSnapshotUploadService.uploadSnapshot.and.rejectWith(new Error('Network error'));

      await expectAsync(service.enableEncryption('my-secret-key')).toBeRejectedWithError(
        /CRITICAL.*Network error/,
      );
    });

    it('should preserve existing config properties when enabling encryption', async () => {
      const existingCfg: SuperSyncPrivateCfg = {
        baseUrl: 'https://custom-server.com',
        accessToken: 'my-access-token',
        refreshToken: 'my-refresh-token',
        isEncryptionEnabled: false,
        encryptKey: undefined,
      };
      mockSnapshotUploadService.gatherSnapshotData.and.resolveTo({
        syncProvider: mockSyncProvider,
        existingCfg,
        state: mockState,
        vectorClock: mockVectorClock,
        clientId: mockClientId,
      } as unknown as SnapshotUploadData);

      await service.enableEncryption('my-secret-key');

      expect(mockProviderManager.setProviderConfig).toHaveBeenCalledWith(
        SyncProviderId.SuperSync,
        jasmine.objectContaining({
          baseUrl: 'https://custom-server.com',
          accessToken: 'my-access-token',
          refreshToken: 'my-refresh-token',
          encryptKey: 'my-secret-key',
          isEncryptionEnabled: true,
        }),
      );
    });

    it('should execute steps in correct order', async () => {
      const callOrder: string[] = [];

      mockSnapshotUploadService.gatherSnapshotData.and.callFake(async () => {
        callOrder.push('gatherSnapshotData');
        return {
          syncProvider: mockSyncProvider,
          existingCfg: mockExistingCfg,
          state: mockState,
          vectorClock: mockVectorClock,
          clientId: mockClientId,
        } as unknown as SnapshotUploadData;
      });

      mockSyncProvider.deleteAllData.and.callFake(async () => {
        callOrder.push('deleteAllData');
        return { success: true };
      });

      mockProviderManager.setProviderConfig.and.callFake(async () => {
        callOrder.push('setProviderConfig');
      });

      mockWrappedProviderService.clearCache.and.callFake(() => {
        callOrder.push('clearCache');
      });

      mockEncryptionService.encryptPayload.and.callFake(async () => {
        callOrder.push('encryptPayload');
        return 'encrypted-data';
      });

      mockSnapshotUploadService.uploadSnapshot.and.callFake(async () => {
        callOrder.push('uploadSnapshot');
        return { accepted: true, serverSeq: 42 };
      });

      mockSnapshotUploadService.updateLastServerSeq.and.callFake(async () => {
        callOrder.push('updateLastServerSeq');
      });

      await service.enableEncryption('my-secret-key');

      expect(callOrder).toEqual([
        'gatherSnapshotData',
        'deleteAllData',
        'setProviderConfig',
        'clearCache',
        'encryptPayload',
        'uploadSnapshot',
        'updateLastServerSeq',
      ]);
    });
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
        mockState,
        mockClientId,
        mockVectorClock,
        false,
      );
    });

    it('should update config with encryption disabled AFTER successful upload', async () => {
      await service.disableEncryption();

      expect(mockSyncProvider.setPrivateCfg).toHaveBeenCalledWith(
        jasmine.objectContaining({
          encryptKey: undefined,
          isEncryptionEnabled: false,
        }),
      );
      // Upload should happen BEFORE config update
      expect(mockSnapshotUploadService.uploadSnapshot).toHaveBeenCalledBefore(
        mockSyncProvider.setPrivateCfg,
      );
    });

    it('should update lastServerSeq after successful upload', async () => {
      await service.disableEncryption();

      expect(mockSnapshotUploadService.updateLastServerSeq).toHaveBeenCalledWith(
        mockSyncProvider as any,
        42,
        'SuperSyncEncryptionToggleService',
      );
    });

    it('should clear wrapped provider cache after disabling', async () => {
      await service.disableEncryption();

      expect(mockWrappedProviderService.clearCache).toHaveBeenCalled();
    });

    it('should NOT update config on upload failure', async () => {
      mockSnapshotUploadService.uploadSnapshot.and.resolveTo({
        accepted: false,
        error: 'Server rejected',
      });

      await expectAsync(service.disableEncryption()).toBeRejectedWithError(/CRITICAL/);

      expect(mockSyncProvider.setPrivateCfg).not.toHaveBeenCalled();
    });

    it('should throw with CRITICAL message on upload failure', async () => {
      mockSnapshotUploadService.uploadSnapshot.and.resolveTo({
        accepted: false,
        error: 'Server rejected',
      });

      await expectAsync(service.disableEncryption()).toBeRejectedWithError(
        /CRITICAL: Failed to upload unencrypted snapshot after deleting server data/,
      );
    });

    it('should throw with CRITICAL message when uploadSnapshot throws', async () => {
      mockSnapshotUploadService.uploadSnapshot.and.rejectWith(new Error('Network error'));

      await expectAsync(service.disableEncryption()).toBeRejectedWithError(
        /CRITICAL.*Network error/,
      );
    });

    it('should preserve other config properties when disabling encryption', async () => {
      const existingCfg: SuperSyncPrivateCfg = {
        baseUrl: 'https://custom-server.com',
        accessToken: 'my-access-token',
        refreshToken: 'my-refresh-token',
        isEncryptionEnabled: true,
        encryptKey: 'old-key',
      };
      mockSnapshotUploadService.gatherSnapshotData.and.resolveTo({
        syncProvider: mockSyncProvider,
        existingCfg,
        state: mockState,
        vectorClock: mockVectorClock,
        clientId: mockClientId,
      } as unknown as SnapshotUploadData);

      await service.disableEncryption();

      expect(mockSyncProvider.setPrivateCfg).toHaveBeenCalledWith(
        jasmine.objectContaining({
          baseUrl: 'https://custom-server.com',
          accessToken: 'my-access-token',
          refreshToken: 'my-refresh-token',
          encryptKey: undefined,
          isEncryptionEnabled: false,
        }),
      );
    });

    it('should NOT encrypt the payload', async () => {
      await service.disableEncryption();

      expect(mockEncryptionService.encryptPayload).not.toHaveBeenCalled();
    });

    it('should execute steps in correct order', async () => {
      const callOrder: string[] = [];

      mockSnapshotUploadService.gatherSnapshotData.and.callFake(async () => {
        callOrder.push('gatherSnapshotData');
        return {
          syncProvider: mockSyncProvider,
          existingCfg: mockExistingCfg,
          state: mockState,
          vectorClock: mockVectorClock,
          clientId: mockClientId,
        } as unknown as SnapshotUploadData;
      });

      mockSyncProvider.deleteAllData.and.callFake(async () => {
        callOrder.push('deleteAllData');
        return { success: true };
      });

      mockSnapshotUploadService.uploadSnapshot.and.callFake(async () => {
        callOrder.push('uploadSnapshot');
        return { accepted: true, serverSeq: 42 };
      });

      mockSnapshotUploadService.updateLastServerSeq.and.callFake(async () => {
        callOrder.push('updateLastServerSeq');
      });

      mockSyncProvider.setPrivateCfg.and.callFake(async () => {
        callOrder.push('setPrivateCfg');
      });

      mockWrappedProviderService.clearCache.and.callFake(() => {
        callOrder.push('clearCache');
      });

      await service.disableEncryption();

      expect(callOrder).toEqual([
        'gatherSnapshotData',
        'deleteAllData',
        'uploadSnapshot',
        'updateLastServerSeq',
        'setPrivateCfg',
        'clearCache',
      ]);
    });
  });
});
