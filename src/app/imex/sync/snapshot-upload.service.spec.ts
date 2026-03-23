import { TestBed } from '@angular/core/testing';
import { SnapshotUploadService } from './snapshot-upload.service';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { StateSnapshotService } from '../../op-log/backup/state-snapshot.service';
import { VectorClockService } from '../../op-log/sync/vector-clock.service';
import { CLIENT_ID_PROVIDER } from '../../op-log/util/client-id.provider';
import { SyncProviderId } from '../../op-log/sync-providers/provider.const';
import {
  OperationSyncCapable,
  SyncProviderServiceInterface,
} from '../../op-log/sync-providers/provider.interface';
import { OperationEncryptionService } from '../../op-log/sync/operation-encryption.service';
import { SuperSyncPrivateCfg } from '../../op-log/sync-providers/super-sync/super-sync.model';

describe('SnapshotUploadService', () => {
  let service: SnapshotUploadService;
  let mockProviderManager: jasmine.SpyObj<SyncProviderManager>;
  let mockStateSnapshotService: jasmine.SpyObj<StateSnapshotService>;
  let mockVectorClockService: jasmine.SpyObj<VectorClockService>;
  let mockClientIdProvider: { loadClientId: jasmine.Spy };
  let mockEncryptionService: jasmine.SpyObj<OperationEncryptionService>;
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
    // Mark as operation-sync capable (isOperationSyncCapable checks for this property)
    (mockSyncProvider as any).supportsOperationSync = true;
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
      'getStateSnapshotAsync',
    ]);
    mockStateSnapshotService.getStateSnapshotAsync.and.resolveTo({} as any);

    mockVectorClockService = jasmine.createSpyObj('VectorClockService', [
      'getCurrentVectorClock',
    ]);
    mockVectorClockService.getCurrentVectorClock.and.resolveTo({});

    mockClientIdProvider = {
      loadClientId: jasmine.createSpy('loadClientId').and.resolveTo('test-client-id'),
    };

    mockEncryptionService = jasmine.createSpyObj('OperationEncryptionService', [
      'encryptPayload',
    ]);
    mockEncryptionService.encryptPayload.and.resolveTo('encrypted-state-data');

    TestBed.configureTestingModule({
      providers: [
        SnapshotUploadService,
        { provide: SyncProviderManager, useValue: mockProviderManager },
        { provide: StateSnapshotService, useValue: mockStateSnapshotService },
        { provide: VectorClockService, useValue: mockVectorClockService },
        { provide: CLIENT_ID_PROVIDER, useValue: mockClientIdProvider },
        { provide: OperationEncryptionService, useValue: mockEncryptionService },
      ],
    });

    service = TestBed.inject(SnapshotUploadService);
  });

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
      (mockSyncProvider as any).supportsOperationSync = false;
      expect(() => service.getValidatedSuperSyncProvider()).toThrowError(
        /does not support operation sync/,
      );
    });
  });

  describe('gatherSnapshotData', () => {
    it('should gather all required data', async () => {
      const mockState = { tasks: [] };
      const mockVectorClock = { clientA: 1 };
      mockStateSnapshotService.getStateSnapshotAsync.and.resolveTo(mockState as any);
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

    it('should throw when client ID is not available', async () => {
      mockClientIdProvider.loadClientId.and.resolveTo(null);
      await expectAsync(service.gatherSnapshotData()).toBeRejectedWithError(
        'Client ID not available',
      );
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
      mockStateSnapshotService.getStateSnapshotAsync.and.resolveTo(mockState as any);
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

    it('should encrypt payload when enabling encryption', async () => {
      const mockState = { task: [] };
      mockStateSnapshotService.getStateSnapshotAsync.and.resolveTo(mockState as any);

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
      const callOrder: string[] = [];

      mockStateSnapshotService.getStateSnapshotAsync.and.callFake(async () => {
        callOrder.push('getStateSnapshotAsync');
        return {} as any;
      });

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
        'getStateSnapshotAsync',
        'encryptPayload',
        'deleteAllData',
        'setProviderConfig',
        'uploadSnapshot',
        'setLastServerSeq',
      ]);
    });
  });
});
