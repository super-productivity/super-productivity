import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { SyncHydrationService } from './sync-hydration.service';
import { OperationLogStoreService } from './operation-log-store.service';
import { StateSnapshotService } from '../backup/state-snapshot.service';
import { ClientIdService } from '../../core/util/client-id.service';
import { VectorClockService } from '../sync/vector-clock.service';
import { ValidateStateService } from '../validation/validate-state.service';
import { loadAllData } from '../../root-store/meta/load-all-data.action';
import { ActionType, OpType } from '../core/operation.types';
import { LegacySyncProvider } from '../../imex/sync/legacy-sync-provider.model';
import { DEFAULT_GLOBAL_CONFIG } from '../../features/config/default-global-config.const';
import { SnackService } from '../../core/snack/snack.service';

describe('SyncHydrationService', () => {
  let service: SyncHydrationService;
  let mockStore: jasmine.SpyObj<Store>;
  let mockOpLogStore: jasmine.SpyObj<OperationLogStoreService>;
  let mockStateSnapshotService: jasmine.SpyObj<StateSnapshotService>;
  let mockClientIdService: jasmine.SpyObj<ClientIdService>;
  let mockVectorClockService: jasmine.SpyObj<VectorClockService>;
  let mockValidateStateService: jasmine.SpyObj<ValidateStateService>;
  let mockSnackService: jasmine.SpyObj<SnackService>;

  // Default local sync config for tests
  const defaultLocalSyncConfig = {
    ...DEFAULT_GLOBAL_CONFIG.sync,
    isEnabled: true,
    syncProvider: LegacySyncProvider.WebDAV,
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
      'setProtectedClientIds',
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
    mockClientIdService = jasmine.createSpyObj('ClientIdService', ['loadClientId']);
    mockVectorClockService = jasmine.createSpyObj('VectorClockService', [
      'getCurrentVectorClock',
    ]);
    mockValidateStateService = jasmine.createSpyObj('ValidateStateService', [
      'validateAndRepair',
    ]);
    mockSnackService = jasmine.createSpyObj('SnackService', ['open']);

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
      ],
    });
    service = TestBed.inject(SyncHydrationService);
  });

  const setupDefaultMocks = (): void => {
    mockClientIdService.loadClientId.and.resolveTo('localClient');
    mockVectorClockService.getCurrentVectorClock.and.resolveTo({ localClient: 5 });
    mockOpLogStore.append.and.resolveTo(undefined);
    mockOpLogStore.getLastSeq.and.resolveTo(10);
    mockOpLogStore.saveStateCache.and.resolveTo(undefined);
    mockOpLogStore.setVectorClock.and.resolveTo(undefined);
    mockOpLogStore.setProtectedClientIds.and.resolveTo(undefined);
    mockValidateStateService.validateAndRepair.and.returnValue({
      isValid: true,
      wasRepaired: false,
    });
  };

  describe('hydrateFromRemoteSync', () => {
    beforeEach(setupDefaultMocks);

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

    it('should strip syncProvider from globalConfig.sync', async () => {
      const downloadedData = {
        task: {},
        globalConfig: {
          sync: { syncProvider: 'dropbox', someOther: 'setting' },
          otherSetting: 'value',
        },
      };

      await service.hydrateFromRemoteSync(downloadedData);

      const appendCall = mockOpLogStore.append.calls.mostRecent();
      const payload = appendCall.args[0].payload as Record<string, unknown>;
      const globalConfig = payload['globalConfig'] as Record<string, unknown>;
      const sync = globalConfig['sync'] as Record<string, unknown>;
      expect(sync['syncProvider']).toBeNull();
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

    it('should throw when clientId cannot be loaded', async () => {
      mockClientIdService.loadClientId.and.resolveTo(null);

      await expectAsync(service.hydrateFromRemoteSync({})).toBeRejectedWithError(
        /Failed to load clientId/,
      );
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

    it('should update vector clock store after sync', async () => {
      mockVectorClockService.getCurrentVectorClock.and.resolveTo({ localClient: 5 });
      mockOpLogStore.loadStateCache.and.resolveTo({ vectorClock: { remote: 3 } } as any);

      await service.hydrateFromRemoteSync({});

      expect(mockOpLogStore.setVectorClock).toHaveBeenCalledWith(
        jasmine.objectContaining({
          localClient: 6,
          remote: 3,
        }),
      );
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

    it('should use repaired state when validation detects issues', async () => {
      const downloadedData = { task: { ids: ['t1'] } };
      const repairedState = { task: { ids: ['t1'], repaired: true } } as any;
      mockValidateStateService.validateAndRepair.and.returnValue({
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
      mockValidateStateService.validateAndRepair.and.returnValue({
        isValid: true,
        wasRepaired: false,
      });

      await service.hydrateFromRemoteSync(downloadedData);

      // Should dispatch with the original (merged, stripped) data, not null
      expect(mockStore.dispatch).toHaveBeenCalled();
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

    describe('protected client IDs for vector clock pruning', () => {
      // These tests verify that SYNC_IMPORT client IDs are protected during
      // hydrateFromRemoteSync to prevent vector clock pruning from removing them.

      it('should set protected client ID when creating SYNC_IMPORT', async () => {
        await service.hydrateFromRemoteSync({ task: {} });

        expect(mockOpLogStore.setProtectedClientIds).toHaveBeenCalledWith([
          'localClient',
        ]);
      });

      it('should call setProtectedClientIds AFTER setVectorClock', async () => {
        let callSequence = 0;
        let setVectorClockSequence = -1;
        let setProtectedSequence = -1;

        mockOpLogStore.setVectorClock.and.callFake(async () => {
          setVectorClockSequence = callSequence++;
        });
        mockOpLogStore.setProtectedClientIds.and.callFake(async () => {
          setProtectedSequence = callSequence++;
        });

        await service.hydrateFromRemoteSync({ task: {} });

        expect(setVectorClockSequence).toBeGreaterThanOrEqual(
          0,
          'setVectorClock should have been called',
        );
        expect(setProtectedSequence).toBeGreaterThanOrEqual(
          0,
          'setProtectedClientIds should have been called',
        );
        expect(setVectorClockSequence).toBeLessThan(
          setProtectedSequence,
          `setVectorClock (seq ${setVectorClockSequence}) should be called BEFORE ` +
            `setProtectedClientIds (seq ${setProtectedSequence})`,
        );
      });

      it('should NOT call setProtectedClientIds when createSyncImportOp is false', async () => {
        await service.hydrateFromRemoteSync({ task: {} }, undefined, false);

        expect(mockOpLogStore.setProtectedClientIds).not.toHaveBeenCalled();
      });

      it('should call setProtectedClientIds when createSyncImportOp is explicitly true', async () => {
        await service.hydrateFromRemoteSync({ task: {} }, undefined, true);

        expect(mockOpLogStore.setProtectedClientIds).toHaveBeenCalledWith([
          'localClient',
        ]);
      });
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

      it('should still save state cache when createSyncImportOp is false', async () => {
        mockOpLogStore.getLastSeq.and.resolveTo(42);

        await service.hydrateFromRemoteSync({ task: {} }, undefined, false);

        expect(mockOpLogStore.saveStateCache).toHaveBeenCalled();
      });

      it('should still update vector clock when createSyncImportOp is false', async () => {
        mockVectorClockService.getCurrentVectorClock.and.resolveTo({ localClient: 5 });

        await service.hydrateFromRemoteSync({ task: {} }, undefined, false);

        expect(mockOpLogStore.setVectorClock).toHaveBeenCalledWith(
          jasmine.objectContaining({
            localClient: 6, // Should still increment
          }),
        );
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

      it('should still merge remote vector clock when createSyncImportOp is false', async () => {
        const remoteVectorClock = { remoteClient: 100 };
        mockVectorClockService.getCurrentVectorClock.and.resolveTo({ localClient: 5 });

        await service.hydrateFromRemoteSync({ task: {} }, remoteVectorClock, false);

        expect(mockOpLogStore.setVectorClock).toHaveBeenCalledWith(
          jasmine.objectContaining({
            localClient: 6,
            remoteClient: 100,
          }),
        );
      });

      it('should still validate and repair when createSyncImportOp is false', async () => {
        const repairedState = { task: { repaired: true } } as any;
        mockValidateStateService.validateAndRepair.and.returnValue({
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

    it('should preserve all other globalConfig properties', async () => {
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
      expect(sync['syncInterval']).toBe(300);
      expect(sync['isEnabled']).toBe(true);
      expect(sync['syncProvider']).toBeNull();
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
        syncProvider: LegacySyncProvider.WebDAV,
      };
      mockStore.select.and.returnValue(of(localSyncConfig));

      // Step 1: Remote data has sync DISABLED (simulates another client with sync off)
      const remoteDataWithSyncDisabled = {
        globalConfig: {
          ...DEFAULT_GLOBAL_CONFIG,
          sync: {
            ...DEFAULT_GLOBAL_CONFIG.sync,
            isEnabled: false, // Another client had sync disabled!
            syncProvider: LegacySyncProvider.Dropbox, // Different provider too
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
      expect(snapshotSync['syncProvider']).toBe(LegacySyncProvider.WebDAV); // Local provider preserved!

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
      expect(dispatchedSync['syncProvider']).toBe(LegacySyncProvider.WebDAV);
    });

    it('should preserve local isEnabled when remote has it disabled', async () => {
      // Local has sync enabled
      mockStore.select.and.returnValue(
        of({
          ...DEFAULT_GLOBAL_CONFIG.sync,
          isEnabled: true,
          syncProvider: LegacySyncProvider.WebDAV,
        }),
      );

      // Remote data has sync disabled
      const downloadedData = {
        globalConfig: {
          sync: {
            isEnabled: false, // Remote has sync disabled
            syncProvider: 'dropbox',
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
      expect(sync['syncProvider']).toBe(LegacySyncProvider.WebDAV);
    });

    it('should preserve local isEnabled when remote has it enabled', async () => {
      // Local has sync disabled
      mockStore.select.and.returnValue(
        of({
          ...DEFAULT_GLOBAL_CONFIG.sync,
          isEnabled: false,
          syncProvider: LegacySyncProvider.WebDAV,
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
          syncProvider: LegacySyncProvider.WebDAV,
        }),
      );

      // Remote data has different provider (would be stripped to null anyway)
      const downloadedData = {
        globalConfig: {
          sync: {
            isEnabled: false,
            syncProvider: LegacySyncProvider.Dropbox,
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
      expect(sync['syncProvider']).toBe(LegacySyncProvider.WebDAV);
      expect(sync['isEnabled']).toBe(true);
    });

    it('should preserve local settings in both snapshot and dispatch', async () => {
      mockStore.select.and.returnValue(
        of({
          ...DEFAULT_GLOBAL_CONFIG.sync,
          isEnabled: true,
          syncProvider: LegacySyncProvider.SuperSync,
        }),
      );

      const downloadedData = {
        globalConfig: {
          sync: {
            isEnabled: false,
            syncProvider: LegacySyncProvider.LocalFile,
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
      expect(savedSync['syncProvider']).toBe(LegacySyncProvider.SuperSync);

      // Check dispatch
      const dispatchCall = mockStore.dispatch.calls.mostRecent();
      const dispatchedAction = dispatchCall.args[0] as unknown as ReturnType<
        typeof loadAllData
      >;
      const dispatchedGlobalConfig = dispatchedAction.appDataComplete
        .globalConfig as Record<string, unknown>;
      const dispatchedSync = dispatchedGlobalConfig['sync'] as Record<string, unknown>;
      expect(dispatchedSync['isEnabled']).toBe(true);
      expect(dispatchedSync['syncProvider']).toBe(LegacySyncProvider.SuperSync);
    });
  });
});
