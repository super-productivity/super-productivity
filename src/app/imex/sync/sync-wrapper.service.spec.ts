import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, firstValueFrom, of } from 'rxjs';
import { SyncWrapperService } from './sync-wrapper.service';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { OperationLogSyncService } from '../../op-log/sync/operation-log-sync.service';
import { WrappedProviderService } from '../../op-log/sync-providers/wrapped-provider.service';
import { OperationLogStoreService } from '../../op-log/persistence/operation-log-store.service';
import { LegacyPfDbService } from '../../core/persistence/legacy-pf-db.service';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { TranslateService } from '@ngx-translate/core';
import { MatDialog } from '@angular/material/dialog';
import { SnackService } from '../../core/snack/snack.service';
import { ReminderService } from '../../features/reminder/reminder.service';
import { DataInitService } from '../../core/data-init/data-init.service';
import { UserInputWaitStateService } from './user-input-wait-state.service';
import { SuperSyncStatusService } from '../../op-log/sync/super-sync-status.service';
import { SuperSyncWebSocketService } from '../../op-log/sync/super-sync-websocket.service';
import { WsTriggeredDownloadService } from '../../op-log/sync/ws-triggered-download.service';
import {
  AuthFailSPError,
  MissingCredentialsSPError,
  PotentialCorsError,
  SyncProviderId,
  SyncStatus,
} from '../../op-log/sync-exports';
import {
  SyncAlreadyInProgressError,
  LocalDataConflictError,
  MissingRefreshTokenAPIError,
} from '../../op-log/core/errors/sync-errors';
import { MAX_LWW_REUPLOAD_RETRIES } from '../../op-log/core/operation-log.const';

