import { TestBed } from '@angular/core/testing';
import { EncryptionPasswordChangeService } from './encryption-password-change.service';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { StateSnapshotService } from '../../op-log/backup/state-snapshot.service';
import { OperationEncryptionService } from '../../op-log/sync/operation-encryption.service';
import { VectorClockService } from '../../op-log/sync/vector-clock.service';
import { CLIENT_ID_PROVIDER } from '../../op-log/util/client-id.provider';
import { SyncProviderId } from '../../op-log/sync-providers/provider.const';

describe('EncryptionPasswordChangeService', () => {
  let service: EncryptionPasswordChangeService;
  let mockProviderManager: jasmine.SpyObj<any>;
  let mockStateSnapshotService: jasmine.SpyObj<StateSnapshotService>;
  let mockEncryptionService: jasmine.SpyObj<OperationEncryptionService>;
  let mockVectorClockService: jasmine.SpyObj<VectorClockService>;
  let mockClientIdProvider: jasmine.SpyObj<any>;
  let mockSyncProvider: jasmine.SpyObj<any>;

  const TEST_PASSWORD = 'new-secure-password-123';
  const TEST_CLIENT_ID = 'test-client-id-abc';
  const TEST_VECTOR_CLOCK = { client1: 5, client2: 3 };
  // Use any to avoid complex type requirements for AllSyncModels
  const TEST_CURRENT_STATE: any = {
    task: { ids: ['task1'], entities: { task1: { id: 'task1', title: 'Test Task' } } },
    project: {
      ids: ['proj1'],
      entities: { proj1: { id: 'proj1', title: 'Test Project' } },
    },
  };
  const TEST_ENCRYPTED_STATE = 'encrypted-state-base64-string';

  beforeEach(() => {
    // Create mock sync provider
    mockSyncProvider = jasmine.createSpyObj('SyncProvider', [
      'deleteAllData',
      'uploadSnapshot',
      'setPrivateCfg',
      'setLastServerSeq',
    ]);
    mockSyncProvider.id = SyncProviderId.SuperSync;
    mockSyncProvider.supportsOperationSync = true;
    mockSyncProvider.privateCfg = {
      load: jasmine.createSpy('load').and.returnValue(
        Promise.resolve({
          encryptKey: 'old-password',
          isEncryptionEnabled: true,
        }),
      ),
    };
    mockSyncProvider.deleteAllData.and.returnValue(Promise.resolve({ success: true }));
    mockSyncProvider.uploadSnapshot.and.returnValue(
      Promise.resolve({ accepted: true, serverSeq: 42 }),
    );
    mockSyncProvider.setPrivateCfg.and.returnValue(Promise.resolve());
    mockSyncProvider.setLastServerSeq.and.returnValue(Promise.resolve());

    // Create mock SyncProviderManager
    mockProviderManager = {
      getActiveProvider: jasmine
        .createSpy('getActiveProvider')
        .and.returnValue(mockSyncProvider),
    };

    mockStateSnapshotService = jasmine.createSpyObj('StateSnapshotService', [
      'getStateSnapshot',
    ]);
    mockStateSnapshotService.getStateSnapshot.and.returnValue(TEST_CURRENT_STATE);

    mockEncryptionService = jasmine.createSpyObj('OperationEncryptionService', [
      'encryptPayload',
    ]);
    mockEncryptionService.encryptPayload.and.returnValue(
      Promise.resolve(TEST_ENCRYPTED_STATE),
    );

    mockVectorClockService = jasmine.createSpyObj('VectorClockService', [
      'getCurrentVectorClock',
    ]);
    mockVectorClockService.getCurrentVectorClock.and.returnValue(
      Promise.resolve(TEST_VECTOR_CLOCK),
    );

    mockClientIdProvider = {
      loadClientId: jasmine
        .createSpy('loadClientId')
        .and.returnValue(Promise.resolve(TEST_CLIENT_ID)),
    };

    TestBed.configureTestingModule({
      providers: [
        EncryptionPasswordChangeService,
        { provide: SyncProviderManager, useValue: mockProviderManager },
        { provide: StateSnapshotService, useValue: mockStateSnapshotService },
        { provide: OperationEncryptionService, useValue: mockEncryptionService },
        { provide: VectorClockService, useValue: mockVectorClockService },
        { provide: CLIENT_ID_PROVIDER, useValue: mockClientIdProvider },
      ],
    });
    service = TestBed.inject(EncryptionPasswordChangeService);
  });

  describe('changePassword', () => {
    it('should successfully change the encryption password', async () => {
      await service.changePassword(TEST_PASSWORD);

      // Verify correct sequence of operations
      expect(mockStateSnapshotService.getStateSnapshot).toHaveBeenCalled();
      expect(mockVectorClockService.getCurrentVectorClock).toHaveBeenCalled();
      expect(mockClientIdProvider.loadClientId).toHaveBeenCalled();
      expect(mockSyncProvider.deleteAllData).toHaveBeenCalled();
      expect(mockEncryptionService.encryptPayload).toHaveBeenCalledWith(
        TEST_CURRENT_STATE,
        TEST_PASSWORD,
      );
      expect(mockSyncProvider.uploadSnapshot).toHaveBeenCalledWith(
        TEST_ENCRYPTED_STATE,
        TEST_CLIENT_ID,
        'recovery',
        TEST_VECTOR_CLOCK,
        jasmine.any(Number), // CURRENT_SCHEMA_VERSION
        true, // isPayloadEncrypted
      );
      expect(mockSyncProvider.setPrivateCfg).toHaveBeenCalledWith(
        jasmine.objectContaining({
          encryptKey: TEST_PASSWORD,
          isEncryptionEnabled: true,
        }),
      );
      expect(mockSyncProvider.setLastServerSeq).toHaveBeenCalledWith(42);
    });

    it('should throw error if sync provider is not SuperSync', async () => {
      mockSyncProvider.id = 'WebDAV' as SyncProviderId;

      await expectAsync(service.changePassword(TEST_PASSWORD)).toBeRejectedWithError(
        'Password change is only supported for SuperSync',
      );
    });

    it('should throw error if no sync provider is active', async () => {
      mockProviderManager.getActiveProvider.and.returnValue(null);

      await expectAsync(service.changePassword(TEST_PASSWORD)).toBeRejectedWithError(
        'Password change is only supported for SuperSync',
      );
    });

    it('should throw error if sync provider is not operation sync capable', async () => {
      mockSyncProvider.supportsOperationSync = false;

      await expectAsync(service.changePassword(TEST_PASSWORD)).toBeRejectedWithError(
        'Sync provider does not support operation sync',
      );
    });

    it('should throw error if client ID is not available', async () => {
      mockClientIdProvider.loadClientId.and.returnValue(Promise.resolve(null));

      await expectAsync(service.changePassword(TEST_PASSWORD)).toBeRejectedWithError(
        'Client ID not available',
      );
    });

    it('should throw error if snapshot upload fails', async () => {
      mockSyncProvider.uploadSnapshot.and.returnValue(
        Promise.resolve({ accepted: false, error: 'Server rejected snapshot' }),
      );

      await expectAsync(service.changePassword(TEST_PASSWORD)).toBeRejectedWithError(
        /CRITICAL: Password change failed.*Original error: Snapshot upload failed: Server rejected snapshot/,
      );
    });

    it('should preserve existing config when updating password', async () => {
      mockSyncProvider.privateCfg.load.and.returnValue(
        Promise.resolve({
          encryptKey: 'old-password',
          isEncryptionEnabled: true,
          someOtherSetting: 'preserved-value',
        }),
      );

      await service.changePassword(TEST_PASSWORD);

      expect(mockSyncProvider.setPrivateCfg).toHaveBeenCalledWith(
        jasmine.objectContaining({
          encryptKey: TEST_PASSWORD,
          isEncryptionEnabled: true,
          someOtherSetting: 'preserved-value',
        }),
      );
    });

    it('should not call setLastServerSeq if serverSeq is undefined', async () => {
      mockSyncProvider.uploadSnapshot.and.returnValue(
        Promise.resolve({ accepted: true }),
      );

      await service.changePassword(TEST_PASSWORD);

      expect(mockSyncProvider.setLastServerSeq).not.toHaveBeenCalled();
    });

    it('should delete all data before uploading new snapshot', async () => {
      const callOrder: string[] = [];
      mockSyncProvider.deleteAllData.and.callFake(() => {
        callOrder.push('deleteAllData');
        return Promise.resolve({ success: true });
      });
      mockSyncProvider.uploadSnapshot.and.callFake(() => {
        callOrder.push('uploadSnapshot');
        return Promise.resolve({ accepted: true, serverSeq: 42 });
      });

      await service.changePassword(TEST_PASSWORD);

      expect(callOrder).toEqual(['deleteAllData', 'uploadSnapshot']);
    });

    it('should handle deleteAllData failure gracefully', async () => {
      mockSyncProvider.deleteAllData.and.returnValue(
        Promise.reject(new Error('Network error')),
      );

      await expectAsync(service.changePassword(TEST_PASSWORD)).toBeRejectedWithError(
        'Network error',
      );

      // Should not proceed to upload
      expect(mockSyncProvider.uploadSnapshot).not.toHaveBeenCalled();
    });

    describe('recovery flow', () => {
      it('should attempt recovery with old password when snapshot upload fails', async () => {
        // First uploadSnapshot call fails (new password), second succeeds (recovery with old)
        let uploadCallCount = 0;
        mockSyncProvider.uploadSnapshot.and.callFake(() => {
          uploadCallCount++;
          if (uploadCallCount === 1) {
            return Promise.reject(new Error('Network timeout'));
          }
          return Promise.resolve({ accepted: true, serverSeq: 100 });
        });

        await expectAsync(service.changePassword(TEST_PASSWORD)).toBeRejectedWithError(
          /Password change failed\. Server data has been restored with your old password/,
        );

        // Verify encryption was called twice: once with new password, once with old
        expect(mockEncryptionService.encryptPayload).toHaveBeenCalledTimes(2);
        expect(mockEncryptionService.encryptPayload).toHaveBeenCalledWith(
          TEST_CURRENT_STATE,
          TEST_PASSWORD,
        );
        expect(mockEncryptionService.encryptPayload).toHaveBeenCalledWith(
          TEST_CURRENT_STATE,
          'old-password',
        );

        // Should set lastServerSeq from recovery response
        expect(mockSyncProvider.setLastServerSeq).toHaveBeenCalledWith(100);
      });

      it('should throw CRITICAL error when both upload and recovery fail', async () => {
        // Both uploadSnapshot calls fail
        mockSyncProvider.uploadSnapshot.and.returnValue(
          Promise.reject(new Error('Server is down')),
        );

        await expectAsync(service.changePassword(TEST_PASSWORD)).toBeRejectedWithError(
          /CRITICAL: Password change failed and could not restore server data/,
        );

        // Verify encryption was called twice (main attempt + recovery)
        expect(mockEncryptionService.encryptPayload).toHaveBeenCalledTimes(2);
      });

      it('should throw CRITICAL error when recovery upload is rejected', async () => {
        let uploadCallCount = 0;
        mockSyncProvider.uploadSnapshot.and.callFake(() => {
          uploadCallCount++;
          if (uploadCallCount === 1) {
            return Promise.reject(new Error('Initial upload failed'));
          }
          // Recovery upload returns accepted: false
          return Promise.resolve({
            accepted: false,
            error: 'Quota exceeded',
          });
        });

        await expectAsync(service.changePassword(TEST_PASSWORD)).toBeRejectedWithError(
          /CRITICAL: Password change failed.*Original error: Initial upload failed/,
        );

        // Should NOT set lastServerSeq since recovery was not accepted
        expect(mockSyncProvider.setLastServerSeq).not.toHaveBeenCalled();
      });

      it('should handle missing serverSeq in recovery response gracefully', async () => {
        let uploadCallCount = 0;
        mockSyncProvider.uploadSnapshot.and.callFake(() => {
          uploadCallCount++;
          if (uploadCallCount === 1) {
            return Promise.reject(new Error('Network error'));
          }
          // Recovery succeeds but serverSeq is missing
          return Promise.resolve({ accepted: true });
        });

        await expectAsync(service.changePassword(TEST_PASSWORD)).toBeRejectedWithError(
          /Password change failed\. Server data has been restored with your old password/,
        );

        // Should NOT call setLastServerSeq when serverSeq is missing
        expect(mockSyncProvider.setLastServerSeq).not.toHaveBeenCalled();
      });

      it('should not attempt recovery when no old password exists', async () => {
        // No existing config (first time setup)
        mockSyncProvider.privateCfg.load.and.returnValue(Promise.resolve(null));
        mockSyncProvider.uploadSnapshot.and.returnValue(
          Promise.reject(new Error('Upload failed')),
        );

        await expectAsync(service.changePassword(TEST_PASSWORD)).toBeRejectedWithError(
          /CRITICAL: Password change failed/,
        );

        // Encryption should only be called once (no recovery attempt)
        expect(mockEncryptionService.encryptPayload).toHaveBeenCalledTimes(1);
      });

      it('should skip recovery when encryptKey is empty string', async () => {
        mockSyncProvider.privateCfg.load.and.returnValue(
          Promise.resolve({
            encryptKey: '', // Empty string is falsy
            isEncryptionEnabled: false,
          }),
        );
        mockSyncProvider.uploadSnapshot.and.returnValue(
          Promise.reject(new Error('Upload failed')),
        );

        await expectAsync(service.changePassword(TEST_PASSWORD)).toBeRejectedWithError(
          /CRITICAL: Password change failed/,
        );

        // Encryption should only be called once (no recovery attempt)
        expect(mockEncryptionService.encryptPayload).toHaveBeenCalledTimes(1);
      });

      it('should handle encryption failure during recovery', async () => {
        let encryptCallCount = 0;
        mockEncryptionService.encryptPayload.and.callFake(() => {
          encryptCallCount++;
          if (encryptCallCount === 1) {
            return Promise.resolve(TEST_ENCRYPTED_STATE);
          }
          // Second call (recovery) fails
          return Promise.reject(new Error('Encryption failed'));
        });
        mockSyncProvider.uploadSnapshot.and.returnValue(
          Promise.reject(new Error('Initial upload failed')),
        );

        await expectAsync(service.changePassword(TEST_PASSWORD)).toBeRejectedWithError(
          /CRITICAL: Password change failed.*Original error: Initial upload failed/,
        );
      });
    });
  });
});
