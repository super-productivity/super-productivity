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

describe('SnapshotUploadService', () => {
  let service: SnapshotUploadService;
  let mockProviderManager: jasmine.SpyObj<SyncProviderManager>;
  let mockStateSnapshotService: jasmine.SpyObj<StateSnapshotService>;
  let mockVectorClockService: jasmine.SpyObj<VectorClockService>;
  let mockClientIdProvider: { loadClientId: jasmine.Spy };
  let mockSyncProvider: jasmine.SpyObj<
    SyncProviderServiceInterface<SyncProviderId> & OperationSyncCapable
  >;

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
      load: jasmine.createSpy('load').and.resolveTo(null),
    } as any;
    // Mark as operation-sync capable (isOperationSyncCapable checks for this property)
    (mockSyncProvider as any).supportsOperationSync = true;

    mockProviderManager = jasmine.createSpyObj('SyncProviderManager', [
      'getActiveProvider',
    ]);
    mockProviderManager.getActiveProvider.and.returnValue(mockSyncProvider);

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

    TestBed.configureTestingModule({
      providers: [
        SnapshotUploadService,
        { provide: SyncProviderManager, useValue: mockProviderManager },
        { provide: StateSnapshotService, useValue: mockStateSnapshotService },
        { provide: VectorClockService, useValue: mockVectorClockService },
        { provide: CLIENT_ID_PROVIDER, useValue: mockClientIdProvider },
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
});
