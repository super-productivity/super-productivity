import { EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { provideMockStore } from '@ngrx/store/testing';
import { CURRENT_SCHEMA_VERSION } from '@sp/shared-schema';
import { OperationLogSyncService } from '../../sync/operation-log-sync.service';
import { OperationLogUploadService } from '../../sync/operation-log-upload.service';
import { OperationLogDownloadService } from '../../sync/operation-log-download.service';
import { OperationEncryptionService } from '../../sync/operation-encryption.service';
import { OperationLogStoreService } from '../../persistence/operation-log-store.service';
import { OperationLogCompactionService } from '../../persistence/operation-log-compaction.service';
import { VectorClockService } from '../../sync/vector-clock.service';
import { OperationApplierService } from '../../apply/operation-applier.service';
import { ConflictResolutionService } from '../../sync/conflict-resolution.service';
import { ValidateStateService } from '../../validation/validate-state.service';
import { RepairOperationService } from '../../validation/repair-operation.service';
import { StateSnapshotService } from '../../backup/state-snapshot.service';
import {
  OperationSyncCapable,
  SyncOperation,
} from '../../sync-providers/provider.interface';
import { SyncProviderId } from '../../sync-providers/provider.const';
import { EncryptAndCompressCfg } from '../../core/types/sync.types';
import { FileBasedSyncAdapterService } from '../../sync-providers/file-based/file-based-sync-adapter.service';
import { FILE_BASED_SYNC_CONSTANTS } from '../../sync-providers/file-based/file-based-sync.types';
import { ActionType, Operation, OpType, VectorClock } from '../../core/operation.types';
import { UserInputWaitStateService } from '../../../imex/sync/user-input-wait-state.service';
import { SnackService } from '../../../core/snack/snack.service';
import { ArchiveDbAdapter } from '../../../core/persistence/archive-db-adapter.service';
import { GlobalConfigService } from '../../../features/config/global-config.service';
import { resetTestUuidCounter } from './helpers/test-client.helper';
import { MockFileProvider } from './helpers/mock-file-provider.helper';
import { LockService } from '../../sync/lock.service';
import { SchemaMigrationService } from '../../persistence/schema-migration.service';
import { SuperSyncStatusService } from '../../sync/super-sync-status.service';
import { ServerMigrationService } from '../../sync/server-migration.service';
import { OperationWriteFlushService } from '../../sync/operation-write-flush.service';
import { RemoteOpsProcessingService } from '../../sync/remote-ops-processing.service';
import { RejectedOpsHandlerService } from '../../sync/rejected-ops-handler.service';
import { SyncHydrationService } from '../../persistence/sync-hydration.service';
import { SyncImportFilterService } from '../../sync/sync-import-filter.service';
import { OperationLogEffects } from '../../capture/operation-log.effects';
import { clearDeferredActions } from '../../capture/operation-capture.meta-reducer';
import { createValidAppData } from '../../validation/state-validity-test-utils';
import { DEFAULT_GLOBAL_CONFIG } from '../../../features/config/default-global-config.const';
import { selectSyncConfig } from '../../../features/config/store/global-config.reducer';
import { CLIENT_ID_PROVIDER } from '../../util/client-id.provider';

/**
 * #10972: a file-based client (Dropbox / WebDAV / local file) that returns
 * with ONE pending local edit after the remote `recentOps` buffer trimmed past
 * its cursor used to get the whole-dataset "Keep local / Keep remote" dialog
 * (LocalDataConflictError), even though the edit touches an entity nobody
 * else changed.
 *
 * Path: FileBasedSyncAdapter.downloadOps → detectDownloadGap (partialTrimGap)
 * → seq-0 re-download with snapshotState → OperationLogSyncService
 * snapshot branch → _classifySnapshotConflict(local, snapshot) = CONCURRENT.
 * The file only grew since the phone's last sync (snapshotExtendsLastSeen),
 * so the snapshot is hydrated and the pending op kept on top of it.
 *
 * Real FileBasedSyncAdapterService instances share one in-memory file; this
 * device ("phone") runs the real download / op-store (IndexedDB) path.
 */

const DESKTOP = 'desktop-client';
const FILE_CFG: EncryptAndCompressCfg = { isEncrypt: false, isCompress: false };
// ~2000 real ops through the real adapter + IndexedDB exceed jasmine's 2s default.
const TEST_TIMEOUT_MS = 30000;

const clearAdapterLocalStorage = (): void => {
  Object.keys(localStorage)
    .filter((key) => key.startsWith('FILE_SYNC_VERSION_'))
    .forEach((key) => localStorage.removeItem(key));
};

for (const isUseSplitSyncFiles of [false, true]) {
  describe(`file snapshot CONCURRENT after a trim gap (integration, split=${isUseSplitSyncFiles})`, () => {
    let syncService: OperationLogSyncService;
    let opLogStore: OperationLogStoreService;
    let remote: MockFileProvider;
    let phone: OperationSyncCapable;
    let desktop: OperationSyncCapable;
    let applierSpy: jasmine.SpyObj<OperationApplierService>;
    let syncHydrationSpy: jasmine.SpyObj<SyncHydrationService>;
    let ownClientId: string;

    const taskOp = (
      id: string,
      clientId: string,
      actionType: ActionType,
      opType: OpType,
      entityId: string,
      vectorClock: VectorClock,
    ): Operation => ({
      id,
      clientId,
      actionType,
      opType,
      entityType: 'TASK',
      entityId,
      payload: {
        actionPayload: { task: { id: entityId, changes: { title: 't' } } },
        entityChanges: [],
      },
      vectorClock,
      timestamp: Date.now(),
      schemaVersion: CURRENT_SCHEMA_VERSION,
    });

    let desktopCounter = 0;
    /**
     * Desktop performs one sync cycle uploading `count` ops in ONE batch
     * (one syncVersion). Its ops only touch desktop-owned tasks.
     */
    const desktopUploadsBatch = async (count: number): Promise<void> => {
      const downloaded = await desktop.downloadOps(0, DESKTOP);
      await desktop.setLastServerSeq(downloaded.latestSeq);
      const ops: Operation[] = [];
      for (let i = 0; i < count; i++) {
        desktopCounter++;
        ops.push(
          taskOp(
            `desktop-op-${desktopCounter}`,
            DESKTOP,
            ActionType.TASK_SHARED_UPDATE,
            OpType.Update,
            `desktop-task-${desktopCounter % 50}`,
            { [DESKTOP]: desktopCounter, [ownClientId]: 1 },
          ),
        );
      }
      const uploaded = await desktop.uploadOps(ops as SyncOperation[], DESKTOP);
      await desktop.setLastServerSeq(uploaded.latestSeq);
    };

    beforeEach(async () => {
      clearAdapterLocalStorage();
      desktopCounter = 0;
      if (!(window.confirm as jasmine.Spy).and) {
        spyOn(window, 'confirm').and.returnValue(true);
      } else {
        (window.confirm as jasmine.Spy).and.returnValue(true);
      }

      applierSpy = jasmine.createSpyObj('OperationApplierService', ['applyOperations']);
      applierSpy.applyOperations.and.callFake(async (ops, options) => {
        await options?.onReducersCommitted?.(ops);
        return { appliedOps: ops };
      });

      const waitServiceSpy = jasmine.createSpyObj('UserInputWaitStateService', [
        'startWaiting',
      ]);
      waitServiceSpy.startWaiting.and.returnValue(() => {});
      const dialogSpy = jasmine.createSpyObj('MatDialog', ['open']);
      dialogSpy.open.and.returnValue({ afterClosed: () => of(true) });
      const superSyncStatusSpy = jasmine.createSpyObj('SuperSyncStatusService', [
        'markRemoteChecked',
        'updatePendingOpsStatus',
        'clearScope',
      ]);
      const serverMigrationSpy = jasmine.createSpyObj('ServerMigrationService', [
        'checkAndHandleMigration',
        'handleServerMigration',
      ]);
      serverMigrationSpy.checkAndHandleMigration.and.resolveTo();
      serverMigrationSpy.handleServerMigration.and.resolveTo();
      const writeFlushSpy = jasmine.createSpyObj('OperationWriteFlushService', [
        'flushPendingWrites',
        'flushThenRunExclusive',
      ]);
      writeFlushSpy.flushPendingWrites.and.resolveTo();
      writeFlushSpy.flushThenRunExclusive.and.callFake(
        async <T>(fn: () => Promise<T>): Promise<T> => fn(),
      );
      const rejectedOpsHandlerSpy = jasmine.createSpyObj('RejectedOpsHandlerService', [
        'handleRejectedOps',
      ]);
      rejectedOpsHandlerSpy.handleRejectedOps.and.resolveTo(0);
      syncHydrationSpy = jasmine.createSpyObj('SyncHydrationService', [
        'hydrateFromRemoteSync',
      ]);
      syncHydrationSpy.hydrateFromRemoteSync.and.callFake(async (_s, _c, hooks) => {
        hooks?.afterStateLoad?.();
      });
      const stateSnapshotSpy = jasmine.createSpyObj('StateSnapshotService', [
        'getStateSnapshot',
        'getStateSnapshotAsync',
        'getStateSnapshotForOperationLog',
      ]);
      stateSnapshotSpy.getStateSnapshotAsync.and.callFake(async () =>
        createValidAppData(),
      );
      stateSnapshotSpy.getStateSnapshot.and.returnValue(
        undefined as unknown as ReturnType<StateSnapshotService['getStateSnapshot']>,
      );
      stateSnapshotSpy.getStateSnapshotForOperationLog.and.callFake(() =>
        createValidAppData(),
      );
      const validateSpy = jasmine.createSpyObj('ValidateStateService', [
        'validateAndRepairCurrentState',
      ]);
      validateSpy.validateAndRepairCurrentState.and.resolveTo(true);
      const archiveDbSpy = jasmine.createSpyObj('ArchiveDbAdapter', [
        'loadArchiveYoung',
        'loadArchiveOld',
      ]);
      archiveDbSpy.loadArchiveYoung.and.resolveTo(null);
      archiveDbSpy.loadArchiveOld.and.resolveTo(null);

      TestBed.configureTestingModule({
        providers: [
          OperationLogSyncService,
          OperationLogUploadService,
          OperationLogDownloadService,
          OperationLogCompactionService,
          OperationEncryptionService,
          OperationLogStoreService,
          LockService,
          VectorClockService,
          SchemaMigrationService,
          RemoteOpsProcessingService,
          SyncImportFilterService,
          ConflictResolutionService,
          provideMockStore({
            selectors: [
              { selector: selectSyncConfig, value: DEFAULT_GLOBAL_CONFIG.sync },
            ],
          }),
          { provide: OperationApplierService, useValue: applierSpy },
          { provide: SuperSyncStatusService, useValue: superSyncStatusSpy },
          { provide: ServerMigrationService, useValue: serverMigrationSpy },
          { provide: OperationWriteFlushService, useValue: writeFlushSpy },
          { provide: RejectedOpsHandlerService, useValue: rejectedOpsHandlerSpy },
          { provide: SyncHydrationService, useValue: syncHydrationSpy },
          { provide: StateSnapshotService, useValue: stateSnapshotSpy },
          { provide: ValidateStateService, useValue: validateSpy },
          { provide: ArchiveDbAdapter, useValue: archiveDbSpy },
          {
            provide: GlobalConfigService,
            useValue: { sync: () => ({ isUseSplitSyncFiles }) },
          },
          {
            provide: RepairOperationService,
            useValue: jasmine.createSpyObj('RepairOperationService', [
              'createRepairOperation',
            ]),
          },
          {
            provide: SnackService,
            useValue: jasmine.createSpyObj('SnackService', [
              'open',
              'hasPendingPersistentAction',
            ]),
          },
          { provide: MatDialog, useValue: dialogSpy },
          { provide: UserInputWaitStateService, useValue: waitServiceSpy },
          {
            provide: TranslateService,
            useValue: jasmine.createSpyObj('TranslateService', ['instant']),
          },
          {
            provide: OperationLogEffects,
            useValue: { processDeferredActions: () => Promise.resolve() },
          },
        ],
      });

      syncService = TestBed.inject(OperationLogSyncService);
      opLogStore = TestBed.inject(OperationLogStoreService);

      remote = new MockFileProvider(SyncProviderId.WebDAV);
      const injector = TestBed.inject(EnvironmentInjector);
      const newAdapter = (): OperationSyncCapable =>
        runInInjectionContext(
          injector,
          () => new FileBasedSyncAdapterService(),
        ).createAdapter(remote, FILE_CFG, undefined);
      phone = newAdapter();
      desktop = newAdapter();

      await opLogStore.init();
      await opLogStore._clearAllDataForTesting();
      resetTestUuidCounter();
      clearDeferredActions();
      ownClientId = await TestBed.inject(CLIENT_ID_PROVIDER).getOrGenerateClientId();
    });

    afterEach(() => {
      clearAdapterLocalStorage();
    });

    /**
     * Phone synced once (created the file, cursor=1), then went offline and
     * made ONE edit to its own task. That edit is pending (unsynced).
     */
    const phoneSyncsOnceThenEditsOffline = async (): Promise<string> => {
      const seed = taskOp(
        'phone-seed',
        ownClientId,
        ActionType.TASK_SHARED_ADD,
        OpType.Create,
        'phone-task',
        { [ownClientId]: 1 },
      );
      const seedSeq = await opLogStore.appendWithVectorClockOverwrite(seed, 'local');
      const response = await phone.uploadOps([seed] as SyncOperation[], ownClientId);
      await phone.setLastServerSeq(response.latestSeq);
      await opLogStore.markSynced([seedSeq]);
      expect(await phone.getLastServerSeq()).toBe(1);

      const pendingEdit = taskOp(
        'phone-pending-edit',
        ownClientId,
        ActionType.TASK_SHARED_UPDATE,
        OpType.Update,
        'phone-task',
        { [ownClientId]: 2 },
      );
      await opLogStore.appendWithVectorClockOverwrite(pendingEdit, 'local');
      expect((await opLogStore.getUnsynced()).length).toBe(1);
      return pendingEdit.id;
    };

    it(
      'keeps the pending edit on top of the snapshot once the desktop pushed enough ' +
        "ops to trim the phone's cursor batch out of recentOps (#10972)",
      async () => {
        const pendingId = await phoneSyncsOnceThenEditsOffline();

        // Desktop syncs normally while the phone is offline. Total > MAX_RECENT_OPS
        // and the first batch after the phone's cursor (sv=2) is fully trimmed.
        await desktopUploadsBatch(10); // sv=2
        await desktopUploadsBatch(1000); // sv=3
        await desktopUploadsBatch(1000); // sv=4
        await desktopUploadsBatch(100); // sv=5 → 2111 ops ever written
        expect(desktopCounter).toBeGreaterThan(FILE_BASED_SYNC_CONSTANTS.MAX_RECENT_OPS);

        // Before #10972 this threw LocalDataConflictError (whole-dataset dialog).
        await expectAsync(syncService.downloadRemoteOps(phone)).not.toBeRejected();

        expect(syncHydrationSpy.hydrateFromRemoteSync).toHaveBeenCalledTimes(1);
        const hooks = syncHydrationSpy.hydrateFromRemoteSync.calls.mostRecent().args[2];
        expect(hooks?.keepPendingOps).toEqual({ discardOpIds: [] });
        // The edit is replayed on top of the snapshot and stays pending for upload.
        const reapplied = applierSpy.applyOperations.calls
          .all()
          .find((call) => call.args[1]?.isLocalHydration);
        expect(reapplied?.args[0].map((op) => op.id)).toEqual([pendingId]);
        const unsynced = await opLogStore.getUnsynced();
        expect(unsynced.map((e) => e.op.id)).toEqual([pendingId]);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      'control: same pending edit, desktop stays within MAX_RECENT_OPS → ops merge, no dialog',
      async () => {
        const pendingId = await phoneSyncsOnceThenEditsOffline();

        await desktopUploadsBatch(10); // sv=2
        await desktopUploadsBatch(1000); // sv=3
        await desktopUploadsBatch(900); // sv=4 → 1911 + seed ≤ 2000
        expect(desktopCounter + 1).toBeLessThanOrEqual(
          FILE_BASED_SYNC_CONSTANTS.MAX_RECENT_OPS,
        );

        const result = await syncService.downloadRemoteOps(phone);
        expect(result.kind).toBe('ops_processed');
        expect(applierSpy.applyOperations).toHaveBeenCalled();
        const unsynced = await opLogStore.getUnsynced();
        expect(unsynced.map((e) => e.op.id)).toEqual([pendingId]);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      'control: same trim, but no pending edit → snapshot adopted silently',
      async () => {
        await phoneSyncsOnceThenEditsOffline();
        // The edit reached the file before the phone went offline.
        const unsynced = await opLogStore.getUnsynced();
        const response = await phone.uploadOps(
          unsynced.map((e) => e.op) as SyncOperation[],
          ownClientId,
        );
        await phone.setLastServerSeq(response.latestSeq);
        await opLogStore.markSynced(unsynced.map((e) => e.seq));
        expect(await phone.getLastServerSeq()).toBe(2);

        await desktopUploadsBatch(10);
        await desktopUploadsBatch(1000);
        await desktopUploadsBatch(1000);
        await desktopUploadsBatch(100);

        await expectAsync(syncService.downloadRemoteOps(phone)).not.toBeRejected();
      },
      TEST_TIMEOUT_MS,
    );
  });
}