describe('SyncWrapperService', () => {
  let service: SyncWrapperService;
  let mockProviderManager: jasmine.SpyObj<SyncProviderManager>;
  let mockSyncService: jasmine.SpyObj<OperationLogSyncService>;
  let mockWrappedProvider: jasmine.SpyObj<WrappedProviderService>;
  let mockOpLogStore: jasmine.SpyObj<OperationLogStoreService>;
  let mockLegacyPfDb: jasmine.SpyObj<LegacyPfDbService>;
  let mockGlobalConfigService: jasmine.SpyObj<GlobalConfigService>;
  let mockSnackService: jasmine.SpyObj<SnackService>;
  let mockMatDialog: jasmine.SpyObj<MatDialog>;
  let mockTranslateService: jasmine.SpyObj<TranslateService>;
  let mockDataInitService: jasmine.SpyObj<DataInitService>;
  let mockReminderService: jasmine.SpyObj<ReminderService>;
  let mockUserInputWaitState: jasmine.SpyObj<UserInputWaitStateService>;
  let mockSuperSyncStatusService: jasmine.SpyObj<SuperSyncStatusService>;
  let mockSuperSyncWsService: jasmine.SpyObj<SuperSyncWebSocketService> & {
    isConnected: ReturnType<typeof signal<boolean>>;
  };
  let mockWsDownloadService: jasmine.SpyObj<WsTriggeredDownloadService>;

  let configSubject: BehaviorSubject<any>;
  let mockSyncCapableProvider: any;

  const createMockSyncConfig = (
    provider: SyncProviderId | null,
    overrides: Record<string, unknown> = {},
  ): { sync: any } => ({
    sync: {
      syncProvider: provider,
      syncInterval: 60000,
      isManualSyncOnly: false,
      ...overrides,
    },
  });

  beforeEach(() => {
    configSubject = new BehaviorSubject(createMockSyncConfig(SyncProviderId.SuperSync));

    mockSyncCapableProvider = {
      uploadOperations: jasmine.createSpy('uploadOperations'),
      downloadOperations: jasmine.createSpy('downloadOperations'),
    };

    mockProviderManager = jasmine.createSpyObj(
      'SyncProviderManager',
      [
        'getActiveProvider',
        'setSyncStatus',
        'setProviderConfig',
        'getProviderById',
        'clearAuthCredentials',
        'getLastSyncedProviderId',
        'setLastSyncedProviderId',
      ],
      {
        syncStatus$: of('SYNCED'),
        isProviderReady$: of(true),
        isSyncInProgress: false,
      },
    );
    mockProviderManager.clearAuthCredentials.and.returnValue(Promise.resolve());
    mockProviderManager.getProviderById.and.returnValue(Promise.resolve(undefined));
    mockProviderManager.getLastSyncedProviderId.and.returnValue(null);
    mockProviderManager.getActiveProvider.and.returnValue({
      id: SyncProviderId.SuperSync,
    } as any);

    mockSyncService = jasmine.createSpyObj('OperationLogSyncService', [
      'downloadRemoteOps',
      'uploadPendingOps',
    ]);
    mockSyncService.downloadRemoteOps.and.returnValue(
      Promise.resolve({
        kind: 'no_new_ops' as const,
      }),
    );
    mockSyncService.uploadPendingOps.and.returnValue(
      Promise.resolve({
        kind: 'completed' as const,
        uploadedCount: 0,
        piggybackedOpsCount: 0,
        localWinOpsCreated: 0,
        permanentRejectionCount: 0,
        hasMorePiggyback: false,
        rejectedOps: [],
      }),
    );

    mockWrappedProvider = jasmine.createSpyObj('WrappedProviderService', [
      'getOperationSyncCapable',
    ]);
    mockWrappedProvider.getOperationSyncCapable.and.returnValue(
      Promise.resolve(mockSyncCapableProvider),
    );

    mockOpLogStore = jasmine.createSpyObj('OperationLogStoreService', [
      'getVectorClockEntry',
      'setVectorClock',
    ]);
    mockOpLogStore.getVectorClockEntry.and.returnValue(Promise.resolve(null));

    mockLegacyPfDb = jasmine.createSpyObj('LegacyPfDbService', [
      'loadMetaModel',
      'saveMetaModel',
    ]);
    mockLegacyPfDb.loadMetaModel.and.returnValue(Promise.resolve({}));
    mockLegacyPfDb.saveMetaModel.and.returnValue(Promise.resolve());

    mockGlobalConfigService = jasmine.createSpyObj('GlobalConfigService', [], {
      cfg$: configSubject.asObservable(),
    });

    mockSnackService = jasmine.createSpyObj('SnackService', ['open']);
    mockMatDialog = jasmine.createSpyObj('MatDialog', ['open'], {
      openDialogs: [],
    });
    mockTranslateService = jasmine.createSpyObj('TranslateService', ['instant']);
    mockTranslateService.instant.and.callFake((key: string) => key);

    mockDataInitService = jasmine.createSpyObj('DataInitService', [
      'reInitFromRemoteSync',
    ]);
    mockReminderService = jasmine.createSpyObj('ReminderService', ['reloadFromDatabase']);

    mockUserInputWaitState = jasmine.createSpyObj(
      'UserInputWaitStateService',
      ['startWaiting'],
      {
        isWaitingForUserInput$: of(false),
      },
    );
    // startWaiting returns a stopWaiting function
    mockUserInputWaitState.startWaiting.and.returnValue(() => {});

    mockSuperSyncStatusService = jasmine.createSpyObj(
      'SuperSyncStatusService',
      ['clearScope'],
      {
        isConfirmedInSync: signal(false),
        hasNoPendingOps: signal(false),
      },
    );

    mockSuperSyncWsService = Object.assign(
      jasmine.createSpyObj('SuperSyncWebSocketService', ['connect', 'disconnect']),
      {
        isConnected: signal(false),
      },
    );
    mockSuperSyncWsService.connect.and.returnValue(Promise.resolve());

    mockWsDownloadService = jasmine.createSpyObj('WsTriggeredDownloadService', [
      'start',
      'stop',
    ]);

    TestBed.configureTestingModule({
      providers: [
        SyncWrapperService,
        { provide: SyncProviderManager, useValue: mockProviderManager },
        { provide: OperationLogSyncService, useValue: mockSyncService },
        { provide: WrappedProviderService, useValue: mockWrappedProvider },
        { provide: OperationLogStoreService, useValue: mockOpLogStore },
        { provide: LegacyPfDbService, useValue: mockLegacyPfDb },
        { provide: GlobalConfigService, useValue: mockGlobalConfigService },
        { provide: TranslateService, useValue: mockTranslateService },
        { provide: MatDialog, useValue: mockMatDialog },
        { provide: SnackService, useValue: mockSnackService },
        { provide: DataInitService, useValue: mockDataInitService },
        { provide: ReminderService, useValue: mockReminderService },
        { provide: UserInputWaitStateService, useValue: mockUserInputWaitState },
        { provide: SuperSyncStatusService, useValue: mockSuperSyncStatusService },
        { provide: SuperSyncWebSocketService, useValue: mockSuperSyncWsService },
        { provide: WsTriggeredDownloadService, useValue: mockWsDownloadService },
      ],
    });

    service = TestBed.inject(SyncWrapperService);
  });

  describe('sync() method', () => {
    it('should return HANDLED_ERROR when sync already in progress', async () => {
      // Start first sync but don't await it
      const firstSync = service.sync();

      // Try to start another sync while first is in progress
      const secondResult = await service.sync();

      expect(secondResult).toBe('HANDLED_ERROR');

      // Clean up first sync
      await firstSync;
    });

    it('should set isSyncInProgress true during sync, false after', async () => {
      expect(service.isSyncInProgressSync()).toBe(false);

      const syncPromise = service.sync();

      // Should be true during sync
      expect(service.isSyncInProgressSync()).toBe(true);

      await syncPromise;

      // Should be false after sync
      expect(service.isSyncInProgressSync()).toBe(false);
    });

    it('should reset isSyncInProgress even on error', async () => {
      mockWrappedProvider.getOperationSyncCapable.and.returnValue(
        Promise.reject(new Error('Test error')),
      );

      expect(service.isSyncInProgressSync()).toBe(false);

      await service.sync();

      // Should be false after error
      expect(service.isSyncInProgressSync()).toBe(false);
    });

    it('should return InSync on successful sync', async () => {
      const result = await service.sync();

      expect(result).toBe(SyncStatus.InSync);
    });
  });

  describe('syncInterval$', () => {
    it('should use 1 minute for SuperSync when websocket is disconnected', async () => {
      expect(await firstValueFrom(service.syncInterval$)).toBe(60000);
    });

    it('should use 5 minutes for SuperSync when websocket is connected', async () => {
      mockSuperSyncWsService.isConnected.set(true);
      configSubject.next(createMockSyncConfig(SyncProviderId.SuperSync));

      expect(await firstValueFrom(service.syncInterval$)).toBe(300000);
    });

    it('should return 0 for manual sync only', async () => {
      configSubject.next(
        createMockSyncConfig(SyncProviderId.SuperSync, { isManualSyncOnly: true }),
      );

      expect(await firstValueFrom(service.syncInterval$)).toBe(0);
    });

    it('should use configured interval for non-SuperSync providers', async () => {
      configSubject.next(
        createMockSyncConfig(SyncProviderId.WebDAV, { syncInterval: 120000 }),
      );

      expect(await firstValueFrom(service.syncInterval$)).toBe(120000);
    });
  });

  describe('websocket integration', () => {
    it('should disconnect websocket when provider changes away from SuperSync', async () => {
      configSubject.next(createMockSyncConfig(SyncProviderId.WebDAV));
      await Promise.resolve();

      expect(mockWsDownloadService.stop).toHaveBeenCalled();
      expect(mockSuperSyncWsService.disconnect).toHaveBeenCalled();
    });

    it('should connect websocket after successful SuperSync sync', async () => {
      const mockProvider = {
        getWebSocketParams: jasmine.createSpy().and.returnValue(
          Promise.resolve({
            baseUrl: 'https://sync.example.com',
            accessToken: 'token-123',
          }),
        ),
      };
      mockProviderManager.getProviderById.and.returnValue(
        Promise.resolve(mockProvider as any),
      );

      await service.sync();
      // Flush microtasks: connectWebSocket() is fire-and-forget (not awaited in _sync).
      // Two flushes needed: one for getProviderById, one for getWebSocketParams + connect.
      await Promise.resolve();
      await Promise.resolve();

      expect(mockProviderManager.getProviderById).toHaveBeenCalledWith(
        SyncProviderId.SuperSync,
      );
      expect(mockProvider.getWebSocketParams).toHaveBeenCalled();
      expect(mockSuperSyncWsService.connect).toHaveBeenCalledWith(
        'https://sync.example.com',
        'token-123',
      );
      expect(mockWsDownloadService.start).toHaveBeenCalled();
    });

    it('should no-op connectWebSocket when provider is not SuperSync', async () => {
      configSubject.next(createMockSyncConfig(SyncProviderId.WebDAV));
      await service.connectWebSocket();
      await Promise.resolve();

      expect(mockProviderManager.getProviderById).not.toHaveBeenCalled();
    });

    it('should no-op connectWebSocket when getWebSocketParams returns null', async () => {
      const mockProvider = {
        getWebSocketParams: jasmine.createSpy().and.returnValue(Promise.resolve(null)),
      };
      mockProviderManager.getProviderById.and.returnValue(
        Promise.resolve(mockProvider as any),
      );

      await service.connectWebSocket();
      await Promise.resolve();
      await Promise.resolve();

      expect(mockProvider.getWebSocketParams).toHaveBeenCalled();
      expect(mockSuperSyncWsService.connect).not.toHaveBeenCalled();
    });

    it('should skip WS connection after sync if already connected', async () => {
      mockSuperSyncWsService.isConnected.set(true);

      await service.sync();
      await Promise.resolve();
      await Promise.resolve();

      expect(mockSuperSyncWsService.connect).not.toHaveBeenCalled();
    });
  });

  describe('_sync() - Provider handling', () => {
    it('should call _syncVectorClockToPfapi for WebDAV provider', async () => {
      configSubject.next(createMockSyncConfig(SyncProviderId.WebDAV));
      mockOpLogStore.getVectorClockEntry.and.returnValue(
        Promise.resolve({
          clock: { clientA: 5 },
          lastUpdate: Date.now(),
        }),
      );

      await service.sync();

      // Should have loaded and saved meta model for vector clock sync
      expect(mockLegacyPfDb.loadMetaModel).toHaveBeenCalled();
      expect(mockLegacyPfDb.saveMetaModel).toHaveBeenCalled();
    });

    it('should call _syncVectorClockToPfapi for Dropbox provider', async () => {
      configSubject.next(createMockSyncConfig(SyncProviderId.Dropbox));
      mockOpLogStore.getVectorClockEntry.and.returnValue(
        Promise.resolve({
          clock: { clientA: 5 },
          lastUpdate: Date.now(),
        }),
      );

      await service.sync();

      expect(mockLegacyPfDb.loadMetaModel).toHaveBeenCalled();
      expect(mockLegacyPfDb.saveMetaModel).toHaveBeenCalled();
    });

    it('should NOT call _syncVectorClockToPfapi for SuperSync provider', async () => {
      configSubject.next(createMockSyncConfig(SyncProviderId.SuperSync));

      await service.sync();

      // Should NOT have tried to sync vector clock for SuperSync
      expect(mockLegacyPfDb.saveMetaModel).not.toHaveBeenCalled();
    });

    it('should return InSync when provider does not support operation sync', async () => {
      mockWrappedProvider.getOperationSyncCapable.and.returnValue(Promise.resolve(null));

      const result = await service.sync();

      expect(result).toBe(SyncStatus.InSync);
      expect(mockSyncService.downloadRemoteOps).not.toHaveBeenCalled();
      expect(mockSyncService.uploadPendingOps).not.toHaveBeenCalled();
    });
  });

  describe('_sync() - Provider switch detection', () => {
    it('should pass forceFromSeq0 when provider has changed', async () => {
      mockProviderManager.getLastSyncedProviderId.and.returnValue(SyncProviderId.Dropbox);
      configSubject.next(createMockSyncConfig(SyncProviderId.SuperSync));

      await service.sync();

      expect(mockSyncService.downloadRemoteOps).toHaveBeenCalledWith(
        mockSyncCapableProvider,
        { forceFromSeq0: true },
      );
    });

    it('should NOT pass forceFromSeq0 when provider is the same', async () => {
      mockProviderManager.getLastSyncedProviderId.and.returnValue(
        SyncProviderId.SuperSync,
      );
      configSubject.next(createMockSyncConfig(SyncProviderId.SuperSync));

      await service.sync();

      expect(mockSyncService.downloadRemoteOps).toHaveBeenCalledWith(
        mockSyncCapableProvider,
        undefined,
      );
    });

    it('should NOT pass forceFromSeq0 on first-ever sync (no last synced provider)', async () => {
      mockProviderManager.getLastSyncedProviderId.and.returnValue(null);

      await service.sync();

      expect(mockSyncService.downloadRemoteOps).toHaveBeenCalledWith(
        mockSyncCapableProvider,
        undefined,
      );
    });

    it('should update lastSyncedProviderId after successful download', async () => {
      configSubject.next(createMockSyncConfig(SyncProviderId.SuperSync));

      await service.sync();

      expect(mockProviderManager.setLastSyncedProviderId).toHaveBeenCalledWith(
        SyncProviderId.SuperSync,
      );
    });

    it('should NOT update lastSyncedProviderId when download is cancelled', async () => {
      mockSyncService.downloadRemoteOps.and.returnValue(
        Promise.resolve({
          kind: 'cancelled' as const,
        }),
      );

      await service.sync();

      expect(mockProviderManager.setLastSyncedProviderId).not.toHaveBeenCalled();
    });
  });

  describe('_sync() - Sync flow', () => {
    it('should download before upload', async () => {
      const callOrder: string[] = [];
      mockSyncService.downloadRemoteOps.and.callFake(async () => {
        callOrder.push('download');
        return { kind: 'no_new_ops' as const };
      });
      mockSyncService.uploadPendingOps.and.callFake(async () => {
        callOrder.push('upload');
        return {
          kind: 'completed' as const,
          uploadedCount: 0,
          piggybackedOpsCount: 0,
          localWinOpsCreated: 0,
          permanentRejectionCount: 0,
          hasMorePiggyback: false,
          rejectedOps: [],
        };
      });

      await service.sync();

      expect(callOrder).toEqual(['download', 'upload']);
    });

    it('should re-upload when localWinOpsCreated > 0 from download', async () => {
      mockSyncService.downloadRemoteOps.and.returnValue(
        Promise.resolve({
          kind: 'ops_processed' as const,
          newOpsCount: 5,
          localWinOpsCreated: 3, // LWW created 3 local-win ops
        }),
      );
      mockSyncService.uploadPendingOps.and.returnValue(
        Promise.resolve({
          kind: 'completed' as const,
          uploadedCount: 3,
          piggybackedOpsCount: 0,
          localWinOpsCreated: 0,
          permanentRejectionCount: 0,
          hasMorePiggyback: false,
          rejectedOps: [],
        }),
      );

      await service.sync();

      // Upload should be called twice: initial + re-upload for LWW ops
      expect(mockSyncService.uploadPendingOps).toHaveBeenCalledTimes(2);
    });

    it('should re-upload when localWinOpsCreated > 0 from upload', async () => {
      mockSyncService.downloadRemoteOps.and.returnValue(
        Promise.resolve({
          kind: 'no_new_ops' as const,
        }),
      );
      // First upload returns localWinOpsCreated > 0
      let uploadCallCount = 0;
      mockSyncService.uploadPendingOps.and.callFake(async () => {
        uploadCallCount++;
        if (uploadCallCount === 1) {
          return {
            kind: 'completed' as const,
            uploadedCount: 2,
            piggybackedOpsCount: 0,
            localWinOpsCreated: 2, // LWW created ops from piggybacked
            permanentRejectionCount: 0,
            hasMorePiggyback: false,
            rejectedOps: [],
          };
        }
        return {
          kind: 'completed' as const,
          uploadedCount: 2,
          piggybackedOpsCount: 0,
          localWinOpsCreated: 0,
          permanentRejectionCount: 0,
          hasMorePiggyback: false,
          rejectedOps: [],
        };
      });

      await service.sync();

      // Upload should be called twice
      expect(mockSyncService.uploadPendingOps).toHaveBeenCalledTimes(2);
    });

    it('should NOT re-upload when no localWinOpsCreated', async () => {
      mockSyncService.downloadRemoteOps.and.returnValue(
        Promise.resolve({
          kind: 'ops_processed' as const,
          newOpsCount: 5,
          localWinOpsCreated: 0,
        }),
      );
      mockSyncService.uploadPendingOps.and.returnValue(
        Promise.resolve({
          kind: 'completed' as const,
          uploadedCount: 3,
          piggybackedOpsCount: 0,
          localWinOpsCreated: 0,
          permanentRejectionCount: 0,
          hasMorePiggyback: false,
          rejectedOps: [],
        }),
      );

      await service.sync();

      // Upload should be called only once
      expect(mockSyncService.uploadPendingOps).toHaveBeenCalledTimes(1);
    });
  });

  describe('Status handling', () => {
    it('should set setSyncStatus IN_SYNC after successful sync', async () => {
      await service.sync();

      expect(mockProviderManager.setSyncStatus).toHaveBeenCalledWith('IN_SYNC');
    });

    it('should NOT set IN_SYNC when error occurs', async () => {
      mockSyncService.downloadRemoteOps.and.returnValue(
        Promise.reject(new Error('Network error')),
      );

      await service.sync();

      // setSyncStatus is called with 'SYNCING' at start, but should NOT be called with 'IN_SYNC' on error
      expect(mockProviderManager.setSyncStatus).not.toHaveBeenCalledWith('IN_SYNC');
    });

    it('should set ERROR and return HANDLED_ERROR when upload has rejected ops with "Payload too complex"', async () => {
      mockSyncService.uploadPendingOps.and.returnValue(
        Promise.resolve({
          kind: 'completed' as const,
          uploadedCount: 0,
          piggybackedOpsCount: 0,
          localWinOpsCreated: 0,
          permanentRejectionCount: 1,
          hasMorePiggyback: false,
          rejectedOps: [{ opId: 'test-op', error: 'Payload too complex (max depth 50)' }],
        }),
      );

      const result = await service.sync();

      expect(result).toBe('HANDLED_ERROR');
      expect(mockProviderManager.setSyncStatus).toHaveBeenCalledWith('ERROR');
      expect(mockProviderManager.setSyncStatus).not.toHaveBeenCalledWith('IN_SYNC');
    });

    it('should set ERROR and return HANDLED_ERROR when upload has rejected ops with "Payload too large"', async () => {
      mockSyncService.uploadPendingOps.and.returnValue(
        Promise.resolve({
          kind: 'completed' as const,
          uploadedCount: 0,
          piggybackedOpsCount: 0,
          localWinOpsCreated: 0,
          permanentRejectionCount: 1,
          hasMorePiggyback: false,
          rejectedOps: [{ opId: 'test-op', error: 'Payload too large' }],
        }),
      );

      const result = await service.sync();

      expect(result).toBe('HANDLED_ERROR');
      expect(mockProviderManager.setSyncStatus).toHaveBeenCalledWith('ERROR');
      expect(mockProviderManager.setSyncStatus).not.toHaveBeenCalledWith('IN_SYNC');
    });

    it('should set ERROR for non-payload rejected ops', async () => {
      mockSyncService.uploadPendingOps.and.returnValue(
        Promise.resolve({
          kind: 'completed' as const,
          uploadedCount: 0,
          piggybackedOpsCount: 0,
          localWinOpsCreated: 0,
          permanentRejectionCount: 1,
          hasMorePiggyback: false,
          rejectedOps: [{ opId: 'test-op', error: 'Some other rejection' }],
        }),
      );

      const result = await service.sync();

      expect(result).toBe('HANDLED_ERROR');
      expect(mockProviderManager.setSyncStatus).toHaveBeenCalledWith('ERROR');
    });

    it('should set IN_SYNC when some ops uploaded and none rejected', async () => {
      mockSyncService.uploadPendingOps.and.returnValue(
        Promise.resolve({
          kind: 'completed' as const,
          uploadedCount: 5,
          piggybackedOpsCount: 0,
          localWinOpsCreated: 0,
          permanentRejectionCount: 0,
          hasMorePiggyback: false,
          rejectedOps: [],
        }),
      );

      const result = await service.sync();

      expect(result).toBe(SyncStatus.InSync);
      expect(mockProviderManager.setSyncStatus).toHaveBeenCalledWith('IN_SYNC');
    });

    it('should set ERROR when multiple ops rejected', async () => {
      mockSyncService.uploadPendingOps.and.returnValue(
        Promise.resolve({
          kind: 'completed' as const,
          uploadedCount: 3,
          piggybackedOpsCount: 0,
          localWinOpsCreated: 0,
          permanentRejectionCount: 2,
          hasMorePiggyback: false,
          rejectedOps: [
            { opId: 'op1', error: 'Conflict' },
            { opId: 'op2', error: 'Validation failed' },
          ],
        }),
      );

      const result = await service.sync();

      expect(result).toBe('HANDLED_ERROR');
      expect(mockProviderManager.setSyncStatus).toHaveBeenCalledWith('ERROR');
    });

    it('should set IN_SYNC when uploadResult is blocked_fresh_client', async () => {
      mockSyncService.uploadPendingOps.and.returnValue(
        Promise.resolve({ kind: 'blocked_fresh_client' as const }),
      );

      const result = await service.sync();

      expect(result).toBe(SyncStatus.InSync);
      expect(mockProviderManager.setSyncStatus).toHaveBeenCalledWith('IN_SYNC');
    });

    it('should set IN_SYNC when permanentRejectionCount is 0 even with empty rejectedOps array', async () => {
      mockSyncService.uploadPendingOps.and.returnValue(
        Promise.resolve({
          kind: 'completed' as const,
          uploadedCount: 0,
          piggybackedOpsCount: 0,
          localWinOpsCreated: 0,
          permanentRejectionCount: 0,
          hasMorePiggyback: false,
          rejectedOps: [],
        }),
      );

      const result = await service.sync();

      expect(result).toBe(SyncStatus.InSync);
      expect(mockProviderManager.setSyncStatus).toHaveBeenCalledWith('IN_SYNC');
    });
  });

  describe('Error handling', () => {
    it('should handle PotentialCorsError with snack message', async () => {
      mockSyncService.downloadRemoteOps.and.returnValue(
        Promise.reject(new PotentialCorsError('https://example.com')),
      );

      const result = await service.sync();

      expect(result).toBe('HANDLED_ERROR');
      expect(mockSnackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: 'ERROR',
        }),
      );
    });

    it('should handle AuthFailSPError with config dialog action', async () => {
      mockSyncService.downloadRemoteOps.and.returnValue(
        Promise.reject(new AuthFailSPError()),
      );

      const result = await service.sync();

      expect(result).toBe('HANDLED_ERROR');
      expect(mockProviderManager.setSyncStatus).toHaveBeenCalledWith('ERROR');
      expect(mockSuperSyncStatusService.clearScope).toHaveBeenCalled();
      expect(mockSnackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: 'ERROR',
          actionFn: jasmine.any(Function),
        }),
      );
    });

    it('should handle MissingCredentialsSPError with config dialog action', async () => {
      mockSyncService.downloadRemoteOps.and.returnValue(
        Promise.reject(new MissingCredentialsSPError('Dropbox no token')),
      );

      const result = await service.sync();

      expect(result).toBe('HANDLED_ERROR');
      expect(mockProviderManager.setSyncStatus).toHaveBeenCalledWith('ERROR');
      expect(mockSuperSyncStatusService.clearScope).toHaveBeenCalled();
      expect(mockSnackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: 'ERROR',
          actionFn: jasmine.any(Function),
        }),
      );
    });

    it('should handle MissingRefreshTokenAPIError with config dialog action', async () => {
      mockSyncService.downloadRemoteOps.and.returnValue(
        Promise.reject(new MissingRefreshTokenAPIError()),
      );

      const result = await service.sync();

      expect(result).toBe('HANDLED_ERROR');
      expect(mockProviderManager.setSyncStatus).toHaveBeenCalledWith('ERROR');
      expect(mockSuperSyncStatusService.clearScope).toHaveBeenCalled();
      expect(mockSnackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: 'ERROR',
          actionFn: jasmine.any(Function),
        }),
      );
    });

    it('should NOT call clearAuthCredentials on first AuthFailSPError for SuperSync', async () => {
      mockSyncService.downloadRemoteOps.and.returnValue(
        Promise.reject(new AuthFailSPError()),
      );

      await service.sync();

      expect(mockProviderManager.clearAuthCredentials).not.toHaveBeenCalled();
    });

    it('should NOT call clearAuthCredentials on second consecutive AuthFailSPError for SuperSync', async () => {
      mockSyncService.downloadRemoteOps.and.returnValue(
        Promise.reject(new AuthFailSPError()),
      );

      await service.sync();
      await service.sync();

      expect(mockProviderManager.clearAuthCredentials).not.toHaveBeenCalled();
    });

    it('should call clearAuthCredentials on third consecutive AuthFailSPError for SuperSync', async () => {
      mockSyncService.downloadRemoteOps.and.returnValue(
        Promise.reject(new AuthFailSPError()),
      );

      await service.sync();
      await service.sync();
      await service.sync();

      expect(mockProviderManager.clearAuthCredentials).toHaveBeenCalledWith(
        SyncProviderId.SuperSync,
      );
    });

    it('should reset auth failure counter after successful sync', async () => {
      // Fail twice
      mockSyncService.downloadRemoteOps.and.returnValue(
        Promise.reject(new AuthFailSPError()),
      );
      await service.sync();
      await service.sync();
      expect(mockProviderManager.clearAuthCredentials).not.toHaveBeenCalled();

      // Succeed once (reset counter)
      mockSyncService.downloadRemoteOps.and.returnValue(
        Promise.resolve({ kind: 'no_new_ops' as const }),
      );
      await service.sync();

      // Fail once more — should NOT clear (counter was reset)
      mockSyncService.downloadRemoteOps.and.returnValue(
        Promise.reject(new AuthFailSPError()),
      );
      mockProviderManager.clearAuthCredentials.calls.reset();
      await service.sync();

      expect(mockProviderManager.clearAuthCredentials).not.toHaveBeenCalled();
    });

    it('should reset auth failure counter when a non-auth error occurs between auth errors', async () => {
      // Fail twice with auth error
      mockSyncService.downloadRemoteOps.and.returnValue(
        Promise.reject(new AuthFailSPError()),
      );
      await service.sync();
      await service.sync();
      expect(mockProviderManager.clearAuthCredentials).not.toHaveBeenCalled();

      // Non-auth error resets the counter
      mockSyncService.downloadRemoteOps.and.returnValue(
        Promise.reject(new Error('network timeout')),
      );
      await service.sync();

      // Next two auth failures should NOT clear (counter was reset by non-auth error)
      mockSyncService.downloadRemoteOps.and.returnValue(
        Promise.reject(new AuthFailSPError()),
      );
      mockProviderManager.clearAuthCredentials.calls.reset();
      await service.sync();
      await service.sync();

      expect(mockProviderManager.clearAuthCredentials).not.toHaveBeenCalled();
    });

    it('should call clearAuthCredentials on MissingCredentialsSPError', async () => {
      mockSyncService.downloadRemoteOps.and.returnValue(
        Promise.reject(new MissingCredentialsSPError('no token')),
      );

      await service.sync();

      expect(mockProviderManager.clearAuthCredentials).toHaveBeenCalledWith(
        SyncProviderId.SuperSync,
      );
    });

    it('should call clearAuthCredentials on MissingRefreshTokenAPIError', async () => {
      mockSyncService.downloadRemoteOps.and.returnValue(
        Promise.reject(new MissingRefreshTokenAPIError()),
      );

      await service.sync();

      expect(mockProviderManager.clearAuthCredentials).toHaveBeenCalledWith(
        SyncProviderId.SuperSync,
      );
    });

    it('should still show snack when clearAuthCredentials throws', async () => {
      mockProviderManager.clearAuthCredentials.and.returnValue(
        Promise.reject(new Error('IndexedDB error')),
      );
      mockSyncService.downloadRemoteOps.and.returnValue(
        Promise.reject(new MissingCredentialsSPError('no token')),
      );

      const result = await service.sync();

      expect(result).toBe('HANDLED_ERROR');
      expect(mockSnackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: 'ERROR',
          actionFn: jasmine.any(Function),
        }),
      );
    });

    it('should handle SyncAlreadyInProgressError silently', async () => {
      mockSyncService.downloadRemoteOps.and.returnValue(
        Promise.reject(new SyncAlreadyInProgressError()),
      );

      const result = await service.sync();

      expect(result).toBe('HANDLED_ERROR');
      // Should NOT show snack for this error
      expect(mockSnackService.open).not.toHaveBeenCalled();
    });

    describe('LocalDataConflictError handling', () => {
      beforeEach(() => {
        mockOpLogStore.getVectorClockEntry.and.returnValue(
          Promise.resolve({
            clock: { clientA: 5 },
            lastUpdate: Date.now(),
          }),
        );
      });

      it('should catch LocalDataConflictError and open conflict dialog', async () => {
        const conflictError = new LocalDataConflictError(
          3, // unsyncedCount
          { tasks: [{ id: 'remote-task' }] }, // remoteSnapshotState
          { clientB: 5 }, // remoteVectorClock
        );
        mockSyncService.downloadRemoteOps.and.returnValue(Promise.reject(conflictError));

        // Mock dialog to return USE_LOCAL
        mockMatDialog.open.and.returnValue({
          afterClosed: () => of('USE_LOCAL'),
        } as any);

        mockSyncService.forceUploadLocalState = jasmine
          .createSpy('forceUploadLocalState')
          .and.resolveTo();

        await service.sync();

        // Should open conflict dialog
        expect(mockMatDialog.open).toHaveBeenCalled();
      });

      it('should call forceUploadLocalState when user chooses USE_LOCAL', async () => {
        const conflictError = new LocalDataConflictError(
          2,
          { tasks: [] },
          { clientB: 3 },
        );
        mockSyncService.downloadRemoteOps.and.returnValue(Promise.reject(conflictError));

        mockMatDialog.open.and.returnValue({
          afterClosed: () => of('USE_LOCAL'),
        } as any);

        mockSyncService.forceUploadLocalState = jasmine
          .createSpy('forceUploadLocalState')
          .and.resolveTo();

        const result = await service.sync();

        expect(mockSyncService.forceUploadLocalState).toHaveBeenCalledWith(
          mockSyncCapableProvider,
        );
        expect(result).toBe(SyncStatus.InSync);
      });

      it('should call forceDownloadRemoteState when user chooses USE_REMOTE', async () => {
        const conflictError = new LocalDataConflictError(
          2,
          { tasks: [] },
          { clientB: 3 },
        );
        mockSyncService.downloadRemoteOps.and.returnValue(Promise.reject(conflictError));

        mockMatDialog.open.and.returnValue({
          afterClosed: () => of('USE_REMOTE'),
        } as any);

        mockSyncService.forceDownloadRemoteState = jasmine
          .createSpy('forceDownloadRemoteState')
          .and.resolveTo();

        const result = await service.sync();

        expect(mockSyncService.forceDownloadRemoteState).toHaveBeenCalledWith(
          mockSyncCapableProvider,
        );
        expect(result).toBe(SyncStatus.InSync);
      });

      it('should return HANDLED_ERROR when user cancels conflict dialog', async () => {
        const conflictError = new LocalDataConflictError(
          2,
          { tasks: [] },
          { clientB: 3 },
        );
        mockSyncService.downloadRemoteOps.and.returnValue(Promise.reject(conflictError));

        // User cancels dialog (returns undefined)
        mockMatDialog.open.and.returnValue({
          afterClosed: () => of(undefined),
        } as any);

        const result = await service.sync();

        expect(result).toBe('HANDLED_ERROR');
        expect(mockSnackService.open).toHaveBeenCalled();
      });

      it('should return HANDLED_ERROR when forceUploadLocalState fails', async () => {
        const conflictError = new LocalDataConflictError(
          2,
          { tasks: [] },
          { clientB: 3 },
        );
        mockSyncService.downloadRemoteOps.and.returnValue(Promise.reject(conflictError));

        mockMatDialog.open.and.returnValue({
          afterClosed: () => of('USE_LOCAL'),
        } as any);

        mockSyncService.forceUploadLocalState = jasmine
          .createSpy('forceUploadLocalState')
          .and.rejectWith(new Error('Upload failed'));

        const result = await service.sync();

        expect(result).toBe('HANDLED_ERROR');
        expect(mockSnackService.open).toHaveBeenCalledWith(
          jasmine.objectContaining({
            type: 'ERROR',
          }),
        );
      });

      it('should return HANDLED_ERROR when forceDownloadRemoteState fails', async () => {
        const conflictError = new LocalDataConflictError(
          2,
          { tasks: [] },
          { clientB: 3 },
        );
        mockSyncService.downloadRemoteOps.and.returnValue(Promise.reject(conflictError));

        mockMatDialog.open.and.returnValue({
          afterClosed: () => of('USE_REMOTE'),
        } as any);

        mockSyncService.forceDownloadRemoteState = jasmine
          .createSpy('forceDownloadRemoteState')
          .and.rejectWith(new Error('Download failed'));

        const result = await service.sync();

        expect(result).toBe('HANDLED_ERROR');
        expect(mockSnackService.open).toHaveBeenCalledWith(
          jasmine.objectContaining({
            type: 'ERROR',
          }),
        );
      });

      it('should return HANDLED_ERROR when provider becomes unavailable during resolution', async () => {
        const conflictError = new LocalDataConflictError(
          2,
          { tasks: [] },
          { clientB: 3 },
        );
        mockSyncService.downloadRemoteOps.and.returnValue(Promise.reject(conflictError));

        mockMatDialog.open.and.returnValue({
          afterClosed: () => of('USE_LOCAL'),
        } as any);

        // First call returns provider (for initial sync), second call returns null (during resolution)
        let callCount = 0;
        mockWrappedProvider.getOperationSyncCapable.and.callFake(() => {
          callCount++;
          if (callCount === 1) {
            return Promise.resolve(mockSyncCapableProvider);
          }
          return Promise.resolve(null);
        });

        const result = await service.sync();

        expect(result).toBe('HANDLED_ERROR');
      });

      it('should call startWaiting before showing dialog and stop after resolution', async () => {
        const stopWaitingSpy = jasmine.createSpy('stopWaiting');
        mockUserInputWaitState.startWaiting.and.returnValue(stopWaitingSpy);

        const conflictError = new LocalDataConflictError(
          2,
          { tasks: [] },
          { clientB: 3 },
        );
        mockSyncService.downloadRemoteOps.and.returnValue(Promise.reject(conflictError));

        mockMatDialog.open.and.returnValue({
          afterClosed: () => of('USE_LOCAL'),
        } as any);

        mockSyncService.forceUploadLocalState = jasmine
          .createSpy('forceUploadLocalState')
          .and.resolveTo();

        await service.sync();

        expect(mockUserInputWaitState.startWaiting).toHaveBeenCalledWith(
          'local-data-conflict',
        );
        expect(stopWaitingSpy).toHaveBeenCalled();
      });

      it('should call stopWaiting even when resolution fails', async () => {
        const stopWaitingSpy = jasmine.createSpy('stopWaiting');
        mockUserInputWaitState.startWaiting.and.returnValue(stopWaitingSpy);

        const conflictError = new LocalDataConflictError(
          2,
          { tasks: [] },
          { clientB: 3 },
        );
        mockSyncService.downloadRemoteOps.and.returnValue(Promise.reject(conflictError));

        mockMatDialog.open.and.returnValue({
          afterClosed: () => of('USE_LOCAL'),
        } as any);

        mockSyncService.forceUploadLocalState = jasmine
          .createSpy('forceUploadLocalState')
          .and.rejectWith(new Error('Upload failed'));

        await service.sync();

        // stopWaiting should be called even on error (finally block)
        expect(stopWaitingSpy).toHaveBeenCalled();
      });
    });

    it('should handle permission errors with appropriate message', async () => {
      mockSyncService.downloadRemoteOps.and.returnValue(
        Promise.reject(new Error('EACCES: permission denied')),
      );

      const result = await service.sync();

      expect(result).toBe('HANDLED_ERROR');
      expect(mockSnackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: 'ERROR',
        }),
      );
    });

    it('should handle unknown errors with generic snack', async () => {
      mockSyncService.downloadRemoteOps.and.returnValue(
        Promise.reject(new Error('Some unexpected error')),
      );

      const result = await service.sync();

      expect(result).toBe('HANDLED_ERROR');
      expect(mockSnackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: 'ERROR',
        }),
      );
    });
  });

  describe('isSyncInProgressSync()', () => {
    it('should return false initially', () => {
      expect(service.isSyncInProgressSync()).toBe(false);
    });
  });

  describe('isEncryptionOperationInProgress', () => {
    it('should return false initially', () => {
      expect(service.isEncryptionOperationInProgress).toBe(false);
    });

    it('should return true during runWithSyncBlocked execution', async () => {
      let capturedValue = false;

      await service.runWithSyncBlocked(async () => {
        capturedValue = service.isEncryptionOperationInProgress;
      });

      expect(capturedValue).toBe(true);
    });

    it('should return false after runWithSyncBlocked completes', async () => {
      await service.runWithSyncBlocked(async () => {
        // do nothing
      });

      expect(service.isEncryptionOperationInProgress).toBe(false);
    });

    it('should return false after runWithSyncBlocked throws', async () => {
      try {
        await service.runWithSyncBlocked(async () => {
          throw new Error('Test error');
        });
      } catch {
        // expected
      }

      expect(service.isEncryptionOperationInProgress).toBe(false);
    });
  });

  describe('runWithSyncBlocked()', () => {
    it('should execute the operation and return its result', async () => {
      const result = await service.runWithSyncBlocked(async () => {
        return 'test-result';
      });

      expect(result).toBe('test-result');
    });

    it('should propagate errors from the operation', async () => {
      const testError = new Error('Test operation error');

      await expectAsync(
        service.runWithSyncBlocked(async () => {
          throw testError;
        }),
      ).toBeRejectedWith(testError);
    });

    it('should block sync during operation', async () => {
      let syncResultDuringOperation: SyncStatus | 'HANDLED_ERROR' | undefined;

      await service.runWithSyncBlocked(async () => {
        // Try to sync during encryption operation
        syncResultDuringOperation = await service.sync();
      });

      // Sync should have been blocked and returned HANDLED_ERROR
      expect(syncResultDuringOperation).toBe('HANDLED_ERROR');
    });

    it('should allow sync after operation completes', async () => {
      await service.runWithSyncBlocked(async () => {
        // do nothing
      });

      // Sync should work after encryption operation completes
      const result = await service.sync();

      expect(result).toBe(SyncStatus.InSync);
    });

    it('should wait for ongoing sync to complete before starting operation', async () => {
      const callOrder: string[] = [];

      // Start a sync that takes a bit
      let syncResolve: () => void;
      const syncPromise = new Promise<void>((resolve) => {
        syncResolve = resolve;
      });

      mockSyncService.downloadRemoteOps.and.callFake(async () => {
        callOrder.push('sync-download-start');
        await syncPromise;
        callOrder.push('sync-download-end');
        return { kind: 'no_new_ops' as const };
      });

      // Start sync
      const syncCall = service.sync();

      // Give sync time to start
      await new Promise((r) => setTimeout(r, 10));

      // Start encryption operation - should wait for sync
      const encryptionOpPromise = service.runWithSyncBlocked(async () => {
        callOrder.push('encryption-op');
      });

      // Let sync complete
      syncResolve!();
      await syncCall;
      await encryptionOpPromise;

      // Encryption operation should have waited for sync to complete
      expect(callOrder).toEqual([
        'sync-download-start',
        'sync-download-end',
        'encryption-op',
      ]);
    });
  });

  describe('sync() with encryption operation blocking', () => {
    it('should return HANDLED_ERROR when encryption operation is in progress', async () => {
      // Manually set the flag (simulating runWithSyncBlocked is active)
      service['_isEncryptionOperationInProgress$'].next(true);

      const result = await service.sync();

      expect(result).toBe('HANDLED_ERROR');

      // Clean up
      service['_isEncryptionOperationInProgress$'].next(false);
    });

    it('should not call download or upload when encryption operation is in progress', async () => {
      service['_isEncryptionOperationInProgress$'].next(true);

      await service.sync();

      expect(mockSyncService.downloadRemoteOps).not.toHaveBeenCalled();
      expect(mockSyncService.uploadPendingOps).not.toHaveBeenCalled();

      // Clean up
      service['_isEncryptionOperationInProgress$'].next(false);
    });
  });

  describe('syncProviderId$', () => {
    it('should emit SyncProviderId from sync config', (done) => {
      configSubject.next(createMockSyncConfig(SyncProviderId.SuperSync));

      service.syncProviderId$.subscribe((providerId) => {
        expect(providerId).toBe(SyncProviderId.SuperSync);
        done();
      });
    });

    it('should return null for null sync provider', (done) => {
      configSubject.next(createMockSyncConfig(null));

      service.syncProviderId$.subscribe((providerId) => {
        expect(providerId).toBeNull();
        done();
      });
    });
  });

  describe('superSyncIsConfirmedInSync$', () => {
    let signalService: SyncWrapperService;
    let isConfirmedSignal: ReturnType<typeof signal<boolean>>;
    let signalConfigSubject: BehaviorSubject<any>;

    const createSignalMockConfig = (provider: SyncProviderId | null): { sync: any } => ({
      sync: {
        syncProvider: provider,
        syncInterval: 60000,
      },
    });

    const createServiceWithSignal = (initialValue: boolean): SyncWrapperService => {
      isConfirmedSignal = signal(initialValue);
      signalConfigSubject = new BehaviorSubject(
        createSignalMockConfig(SyncProviderId.SuperSync),
      );

      const signalMockSuperSyncStatusService = {
        isConfirmedInSync: isConfirmedSignal,
        hasNoPendingOps: signal(true), // When isConfirmedInSync is true, hasNoPendingOps is also true
        markRemoteChecked: jasmine.createSpy('markRemoteChecked'),
        clearScope: jasmine.createSpy('clearScope'),
        updatePendingOpsStatus: jasmine.createSpy('updatePendingOpsStatus'),
      };

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          SyncWrapperService,
          { provide: SyncProviderManager, useValue: mockProviderManager },
          { provide: OperationLogSyncService, useValue: mockSyncService },
          { provide: WrappedProviderService, useValue: mockWrappedProvider },
          { provide: OperationLogStoreService, useValue: mockOpLogStore },
          { provide: LegacyPfDbService, useValue: mockLegacyPfDb },
          {
            provide: GlobalConfigService,
            useValue: { cfg$: signalConfigSubject.asObservable() },
          },
          { provide: TranslateService, useValue: mockTranslateService },
          { provide: MatDialog, useValue: mockMatDialog },
          { provide: SnackService, useValue: mockSnackService },
          { provide: DataInitService, useValue: mockDataInitService },
          { provide: ReminderService, useValue: mockReminderService },
          { provide: UserInputWaitStateService, useValue: mockUserInputWaitState },
          { provide: SuperSyncStatusService, useValue: signalMockSuperSyncStatusService },
        ],
      });

      return TestBed.inject(SyncWrapperService);
    };

    describe('with SuperSync provider', () => {
      it('should return true when SuperSyncStatusService.isConfirmedInSync is true', (done) => {
        signalService = createServiceWithSignal(true);
        signalConfigSubject.next(createSignalMockConfig(SyncProviderId.SuperSync));

        signalService.superSyncIsConfirmedInSync$.subscribe((isConfirmed) => {
          expect(isConfirmed).toBe(true);
          done();
        });
      });

      it('should return false when SuperSyncStatusService.isConfirmedInSync is false', (done) => {
        signalService = createServiceWithSignal(false);
        signalConfigSubject.next(createSignalMockConfig(SyncProviderId.SuperSync));

        signalService.superSyncIsConfirmedInSync$.subscribe((isConfirmed) => {
          expect(isConfirmed).toBe(false);
          done();
        });
      });
    });

    describe('with file-based providers', () => {
      it('should return false for WebDAV when status service returns false', (done) => {
        signalService = createServiceWithSignal(false);
        signalConfigSubject.next(createSignalMockConfig(SyncProviderId.WebDAV));

        signalService.superSyncIsConfirmedInSync$.subscribe((isConfirmed) => {
          expect(isConfirmed).toBe(false);
          done();
        });
      });

      it('should return true for WebDAV when status service returns true', (done) => {
        signalService = createServiceWithSignal(true);
        signalConfigSubject.next(createSignalMockConfig(SyncProviderId.WebDAV));

        signalService.superSyncIsConfirmedInSync$.subscribe((isConfirmed) => {
          expect(isConfirmed).toBe(true);
          done();
        });
      });

      it('should return false for Dropbox when status service returns false', (done) => {
        signalService = createServiceWithSignal(false);
        signalConfigSubject.next(createSignalMockConfig(SyncProviderId.Dropbox));

        signalService.superSyncIsConfirmedInSync$.subscribe((isConfirmed) => {
          expect(isConfirmed).toBe(false);
          done();
        });
      });

      it('should return true for Dropbox when status service returns true', (done) => {
        signalService = createServiceWithSignal(true);
        signalConfigSubject.next(createSignalMockConfig(SyncProviderId.Dropbox));

        signalService.superSyncIsConfirmedInSync$.subscribe((isConfirmed) => {
          expect(isConfirmed).toBe(true);
          done();
        });
      });

      it('should return false for LocalFile when status service returns false', (done) => {
        signalService = createServiceWithSignal(false);
        signalConfigSubject.next(createSignalMockConfig(SyncProviderId.LocalFile));

        signalService.superSyncIsConfirmedInSync$.subscribe((isConfirmed) => {
          expect(isConfirmed).toBe(false);
          done();
        });
      });

      it('should return true for LocalFile when status service returns true', (done) => {
        signalService = createServiceWithSignal(true);
        signalConfigSubject.next(createSignalMockConfig(SyncProviderId.LocalFile));

        signalService.superSyncIsConfirmedInSync$.subscribe((isConfirmed) => {
          expect(isConfirmed).toBe(true);
          done();
        });
      });
    });
  });

  describe('hasNoPendingOps$', () => {
    let signalService: SyncWrapperService;
    let hasNoPendingOpsSignal: ReturnType<typeof signal<boolean>>;

    const createServiceWithPendingOpsSignal = (
      hasNoPendingOps: boolean,
    ): SyncWrapperService => {
      hasNoPendingOpsSignal = signal(hasNoPendingOps);

      const signalMockSuperSyncStatusService = {
        isConfirmedInSync: signal(false),
        hasNoPendingOps: hasNoPendingOpsSignal,
        markRemoteChecked: jasmine.createSpy('markRemoteChecked'),
        clearScope: jasmine.createSpy('clearScope'),
        updatePendingOpsStatus: jasmine.createSpy('updatePendingOpsStatus'),
      };

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          SyncWrapperService,
          { provide: SyncProviderManager, useValue: mockProviderManager },
          { provide: OperationLogSyncService, useValue: mockSyncService },
          { provide: WrappedProviderService, useValue: mockWrappedProvider },
          { provide: OperationLogStoreService, useValue: mockOpLogStore },
          { provide: LegacyPfDbService, useValue: mockLegacyPfDb },
          {
            provide: GlobalConfigService,
            useValue: { cfg$: configSubject.asObservable() },
          },
          { provide: TranslateService, useValue: mockTranslateService },
          { provide: MatDialog, useValue: mockMatDialog },
          { provide: SnackService, useValue: mockSnackService },
          { provide: DataInitService, useValue: mockDataInitService },
          { provide: ReminderService, useValue: mockReminderService },
          { provide: UserInputWaitStateService, useValue: mockUserInputWaitState },
          { provide: SuperSyncStatusService, useValue: signalMockSuperSyncStatusService },
        ],
      });

      return TestBed.inject(SyncWrapperService);
    };

    it('should return true when hasNoPendingOps signal is true', (done) => {
      signalService = createServiceWithPendingOpsSignal(true);

      signalService.hasNoPendingOps$.subscribe((hasNoPending) => {
        expect(hasNoPending).toBe(true);
        done();
      });
    });

    it('should return false when hasNoPendingOps signal is false', (done) => {
      signalService = createServiceWithPendingOpsSignal(false);

      signalService.hasNoPendingOps$.subscribe((hasNoPending) => {
        expect(hasNoPending).toBe(false);
        done();
      });
    });
  });

  describe('_isTimeoutError', () => {
    it('should detect timeout keyword in error message', () => {
      const timeoutError = new Error('Request timeout after 75s');
      expect(service['_isTimeoutError'](timeoutError)).toBe(true);
    });

    it('should detect 504 status code', () => {
      const error504 = new Error('504 Gateway Timeout');
      expect(service['_isTimeoutError'](error504)).toBe(true);
    });

    it('should detect gateway timeout phrase', () => {
      const gatewayError = new Error('Error: gateway timeout from proxy');
      expect(service['_isTimeoutError'](gatewayError)).toBe(true);
    });

    it('should be case insensitive', () => {
      const uppercaseError = new Error('REQUEST TIMEOUT');
      expect(service['_isTimeoutError'](uppercaseError)).toBe(true);

      const mixedCaseError = new Error('Gateway TIMEOUT occurred');
      expect(service['_isTimeoutError'](mixedCaseError)).toBe(true);
    });

    it('should not false-positive on network errors', () => {
      const networkError = new Error('Network error');
      expect(service['_isTimeoutError'](networkError)).toBe(false);
    });

    it('should not false-positive on auth errors', () => {
      const authError = new Error('401 Unauthorized');
      expect(service['_isTimeoutError'](authError)).toBe(false);
    });

    it('should not false-positive on generic errors', () => {
      const genericError = new Error('Something went wrong');
      expect(service['_isTimeoutError'](genericError)).toBe(false);
    });

    it('should handle non-Error objects', () => {
      expect(service['_isTimeoutError']('timeout string')).toBe(true);
      expect(service['_isTimeoutError']('regular error')).toBe(false);
    });

    it('should handle objects with toString()', () => {
      const errorObj = { toString: () => 'Error: timeout occurred' };
      expect(service['_isTimeoutError'](errorObj)).toBe(true);
    });
  });

  describe('_sync() - LWW retry loop limit', () => {
    it('should stop after MAX_LWW_REUPLOAD_RETRIES when upload always returns localWinOpsCreated', async () => {
      mockSyncService.downloadRemoteOps.and.returnValue(
        Promise.resolve({
          kind: 'no_new_ops' as const,
        }),
      );
      // Upload always returns localWinOpsCreated: 2 (never resolves)
      mockSyncService.uploadPendingOps.and.returnValue(
        Promise.resolve({
          kind: 'completed' as const,
          uploadedCount: 2,
          piggybackedOpsCount: 0,
          localWinOpsCreated: 2,
          permanentRejectionCount: 0,
          hasMorePiggyback: false,
          rejectedOps: [],
        }),
      );

      const result = await service.sync();

      // 1 initial upload + MAX_LWW_REUPLOAD_RETRIES retries
      expect(mockSyncService.uploadPendingOps).toHaveBeenCalledTimes(
        1 + MAX_LWW_REUPLOAD_RETRIES,
      );
      // Should set UNKNOWN_OR_CHANGED since ops remain pending
      expect(mockProviderManager.setSyncStatus).toHaveBeenCalledWith(
        'UNKNOWN_OR_CHANGED',
      );
      // Should return UpdateRemote to signal that unuploaded ops remain
      expect(result).toBe(SyncStatus.UpdateRemote);
    });

    it('should exit early when retry returns localWinOpsCreated: 0', async () => {
      mockSyncService.downloadRemoteOps.and.returnValue(
        Promise.resolve({
          kind: 'no_new_ops' as const,
        }),
      );

      let uploadCallCount = 0;
      mockSyncService.uploadPendingOps.and.callFake(async () => {
        uploadCallCount++;
        return {
          kind: 'completed' as const,
          uploadedCount: 2,
          piggybackedOpsCount: 0,
          // First call returns 1, second call returns 0 -> exits loop
          localWinOpsCreated: uploadCallCount <= 1 ? 1 : 0,
          permanentRejectionCount: 0,
          hasMorePiggyback: false,
          rejectedOps: [],
        };
      });

      const result = await service.sync();

      // 1 initial upload + 1 retry (which returns 0) = 2 total
      // The retry returns 0 so no more retries needed
      expect(mockSyncService.uploadPendingOps).toHaveBeenCalledTimes(2);
      expect(result).toBe(SyncStatus.InSync);
    });

    it('should treat blocked_fresh_client reupload result as 0 localWinOpsCreated and exit loop', async () => {
      mockSyncService.downloadRemoteOps.and.returnValue(
        Promise.resolve({
          kind: 'no_new_ops' as const,
        }),
      );

      let uploadCallCount = 0;
      mockSyncService.uploadPendingOps.and.callFake(async () => {
        uploadCallCount++;
        if (uploadCallCount === 1) {
          return {
            kind: 'completed' as const,
            uploadedCount: 1,
            piggybackedOpsCount: 0,
            localWinOpsCreated: 2,
            permanentRejectionCount: 0,
            hasMorePiggyback: false,
            rejectedOps: [],
          };
        }
        // Second call returns blocked_fresh_client (treated as 0 localWinOpsCreated)
        return { kind: 'blocked_fresh_client' as const };
      });

      const result = await service.sync();

      // 1 initial + 1 retry (returns blocked_fresh_client -> treated as 0) = 2 total
      expect(mockSyncService.uploadPendingOps).toHaveBeenCalledTimes(2);
      expect(result).toBe(SyncStatus.InSync);
    });

    it('should enter while loop when both download and upload produce LWW ops', async () => {
      mockSyncService.downloadRemoteOps.and.returnValue(
        Promise.resolve({
          kind: 'ops_processed' as const,
          newOpsCount: 5,
          localWinOpsCreated: 2, // download produced LWW ops
        }),
      );

      let uploadCallCount = 0;
      mockSyncService.uploadPendingOps.and.callFake(async () => {
        uploadCallCount++;
        return {
          kind: 'completed' as const,
          uploadedCount: 3,
          piggybackedOpsCount: 0,
          // First upload also produces LWW ops, subsequent do not
          localWinOpsCreated: uploadCallCount === 1 ? 1 : 0,
          permanentRejectionCount: 0,
          hasMorePiggyback: false,
          rejectedOps: [],
        };
      });

      const result = await service.sync();

      // pendingLwwOps = download(2) + upload(1) = 3
      // Retry 1: upload returns 0 -> exits loop
      // Total uploads: 1 initial + 1 retry = 2
      expect(mockSyncService.uploadPendingOps).toHaveBeenCalledTimes(2);
      expect(result).toBe(SyncStatus.InSync);
    });
  });
});
