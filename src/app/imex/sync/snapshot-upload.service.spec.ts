import { TestBed } from '@angular/core/testing';
import { SnapshotUploadService } from './snapshot-upload.service';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { StateSnapshotService } from '../../op-log/backup/state-snapshot.service';
import { VectorClockService } from '../../op-log/sync/vector-clock.service';
import { CLIENT_ID_PROVIDER } from '../../op-log/util/client-id.provider';
import { SyncProviderId } from '../../op-log/sync-providers/provider.const';
import {
  OperationSyncCapable,
  SyncProviderBase,
} from '../../op-log/sync-providers/provider.interface';
import { OperationEncryptionService } from '../../op-log/sync/operation-encryption.service';
import { OperationLogStoreService } from '../../op-log/persistence/operation-log-store.service';
import type { SuperSyncPrivateCfg } from '@sp/sync-providers/super-sync';
import { WebCryptoNotAvailableError } from '../../op-log/core/errors/sync-errors';
import { DEFAULT_GLOBAL_CONFIG } from '../../features/config/default-global-config.const';
import { LockService } from '../../op-log/sync/lock.service';

describe('SnapshotUploadService', () => {
  let service: SnapshotUploadService;
  let mockProviderManager: jasmine.SpyObj<SyncProviderManager>;
  let mockStateSnapshotService: jasmine.SpyObj<StateSnapshotService>;
  let mockVectorClockService: jasmine.SpyObj<VectorClockService>;
  let mockClientIdProvider: {
    loadClientId: jasmine.Spy;
    getOrGenerateClientId: jasmine.Spy;
  };
  let mockEncryptionService: jasmine.SpyObj<OperationEncryptionService>;
  let mockOpLogStore: jasmine.SpyObj<OperationLogStoreService>;
  let mockLockService: jasmine.SpyObj<LockService>;
  let mockSyncProvider: jasmine.SpyObj<
    SyncProviderBase<SyncProviderId> & OperationSyncCapable
  >;
  let originalCryptoSubtleDescriptor: PropertyDescriptor | undefined;
  let originalCryptoSubtle: SubtleCrypto | undefined;

  const mockExistingCfg: SuperSyncPrivateCfg = {
    baseUrl: 'https://test.example.com',
    accessToken: 'test-token',
    isEncryptionEnabled: false,
    encryptKey: undefined,
  };

  beforeEach(() => {
    originalCryptoSubtle = globalThis.crypto.subtle;
    originalCryptoSubtleDescriptor = Object.getOwnPropertyDescriptor(
      globalThis.crypto,
      'subtle',
    );

    mockSyncProvider = jasmine.createSpyObj('SyncProvider', [
      'uploadSnapshot',
      'setLastServerSeq',
      'deleteAllData',
      'setPrivateCfg',
    ]);
    mockSyncProvider.id = SyncProviderId.SuperSync;
    mockSyncProvider.isReady = jasmine.createSpy('isReady').and.resolveTo(true);
    mockSyncProvider.privateCfg = {
      load: jasmine.createSpy('load').and.resolveTo(mockExistingCfg),
    } as any;
    // Mark as operation-sync capable (isOperationSyncCapable checks for these properties)
    mockSyncProvider.supportsOperationSync = true;
    mockSyncProvider.providerMode = 'superSyncOps';
    mockSyncProvider.deleteAllData.and.resolveTo({ success: true });
    mockSyncProvider.uploadSnapshot.and.resolveTo({
      accepted: true,
      serverSeq: 42,
    });
    mockSyncProvider.setLastServerSeq.and.resolveTo(undefined);

    mockProviderManager = jasmine.createSpyObj('SyncProviderManager', [
      'getActiveProvider',
      'setProviderConfig',
    ]);
    mockProviderManager.getActiveProvider.and.returnValue(mockSyncProvider);
    mockProviderManager.setProviderConfig.and.resolveTo();

    mockStateSnapshotService = jasmine.createSpyObj('StateSnapshotService', [
      'getStateSnapshotForOperationLogAsync',
    ]);
    mockStateSnapshotService.getStateSnapshotForOperationLogAsync.and.resolveTo(
      {} as any,
    );

    mockVectorClockService = jasmine.createSpyObj('VectorClockService', [
      'getCurrentVectorClock',
    ]);
    mockVectorClockService.getCurrentVectorClock.and.resolveTo({});

    mockClientIdProvider = {
      loadClientId: jasmine.createSpy('loadClientId').and.resolveTo('test-client-id'),
      getOrGenerateClientId: jasmine
        .createSpy('getOrGenerateClientId')
        .and.resolveTo('test-client-id'),
    };

    mockEncryptionService = jasmine.createSpyObj('OperationEncryptionService', [
      'encryptPayload',
    ]);
    mockEncryptionService.encryptPayload.and.resolveTo('encrypted-state-data');

    mockOpLogStore = jasmine.createSpyObj('OperationLogStoreService', [
      'getUnsynced',
      'markSynced',
    ]);
    mockOpLogStore.getUnsynced.and.resolveTo([]);
    mockOpLogStore.markSynced.and.resolveTo(undefined);
    mockLockService = jasmine.createSpyObj('LockService', ['request']);
    mockLockService.request.and.callFake(
      async <T>(_name: string, callback: () => Promise<T>) => callback(),
    );

    TestBed.configureTestingModule({
      providers: [
        SnapshotUploadService,
        { provide: SyncProviderManager, useValue: mockProviderManager },
        { provide: StateSnapshotService, useValue: mockStateSnapshotService },
        { provide: VectorClockService, useValue: mockVectorClockService },
        { provide: CLIENT_ID_PROVIDER, useValue: mockClientIdProvider },
        { provide: OperationEncryptionService, useValue: mockEncryptionService },
        { provide: OperationLogStoreService, useValue: mockOpLogStore },
        { provide: LockService, useValue: mockLockService },
      ],
    });

    service = TestBed.inject(SnapshotUploadService);
  });

  afterEach(() => {
    if (originalCryptoSubtleDescriptor) {
      Object.defineProperty(globalThis.crypto, 'subtle', originalCryptoSubtleDescriptor);
    } else {
      Object.defineProperty(globalThis.crypto, 'subtle', {
        value: originalCryptoSubtle,
        writable: true,
        configurable: true,
      });
    }
  });

  const setCryptoSubtle = (subtle: SubtleCrypto | undefined): void => {
    Object.defineProperty(globalThis.crypto, 'subtle', {
      value: subtle,
      writable: true,
      configurable: true,
    });
  };

  const mockCryptoSubtleAvailable = (): void => {
    setCryptoSubtle({} as SubtleCrypto);
  };

  const mockCryptoSubtleUnavailable = (): void => {
    setCryptoSubtle(undefined);
  };

  describe('getValidatedSuperSyncProvider', () => {
    it('should return the provider when valid', () => {
      const result = service.getValidatedSuperSyncProvider();
      expect(result).toBe(mockSyncProvider as any);
    });

    it('should throw when no active provider', () => {
      mockProviderManager.getActiveProvider.and.returnValue(null);
      expect(() => service.getValidatedSuperSyncProvider()).toThrowError(
        /No active sync provider/,
      );
    });

    it('should throw when provider is not SuperSync', () => {
      mockSyncProvider.id = SyncProviderId.Dropbox;
      expect(() => service.getValidatedSuperSyncProvider()).toThrowError(
        /only supported for SuperSync/,
      );
    });

    it('should throw when provider is not operation-sync capable', () => {
      mockSyncProvider.supportsOperationSync = false;
      expect(() => service.getValidatedSuperSyncProvider()).toThrowError(
        /does not support operation sync/,
      );
    });
  });

  describe('gatherSnapshotData', () => {
    it('should gather all required data', async () => {
      const mockState = { tasks: [] };
      const mockVectorClock = { clientA: 1 };
      mockStateSnapshotService.getStateSnapshotForOperationLogAsync.and.resolveTo(
        mockState as any,
      );
      mockVectorClockService.getCurrentVectorClock.and.resolveTo(mockVectorClock);
      mockSyncProvider.privateCfg.load = jasmine
        .createSpy('load')
        .and.resolveTo({ encryptKey: 'test' });

      const result = await service.gatherSnapshotData();

      expect(result.syncProvider).toBe(mockSyncProvider as any);
      expect(result.state).toBe(mockState as any);
      expect(result.vectorClock).toBe(mockVectorClock);
      expect(result.clientId).toBe('test-client-id');
      expect(result.existingCfg).toEqual({ encryptKey: 'test' } as any);
    });

    it('should strip local-only sync settings from gathered snapshot state', async () => {
      const mockState = {
        globalConfig: {
          ...DEFAULT_GLOBAL_CONFIG,
          sync: {
            ...DEFAULT_GLOBAL_CONFIG.sync,
            syncProvider: SyncProviderId.WebDAV,
            syncInterval: 300000,
            isManualSyncOnly: true,
            isCompressionEnabled: true,
          },
        },
      };
      mockStateSnapshotService.getStateSnapshotForOperationLogAsync.and.resolveTo(
        mockState as any,
      );

      const result = await service.gatherSnapshotData();
      const globalConfig = result.state.globalConfig as Record<string, unknown>;
      const sync = globalConfig['sync'] as Record<string, unknown>;

      expect(sync['syncProvider']).toBeNull();
      expect(sync['syncInterval']).toBeUndefined();
      expect(sync['isManualSyncOnly']).toBeUndefined();
      expect(sync['isCompressionEnabled']).toBe(true);
    });

    it('should regenerate client ID when getOrGenerateClientId is used', async () => {
      mockClientIdProvider.getOrGenerateClientId.and.resolveTo('B_regen');

      const result = await service.gatherSnapshotData();

      expect(mockClientIdProvider.getOrGenerateClientId).toHaveBeenCalled();
      expect(result.clientId).toBe('B_regen');
    });
  });

  describe('uploadSnapshot', () => {
    it('should upload snapshot and return result', async () => {
      mockSyncProvider.uploadSnapshot.and.resolveTo({
        accepted: true,
        serverSeq: 42,
      });

      const result = await service.uploadSnapshot(
        mockSyncProvider as any,
        { data: 'test' },
        'client-1',
        { client1: 1 },
        false,
      );

      expect(result.accepted).toBe(true);
      expect(result.serverSeq).toBe(42);
      expect(mockSyncProvider.uploadSnapshot).toHaveBeenCalled();
    });

    it('should return error when upload fails', async () => {
      mockSyncProvider.uploadSnapshot.and.resolveTo({
        accepted: false,
        error: 'Network error',
      });

      const result = await service.uploadSnapshot(
        mockSyncProvider as any,
        { data: 'test' },
        'client-1',
        { client1: 1 },
        false,
      );

      expect(result.accepted).toBe(false);
      expect(result.error).toBe('Network error');
    });
  });

  describe('updateLastServerSeq', () => {
    it('should call setLastServerSeq when serverSeq is defined', async () => {
      mockSyncProvider.setLastServerSeq.and.resolveTo(undefined);

      await service.updateLastServerSeq(mockSyncProvider as any, 42);

      expect(mockSyncProvider.setLastServerSeq).toHaveBeenCalledWith(42);
    });

    it('should not call setLastServerSeq when serverSeq is undefined', async () => {
      await service.updateLastServerSeq(mockSyncProvider as any, undefined);

      expect(mockSyncProvider.setLastServerSeq).not.toHaveBeenCalled();
    });
  });

  describe('deleteAndReuploadWithNewEncryption', () => {
    it('should gather data, delete, update config, and upload when disabling encryption', async () => {
      const mockState = { task: [] };
      mockStateSnapshotService.getStateSnapshotForOperationLogAsync.and.resolveTo(
        mockState as any,
      );
      mockVectorClockService.getCurrentVectorClock.and.resolveTo({ c1: 1 });

      const result = await service.deleteAndReuploadWithNewEncryption({
        encryptKey: undefined,
        isEncryptionEnabled: false,
        logPrefix: 'TestPrefix',
      });

      expect(result.accepted).toBeTrue();
      expect(result.serverSeq).toBe(42);
      expect(mockSyncProvider.deleteAllData).toHaveBeenCalled();
      expect(mockProviderManager.setProviderConfig).toHaveBeenCalledWith(
        SyncProviderId.SuperSync,
        jasmine.objectContaining({
          isEncryptionEnabled: false,
          encryptKey: undefined,
        }),
      );
      expect(mockSyncProvider.uploadSnapshot).toHaveBeenCalled();
      expect(mockSyncProvider.setLastServerSeq).toHaveBeenCalledWith(42);
    });

    // The snapshot subsumes all local ops, so they must be marked synced rather
    // than left to re-upload incrementally on the next sync (GHSA-9v8x-68pf-p5x7
    // follow-up: first-time setup would otherwise re-push the whole history).
    describe('op-log consolidation', () => {
      it('marks the ops subsumed by the snapshot as synced', async () => {
        mockCryptoSubtleAvailable();
        mockOpLogStore.getUnsynced.and.resolveTo([{ seq: 5 } as any, { seq: 6 } as any]);

        await service.deleteAndReuploadWithNewEncryption({
          encryptKey: 'my-key',
          isEncryptionEnabled: true,
          logPrefix: 'TestPrefix',
        });

        expect(mockOpLogStore.markSynced).toHaveBeenCalledWith([5, 6]);
      });

      it('does NOT mark synced when the snapshot upload fails', async () => {
        mockCryptoSubtleAvailable();
        mockOpLogStore.getUnsynced.and.resolveTo([{ seq: 5 } as any]);
        mockSyncProvider.uploadSnapshot.and.resolveTo({
          accepted: false,
          error: 'boom',
        } as any);

        await expectAsync(
          service.deleteAndReuploadWithNewEncryption({
            encryptKey: 'my-key',
            isEncryptionEnabled: true,
            logPrefix: 'TestPrefix',
          }),
        ).toBeRejected();

        expect(mockOpLogStore.markSynced).not.toHaveBeenCalled();
      });

      it('captures ops BEFORE the destructive deleteAllData', async () => {
        mockCryptoSubtleAvailable();
        const callOrder: string[] = [];
        mockOpLogStore.getUnsynced.and.callFake(async () => {
          callOrder.push('getUnsynced');
          return [{ seq: 5 } as any];
        });
        mockSyncProvider.deleteAllData.and.callFake(async () => {
          callOrder.push('deleteAllData');
          return { success: true };
        });

        await service.deleteAndReuploadWithNewEncryption({
          encryptKey: 'my-key',
          isEncryptionEnabled: true,
          logPrefix: 'TestPrefix',
        });

        expect(callOrder).toEqual(['getUnsynced', 'deleteAllData']);
        expect(mockLockService.request).toHaveBeenCalledWith(
          'sp_op_log',
          jasmine.any(Function),
        );
      });
    });

    // Defense-in-depth for GHSA-9v8x-68pf-p5x7: for a provider that mandates E2E
    // encryption, this method must never push a plaintext snapshot — it must fail
    // closed BEFORE the destructive deleteAllData, regardless of caller.
    describe('encryption-mandatory provider (GHSA-9v8x-68pf-p5x7)', () => {
      beforeEach(() => {
        (mockSyncProvider as any).isEncryptionMandatory = true;
      });

      it('throws (before deleting) when disabling encryption', async () => {
        await expectAsync(
          service.deleteAndReuploadWithNewEncryption({
            encryptKey: undefined,
            isEncryptionEnabled: false,
            logPrefix: 'TestPrefix',
          }),
        ).toBeRejectedWithError(/unencrypted snapshot/);

        expect(mockSyncProvider.deleteAllData).not.toHaveBeenCalled();
        expect(mockSyncProvider.uploadSnapshot).not.toHaveBeenCalled();
      });

      it('throws (before deleting) when enabling without a usable key', async () => {
        // Crypto must be available so the WebCrypto-availability check passes and
        // execution reaches the mandatory-encryption guard (the assertion target).
        mockCryptoSubtleAvailable();

        await expectAsync(
          service.deleteAndReuploadWithNewEncryption({
            encryptKey: undefined,
            isEncryptionEnabled: true,
            logPrefix: 'TestPrefix',
          }),
        ).toBeRejectedWithError(/unencrypted snapshot/);

        expect(mockSyncProvider.deleteAllData).not.toHaveBeenCalled();
      });

      it('still succeeds when enabling with a usable key', async () => {
        mockCryptoSubtleAvailable();
        mockStateSnapshotService.getStateSnapshotForOperationLogAsync.and.resolveTo({
          task: [],
        } as any);

        await service.deleteAndReuploadWithNewEncryption({
          encryptKey: 'my-key',
          isEncryptionEnabled: true,
          logPrefix: 'TestPrefix',
        });

        expect(mockSyncProvider.deleteAllData).toHaveBeenCalled();
        expect(mockSyncProvider.uploadSnapshot).toHaveBeenCalled();
      });
    });

    it('should encrypt payload when enabling encryption', async () => {
      mockCryptoSubtleAvailable();
      const mockState = { task: [] };
      mockStateSnapshotService.getStateSnapshotForOperationLogAsync.and.resolveTo(
        mockState as any,
      );

      await service.deleteAndReuploadWithNewEncryption({
        encryptKey: 'my-key',
        isEncryptionEnabled: true,
        logPrefix: 'TestPrefix',
      });

      expect(mockEncryptionService.encryptPayload).toHaveBeenCalledWith(
        mockState,
        'my-key',
      );
      // uploadSnapshot on the provider receives: payload, clientId, reason, vectorClock, schemaVersion, isEncrypted, requestId
      expect(mockSyncProvider.uploadSnapshot).toHaveBeenCalledWith(
        'encrypted-state-data',
        jasmine.anything(),
        jasmine.anything(),
        jasmine.anything(),
        jasmine.anything(),
        true,
        jasmine.anything(),
      );
    });

    it('should NOT encrypt payload when disabling encryption', async () => {
      await service.deleteAndReuploadWithNewEncryption({
        encryptKey: undefined,
        isEncryptionEnabled: false,
        logPrefix: 'TestPrefix',
      });

      expect(mockEncryptionService.encryptPayload).not.toHaveBeenCalled();
    });

    it('should update provider config with new encryption settings', async () => {
      mockCryptoSubtleAvailable();

      await service.deleteAndReuploadWithNewEncryption({
        encryptKey: 'new-key',
        isEncryptionEnabled: true,
        logPrefix: 'TestPrefix',
      });

      expect(mockProviderManager.setProviderConfig).toHaveBeenCalledWith(
        SyncProviderId.SuperSync,
        jasmine.objectContaining({
          encryptKey: 'new-key',
          isEncryptionEnabled: true,
        }),
      );
    });

    it('should return existingCfg in result', async () => {
      const result = await service.deleteAndReuploadWithNewEncryption({
        encryptKey: undefined,
        isEncryptionEnabled: false,
        logPrefix: 'TestPrefix',
      });

      expect(result.existingCfg).toEqual(mockExistingCfg);
    });

    it('should throw when upload is rejected', async () => {
      mockSyncProvider.uploadSnapshot.and.resolveTo({
        accepted: false,
        error: 'Server rejected',
      });

      await expectAsync(
        service.deleteAndReuploadWithNewEncryption({
          encryptKey: undefined,
          isEncryptionEnabled: false,
          logPrefix: 'TestPrefix',
        }),
      ).toBeRejectedWithError(/Snapshot upload failed/);
    });

    it('should retry upload on 429 rate limit error', async () => {
      let callCount = 0;
      mockSyncProvider.uploadSnapshot.and.callFake(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error(
            'SuperSync API error: 429 Too Many Requests - {"statusCode":429,"message":"Rate limit exceeded, retry in 0 seconds"}',
          );
        }
        return { accepted: true, serverSeq: 42 };
      });

      const result = await service.deleteAndReuploadWithNewEncryption({
        encryptKey: undefined,
        isEncryptionEnabled: false,
        logPrefix: 'TestPrefix',
      });

      expect(result.accepted).toBeTrue();
      expect(callCount).toBe(2);
    });

    it('should not retry on non-429 errors', async () => {
      mockSyncProvider.uploadSnapshot.and.rejectWith(new Error('Network timeout'));

      await expectAsync(
        service.deleteAndReuploadWithNewEncryption({
          encryptKey: undefined,
          isEncryptionEnabled: false,
          logPrefix: 'TestPrefix',
        }),
      ).toBeRejectedWithError(/Network timeout/);

      expect(mockSyncProvider.uploadSnapshot).toHaveBeenCalledTimes(1);
    });

    it('should throw after exhausting retries on repeated 429', async () => {
      mockSyncProvider.uploadSnapshot.and.callFake(async () => {
        throw new Error(
          'SuperSync API error: 429 Too Many Requests - {"statusCode":429,"message":"Rate limit exceeded, retry in 0 seconds"}',
        );
      });

      await expectAsync(
        service.deleteAndReuploadWithNewEncryption({
          encryptKey: undefined,
          isEncryptionEnabled: false,
          logPrefix: 'TestPrefix',
        }),
      ).toBeRejectedWithError(/429/);

      // 1 initial + 2 retries = 3 total attempts
      expect(mockSyncProvider.uploadSnapshot).toHaveBeenCalledTimes(3);
    });

    it('should parse retry delay from minutes in error message', async () => {
      let callCount = 0;
      mockSyncProvider.uploadSnapshot.and.callFake(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error(
            'SuperSync API error: 429 Too Many Requests - {"statusCode":429,"message":"Rate limit exceeded, retry in 0 minutes"}',
          );
        }
        return { accepted: true, serverSeq: 42 };
      });

      const result = await service.deleteAndReuploadWithNewEncryption({
        encryptKey: undefined,
        isEncryptionEnabled: false,
        logPrefix: 'TestPrefix',
      });

      expect(result.accepted).toBeTrue();
      expect(callCount).toBe(2);
    });

    it('should execute steps in correct order', async () => {
      mockCryptoSubtleAvailable();
      const callOrder: string[] = [];

      mockStateSnapshotService.getStateSnapshotForOperationLogAsync.and.callFake(
        async () => {
          callOrder.push('getStateSnapshotForOperationLogAsync');
          return {} as any;
        },
      );

      mockEncryptionService.encryptPayload.and.callFake(async () => {
        callOrder.push('encryptPayload');
        return 'encrypted';
      });

      mockSyncProvider.deleteAllData.and.callFake(async () => {
        callOrder.push('deleteAllData');
        return { success: true };
      });

      mockProviderManager.setProviderConfig.and.callFake(async () => {
        callOrder.push('setProviderConfig');
      });

      mockSyncProvider.uploadSnapshot.and.callFake(async () => {
        callOrder.push('uploadSnapshot');
        return { accepted: true, serverSeq: 42 };
      });

      mockSyncProvider.setLastServerSeq.and.callFake(async () => {
        callOrder.push('setLastServerSeq');
      });

      await service.deleteAndReuploadWithNewEncryption({
        encryptKey: 'key',
        isEncryptionEnabled: true,
        logPrefix: 'TestPrefix',
      });

      expect(callOrder).toEqual([
        'getStateSnapshotForOperationLogAsync',
        'encryptPayload',
        'deleteAllData',
        'setProviderConfig',
        'uploadSnapshot',
        'setLastServerSeq',
      ]);
    });

    it('should throw before destructive actions when enabling encryption without WebCrypto', async () => {
      mockCryptoSubtleUnavailable();

      await expectAsync(
        service.deleteAndReuploadWithNewEncryption({
          encryptKey: 'key',
          isEncryptionEnabled: true,
          logPrefix: 'TestPrefix',
        }),
      ).toBeRejectedWithError(WebCryptoNotAvailableError);

      expect(
        mockStateSnapshotService.getStateSnapshotForOperationLogAsync,
      ).not.toHaveBeenCalled();
      expect(mockSyncProvider.deleteAllData).not.toHaveBeenCalled();
      expect(mockProviderManager.setProviderConfig).not.toHaveBeenCalled();
      expect(mockSyncProvider.uploadSnapshot).not.toHaveBeenCalled();
    });
  });
});
