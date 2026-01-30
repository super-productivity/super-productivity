import { TestBed } from '@angular/core/testing';
import { ImportEncryptionHandlerService } from './import-encryption-handler.service';
import { SnapshotUploadData, SnapshotUploadService } from './snapshot-upload.service';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { OperationEncryptionService } from '../../op-log/sync/operation-encryption.service';
import { SyncProviderId } from '../../op-log/sync-providers/provider.const';
import {
  OperationSyncCapable,
  SyncProviderServiceInterface,
} from '../../op-log/sync-providers/provider.interface';
import { SuperSyncPrivateCfg } from '../../op-log/sync-providers/super-sync/super-sync.model';
import { AppDataComplete } from '../../op-log/model/model-config';

describe('ImportEncryptionHandlerService', () => {
  let service: ImportEncryptionHandlerService;
  let mockSnapshotUploadService: jasmine.SpyObj<SnapshotUploadService>;
  let mockProviderManager: jasmine.SpyObj<SyncProviderManager>;
  let mockEncryptionService: jasmine.SpyObj<OperationEncryptionService>;
  let mockSyncProvider: jasmine.SpyObj<
    SyncProviderServiceInterface<SyncProviderId> & OperationSyncCapable
  >;

  const createMockImportedData = (
    isEncryptionEnabled?: boolean,
    encryptKey?: string,
  ): AppDataComplete =>
    ({
      globalConfig: {
        sync: {
          superSync: {
            isEncryptionEnabled,
            encryptKey,
          },
        },
      },
    }) as unknown as AppDataComplete;

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
    mockSyncProvider.privateCfg = {
      load: jasmine.createSpy('load').and.resolveTo(mockExistingCfg),
    } as any;

    mockProviderManager = jasmine.createSpyObj('SyncProviderManager', [
      'getActiveProvider',
    ]);
    mockProviderManager.getActiveProvider.and.returnValue(mockSyncProvider as any);

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

    TestBed.configureTestingModule({
      providers: [
        ImportEncryptionHandlerService,
        { provide: SyncProviderManager, useValue: mockProviderManager },
        { provide: SnapshotUploadService, useValue: mockSnapshotUploadService },
        { provide: OperationEncryptionService, useValue: mockEncryptionService },
      ],
    });

    service = TestBed.inject(ImportEncryptionHandlerService);
  });

  describe('checkEncryptionStateChange', () => {
    it('should return no change when provider is not SuperSync', async () => {
      mockProviderManager.getActiveProvider.and.returnValue(null);

      const result = await service.checkEncryptionStateChange(createMockImportedData());

      expect(result.willChange).toBeFalse();
    });

    it('should detect change from unencrypted to encrypted', async () => {
      // Current: unencrypted (default mockExistingCfg)
      const importedData = createMockImportedData(true, 'new-key');

      const result = await service.checkEncryptionStateChange(importedData);

      expect(result.willChange).toBeTrue();
      expect(result.currentEnabled).toBeFalse();
      expect(result.importedEnabled).toBeTrue();
    });

    it('should detect change from encrypted to unencrypted', async () => {
      // Current: encrypted
      (mockSyncProvider.privateCfg.load as jasmine.Spy).and.resolveTo({
        ...mockExistingCfg,
        isEncryptionEnabled: true,
        encryptKey: 'current-key',
      });
      const importedData = createMockImportedData(false);

      const result = await service.checkEncryptionStateChange(importedData);

      expect(result.willChange).toBeTrue();
      expect(result.currentEnabled).toBeTrue();
      expect(result.importedEnabled).toBeFalse();
    });

    it('should detect no change when both are unencrypted', async () => {
      const importedData = createMockImportedData(false);

      const result = await service.checkEncryptionStateChange(importedData);

      expect(result.willChange).toBeFalse();
    });

    it('should detect no change when both are encrypted', async () => {
      (mockSyncProvider.privateCfg.load as jasmine.Spy).and.resolveTo({
        ...mockExistingCfg,
        isEncryptionEnabled: true,
        encryptKey: 'current-key',
      });
      const importedData = createMockImportedData(true, 'new-key');

      const result = await service.checkEncryptionStateChange(importedData);

      // Same enabled state = no change (key differences handled separately)
      expect(result.willChange).toBeFalse();
    });
  });

  describe('handleEncryptionStateChange', () => {
    it('should return error result when provider validation fails', async () => {
      mockSnapshotUploadService.gatherSnapshotData.and.rejectWith(
        new Error('No active provider'),
      );

      const result = await service.handleEncryptionStateChange(
        createMockImportedData(),
        undefined,
        false,
      );

      expect(result.encryptionStateChanged).toBeFalse();
      expect(result.serverDataDeleted).toBeFalse();
      expect(result.error).toContain('No active provider');
    });

    it('should delete server data before uploading', async () => {
      await service.handleEncryptionStateChange(
        createMockImportedData(),
        undefined,
        false,
      );

      expect(mockSyncProvider.deleteAllData).toHaveBeenCalledTimes(1);
      expect(mockSyncProvider.deleteAllData).toHaveBeenCalledBefore(
        mockSnapshotUploadService.uploadSnapshot,
      );
    });

    it('should update provider config before uploading', async () => {
      await service.handleEncryptionStateChange(
        createMockImportedData(),
        'new-key',
        true,
      );

      expect(mockSyncProvider.setPrivateCfg).toHaveBeenCalledWith(
        jasmine.objectContaining({
          encryptKey: 'new-key',
          isEncryptionEnabled: true,
        }),
      );
      expect(mockSyncProvider.setPrivateCfg).toHaveBeenCalledBefore(
        mockSnapshotUploadService.uploadSnapshot,
      );
    });

    it('should encrypt payload when encryption is enabled', async () => {
      await service.handleEncryptionStateChange(
        createMockImportedData(),
        'new-key',
        true,
      );

      expect(mockEncryptionService.encryptPayload).toHaveBeenCalledWith(
        { task: [] },
        'new-key',
      );
    });

    it('should NOT encrypt payload when encryption is disabled', async () => {
      await service.handleEncryptionStateChange(
        createMockImportedData(),
        undefined,
        false,
      );

      expect(mockEncryptionService.encryptPayload).not.toHaveBeenCalled();
    });

    it('should return success result on successful upload', async () => {
      const result = await service.handleEncryptionStateChange(
        createMockImportedData(),
        undefined,
        false,
      );

      expect(result.encryptionStateChanged).toBeTrue();
      expect(result.serverDataDeleted).toBeTrue();
      expect(result.snapshotUploaded).toBeTrue();
      expect(result.error).toBeUndefined();
    });

    it('should return error result when upload fails', async () => {
      mockSnapshotUploadService.uploadSnapshot.and.rejectWith(new Error('Network error'));

      const result = await service.handleEncryptionStateChange(
        createMockImportedData(),
        undefined,
        false,
      );

      expect(result.encryptionStateChanged).toBeTrue();
      expect(result.snapshotUploaded).toBeFalse();
      expect(result.error).toContain('Network error');
    });

    it('should update lastServerSeq after successful upload', async () => {
      await service.handleEncryptionStateChange(
        createMockImportedData(),
        undefined,
        false,
      );

      expect(mockSnapshotUploadService.updateLastServerSeq).toHaveBeenCalledWith(
        mockSyncProvider as any,
        1,
        'ImportEncryptionHandlerService',
      );
    });
  });

  describe('handleImportEncryptionIfNeeded', () => {
    it('should return null when no encryption state change', async () => {
      // Both unencrypted - no change
      const importedData = createMockImportedData(false);

      const result = await service.handleImportEncryptionIfNeeded(importedData);

      expect(result).toBeNull();
      expect(mockSyncProvider.deleteAllData).not.toHaveBeenCalled();
    });

    it('should handle encryption state change when detected', async () => {
      // Change from unencrypted to encrypted
      const importedData = createMockImportedData(true, 'new-key');

      const result = await service.handleImportEncryptionIfNeeded(importedData);

      expect(result).not.toBeNull();
      expect(result?.encryptionStateChanged).toBeTrue();
      expect(mockSyncProvider.deleteAllData).toHaveBeenCalled();
    });

    it('should pass correct encryption key from imported data', async () => {
      const importedData = createMockImportedData(true, 'imported-encryption-key');

      await service.handleImportEncryptionIfNeeded(importedData);

      expect(mockSyncProvider.setPrivateCfg).toHaveBeenCalledWith(
        jasmine.objectContaining({
          encryptKey: 'imported-encryption-key',
          isEncryptionEnabled: true,
        }),
      );
    });
  });
});
