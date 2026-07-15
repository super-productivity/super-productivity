import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { SyncHydrationService } from './sync-hydration.service';
import { OperationLogStoreService } from './operation-log-store.service';
import { AppStateSnapshot, StateSnapshotService } from '../backup/state-snapshot.service';
import { ClientIdService } from '../../core/util/client-id.service';
import { VectorClockService } from '../sync/vector-clock.service';
import { ValidateStateService } from '../validation/validate-state.service';
import { loadAllData } from '../../root-store/meta/load-all-data.action';
import { ActionType, OperationLogEntry, OpType } from '../core/operation.types';
import { SyncProviderId } from '../sync-providers/provider.const';
import { DEFAULT_GLOBAL_CONFIG } from '../../features/config/default-global-config.const';
import { LOCAL_ONLY_SYNC_KEYS } from '../../features/config/local-only-sync-settings.util';
import { SnackService } from '../../core/snack/snack.service';
import { ArchiveDbAdapter } from '../../core/persistence/archive-db-adapter.service';
import { LockService } from '../sync/lock.service';
import { LOCK_NAMES } from '../core/operation-log.const';
import { TaskTimeSyncService } from '../../features/tasks/task-time-sync.service';

describe('SyncHydrationService', () => {
  let service: SyncHydrationService;
  let mockStore: jasmine.SpyObj<Store>;
  let mockOpLogStore: jasmine.SpyObj<OperationLogStoreService>;
  let mockStateSnapshotService: jasmine.SpyObj<StateSnapshotService>;
  let mockClientIdService: jasmine.SpyObj<ClientIdService>;
  let mockVectorClockService: jasmine.SpyObj<VectorClockService>;
  let mockValidateStateService: jasmine.SpyObj<ValidateStateService>;
  let mockSnackService: jasmine.SpyObj<SnackService>;
  let mockArchiveDbAdapter: jasmine.SpyObj<ArchiveDbAdapter>;
  let mockLockService: jasmine.SpyObj<LockService>;
  let mockTaskTimeSyncService: jasmine.SpyObj<TaskTimeSyncService>;

  // Default local sync config for tests
  const defaultLocalSyncConfig = {
    ...DEFAULT_GLOBAL_CONFIG.sync,
    isEnabled: true,
    syncProvider: SyncProviderId.WebDAV,
    syncInterval: 300000,
    isManualSyncOnly: false,
  };

  beforeEach(() => {
    mockStore = jasmine.createSpyObj('Store', ['dispatch', 'select']);
    // Default: return local sync config with isEnabled: true
    mockStore.select.and.returnValue(of(defaultLocalSyncConfig));
    mockOpLogStore = jasmine.createSpyObj('OperationLogStoreService', [
      'append',
      'getLastSeq',
      'saveStateCache',
      'setVectorClock',
      'commitFileSnapshotBaseline',
      'loadStateCache',
      'getUnsynced',
      'markRejected',
    ]);
    // Default: no unsynced ops (for tests that don't care about this)
    mockOpLogStore.getUnsynced.and.resolveTo([]);
    mockOpLogStore.markRejected.and.resolveTo();
    mockStateSnapshotService = jasmine.createSpyObj('StateSnapshotService', [
      'getAllSyncModelDataFromStoreAsync',
    ]);
    mockStateSnapshotService.getAllSyncModelDataFromStoreAsync.and.resolveTo({} as any);
    // Default: state cache has no vector clock (simulates fresh start)
    mockOpLogStore.loadStateCache.and.resolveTo(null);
    mockClientIdService = jasmine.createSpyObj('ClientIdService', [
      'loadClientId',
      'getOrGenerateClientId',
    ]);
    mockVectorClockService = jasmine.createSpyObj('VectorClockService', [
      'getCurrentVectorClock',
    ]);
    mockValidateStateService = jasmine.createSpyObj('ValidateStateService', [
      'validateAndRepair',
    ]);
    mockSnackService = jasmine.createSpyObj('SnackService', ['open']);
    mockArchiveDbAdapter = jasmine.createSpyObj('ArchiveDbAdapter', [
      'saveArchiveYoung',
      'saveArchiveOld',
    ]);
    mockArchiveDbAdapter.saveArchiveYoung.and.resolveTo();
    mockArchiveDbAdapter.saveArchiveOld.and.resolveTo();
    mockLockService = jasmine.createSpyObj('LockService', ['request']);
    mockLockService.request.and.callFake(async (_lockName, callback) => callback());
    mockTaskTimeSyncService = jasmine.createSpyObj('TaskTimeSyncService', [
      'flush',
      'clear',
      'accumulate',
      'shouldFlush',
    ]);

    TestBed.configureTestingModule({
      providers: [
        SyncHydrationService,
        { provide: Store, useValue: mockStore },
        { provide: OperationLogStoreService, useValue: mockOpLogStore },
        { provide: StateSnapshotService, useValue: mockStateSnapshotService },
        { provide: ClientIdService, useValue: mockClientIdService },
        { provide: VectorClockService, useValue: mockVectorClockService },
        { provide: ValidateStateService, useValue: mockValidateStateService },
        { provide: SnackService, useValue: mockSnackService },
        { provide: ArchiveDbAdapter, useValue: mockArchiveDbAdapter },
        { provide: LockService, useValue: mockLockService },
        { provide: TaskTimeSyncService, useValue: mockTaskTimeSyncService },
      ],
    });
    service = TestBed.inject(SyncHydrationService);
  });

  const setupDefaultMocks = (): void => {
    mockClientIdService.loadClientId.and.resolveTo('localClient');
    mockClientIdService.getOrGenerateClientId.and.resolveTo('localClient');
    mockVectorClockService.getCurrentVectorClock.and.resolveTo({ localClient: 5 });
    mockOpLogStore.append.and.resolveTo(undefined);
    mockOpLogStore.getLastSeq.and.resolveTo(10);
    mockOpLogStore.saveStateCache.and.resolveTo(undefined);
    mockOpLogStore.setVectorClock.and.resolveTo(undefined);
    mockOpLogStore.commitFileSnapshotBaseline.and.resolveTo({
      seqs: [],
      writtenOps: [],
      skippedCount: 0,
    });
    mockValidateStateService.validateAndRepair.and.resolveTo({
      isValid: true,
      wasRepaired: false,
    });
  };

  describe('hydrateFromRemoteSync', () => {
    beforeEach(setupDefaultMocks);

    it('serializes archive replacement and its snapshot read', async () => {
      let isArchiveLockHeld = false;
      mockLockService.request.and.callFake(async (lockName, callback) => {
        expect(lockName).toBe(LOCK_NAMES.TASK_ARCHIVE);
        isArchiveLockHeld = true;
        try {
          return await callback();
        } finally {
          isArchiveLockHeld = false;
        }
      });
      mockArchiveDbAdapter.saveArchiveYoung.and.callFake(async () => {
        expect(isArchiveLockHeld).toBeTrue();
      });
      mockArchiveDbAdapter.saveArchiveOld.and.callFake(async () => {
        expect(isArchiveLockHeld).toBeTrue();
      });
      mockStateSnapshotService.getAllSyncModelDataFromStoreAsync.and.callFake(
        async () => {
          expect(isArchiveLockHeld).toBeTrue();
          return {} as AppStateSnapshot;
        },
      );

      await service.hydrateFromRemoteSync({
        archiveYoung: { task: { ids: [], entities: {} } },
        archiveOld: { task: { ids: [], entities: {} } },
      });

      expect(mockLockService.request).toHaveBeenCalledTimes(1);
    });

    it('should merge downloaded data with archive data from DB', async () => {
      const downloadedData = { task: { ids: ['t1'] }, project: { ids: ['p1'] } };
      const archiveData = {
        archiveYoung: { data: 'young' },
        archiveOld: { data: 'old' },
      };
      mockStateSnapshotService.getAllSyncModelDataFromStoreAsync.and.resolveTo(
        archiveData as any,
      );

      await service.hydrateFromRemoteSync(downloadedData);

      // Verify the merged data was used
      const appendCall = mockOpLogStore.append.calls.mostRecent();
      const payload = appendCall.args[0].payload as Record<string, unknown>;
      expect(payload['task']).toEqual({ ids: ['t1'] });
      expect(payload['project']).toEqual({ ids: ['p1'] });
      expect(payload['archiveYoung']).toEqual({ data: 'young' });
      expect(payload['archiveOld']).toEqual({ data: 'old' });
    });

    it('should create SYNC_IMPORT operation with correct properties', async () => {
      await service.hydrateFromRemoteSync({ task: {} });

      expect(mockOpLogStore.append).toHaveBeenCalledWith(
        jasmine.objectContaining({
          actionType: ActionType.LOAD_ALL_DATA,
          opType: OpType.SyncImport,
          entityType: 'ALL',
          clientId: 'localClient',
        }),
        'remote',
      );
    });

    it('should merge local and state cache vector clocks', async () => {
      const localClock = { localClient: 5 };
      const stateCacheClock = { remoteClient: 10, otherClient: 3 };
      mockVectorClockService.getCurrentVectorClock.and.resolveTo(localClock);
      mockOpLogStore.loadStateCache.and.resolveTo({
        vectorClock: stateCacheClock,
      } as any);

      await service.hydrateFromRemoteSync({});

      const appendCall = mockOpLogStore.append.calls.mostRecent();
      const vectorClock = appendCall.args[0].vectorClock;
      // Should have all clients with incremented local client
      expect(vectorClock['localClient']).toBe(6);
      expect(vectorClock['remoteClient']).toBe(10);
      expect(vectorClock['otherClient']).toBe(3);
    });

    it('should handle missing state cache gracefully', async () => {
      mockOpLogStore.loadStateCache.and.resolveTo(null);

      await service.hydrateFromRemoteSync({});

      // Should still work with just local clock
      const appendCall = mockOpLogStore.append.calls.mostRecent();
      const vectorClock = appendCall.args[0].vectorClock;
      expect(vectorClock['localClient']).toBe(6);
    });

    it('should handle state cache with missing vectorClock', async () => {
      mockOpLogStore.loadStateCache.and.resolveTo({ someOtherProp: 'value' } as any);

      await service.hydrateFromRemoteSync({});

      const appendCall = mockOpLogStore.append.calls.mostRecent();
      const vectorClock = appendCall.args[0].vectorClock;
      expect(vectorClock['localClient']).toBe(6);
    });

    it('should merge remote snapshot vector clock when provided', async () => {
      const localClock = { localClient: 5 };
      const stateCacheClock = { cachedClient: 3 };
      const remoteVectorClock = { remoteClient: 100, anotherRemote: 50 };
      mockVectorClockService.getCurrentVectorClock.and.resolveTo(localClock);
      mockOpLogStore.loadStateCache.and.resolveTo({
        vectorClock: stateCacheClock,
      } as any);

      await service.hydrateFromRemoteSync({}, remoteVectorClock);

      const appendCall = mockOpLogStore.append.calls.mostRecent();
      const vectorClock = appendCall.args[0].vectorClock;
      // Should have all clients: local (incremented), cached, and remote
      expect(vectorClock['localClient']).toBe(6); // incremented
      expect(vectorClock['cachedClient']).toBe(3);
      expect(vectorClock['remoteClient']).toBe(100);
      expect(vectorClock['anotherRemote']).toBe(50);
    });

    it('should handle undefined remote vector clock gracefully', async () => {
      const localClock = { localClient: 5 };
      mockVectorClockService.getCurrentVectorClock.and.resolveTo(localClock);
      mockOpLogStore.loadStateCache.and.resolveTo(null);

      // Pass undefined explicitly
      await service.hydrateFromRemoteSync({}, undefined);

      const appendCall = mockOpLogStore.append.calls.mostRecent();
      const vectorClock = appendCall.args[0].vectorClock;
      expect(vectorClock['localClient']).toBe(6);
    });

    it('should take max value when merging conflicting clock entries', async () => {
      const localClock = { localClient: 5, sharedClient: 10 };
      const stateCacheClock = { sharedClient: 8, cachedClient: 3 };
      const remoteVectorClock = { sharedClient: 15, remoteClient: 100 };
      mockVectorClockService.getCurrentVectorClock.and.resolveTo(localClock);
      mockOpLogStore.loadStateCache.and.resolveTo({
        vectorClock: stateCacheClock,
      } as any);

      await service.hydrateFromRemoteSync({}, remoteVectorClock);

      const appendCall = mockOpLogStore.append.calls.mostRecent();
      const vectorClock = appendCall.args[0].vectorClock;
      // sharedClient should be max of 10, 8, 15 = 15
      expect(vectorClock['sharedClient']).toBe(15);
      expect(vectorClock['localClient']).toBe(6); // incremented from 5
      expect(vectorClock['cachedClient']).toBe(3);
      expect(vectorClock['remoteClient']).toBe(100);
    });

    it('should persist local-only settings in local SYNC_IMPORT payload for replay', async () => {
      const downloadedData = {
        task: {},
        globalConfig: {
          sync: {
            syncProvider: 'dropbox',
            syncInterval: 600000,
            isManualSyncOnly: true,
            someOther: 'setting',
          },
          otherSetting: 'value',
        },
      };

      await service.hydrateFromRemoteSync(downloadedData);

      const appendCall = mockOpLogStore.append.calls.mostRecent();
      const payload = appendCall.args[0].payload as Record<string, unknown>;
      const globalConfig = payload['globalConfig'] as Record<string, unknown>;
      const sync = globalConfig['sync'] as Record<string, unknown>;
      expect(sync['isEnabled']).toBe(defaultLocalSyncConfig.isEnabled);
      expect(sync['isEncryptionEnabled']).toBe(
        defaultLocalSyncConfig.isEncryptionEnabled,
      );
      expect(sync['syncProvider']).toBe(defaultLocalSyncConfig.syncProvider);
      expect(sync['syncInterval']).toBe(defaultLocalSyncConfig.syncInterval);
      expect(sync['isManualSyncOnly']).toBe(defaultLocalSyncConfig.isManualSyncOnly);
      expect(sync['someOther']).toBe('setting');
      expect(globalConfig['otherSetting']).toBe('value');
    });

    it('should not modify data without globalConfig', async () => {
      const downloadedData = { task: { ids: ['t1'] } };

      await service.hydrateFromRemoteSync(downloadedData);

      const appendCall = mockOpLogStore.append.calls.mostRecent();
      const payload = appendCall.args[0].payload as Record<string, unknown>;
      expect(payload['task']).toEqual({ ids: ['t1'] });
    });

    it('should not modify globalConfig without sync property', async () => {
      const downloadedData = {
        task: {},
        globalConfig: { lang: 'en' },
      };

      await service.hydrateFromRemoteSync(downloadedData);

      const appendCall = mockOpLogStore.append.calls.mostRecent();
      const payload = appendCall.args[0].payload as Record<string, unknown>;
      const globalConfig = payload['globalConfig'] as Record<string, unknown>;
      expect(globalConfig['lang']).toBe('en');
    });

    it('should use getOrGenerateClientId and propagate the ID to SYNC_IMPORT', async () => {
      // Simulate issue #6197: getOrGenerateClientId() generates a fresh ID when stored is invalid.
      // Service must use the returned ID — not throw, not leave the op with null/undefined.
      mockClientIdService.getOrGenerateClientId.and.resolveTo('B_regen');

      await expectAsync(service.hydrateFromRemoteSync({})).toBeResolved();
      expect(mockClientIdService.getOrGenerateClientId).toHaveBeenCalled();

      // Verify the SYNC_IMPORT operation carries the ID returned by getOrGenerateClientId
      const appendCall = mockOpLogStore.append.calls.mostRecent();
      expect(appendCall.args[0].clientId).toBe('B_regen');
    });

    it('should save state cache after appending operation', async () => {
      mockOpLogStore.getLastSeq.and.resolveTo(42);

      await service.hydrateFromRemoteSync({});

      expect(mockOpLogStore.saveStateCache).toHaveBeenCalledWith(
        jasmine.objectContaining({
          lastAppliedOpSeq: 42,
        }),
      );
    });

    it('should update vector clock store after sync with minimal clock', async () => {
      mockVectorClockService.getCurrentVectorClock.and.resolveTo({ localClient: 5 });
      mockOpLogStore.loadStateCache.and.resolveTo({ vectorClock: { remote: 3 } } as any);

      await service.hydrateFromRemoteSync({});

      // After SYNC_IMPORT, the working clock is reset to minimal (only own entry).
      // The full merged clock is stored in the SYNC_IMPORT operation for filtering.
      expect(mockOpLogStore.setVectorClock).toHaveBeenCalledWith(
        jasmine.objectContaining({
          localClient: 6,
        }),
      );
      // Remote entries should NOT be in the minimal working clock
      const setClockArg = mockOpLogStore.setVectorClock.calls.mostRecent().args[0];
      expect(setClockArg['remote']).toBeUndefined();
    });

    it('should dispatch loadAllData with synced data', async () => {
      const downloadedData = { task: { ids: ['t1'] }, project: {} };
      mockStateSnapshotService.getAllSyncModelDataFromStoreAsync.and.resolveTo({} as any);

      await service.hydrateFromRemoteSync(downloadedData);

      expect(mockStore.dispatch).toHaveBeenCalledWith(
        loadAllData({
          appDataComplete: jasmine.objectContaining({
            task: { ids: ['t1'] },
          }) as any,
        }),
      );
    });

    // Regression: the in-memory time-sync delta must be captured as a durable op
    // before loadAllData wipes the live state it was applied to. Otherwise a later
    // flush dispatches a local syncTimeSpent the reducer ignores, silently dropping
    // the tracked time. Order matters: flush must precede loadAllData.
    const loadAllDataAlreadyDispatched = (): boolean =>
      mockStore.dispatch.calls
        .all()
        .some((c) => (c.args[0] as { type?: string })?.type === loadAllData.type);

    it('flushes the tracked-time accumulator BEFORE replacing NgRx state', async () => {
      let flushedBeforeLoad = false;
      mockTaskTimeSyncService.flush.and.callFake(() => {
        flushedBeforeLoad = !loadAllDataAlreadyDispatched();
      });

      await service.hydrateFromRemoteSync({ task: { ids: ['t1'] } });

      expect(mockTaskTimeSyncService.flush).toHaveBeenCalledTimes(1);
      expect(flushedBeforeLoad).toBe(true);
    });

    it('flushes the accumulator on the file-based bootstrap path too', async () => {
      let flushedBeforeLoad = false;
      mockTaskTimeSyncService.flush.and.callFake(() => {
        flushedBeforeLoad = !loadAllDataAlreadyDispatched();
      });

      // createSyncImportOp = false → file-based bootstrap (no SYNC_IMPORT).
      await service.hydrateFromRemoteSync({ task: { ids: ['t1'] } }, undefined, false);

      expect(mockTaskTimeSyncService.flush).toHaveBeenCalledTimes(1);
      expect(flushedBeforeLoad).toBe(true);
    });

    it('should use repaired state when validation detects issues', async () => {
      const downloadedData = { task: { ids: ['t1'] } };
      const repairedState = { task: { ids: ['t1'], repaired: true } } as any;
      mockValidateStateService.validateAndRepair.and.resolveTo({
        isValid: true,
        wasRepaired: true,
        repairedState,
      });

      await service.hydrateFromRemoteSync(downloadedData);

      expect(mockStore.dispatch).toHaveBeenCalledWith(
        loadAllData({
          appDataComplete: repairedState as any,
        }),
      );
      // State cache should also use repaired state
      const saveCacheCall = mockOpLogStore.saveStateCache.calls.mostRecent();
      expect(saveCacheCall.args[0].state).toBe(repairedState);
    });

    it('should use original data when no repair needed', async () => {
      const downloadedData = { task: { ids: ['t1'] } };
      mockValidateStateService.validateAndRepair.and.resolveTo({
        isValid: true,
        wasRepaired: false,
      });

      await service.hydrateFromRemoteSync(downloadedData);

      // Should dispatch with the original (merged, stripped) data, not null
      expect(mockStore.dispatch).toHaveBeenCalled();
    });

    it('should normalize invalid startOfNextDay config before validation and persistence', async () => {
      const downloadedData = {
        globalConfig: {
          ...DEFAULT_GLOBAL_CONFIG,
          misc: {
            ...DEFAULT_GLOBAL_CONFIG.misc,
            startOfNextDay: 4,
            startOfNextDayTime: '24:00',
          },
        },
      };

      await service.hydrateFromRemoteSync(downloadedData);

      const validatedData = mockValidateStateService.validateAndRepair.calls.mostRecent()
        .args[0] as any;
      expect(validatedData.globalConfig.misc.startOfNextDay).toBe(4);
      expect(validatedData.globalConfig.misc.startOfNextDayTime).toBe('04:00');

      const saveCacheCall = mockOpLogStore.saveStateCache.calls.mostRecent();
      const savedState = saveCacheCall.args[0].state as any;
      expect(savedState.globalConfig.misc.startOfNextDay).toBe(4);
      expect(savedState.globalConfig.misc.startOfNextDayTime).toBe('04:00');
    });

    it('should handle null downloadedMainModelData by using only DB data', async () => {
      const dbData = { archiveYoung: { data: 'archive' } };
      mockStateSnapshotService.getAllSyncModelDataFromStoreAsync.and.resolveTo(
        dbData as any,
      );

      await service.hydrateFromRemoteSync(undefined);

      const appendCall = mockOpLogStore.append.calls.mostRecent();
      const payload = appendCall.args[0].payload as Record<string, unknown>;
      expect(payload['archiveYoung']).toEqual({ data: 'archive' });
    });

    it('should propagate errors from append', async () => {
      mockOpLogStore.append.and.rejectWith(new Error('Append failed'));

      await expectAsync(service.hydrateFromRemoteSync({})).toBeRejectedWithError(
        'Append failed',
      );
    });

    it('should propagate errors from saveStateCache', async () => {
      mockOpLogStore.saveStateCache.and.rejectWith(new Error('Save failed'));

      await expectAsync(service.hydrateFromRemoteSync({})).toBeRejectedWithError(
        'Save failed',
      );
    });

    describe('createSyncImportOp parameter', () => {
      it('should create SYNC_IMPORT when createSyncImportOp is true (default)', async () => {
        await service.hydrateFromRemoteSync({ task: {} });

        expect(mockOpLogStore.append).toHaveBeenCalledWith(
          jasmine.objectContaining({
            opType: OpType.SyncImport,
          }),
          'remote',
        );
      });

      it('should create SYNC_IMPORT when createSyncImportOp is explicitly true', async () => {
        await service.hydrateFromRemoteSync({ task: {} }, undefined, true);

        expect(mockOpLogStore.append).toHaveBeenCalledWith(
          jasmine.objectContaining({
            opType: OpType.SyncImport,
          }),
          'remote',
        );
      });

      it('should NOT create SYNC_IMPORT when createSyncImportOp is false', async () => {
        await service.hydrateFromRemoteSync({ task: {} }, undefined, false);

        expect(mockOpLogStore.append).not.toHaveBeenCalled();
      });

      it('should reject only the pending ops captured before snapshot hydration starts', async () => {
        const makeEntry = (id: string, seq: number): OperationLogEntry => ({
          seq,
          op: {
            id,
            clientId: 'localClient',
            actionType: ActionType.TASK_SHARED_UPDATE,
            opType: OpType.Update,
            entityType: 'TASK',
            entityId: `task-${seq}`,
            payload: { title: id },
            vectorClock: { localClient: seq },
            timestamp: seq,
            schemaVersion: 1,
          },
          appliedAt: seq,
          source: 'local',
        });
        const pendingBeforeHydration = makeEntry('pending-before-hydration', 1);
        const pendingDuringHydration = makeEntry('pending-during-hydration', 2);
        let snapshotReadStarted = false;
        mockOpLogStore.getUnsynced.and.callFake(async () =>
          snapshotReadStarted
            ? [pendingBeforeHydration, pendingDuringHydration]
            : [pendingBeforeHydration],
        );
        mockStateSnapshotService.getAllSyncModelDataFromStoreAsync.and.callFake(
          async () => {
            snapshotReadStarted = true;
            return {} as never;
          },
        );

        await service.hydrateFromRemoteSync({ task: {} }, undefined, false);

        // The rejection is now folded into the atomic baseline commit (rejectOpIds)
        // rather than a standalone markRejected() that could outlive a failed
        // commit. Only the op captured before the snapshot read is rejected — the
        // one that arrived during hydration is preserved.
        expect(mockOpLogStore.markRejected).not.toHaveBeenCalled();
        const commitCall = mockOpLogStore.commitFileSnapshotBaseline.calls.mostRecent();
        expect(commitCall.args[0].rejectOpIds).toEqual([pendingBeforeHydration.op.id]);
      });

      it('should commit the file snapshot baseline when createSyncImportOp is false', async () => {
        mockOpLogStore.getLastSeq.and.resolveTo(42);

        await service.hydrateFromRemoteSync({ task: {} }, undefined, false);

        expect(mockOpLogStore.commitFileSnapshotBaseline).toHaveBeenCalledWith(
          jasmine.objectContaining({ lastAppliedOpSeq: 42 }),
        );
        expect(mockOpLogStore.saveStateCache).not.toHaveBeenCalled();
      });

      it('should include the vector clock in the atomic file baseline', async () => {
        mockVectorClockService.getCurrentVectorClock.and.resolveTo({ localClient: 5 });

        await service.hydrateFromRemoteSync({ task: {} }, undefined, false);

        expect(mockOpLogStore.commitFileSnapshotBaseline).toHaveBeenCalledWith(
          jasmine.objectContaining({
            vectorClock: jasmine.objectContaining({
              localClient: 6,
            }),
          }),
        );
        expect(mockOpLogStore.setVectorClock).not.toHaveBeenCalled();
      });

      it('should still dispatch loadAllData when createSyncImportOp is false', async () => {
        const downloadedData = { task: { ids: ['t1'] } };

        await service.hydrateFromRemoteSync(downloadedData, undefined, false);

        expect(mockStore.dispatch).toHaveBeenCalledWith(
          loadAllData({
            appDataComplete: jasmine.objectContaining({
              task: { ids: ['t1'] },
            }) as any,
          }),
        );
      });

      it('should invoke beforeStateLoad immediately before replacing NgRx state', async () => {
        let dispatchCountAtHook = -1;

        await service.hydrateFromRemoteSync({}, undefined, false, undefined, {
          beforeStateLoad: () => {
            dispatchCountAtHook = mockStore.dispatch.calls.count();
          },
        });

        expect(dispatchCountAtHook).toBe(0);
        expect(mockStore.dispatch).toHaveBeenCalledTimes(1);
      });

      it('should invoke afterStateLoad only after loadAllData dispatch commits', async () => {
        let dispatchCountBeforeStateLoad = -1;
        let dispatchCountAfterStateLoad = -1;

        await service.hydrateFromRemoteSync({}, undefined, false, undefined, {
          beforeStateLoad: () => {
            dispatchCountBeforeStateLoad = mockStore.dispatch.calls.count();
          },
          afterStateLoad: () => {
            dispatchCountAfterStateLoad = mockStore.dispatch.calls.count();
          },
        });

        expect(dispatchCountBeforeStateLoad).toBe(0);
        expect(dispatchCountAfterStateLoad).toBe(1);
      });

      it('should not invoke afterStateLoad when loadAllData dispatch throws', async () => {
        let didRunBeforeStateLoad = false;
        let didRunAfterStateLoad = false;
        mockStore.dispatch.and.throwError('state dispatch failed');

        await expectAsync(
          service.hydrateFromRemoteSync({}, undefined, false, undefined, {
            beforeStateLoad: () => {
              didRunBeforeStateLoad = true;
            },
            afterStateLoad: () => {
              didRunAfterStateLoad = true;
            },
          }),
        ).toBeRejectedWithError('state dispatch failed');

        expect(didRunBeforeStateLoad).toBeTrue();
        expect(didRunAfterStateLoad).toBeFalse();
      });

      it('should signal snapshot persistence only after cache and vector clock commit', async () => {
        const callOrder: string[] = [];
        mockOpLogStore.commitFileSnapshotBaseline.and.callFake(async () => {
          callOrder.push('commit-snapshot-baseline');
          return { seqs: [], writtenOps: [], skippedCount: 0 };
        });

        await service.hydrateFromRemoteSync({}, undefined, false, undefined, {
          afterSnapshotCachePersisted: () => {
            callOrder.push('after-snapshot-cache-persisted');
          },
          afterSnapshotPersisted: () => {
            callOrder.push('after-snapshot-persisted');
          },
          beforeStateLoad: () => {
            callOrder.push('before-state-load');
          },
        });

        expect(callOrder).toEqual([
          'commit-snapshot-baseline',
          'after-snapshot-cache-persisted',
          'after-snapshot-persisted',
          'before-state-load',
        ]);
      });

      it('should not signal or dispatch when the atomic snapshot baseline fails', async () => {
        let didPersistSnapshotCache = false;
        let didPersistSnapshot = false;
        let didRunBeforeStateLoad = false;
        let didRunAfterStateLoad = false;
        mockOpLogStore.commitFileSnapshotBaseline.and.rejectWith(
          new Error('snapshot baseline write failed'),
        );

        await expectAsync(
          service.hydrateFromRemoteSync({}, undefined, false, undefined, {
            afterSnapshotCachePersisted: () => {
              didPersistSnapshotCache = true;
            },
            afterSnapshotPersisted: () => {
              didPersistSnapshot = true;
            },
            beforeStateLoad: () => {
              didRunBeforeStateLoad = true;
            },
            afterStateLoad: () => {
              didRunAfterStateLoad = true;
            },
          }),
        ).toBeRejectedWithError('snapshot baseline write failed');

        expect(didPersistSnapshotCache).toBeFalse();
        expect(didPersistSnapshot).toBeFalse();
        expect(didRunBeforeStateLoad).toBeFalse();
        expect(didRunAfterStateLoad).toBeFalse();
        expect(mockStore.dispatch).not.toHaveBeenCalled();
      });

      it('should signal archive replacement after the atomic baseline commits', async () => {
        const callOrder: string[] = [];
        mockOpLogStore.commitFileSnapshotBaseline.and.callFake(async () => {
          callOrder.push('commit-snapshot-baseline');
          return { seqs: [], writtenOps: [], skippedCount: 0 };
        });

        await service.hydrateFromRemoteSync(
          {
            task: {},
            archiveYoung: { task: { ids: [], entities: {} } },
          },
          undefined,
          false,
          undefined,
          {
            afterArchiveReplacement: () => callOrder.push('after-archive-replace'),
          },
        );

        expect(callOrder).toEqual(['commit-snapshot-baseline', 'after-archive-replace']);
        expect(mockArchiveDbAdapter.saveArchiveYoung).not.toHaveBeenCalled();
      });

      it('should not signal archive replacement when the atomic baseline fails', async () => {
        let didReplaceArchive = false;
        mockOpLogStore.commitFileSnapshotBaseline.and.rejectWith(
          new Error('snapshot baseline write failed'),
        );

        await expectAsync(
          service.hydrateFromRemoteSync(
            {
              task: {},
              archiveYoung: { task: { ids: [], entities: {} } },
            },
            undefined,
            false,
            undefined,
            {
              afterArchiveReplacement: () => {
                didReplaceArchive = true;
              },
            },
          ),
        ).toBeRejectedWithError('snapshot baseline write failed');

        expect(didReplaceArchive).toBeFalse();
      });

      it('should still merge remote vector clock when createSyncImportOp is false', async () => {
        const remoteVectorClock = { remoteClient: 100 };
        mockVectorClockService.getCurrentVectorClock.and.resolveTo({ localClient: 5 });

        await service.hydrateFromRemoteSync({ task: {} }, remoteVectorClock, false);

        expect(mockOpLogStore.commitFileSnapshotBaseline).toHaveBeenCalledWith(
          jasmine.objectContaining({
            vectorClock: jasmine.objectContaining({
              localClient: 6,
              remoteClient: 100,
            }),
          }),
        );
      });

      it('should still validate and repair when createSyncImportOp is false', async () => {
        const repairedState = { task: { repaired: true } } as any;
        mockValidateStateService.validateAndRepair.and.resolveTo({
          isValid: true,
          wasRepaired: true,
          repairedState,
        });

        await service.hydrateFromRemoteSync({ task: {} }, undefined, false);

        expect(mockStore.dispatch).toHaveBeenCalledWith(
          loadAllData({
            appDataComplete: repairedState,
          }),
        );
      });
    });
  });

  describe('_stripLocalOnlySettings (via hydrateFromRemoteSync)', () => {
    beforeEach(setupDefaultMocks);

    it('should handle non-object data gracefully', async () => {
      // Pass null - the merged data should still work
      mockStateSnapshotService.getAllSyncModelDataFromStoreAsync.and.resolveTo(
        null as any,
      );

      // Should not throw when calling hydrateFromRemoteSync with data that gets
      // merged with null from DB
      await service.hydrateFromRemoteSync({ task: {} });

      // If it didn't throw, the stripping handled the edge case
      expect(mockOpLogStore.append).toHaveBeenCalled();
    });

    it('should preserve synced globalConfig properties while overlaying local-only sync settings', async () => {
      const downloadedData = {
        globalConfig: {
          lang: 'de',
          theme: 'dark',
          sync: {
            syncProvider: 'webdav',
            syncInterval: 300,
            isEnabled: true,
          },
        },
      };

      await service.hydrateFromRemoteSync(downloadedData);

      const appendCall = mockOpLogStore.append.calls.mostRecent();
      const payload = appendCall.args[0].payload as Record<string, unknown>;
      const globalConfig = payload['globalConfig'] as Record<string, unknown>;
      expect(globalConfig['lang']).toBe('de');
      expect(globalConfig['theme']).toBe('dark');
      const sync = globalConfig['sync'] as Record<string, unknown>;
      expect(sync['isEnabled']).toBe(defaultLocalSyncConfig.isEnabled);
      expect(sync['syncProvider']).toBe(defaultLocalSyncConfig.syncProvider);
      expect(sync['syncInterval']).toBe(defaultLocalSyncConfig.syncInterval);
      expect(sync['isManualSyncOnly']).toBe(defaultLocalSyncConfig.isManualSyncOnly);
    });
  });

  describe('local-only sync settings preservation', () => {
    beforeEach(setupDefaultMocks);

    /**
     * Integration test: Full reload cycle
     *
     * This test verifies the complete bug fix by simulating:
     * 1. User has sync enabled locally (isEnabled: true)
     * 2. Remote sync downloads data where another client had sync disabled (isEnabled: false)
     * 3. hydrateFromRemoteSync() saves a snapshot
     * 4. User reloads the app
     * 5. Hydrator loads the snapshot and passes it to reducer
     * 6. Reducer should see isEnabled: true (preserved local setting)
     *
     * The bug was: snapshot was saved with remote's isEnabled: false,
     * causing sync to appear disabled after reload.
     */
    it('should preserve isEnabled through full reload cycle (integration)', async () => {
      // Setup: Local client has sync enabled with WebDAV provider
      const localSyncConfig = {
        ...DEFAULT_GLOBAL_CONFIG.sync,
        isEnabled: true,
        syncProvider: SyncProviderId.WebDAV,
        syncInterval: 300000,
        isManualSyncOnly: false,
      };
      mockStore.select.and.returnValue(of(localSyncConfig));

      // Step 1: Remote data has sync DISABLED (simulates another client with sync off)
      const remoteDataWithSyncDisabled = {
        globalConfig: {
          ...DEFAULT_GLOBAL_CONFIG,
          sync: {
            ...DEFAULT_GLOBAL_CONFIG.sync,
            isEnabled: false, // Another client had sync disabled!
            syncProvider: SyncProviderId.Dropbox, // Different provider too
          },
        },
        task: { ids: [], entities: {} },
      };

      // Step 2: hydrateFromRemoteSync() processes the remote data
      await service.hydrateFromRemoteSync(remoteDataWithSyncDisabled);

      // Step 3: Capture the snapshot that was saved (this is what hydrator will load on reload)
      const savedSnapshot = mockOpLogStore.saveStateCache.calls.mostRecent().args[0];
      const snapshotState = savedSnapshot.state as Record<string, unknown>;
      const snapshotGlobalConfig = snapshotState['globalConfig'] as Record<
        string,
        unknown
      >;
      const snapshotSync = snapshotGlobalConfig['sync'] as Record<string, unknown>;

      // Step 4: Verify the snapshot has PRESERVED local settings (not remote's false)
      expect(snapshotSync['isEnabled']).toBe(true); // Local value preserved!
      expect(snapshotSync['syncProvider']).toBe(SyncProviderId.WebDAV); // Local provider preserved!
      expect(snapshotSync['syncInterval']).toBe(300000);
      expect(snapshotSync['isManualSyncOnly']).toBe(false);

      // Step 5: Simulate what happens on reload
      // The hydrator will call store.dispatch(loadAllData({ appDataComplete: snapshotState }))
      // With our fix, the snapshot already has correct local settings, so reducer gets correct data
      const dispatchedAction = mockStore.dispatch.calls.mostRecent()
        .args[0] as unknown as ReturnType<typeof loadAllData>;
      const dispatchedSync = (
        dispatchedAction.appDataComplete.globalConfig as Record<string, unknown>
      )['sync'] as Record<string, unknown>;

      // Final verification: The data dispatched to NgRx has correct local settings
      expect(dispatchedSync['isEnabled']).toBe(true);
      expect(dispatchedSync['syncProvider']).toBe(SyncProviderId.WebDAV);
      expect(dispatchedSync['syncInterval']).toBe(300000);
      expect(dispatchedSync['isManualSyncOnly']).toBe(false);
    });

    it('should preserve local-only sync settings when remote has sync disabled', async () => {
      // Local has sync enabled
      mockStore.select.and.returnValue(
        of({
          ...DEFAULT_GLOBAL_CONFIG.sync,
          isEnabled: true,
          syncProvider: SyncProviderId.WebDAV,
          syncInterval: 300000,
          isManualSyncOnly: true,
        }),
      );

      // Remote data has sync disabled
      const downloadedData = {
        globalConfig: {
          sync: {
            isEnabled: false, // Remote has sync disabled
            syncProvider: 'dropbox',
            syncInterval: 600000,
            isManualSyncOnly: false,
          },
        },
      };

      await service.hydrateFromRemoteSync(downloadedData);

      // Check that saved state cache has local isEnabled (true)
      const saveCacheCall = mockOpLogStore.saveStateCache.calls.mostRecent();
      const savedState = saveCacheCall.args[0].state as Record<string, unknown>;
      const globalConfig = savedState['globalConfig'] as Record<string, unknown>;
      const sync = globalConfig['sync'] as Record<string, unknown>;
      expect(sync['isEnabled']).toBe(true);
      expect(sync['syncProvider']).toBe(SyncProviderId.WebDAV);
      expect(sync['syncInterval']).toBe(300000);
      expect(sync['isManualSyncOnly']).toBe(true);
    });

    it('should keep local sync schedule settings in the local SYNC_IMPORT payload', async () => {
      mockStore.select.and.returnValue(
        of({
          ...DEFAULT_GLOBAL_CONFIG.sync,
          isEnabled: true,
          syncProvider: SyncProviderId.WebDAV,
          syncInterval: 300000,
          isManualSyncOnly: true,
        }),
      );

      const downloadedData = {
        globalConfig: {
          sync: {
            isEnabled: false,
            syncProvider: SyncProviderId.Dropbox,
            syncInterval: 600000,
            isManualSyncOnly: false,
          },
        },
      };

      await service.hydrateFromRemoteSync(downloadedData);

      const appendCall = mockOpLogStore.append.calls.mostRecent();
      const payload = appendCall.args[0].payload as Record<string, unknown>;
      const globalConfig = payload['globalConfig'] as Record<string, unknown>;
      const sync = globalConfig['sync'] as Record<string, unknown>;

      expect(sync['syncProvider']).toBe(SyncProviderId.WebDAV);
      expect(sync['syncInterval']).toBe(300000);
      expect(sync['isManualSyncOnly']).toBe(true);
    });

    it('should preserve local isEnabled when remote has it enabled', async () => {
      // Local has sync disabled
      mockStore.select.and.returnValue(
        of({
          ...DEFAULT_GLOBAL_CONFIG.sync,
          isEnabled: false,
          syncProvider: SyncProviderId.WebDAV,
        }),
      );

      // Remote data has sync enabled
      const downloadedData = {
        globalConfig: {
          sync: {
            isEnabled: true, // Remote has sync enabled
            syncProvider: 'dropbox',
          },
        },
      };

      await service.hydrateFromRemoteSync(downloadedData);

      // Check that saved state cache has local isEnabled (false)
      const saveCacheCall = mockOpLogStore.saveStateCache.calls.mostRecent();
      const savedState = saveCacheCall.args[0].state as Record<string, unknown>;
      const globalConfig = savedState['globalConfig'] as Record<string, unknown>;
      const sync = globalConfig['sync'] as Record<string, unknown>;
      expect(sync['isEnabled']).toBe(false);
    });

    it('should preserve local syncProvider in saved state', async () => {
      // Local has WebDAV
      mockStore.select.and.returnValue(
        of({
          ...DEFAULT_GLOBAL_CONFIG.sync,
          isEnabled: true,
          syncProvider: SyncProviderId.WebDAV,
        }),
      );

      // Remote data has different provider (would be stripped to null anyway)
      const downloadedData = {
        globalConfig: {
          sync: {
            isEnabled: false,
            syncProvider: SyncProviderId.Dropbox,
          },
        },
      };

      await service.hydrateFromRemoteSync(downloadedData);

      // Check that dispatched data has local syncProvider
      const dispatchCall = mockStore.dispatch.calls.mostRecent();
      const dispatchedAction = dispatchCall.args[0] as unknown as ReturnType<
        typeof loadAllData
      >;
      const globalConfig = dispatchedAction.appDataComplete.globalConfig as Record<
        string,
        unknown
      >;
      const sync = globalConfig['sync'] as Record<string, unknown>;
      expect(sync['syncProvider']).toBe(SyncProviderId.WebDAV);
      expect(sync['isEnabled']).toBe(true);
    });

    // Round-trip pin (issue #8233): iterates LOCAL_ONLY_SYNC_KEYS so adding a
    // new local-only key in the util grows coverage here automatically without
    // touching this spec.
    it('preserves every LOCAL_ONLY_SYNC_KEYS value through hydration (round-trip)', async () => {
      const localSync = {
        ...DEFAULT_GLOBAL_CONFIG.sync,
        isEnabled: true,
        isEncryptionEnabled: false,
        syncProvider: SyncProviderId.WebDAV,
        syncInterval: 300000,
        isManualSyncOnly: true,
      };
      const remoteSync = {
        ...DEFAULT_GLOBAL_CONFIG.sync,
        isEnabled: false,
        isEncryptionEnabled: true,
        syncProvider: SyncProviderId.Dropbox,
        syncInterval: 60000,
        isManualSyncOnly: false,
      };
      mockStore.select.and.returnValue(of(localSync));

      await service.hydrateFromRemoteSync({
        task: {},
        globalConfig: { sync: remoteSync },
      });

      const dispatchedAction = mockStore.dispatch.calls.mostRecent()
        .args[0] as unknown as ReturnType<typeof loadAllData>;
      const dispatchedSync = (
        dispatchedAction.appDataComplete.globalConfig as Record<string, unknown>
      )['sync'] as Record<string, unknown>;
      for (const key of LOCAL_ONLY_SYNC_KEYS) {
        expect(dispatchedSync[key])
          .withContext(`dispatched sync.${key} must match local`)
          .toBe(localSync[key]);
      }

      const savedState = mockOpLogStore.saveStateCache.calls.mostRecent().args[0]
        .state as Record<string, unknown>;
      const savedSync = (savedState['globalConfig'] as Record<string, unknown>)[
        'sync'
      ] as Record<string, unknown>;
      for (const key of LOCAL_ONLY_SYNC_KEYS) {
        expect(savedSync[key])
          .withContext(`saved snapshot sync.${key} must match local`)
          .toBe(localSync[key]);
      }
    });

    it('should preserve local settings in both snapshot and dispatch', async () => {
      mockStore.select.and.returnValue(
        of({
          ...DEFAULT_GLOBAL_CONFIG.sync,
          isEnabled: true,
          syncProvider: SyncProviderId.SuperSync,
          syncInterval: 300000,
          isManualSyncOnly: true,
        }),
      );

      const downloadedData = {
        globalConfig: {
          sync: {
            isEnabled: false,
            syncProvider: SyncProviderId.LocalFile,
            syncInterval: 600000,
            isManualSyncOnly: false,
          },
        },
      };

      await service.hydrateFromRemoteSync(downloadedData);

      // Check snapshot
      const saveCacheCall = mockOpLogStore.saveStateCache.calls.mostRecent();
      const savedState = saveCacheCall.args[0].state as Record<string, unknown>;
      const savedGlobalConfig = savedState['globalConfig'] as Record<string, unknown>;
      const savedSync = savedGlobalConfig['sync'] as Record<string, unknown>;
      expect(savedSync['isEnabled']).toBe(true);
      expect(savedSync['syncProvider']).toBe(SyncProviderId.SuperSync);
      expect(savedSync['syncInterval']).toBe(300000);
      expect(savedSync['isManualSyncOnly']).toBe(true);

      // Check dispatch
      const dispatchCall = mockStore.dispatch.calls.mostRecent();
      const dispatchedAction = dispatchCall.args[0] as unknown as ReturnType<
        typeof loadAllData
      >;
      const dispatchedGlobalConfig = dispatchedAction.appDataComplete
        .globalConfig as Record<string, unknown>;
      const dispatchedSync = dispatchedGlobalConfig['sync'] as Record<string, unknown>;
      expect(dispatchedSync['isEnabled']).toBe(true);
      expect(dispatchedSync['syncProvider']).toBe(SyncProviderId.SuperSync);
      expect(dispatchedSync['syncInterval']).toBe(300000);
      expect(dispatchedSync['isManualSyncOnly']).toBe(true);
    });
  });
});
