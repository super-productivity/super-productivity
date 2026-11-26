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
 * #10973: one upload is one batch under one syncVersion. Before the fix the
 * `recentOps` trim was per op (`combinedOps.slice(-cap)`), and `partialTrimGap`
 * only fires when `oldestOpSyncVersion > sinceSeq + 1`. A cut INSIDE batch
 * sinceSeq+1 left its tail looking contiguous, so a behind client ("phone")
 * never received the trimmed head of that batch.
 *
 * Fixed writers trim only at batch boundaries (the behind client then sees a
 * proven gap and hydrates the snapshot). Files from released writers can still
 * hold a partial oldest batch; the reader falls back to the snapshot when the
 * file does not certify that batch complete.
 *
 * Real FileBasedSyncAdapterService instances share one in-memory file; the
 * phone runs the real download / conflict-detection / op-store (IndexedDB)
 * path. No pending edits on the phone.
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
  describe(`file partial-trim gap inside batch sinceSeq+1 (integration, split=${isUseSplitSyncFiles})`, () => {
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
    const desktopUploadsBatch = async (
      count: number,
      isHeadBatch = false,
    ): Promise<void> => {
      const downloaded = await desktop.downloadOps(0, DESKTOP);
      await desktop.setLastServerSeq(downloaded.latestSeq);
      const ops: Operation[] = [];
      for (let i = 0; i < count; i++) {
        desktopCounter++;
        ops.push(
          isHeadBatch
            ? // Head batch: each op CREATES a distinct task (bulk add / import).
              taskOp(
                `head-op-${i}`,
                DESKTOP,
                ActionType.TASK_SHARED_ADD,
                OpType.Create,
                `head-task-${i}`,
                { [DESKTOP]: desktopCounter, [ownClientId]: 1 },
              )
            : taskOp(
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
      syncHydrationSpy.hydrateFromRemoteSync.and.resolveTo();
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

    // Sizes per format. Single file: every upload trims to MAX_RECENT_OPS.
    // Split: a recompaction fires above MAX_RECENT_OPS and trims to
    // SPLIT_COMPACTION_THRESHOLD, so the head batch must reach past that.
    const KEEP = isUseSplitSyncFiles
      ? FILE_BASED_SYNC_CONSTANTS.SPLIT_COMPACTION_THRESHOLD
      : FILE_BASED_SYNC_CONSTANTS.MAX_RECENT_OPS;
    const HEAD = isUseSplitSyncFiles ? KEEP + 10 : 10;
    const RETAINED_HEAD = 5;
    // Tail that leaves exactly RETAINED_HEAD head ops (cut INSIDE the head
    // batch): the newest KEEP ops are the tail plus RETAINED_HEAD head ops.
    const TAIL_CUT_INSIDE = KEEP - RETAINED_HEAD;
    // Tail that trims the whole head batch (cut ON the batch boundary).
    const TAIL_CUT_ON_BOUNDARY = KEEP;

    const appliedIds = (): Set<string> =>
      new Set(
        applierSpy.applyOperations.calls
          .allArgs()
          .flatMap(([ops]) => (ops as Operation[]).map((op) => op.id)),
      );

    /** Phone synced once (created the file, cursor=1). Nothing pending. */
    const phoneSyncsOnce = async (): Promise<void> => {
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
      expect((await opLogStore.getUnsynced()).length).toBe(0);
    };

    const remoteFilePath = isUseSplitSyncFiles
      ? FILE_BASED_SYNC_CONSTANTS.OPS_FILE
      : FILE_BASED_SYNC_CONSTANTS.SYNC_FILE;
    type RemoteFile = {
      syncVersion: number;
      recentOps: { sv?: number }[];
      oldestOpSyncVersion?: number;
      oldestBatchComplete?: boolean;
    };
    const readRemote = (): { prefix: string; file: RemoteFile } => {
      const raw = remote.getFileContent(remoteFilePath)!.data;
      const end = raw.indexOf('__') + 2;
      return { prefix: raw.slice(0, end), file: JSON.parse(raw.slice(end)) };
    };

    it(
      'cut INSIDE batch sinceSeq+1: the writer drops the partial batch, so the phone ' +
        'detects the gap and hydrates the snapshot',
      async () => {
        await phoneSyncsOnce();
        await desktopUploadsBatch(HEAD, true); // sv=2 = phone cursor + 1
        await desktopUploadsBatch(TAIL_CUT_INSIDE); // sv=3, a per-op cut lands in sv=2

        const { file } = readRemote();
        expect(file.recentOps.some((op) => op.sv === 2)).toBeFalse();
        expect(file.oldestOpSyncVersion).toBe(3);
        expect(file.oldestBatchComplete).toBeTrue();

        await syncService.downloadRemoteOps(phone);

        // The snapshot carries every head create.
        expect(syncHydrationSpy.hydrateFromRemoteSync).toHaveBeenCalled();
      },
      TEST_TIMEOUT_MS,
    );

    it(
      'released writer left a partial batch sinceSeq+1 (mixed fleet): the phone falls ' +
        'back to the snapshot',
      async () => {
        await phoneSyncsOnce();
        await desktopUploadsBatch(HEAD, true); // sv=2
        await desktopUploadsBatch(TAIL_CUT_INSIDE); // sv=3

        // Rewrite the file as a released (per-op trimming) writer leaves it: the
        // newest KEEP ops include RETAINED_HEAD ops of batch 2, and no marker.
        const { prefix, file } = readRemote();
        const tail = file.recentOps.filter((op) => op.sv === 3);
        const headTemplate = tail[0];
        const partialHead = Array.from({ length: RETAINED_HEAD }, (_, i) => ({
          ...headTemplate,
          id: `released-head-op-${i}`,
          sv: 2,
        }));
        const releasedOps = [...partialHead, ...tail].slice(-KEEP);
        delete file.oldestBatchComplete;
        remote.setFileContent(
          remoteFilePath,
          prefix +
            JSON.stringify({
              ...file,
              recentOps: releasedOps,
              oldestOpSyncVersion: releasedOps[0].sv,
            }),
        );
        expect(releasedOps[0].sv).toBe(2);

        await syncService.downloadRemoteOps(phone);

        expect(syncHydrationSpy.hydrateFromRemoteSync).toHaveBeenCalled();
      },
      TEST_TIMEOUT_MS,
    );

    it(
      'control: an untrimmed buffer stays incremental (no snapshot)',
      async () => {
        await phoneSyncsOnce();
        await desktopUploadsBatch(HEAD, true); // sv=2, buffer not trimmed
        await desktopUploadsBatch(3); // sv=3

        expect(readRemote().file.oldestOpSyncVersion).toBeLessThanOrEqual(2);
        await syncService.downloadRemoteOps(phone);

        expect(syncHydrationSpy.hydrateFromRemoteSync).not.toHaveBeenCalled();
        const applied = appliedIds();
        for (let i = 0; i < HEAD; i++) {
          expect(applied.has(`head-op-${i}`))
            .withContext(`head-op-${i}`)
            .toBeTrue();
        }
      },
      TEST_TIMEOUT_MS,
    );

    it(
      'control: cut ON the batch boundary → partialTrimGap fires and the snapshot is ' +
        'hydrated',
      async () => {
        await phoneSyncsOnce();
        await desktopUploadsBatch(HEAD, true);
        await desktopUploadsBatch(TAIL_CUT_ON_BOUNDARY);

        await syncService.downloadRemoteOps(phone);

        expect(syncHydrationSpy.hydrateFromRemoteSync).toHaveBeenCalled();
      },
      TEST_TIMEOUT_MS,
    );
  });
}
