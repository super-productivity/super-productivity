import { TestBed } from '@angular/core/testing';
import { SuperSyncEncryptionToggleService } from './supersync-encryption-toggle.service';
import { SnapshotUploadService } from './snapshot-upload.service';
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
      'deleteAndReuploadWithNewEncryption',
    ]);
    mockSnapshotUploadService.deleteAndReuploadWithNewEncryption.and.resolveTo({
      accepted: true,
      serverSeq: 42,
      existingCfg: mockExistingCfg,
    });

    TestBed.configureTestingModule({
      providers: [
        SuperSyncEncryptionToggleService,
        { provide: SnapshotUploadService, useValue: mockSnapshotUploadService },
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

      expect(
        mockSnapshotUploadService.deleteAndReuploadWithNewEncryption,
      ).not.toHaveBeenCalled();
    });

    it('should delegate to deleteAndReuploadWithNewEncryption with correct params', async () => {
      await service.enableEncryption('my-secret-key');

      expect(
        mockSnapshotUploadService.deleteAndReuploadWithNewEncryption,
      ).toHaveBeenCalledWith({
        encryptKey: 'my-secret-key',
        isEncryptionEnabled: true,
        logPrefix: 'SuperSyncEncryptionToggleService',
      });
    });

    it('should revert config on failure using pre-captured config (preserving auth credentials)', async () => {
      mockSnapshotUploadService.deleteAndReuploadWithNewEncryption.and.rejectWith(
        new Error('Upload failed'),
      );

      await expectAsync(service.enableEncryption('my-secret-key')).toBeRejectedWithError(
        /Failed to upload encrypted snapshot/,
      );

      // Should revert using the config captured BEFORE the destructive call
      expect(mockProviderManager.setProviderConfig).toHaveBeenCalledWith(
        SyncProviderId.SuperSync,
        jasmine.objectContaining({
          baseUrl: 'https://test.example.com',
          accessToken: 'test-token',
          encryptKey: undefined,
          isEncryptionEnabled: false,
        }),
      );
    });

    it('should throw with descriptive message including reason on failure', async () => {
      mockSnapshotUploadService.deleteAndReuploadWithNewEncryption.and.rejectWith(
        new Error('Server rejected'),
      );

      await expectAsync(service.enableEncryption('my-secret-key')).toBeRejectedWithError(
        /Failed to upload encrypted snapshot.*Reason: Server rejected/,
      );
    });

    it('should preserve original error as cause', async () => {
      const originalError = new Error('Network error');
      mockSnapshotUploadService.deleteAndReuploadWithNewEncryption.and.rejectWith(
        originalError,
      );

      try {
        await service.enableEncryption('my-secret-key');
        fail('Expected error to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toMatch(/Reason: Network error/);
        expect((error as Error).cause).toBe(originalError);
      }
    });
  });

  describe('disableEncryption', () => {
    it('should delegate to deleteAndReuploadWithNewEncryption with correct params', async () => {
      await service.disableEncryption();

      expect(
        mockSnapshotUploadService.deleteAndReuploadWithNewEncryption,
      ).toHaveBeenCalledWith({
        encryptKey: undefined,
        isEncryptionEnabled: false,
        logPrefix: 'SuperSyncEncryptionToggleService',
      });
    });

    it('should revert config to original state (including encryption key) on failure', async () => {
      // Set up initial state: encryption is enabled with a key
      const encryptedCfg: SuperSyncPrivateCfg = {
        ...mockExistingCfg,
        isEncryptionEnabled: true,
        encryptKey: 'original-key',
      };
      (mockSyncProvider.privateCfg.load as jasmine.Spy).and.resolveTo(encryptedCfg);

      mockSnapshotUploadService.deleteAndReuploadWithNewEncryption.and.rejectWith(
        new Error('Upload failed'),
      );

      await expectAsync(service.disableEncryption()).toBeRejectedWithError(
        /Failed to upload unencrypted snapshot/,
      );

      // Should restore the original config including the encryption key
      expect(mockProviderManager.setProviderConfig).toHaveBeenCalledWith(
        SyncProviderId.SuperSync,
        encryptedCfg,
      );
    });

    it('should throw with descriptive message including reason on failure', async () => {
      mockSnapshotUploadService.deleteAndReuploadWithNewEncryption.and.rejectWith(
        new Error('Server rejected'),
      );

      await expectAsync(service.disableEncryption()).toBeRejectedWithError(
        /Failed to upload unencrypted snapshot.*Reason: Server rejected/,
      );
    });

    it('should preserve original error as cause', async () => {
      const originalError = new Error('Network error');
      mockSnapshotUploadService.deleteAndReuploadWithNewEncryption.and.rejectWith(
        originalError,
      );

      try {
        await service.disableEncryption();
        fail('Expected error to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toMatch(/Reason: Network error/);
        expect((error as Error).cause).toBe(originalError);
      }
    });
  });
});
