import { TestBed } from '@angular/core/testing';
import { EncryptionPasswordChangeService } from './encryption-password-change.service';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { CleanSlateService } from '../../op-log/clean-slate/clean-slate.service';
import { OperationLogUploadService } from '../../op-log/sync/operation-log-upload.service';
import { DerivedKeyCacheService } from '../../op-log/encryption/derived-key-cache.service';
import { SyncProviderId } from '../../op-log/sync-providers/provider.const';
import { SyncWrapperService } from './sync-wrapper.service';
import { OperationLogStoreService } from '../../op-log/persistence/operation-log-store.service';
import { OpType } from '../../op-log/core/operation.types';
import { WrappedProviderService } from '../../op-log/sync-providers/wrapped-provider.service';

describe('EncryptionPasswordChangeService', () => {
  let service: EncryptionPasswordChangeService;
  let mockProviderManager: jasmine.SpyObj<any>;
  let mockCleanSlateService: jasmine.SpyObj<CleanSlateService>;
  let mockUploadService: jasmine.SpyObj<OperationLogUploadService>;
  let mockDerivedKeyCache: jasmine.SpyObj<DerivedKeyCacheService>;
  let mockSyncWrapper: jasmine.SpyObj<SyncWrapperService>;
  let mockOpLogStore: jasmine.SpyObj<OperationLogStoreService>;
  let mockWrappedProviderService: jasmine.SpyObj<WrappedProviderService>;
  let mockSyncProvider: jasmine.SpyObj<any>;

  const TEST_PASSWORD = 'new-secure-password-123';

  beforeEach(() => {
    // Create mock sync provider
    mockSyncProvider = jasmine.createSpyObj('SyncProvider', ['setPrivateCfg']);
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
    mockSyncProvider.setPrivateCfg.and.returnValue(Promise.resolve());

    // Create mock SyncProviderManager
    mockProviderManager = {
      getActiveProvider: jasmine
        .createSpy('getActiveProvider')
        .and.returnValue(mockSyncProvider),
    };

    mockCleanSlateService = jasmine.createSpyObj('CleanSlateService', [
      'createCleanSlate',
    ]);
    mockCleanSlateService.createCleanSlate.and.returnValue(Promise.resolve());

    mockUploadService = jasmine.createSpyObj('OperationLogUploadService', [
      'uploadPendingOps',
    ]);
    mockUploadService.uploadPendingOps.and.returnValue(
      Promise.resolve({
        uploadedCount: 1,
        rejectedCount: 0,
        rejectedOps: [],
        piggybackedOps: [],
      }),
    );

    mockDerivedKeyCache = jasmine.createSpyObj('DerivedKeyCacheService', ['clearCache']);

    // Mock SyncWrapperService - runWithSyncBlocked should just execute the callback
    mockSyncWrapper = jasmine.createSpyObj('SyncWrapperService', ['runWithSyncBlocked']);
    mockSyncWrapper.runWithSyncBlocked.and.callFake(
      async <T>(operation: () => Promise<T>): Promise<T> => {
        return operation();
      },
    );

    // Mock OperationLogStoreService
    // First call: check for unsynced user ops (should return empty)
    // Second call: verify SYNC_IMPORT was stored after clean slate
    mockOpLogStore = jasmine.createSpyObj('OperationLogStoreService', ['getUnsynced']);
    let getUnsyncedCallCount = 0;
    mockOpLogStore.getUnsynced.and.callFake((): any => {
      getUnsyncedCallCount++;
      if (getUnsyncedCallCount === 1) {
        // First call: no unsynced user operations
        return Promise.resolve([]);
      } else {
        // Second call: SYNC_IMPORT was created by clean slate
        return Promise.resolve([{ seq: 1, op: { opType: OpType.SyncImport } }]);
      }
    });

    mockWrappedProviderService = jasmine.createSpyObj('WrappedProviderService', [
      'clearCache',
    ]);

    TestBed.configureTestingModule({
      providers: [
        EncryptionPasswordChangeService,
        { provide: SyncProviderManager, useValue: mockProviderManager },
        { provide: CleanSlateService, useValue: mockCleanSlateService },
        { provide: OperationLogUploadService, useValue: mockUploadService },
        { provide: DerivedKeyCacheService, useValue: mockDerivedKeyCache },
        { provide: SyncWrapperService, useValue: mockSyncWrapper },
        { provide: OperationLogStoreService, useValue: mockOpLogStore },
        { provide: WrappedProviderService, useValue: mockWrappedProviderService },
      ],
    });
    service = TestBed.inject(EncryptionPasswordChangeService);
  });

  describe('changePassword', () => {
    it('should successfully change the encryption password', async () => {
      await service.changePassword(TEST_PASSWORD);

      // Should create clean slate
      expect(mockCleanSlateService.createCleanSlate).toHaveBeenCalledWith(
        'ENCRYPTION_CHANGE',
      );

      // Should update config with new password
      expect(mockSyncProvider.setPrivateCfg).toHaveBeenCalledWith(
        jasmine.objectContaining({
          encryptKey: TEST_PASSWORD,
          isEncryptionEnabled: true,
        }),
      );

      // Should clear derived key cache
      expect(mockDerivedKeyCache.clearCache).toHaveBeenCalled();

      // Should upload with isCleanSlate flag
      expect(mockUploadService.uploadPendingOps).toHaveBeenCalledWith(mockSyncProvider, {
        isCleanSlate: true,
      });
    });

    it('should preserve existing config properties when updating password', async () => {
      mockSyncProvider.privateCfg.load.and.returnValue(
        Promise.resolve({
          encryptKey: 'old-password',
          isEncryptionEnabled: true,
          someOtherProperty: 'value',
        }),
      );

      await service.changePassword(TEST_PASSWORD);

      expect(mockSyncProvider.setPrivateCfg).toHaveBeenCalledWith(
        jasmine.objectContaining({
          encryptKey: TEST_PASSWORD,
          isEncryptionEnabled: true,
          someOtherProperty: 'value',
        }),
      );
    });

    it('should throw error if provider is not SuperSync', async () => {
      mockSyncProvider.id = SyncProviderId.WebDAV;

      await expectAsync(service.changePassword(TEST_PASSWORD)).toBeRejectedWithError(
        'Password change is only supported for SuperSync',
      );

      expect(mockCleanSlateService.createCleanSlate).not.toHaveBeenCalled();
    });

    it('should throw error if provider does not support operation sync', async () => {
      mockSyncProvider.supportsOperationSync = false;

      await expectAsync(service.changePassword(TEST_PASSWORD)).toBeRejectedWithError(
        'Sync provider does not support operation sync',
      );

      expect(mockCleanSlateService.createCleanSlate).not.toHaveBeenCalled();
    });

    it('should throw error if no active provider', async () => {
      mockProviderManager.getActiveProvider.and.returnValue(null);

      await expectAsync(service.changePassword(TEST_PASSWORD)).toBeRejectedWithError(
        'Password change is only supported for SuperSync',
      );

      expect(mockCleanSlateService.createCleanSlate).not.toHaveBeenCalled();
    });

    it('should throw error if there are unsynced user operations', async () => {
      // First call returns unsynced user operations - should throw before reaching second call
      mockOpLogStore.getUnsynced.and.returnValue(
        Promise.resolve([
          { seq: 1, op: { opType: OpType.Create } } as any,
          { seq: 2, op: { opType: OpType.Update } } as any,
        ]),
      );

      await expectAsync(service.changePassword(TEST_PASSWORD)).toBeRejectedWithError(
        /Cannot change password: 2 operation\(s\) have not been synced yet/,
      );

      // Should not proceed with password change
      expect(mockCleanSlateService.createCleanSlate).not.toHaveBeenCalled();
    });

    it('should proceed when there are no unsynced operations', async () => {
      // First call: no unsynced ops, second call: SYNC_IMPORT stored
      let callCount = 0;
      mockOpLogStore.getUnsynced.and.callFake((): any => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve([]);
        } else {
          return Promise.resolve([{ seq: 1, op: { opType: OpType.SyncImport } }]);
        }
      });

      await service.changePassword(TEST_PASSWORD);

      // Should proceed with password change
      expect(mockCleanSlateService.createCleanSlate).toHaveBeenCalled();
    });

    it('should ignore full-state operations (SYNC_IMPORT, BACKUP_IMPORT, REPAIR) when checking for unsynced ops', async () => {
      // Full-state operations from failed previous attempts should not block retry
      let callCount = 0;
      mockOpLogStore.getUnsynced.and.callFake((): any => {
        callCount++;
        if (callCount === 1) {
          // First call: only full-state ops (should be ignored)
          return Promise.resolve([
            { seq: 1, op: { opType: OpType.SyncImport } } as any,
            { seq: 2, op: { opType: OpType.BackupImport } } as any,
            { seq: 3, op: { opType: OpType.Repair } } as any,
          ]);
        } else {
          // Second call: fresh SYNC_IMPORT from clean slate
          return Promise.resolve([{ seq: 4, op: { opType: OpType.SyncImport } }]);
        }
      });

      await service.changePassword(TEST_PASSWORD);

      // Should proceed despite having unsynced full-state ops
      expect(mockCleanSlateService.createCleanSlate).toHaveBeenCalled();
    });

    it('should throw error if there are unsynced user operations mixed with full-state ops', async () => {
      // First call returns mixed ops - user op should cause throw
      mockOpLogStore.getUnsynced.and.returnValue(
        Promise.resolve([
          { seq: 1, op: { opType: OpType.SyncImport } } as any, // Ignored
          { seq: 2, op: { opType: OpType.Create } } as any, // Counts
        ]),
      );

      await expectAsync(service.changePassword(TEST_PASSWORD)).toBeRejectedWithError(
        /Cannot change password: 1 operation\(s\) have not been synced yet/,
      );

      expect(mockCleanSlateService.createCleanSlate).not.toHaveBeenCalled();
    });

    it('should keep new password config if upload fails (for retry)', async () => {
      const originalConfig = {
        encryptKey: 'old-password',
        isEncryptionEnabled: true,
      };
      mockSyncProvider.privateCfg.load.and.returnValue(Promise.resolve(originalConfig));

      // Setup two-call mock for getUnsynced
      let callCount = 0;
      mockOpLogStore.getUnsynced.and.callFake((): any => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve([]);
        } else {
          return Promise.resolve([{ seq: 1, op: { opType: OpType.SyncImport } }]);
        }
      });

      mockUploadService.uploadPendingOps.and.returnValue(
        Promise.reject(new Error('Upload failed')),
      );

      await expectAsync(service.changePassword(TEST_PASSWORD)).toBeRejectedWithError(
        /Password change failed during upload: Upload failed/,
      );

      // Should have set password to new value
      expect(mockSyncProvider.setPrivateCfg).toHaveBeenCalledWith(
        jasmine.objectContaining({
          encryptKey: TEST_PASSWORD,
        }),
      );

      // Should NOT revert - only one call to setPrivateCfg
      expect(mockSyncProvider.setPrivateCfg).toHaveBeenCalledTimes(1);

      // Should have cleared cache only once (on change, not on revert)
      expect(mockDerivedKeyCache.clearCache).toHaveBeenCalledTimes(1);
    });

    it('should throw error if no operations are uploaded', async () => {
      // Setup two-call mock for getUnsynced
      let callCount = 0;
      mockOpLogStore.getUnsynced.and.callFake((): any => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve([]);
        } else {
          return Promise.resolve([{ seq: 1, op: { opType: OpType.SyncImport } }]);
        }
      });

      mockUploadService.uploadPendingOps.and.returnValue(
        Promise.resolve({
          uploadedCount: 0, // No ops uploaded!
          rejectedCount: 0,
          rejectedOps: [],
          piggybackedOps: [],
        }),
      );

      await expectAsync(service.changePassword(TEST_PASSWORD)).toBeRejectedWithError(
        /No operations uploaded - upload may have failed silently/,
      );
    });

    it('should throw error if operations are rejected by server', async () => {
      // Setup two-call mock for getUnsynced
      let callCount = 0;
      mockOpLogStore.getUnsynced.and.callFake((): any => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve([]);
        } else {
          return Promise.resolve([{ seq: 1, op: { opType: OpType.SyncImport } }]);
        }
      });

      mockUploadService.uploadPendingOps.and.returnValue(
        Promise.resolve({
          uploadedCount: 1, // Some ops uploaded
          rejectedCount: 1, // But some were rejected
          rejectedOps: [{ opId: 'op1', error: 'Server rejected' }],
          piggybackedOps: [],
        }),
      );

      await expectAsync(service.changePassword(TEST_PASSWORD)).toBeRejectedWithError(
        /Clean slate upload was rejected by server: Server rejected/,
      );
    });

    it('should execute steps in correct order', async () => {
      const callOrder: string[] = [];

      // Setup two-call mock for getUnsynced
      let getUnsyncedCount = 0;
      mockOpLogStore.getUnsynced.and.callFake((): any => {
        getUnsyncedCount++;
        callOrder.push(`getUnsynced(${getUnsyncedCount})`);
        if (getUnsyncedCount === 1) {
          return Promise.resolve([]);
        } else {
          return Promise.resolve([{ seq: 1, op: { opType: OpType.SyncImport } }]);
        }
      });

      mockCleanSlateService.createCleanSlate.and.callFake(async () => {
        callOrder.push('createCleanSlate');
      });

      mockSyncProvider.setPrivateCfg.and.callFake(async () => {
        callOrder.push('setPrivateCfg');
      });

      mockDerivedKeyCache.clearCache.and.callFake(() => {
        callOrder.push('clearDerivedKeyCache');
      });

      mockWrappedProviderService.clearCache.and.callFake(() => {
        callOrder.push('clearWrappedProviderCache');
      });

      mockUploadService.uploadPendingOps.and.callFake(async () => {
        callOrder.push('uploadPendingOps');
        return {
          uploadedCount: 1,
          rejectedCount: 0,
          rejectedOps: [],
          piggybackedOps: [],
        };
      });

      await service.changePassword(TEST_PASSWORD);

      expect(callOrder).toEqual([
        'getUnsynced(1)', // Check for unsynced user ops
        'createCleanSlate',
        'getUnsynced(2)', // Verify SYNC_IMPORT was stored
        'setPrivateCfg',
        'clearDerivedKeyCache',
        'clearWrappedProviderCache',
        'uploadPendingOps',
      ]);
    });

    it('should run password change with sync blocked to prevent race conditions', async () => {
      await service.changePassword(TEST_PASSWORD);

      // Verify runWithSyncBlocked was called (prevents sync during password change)
      expect(mockSyncWrapper.runWithSyncBlocked).toHaveBeenCalled();
    });

    it('should set both encryptKey AND isEncryptionEnabled when changing password', async () => {
      // This test prevents regression of the password change bug where
      // isEncryptionEnabled was not set, causing getEncryptKey() to return undefined
      // and data to be uploaded unencrypted

      const oldConfig = {
        baseUrl: 'https://sync.example.com',
        accessToken: 'test-token',
        encryptKey: 'old-password',
        isEncryptionEnabled: false, // Currently disabled
      };

      mockSyncProvider.privateCfg.load.and.returnValue(Promise.resolve(oldConfig));

      await service.changePassword(TEST_PASSWORD);

      // Verify BOTH fields are set in the new config
      expect(mockSyncProvider.setPrivateCfg).toHaveBeenCalledWith(
        jasmine.objectContaining({
          encryptKey: TEST_PASSWORD,
          isEncryptionEnabled: true, // MUST be true!
        }),
      );
    });

    it('should preserve other config fields when changing password', async () => {
      const oldConfig = {
        baseUrl: 'https://custom-server.com',
        accessToken: 'my-access-token',
        userName: 'testuser',
        password: 'testpass',
        syncFolderPath: '/my-sync',
        encryptKey: 'old-password',
        isEncryptionEnabled: false,
      };

      mockSyncProvider.privateCfg.load.and.returnValue(Promise.resolve(oldConfig));

      await service.changePassword(TEST_PASSWORD);

      // Verify all other fields are preserved
      expect(mockSyncProvider.setPrivateCfg).toHaveBeenCalledWith(
        jasmine.objectContaining({
          baseUrl: 'https://custom-server.com',
          accessToken: 'my-access-token',
          userName: 'testuser',
          password: 'testpass',
          syncFolderPath: '/my-sync',
          encryptKey: TEST_PASSWORD,
          isEncryptionEnabled: true,
        }),
      );
    });

    it('should upload clean slate with isCleanSlate=true flag for server-side deletion', async () => {
      // This test ensures the password change triggers the server to delete all old
      // encrypted data before accepting the new data. This is critical because:
      // 1. Old data is encrypted with OLD password
      // 2. New data will be encrypted with NEW password
      // 3. If old data remains, clients will see mixed encryption and fail
      //
      // The isCleanSlate=true flag tells the server to wipe everything first.
      // This will cause other clients to experience gap detection when they sync.

      await service.changePassword(TEST_PASSWORD);

      // Verify upload was called with isCleanSlate flag
      expect(mockUploadService.uploadPendingOps).toHaveBeenCalledWith(
        mockSyncProvider,
        jasmine.objectContaining({
          isCleanSlate: true, // CRITICAL: Server will delete all data
        }),
      );
    });

    it('should clear caches once on upload failure (no revert)', async () => {
      // When upload fails, we keep the new password config for retry.
      // User must retry with the SAME password to complete the upload.
      // This prevents inconsistent state where SYNC_IMPORT would be
      // encrypted with old password but user expects new password.

      const originalConfig = {
        encryptKey: 'old-password',
        isEncryptionEnabled: true,
      };
      mockSyncProvider.privateCfg.load.and.returnValue(Promise.resolve(originalConfig));

      // Setup two-call mock for getUnsynced
      let callCount = 0;
      mockOpLogStore.getUnsynced.and.callFake((): any => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve([]);
        } else {
          return Promise.resolve([{ seq: 1, op: { opType: OpType.SyncImport } }]);
        }
      });

      mockUploadService.uploadPendingOps.and.returnValue(
        Promise.reject(new Error('Network error')),
      );

      await expectAsync(service.changePassword(TEST_PASSWORD)).toBeRejected();

      // Should have cleared caches only once (no revert):
      // After setting new password (before upload attempt)
      expect(mockDerivedKeyCache.clearCache).toHaveBeenCalledTimes(1);
      expect(mockWrappedProviderService.clearCache).toHaveBeenCalledTimes(1);
    });

    it('should throw error if SYNC_IMPORT was not stored after clean slate', async () => {
      // This catches IndexedDB timing issues where createCleanSlate completes
      // but the SYNC_IMPORT operation wasn't actually stored
      let callCount = 0;
      mockOpLogStore.getUnsynced.and.callFake((): any => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve([]); // No unsynced user ops
        } else {
          return Promise.resolve([]); // SYNC_IMPORT not stored (problem!)
        }
      });

      await expectAsync(service.changePassword(TEST_PASSWORD)).toBeRejectedWithError(
        /Clean slate creation failed - no SYNC_IMPORT operation was stored/,
      );

      // Should have created clean slate
      expect(mockCleanSlateService.createCleanSlate).toHaveBeenCalled();

      // Should NOT have updated config (failed before reaching that step)
      expect(mockSyncProvider.setPrivateCfg).not.toHaveBeenCalled();
    });

    it('should generate new client ID via clean slate to prevent operation conflicts', async () => {
      // Password change creates a clean slate which generates a new client ID.
      // This is important because:
      // 1. Server deletes all old operations (from old client ID)
      // 2. Client uploads fresh SYNC_IMPORT (with new client ID)
      // 3. Other clients will see gap (their lastServerSeq > latestSeq)
      // 4. Gap triggers re-download with encryption key re-fetch
      //
      // Without new client ID, vector clock conflicts could occur.

      await service.changePassword(TEST_PASSWORD);

      // Verify clean slate was created (which generates new client ID)
      expect(mockCleanSlateService.createCleanSlate).toHaveBeenCalledWith(
        'ENCRYPTION_CHANGE',
      );
    });
  });
});
