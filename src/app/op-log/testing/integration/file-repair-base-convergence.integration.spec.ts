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
  SnapshotUploadResponse,
  SyncOperation,
} from '../../sync-providers/provider.interface';
import { SyncProviderId } from '../../sync-providers/provider.const';
import { EncryptAndCompressCfg } from '../../core/types/sync.types';
import { FileBasedSyncAdapterService } from '../../sync-providers/file-based/file-based-sync-adapter.service';
import { FILE_BASED_SYNC_CONSTANTS } from '../../sync-providers/file-based/file-based-sync.types';
import {
  ActionType,
  Operation,
  OpType,
  RepairPayload,
  VectorClock,
} from '../../core/operation.types';
import {
  MAX_LWW_REUPLOAD_RETRIES,
  REPAIR_STALE_ERROR_CODE,
} from '../../core/operation-log.const';
import { UploadOutcome } from '../../core/types/sync-results.types';
import { countTransientRejections } from '../../sync/upload-outcome.util';
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
import {
  addTaskToAppData,
  createValidAppData,
  createValidTask,
} from '../../validation/state-validity-test-utils';
import { DEFAULT_GLOBAL_CONFIG } from '../../../features/config/default-global-config.const';
import { selectSyncConfig } from '../../../features/config/store/global-config.reducer';
import { CLIENT_ID_PROVIDER } from '../../util/client-id.provider';
import { AppDataComplete } from '../../model/model-config';
import { incrementVectorClock } from '../../../core/util/vector-clock';
import { uuidv7 } from '../../../util/uuid-v7';

/**
 * #11483: a file-based (Dropbox / WebDAV / local file) REPAIR is only written
 * when its `repairBaseServerSeq` equals the committed cursor; otherwise the
 * adapter answers REPAIR_STALE and RejectedOpsHandlerService rebases it at the
 * cursor of the download it runs. These tests prove that answer converges
 * inside ONE sync cycle (no REPAIR_STALE loop, nothing left pending) and that
 * the remote ends with the client's state, peer data included.
 *
 * Real OperationLogSyncService, upload/download services, RejectedOpsHandler,
 * RepairOperationService and FileBasedSyncAdapterService on a shared in-memory
 * file; the op store runs on IndexedDB. NgRx is replaced by `liveState`: the
 * applier spy upserts task entities into it, hydration replaces it with the
 * downloaded snapshot, and every state snapshot read returns it.
 */

const DESKTOP = 'desktop-client';
const FRESH_READER = 'fresh-reader-client';
const FILE_CFG: EncryptAndCompressCfg = { isEncrypt: false, isCompress: false };
// ~2000 real ops through the real adapter + IndexedDB exceed jasmine's 2s default.
const TEST_TIMEOUT_MS = 60000;

const clearAdapterLocalStorage = (): void => {
  Object.keys(localStorage)
    .filter((key) => key.startsWith('FILE_SYNC_VERSION_'))
    .forEach((key) => localStorage.removeItem(key));
};

const upsertTask = (state: AppDataComplete, id: string): AppDataComplete =>
  (state.task.ids as string[]).includes(id)
    ? state
    : addTaskToAppData(state, createValidTask(id));

const taskIdsOf = (state: unknown): string[] =>
  [...((state as AppDataComplete).task.ids as string[])].sort();

const repairSummary = (): RepairPayload['repairSummary'] => ({
  ...RepairOperationService.createEmptyRepairSummary(),
  entityStateFixed: 1,
});

for (const isUseSplitSyncFiles of [false, true]) {
  describe(`file REPAIR base convergence in one sync cycle (integration, split=${isUseSplitSyncFiles})`, () => {
    let syncService: OperationLogSyncService;
    let opLogStore: OperationLogStoreService;
    let repairService: RepairOperationService;
    let remote: MockFileProvider;
    let phone: OperationSyncCapable;
    let desktop: OperationSyncCapable;
    let newAdapter: () => OperationSyncCapable;
    let validateSpy: jasmine.SpyObj<ValidateStateService>;
    let ownClientId: string;
    /** The phone's app state (stands in for NgRx). */
    let liveState: AppDataComplete;
    /** The desktop's app state; written into the file with its uploads. */
    let desktopState: AppDataComplete;
    /** Every snapshot answer the phone's adapter gave, in order. */
    let phoneSnapshotResponses: SnapshotUploadResponse[];

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
    /** Desktop uploads `count` ops on desktop-owned tasks in ONE batch. */
    const desktopUploadsBatch = async (count: number): Promise<void> => {
      const downloaded = await desktop.downloadOps(0, DESKTOP);
      await desktop.setLastServerSeq(downloaded.latestSeq);
      const ops: Operation[] = [];
      for (let i = 0; i < count; i++) {
        desktopCounter++;
        const entityId = `desktop-task-${desktopCounter % 50}`;
        desktopState = upsertTask(desktopState, entityId);
        ops.push(
          taskOp(
            `desktop-op-${desktopCounter}`,
            DESKTOP,
            ActionType.TASK_SHARED_UPDATE,
            OpType.Update,
            entityId,
            { [DESKTOP]: desktopCounter, [ownClientId]: 1 },
          ),
        );
      }
      const uploaded = await desktop.uploadOps(
        ops as SyncOperation[],
        DESKTOP,
        undefined,
        desktopState,
      );
      await desktop.setLastServerSeq(uploaded.latestSeq);
    };

    /**
     * One sync cycle exactly as SyncWrapperService runs it (sync-wrapper.service.ts,
     * "3. If LWW created local-win ops"): downloadRemoteOps, uploadPendingOps,
     * then re-upload while the previous result reports local-win ops (incl. a
     * rebased REPAIR, counted as mergedOpsCreated → localWinOpsCreated) or
     * transient rejections, at most MAX_LWW_REUPLOAD_RETRIES times.
     */
    const runOneSyncCycle = async (): Promise<{
      uploads: UploadOutcome[];
      pendingAfterLoop: number;
    }> => {
      const isNeverSynced = !(await syncService.hasSyncedOps());
      const down = await syncService.downloadRemoteOps(phone, { isNeverSynced });
      expect(down.kind).not.toBe('cancelled');
      const uploads: UploadOutcome[] = [];
      let up = await syncService.uploadPendingOps(phone, { isNeverSynced });
      uploads.push(up);
      let pending =
        (down.kind === 'ops_processed' ? down.localWinOpsCreated : 0) +
        (up.kind === 'completed'
          ? up.localWinOpsCreated + countTransientRejections(up)
          : 0);
      let retries = 0;
      while (pending > 0 && retries < MAX_LWW_REUPLOAD_RETRIES) {
        retries++;
        up = await syncService.uploadPendingOps(phone, { isNeverSynced });
        uploads.push(up);
        pending =
          up.kind === 'completed'
            ? up.localWinOpsCreated + countTransientRejections(up)
            : 0;
      }
      return { uploads, pendingAfterLoop: pending };
    };

    /** What a client with no local history reads from the remote. */
    const freshReaderSnapshotState = async (): Promise<AppDataComplete> => {
      clearAdapterLocalStorage();
      const reader = newAdapter();
      const downloaded = await reader.downloadOps(0, FRESH_READER);
      expect(downloaded.snapshotState).toBeDefined();
      // A REPAIR snapshot starts a fresh file: nothing may sit on top of it.
      expect(downloaded.ops.length).toBe(0);
      return downloaded.snapshotState as AppDataComplete;
    };

    const pendingFullStateOps = async (): Promise<Operation[]> =>
      (await opLogStore.getUnsynced())
        .map((entry) => entry.op)
        .filter(
          (op) =>
            op.opType === OpType.Repair ||
            op.opType === OpType.SyncImport ||
            op.opType === OpType.BackupImport,
        );

    const staleAnswers = (): number =>
      phoneSnapshotResponses.filter((r) => r.errorCode === REPAIR_STALE_ERROR_CODE)
        .length;

    beforeEach(async () => {
      clearAdapterLocalStorage();
      desktopCounter = 0;
      phoneSnapshotResponses = [];
      liveState = createValidAppData();
      desktopState = createValidAppData();
      if (!(window.confirm as jasmine.Spy).and) {
        spyOn(window, 'confirm').and.returnValue(true);
      } else {
        (window.confirm as jasmine.Spy).and.returnValue(true);
      }

      const applierSpy = jasmine.createSpyObj('OperationApplierService', [
        'applyOperations',
      ]);
      applierSpy.applyOperations.and.callFake(
        async (
          ops: Operation[],
          options?: { onReducersCommitted?: (o: Operation[]) => Promise<void> },
        ) => {
          for (const op of ops) {
            if (op.entityType === 'TASK' && op.entityId) {
              liveState = upsertTask(liveState, op.entityId);
            }
          }
          await options?.onReducersCommitted?.(ops);
          return { appliedOps: ops };
        },
      );

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
      const syncHydrationSpy = jasmine.createSpyObj('SyncHydrationService', [
        'hydrateFromRemoteSync',
      ]);
      syncHydrationSpy.hydrateFromRemoteSync.and.callFake(
        async (
          state: Record<string, unknown> | undefined,
          _clock: unknown,
          hooks?: { afterStateLoad?: () => void },
        ) => {
          if (state) {
            liveState = state as unknown as AppDataComplete;
          }
          hooks?.afterStateLoad?.();
        },
      );
      const stateSnapshotSpy = jasmine.createSpyObj('StateSnapshotService', [
        'getStateSnapshot',
        'getStateSnapshotAsync',
        'getStateSnapshotForOperationLog',
        'getStateSnapshotForOperationLogAsync',
      ]);
      stateSnapshotSpy.getStateSnapshotAsync.and.callFake(async () => liveState);
      stateSnapshotSpy.getStateSnapshotForOperationLogAsync.and.callFake(
        async () => liveState,
      );
      stateSnapshotSpy.getStateSnapshot.and.callFake(() => liveState);
      stateSnapshotSpy.getStateSnapshotForOperationLog.and.callFake(() => liveState);
      validateSpy = jasmine.createSpyObj('ValidateStateService', [
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
          RejectedOpsHandlerService,
          RepairOperationService,
          provideMockStore({
            selectors: [
              { selector: selectSyncConfig, value: DEFAULT_GLOBAL_CONFIG.sync },
            ],
          }),
          { provide: OperationApplierService, useValue: applierSpy },
          { provide: SuperSyncStatusService, useValue: superSyncStatusSpy },
          { provide: ServerMigrationService, useValue: serverMigrationSpy },
          { provide: OperationWriteFlushService, useValue: writeFlushSpy },
          { provide: SyncHydrationService, useValue: syncHydrationSpy },
          { provide: StateSnapshotService, useValue: stateSnapshotSpy },
          { provide: ValidateStateService, useValue: validateSpy },
          { provide: ArchiveDbAdapter, useValue: archiveDbSpy },
          {
            provide: GlobalConfigService,
            useValue: { sync: () => ({ isUseSplitSyncFiles }) },
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
      repairService = TestBed.inject(RepairOperationService);

      remote = new MockFileProvider(SyncProviderId.WebDAV);
      const injector = TestBed.inject(EnvironmentInjector);
      newAdapter = (): OperationSyncCapable =>
        runInInjectionContext(
          injector,
          () => new FileBasedSyncAdapterService(),
        ).createAdapter(remote, FILE_CFG, undefined);
      phone = newAdapter();
      desktop = newAdapter();

      const originalUploadSnapshot = phone.uploadSnapshot.bind(phone);
      phone.uploadSnapshot = async (
        ...args: Parameters<OperationSyncCapable['uploadSnapshot']>
      ): Promise<SnapshotUploadResponse> => {
        const response = await originalUploadSnapshot(...args);
        phoneSnapshotResponses.push(response);
        return response;
      };

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
     * Phone synced once (created the file with its own task, cursor=1). The
     * desktop downloaded that task.
     */
    const phoneSyncsSeed = async (): Promise<void> => {
      const seed = taskOp(
        'phone-seed',
        ownClientId,
        ActionType.TASK_SHARED_ADD,
        OpType.Create,
        'phone-task',
        { [ownClientId]: 1 },
      );
      const seedSeq = await opLogStore.appendWithVectorClockOverwrite(seed, 'local');
      liveState = upsertTask(liveState, 'phone-task');
      desktopState = upsertTask(desktopState, 'phone-task');
      const response = await phone.uploadOps(
        [seed] as SyncOperation[],
        ownClientId,
        undefined,
        liveState,
      );
      await phone.setLastServerSeq(response.latestSeq);
      await opLogStore.markSynced([seedSeq]);
      expect(await phone.getLastServerSeq()).toBe(1);
    };

    it(
      'a base-less REPAIR from the keep-pending snapshot path is rebased once and ' +
        'lands in the same cycle, keeping the peer data',
      async () => {
        await phoneSyncsSeed();
        // Offline edit → the later snapshot download keeps it pending (#10972).
        await opLogStore.appendWithVectorClockOverwrite(
          taskOp(
            'phone-pending-edit',
            ownClientId,
            ActionType.TASK_SHARED_UPDATE,
            OpType.Update,
            'phone-task',
            { [ownClientId]: 2 },
          ),
          'local',
        );

        // Desktop trims the phone's cursor batch out of recentOps, forcing the
        // seq-0 snapshot download that keeps the pending edit on top.
        await desktopUploadsBatch(10);
        await desktopUploadsBatch(1000);
        await desktopUploadsBatch(1000);
        await desktopUploadsBatch(100);
        expect(desktopCounter).toBeGreaterThan(FILE_BASED_SYNC_CONSTANTS.MAX_RECENT_OPS);
        const lastPeerTaskId = `desktop-task-${desktopCounter % 50}`;

        // The keep-pending branch (operation-log-sync.service.ts, after
        // hydration: `if (keepPendingOps) await validateAfterSync()`) is the
        // only validation here that runs without the op-log lock, and it runs
        // OUTSIDE RepairSyncContext.runWithBaseServerSeq. That validation finds
        // something to repair and, like ValidateStateService, appends a REPAIR
        // through the real RepairOperationService. It carries no
        // repairBaseServerSeq (asserted below). Validations under the lock
        // (the split-file suffix apply) report a valid state.
        let repairsCreated = 0;
        validateSpy.validateAndRepairCurrentState.and.callFake(
          async (_context: string, options?: { callerHoldsLock?: boolean }) => {
            if (!options?.callerHoldsLock && repairsCreated === 0) {
              repairsCreated++;
              await repairService.createRepairOperation(
                liveState as unknown as Record<string, unknown>,
                repairSummary(),
                ownClientId,
              );
            }
            return true;
          },
        );

        const { uploads, pendingAfterLoop } = await runOneSyncCycle();

        expect(repairsCreated).toBe(1);
        const allRepairs = (await opLogStore.getOpsAfterSeq(0)).filter(
          (entry) => entry.op.opType === OpType.Repair,
        );
        // The keep-pending REPAIR was base-less, was answered REPAIR_STALE once,
        // and was replaced by one rebased at the committed cursor.
        expect(allRepairs.length).toBe(2);
        const [staleRepair, rebasedRepair] = allRepairs;
        expect(staleRepair.op.repairBaseServerSeq).toBeUndefined();
        expect(
          (staleRepair.op.payload as RepairPayload).repairBaseServerSeq,
        ).toBeUndefined();
        expect(staleRepair.rejectedAt).toBeDefined();
        expect(staleAnswers()).toBe(1);
        expect(rebasedRepair.syncedAt).toBeDefined();
        expect(phoneSnapshotResponses.at(-1)?.accepted).toBe(true);
        expect(uploads.length).toBe(2);
        expect(pendingAfterLoop).toBe(0);
        const committedSeq = await phone.getLastServerSeq();
        expect(rebasedRepair.op.repairBaseServerSeq).toBeDefined();
        // The REPAIR was written, which reset the file to syncVersion 1; its
        // base was the cursor committed before that write.
        expect(committedSeq).toBe(1);

        expect(await pendingFullStateOps()).toEqual([]);
        expect(await opLogStore.getUnsynced()).toEqual([]);

        const remoteState = await freshReaderSnapshotState();
        expect(taskIdsOf(remoteState)).toContain(lastPeerTaskId);
        expect(taskIdsOf(remoteState)).toContain('phone-task');
        expect(taskIdsOf(remoteState)).toEqual(taskIdsOf(liveState));
      },
      TEST_TIMEOUT_MS,
    );

    /**
     * The phone is fully synced at cursor 2 (it downloaded a peer batch), then
     * appends a local SYNC_IMPORT and a base-less REPAIR while offline.
     *
     * - SYNC_IMPORT first: the import upload resets the file to syncVersion 1
     *   and commits cursor 1; the REPAIR is answered stale once and rebased at 1.
     * - REPAIR first (e.g. left pending by an earlier failed sync): it is
     *   uploaded first, answered stale and rebased AFTER the import at cursor 2;
     *   the import upload then commits cursor 1, so it is answered stale once
     *   more and rebased at 1. Two answers, inside the wrapper's retry budget.
     *
     * No remote op arrives during the cycle: one would be filtered by the local
     * import and open the by-design LOCAL_IMPORT_FILTERS_REMOTE dialog.
     */
    for (const { repairFirst, expectedStale } of [
      { repairFirst: false, expectedStale: 1 },
      { repairFirst: true, expectedStale: 2 },
    ]) {
      it(
        `a pending SYNC_IMPORT and a pending base-less REPAIR (${repairFirst ? 'REPAIR' : 'SYNC_IMPORT'} ` +
          'appended first) converge in one cycle without a REPAIR_STALE loop',
        async () => {
          await phoneSyncsSeed();
          await desktopUploadsBatch(3);
          const catchUp = await runOneSyncCycle();
          expect(catchUp.pendingAfterLoop).toBe(0);
          expect(await phone.getLastServerSeq()).toBe(2);
          expect(taskIdsOf(liveState)).toContain('desktop-task-3');
          expect(await opLogStore.getUnsynced()).toEqual([]);
          phoneSnapshotResponses = [];

          // A local full-state import (as ServerMigrationService appends one)
          // and a REPAIR appended outside any sync (no RepairSyncContext, so no
          // repairBaseServerSeq), both still pending.
          const appendRepair = async (): Promise<void> => {
            await repairService.createRepairOperation(
              liveState as unknown as Record<string, unknown>,
              repairSummary(),
              ownClientId,
            );
          };
          if (repairFirst) {
            await appendRepair();
          }
          let importedState = createValidAppData();
          importedState = upsertTask(importedState, 'imported-task-a');
          importedState = upsertTask(importedState, 'imported-task-b');
          const importId = uuidv7();
          await opLogStore.append(
            {
              id: importId,
              actionType: ActionType.LOAD_ALL_DATA,
              opType: OpType.SyncImport,
              entityType: 'ALL',
              entityId: importId,
              payload: importedState,
              clientId: ownClientId,
              vectorClock: incrementVectorClock(
                await opLogStore.getVectorClock(),
                ownClientId,
              ),
              timestamp: Date.now(),
              schemaVersion: CURRENT_SCHEMA_VERSION,
              syncImportReason: 'SERVER_MIGRATION',
            },
            'local',
          );
          liveState = importedState;
          if (!repairFirst) {
            await appendRepair();
          }
          const pendingBefore = await pendingFullStateOps();
          expect(pendingBefore.map((op) => op.opType)).toEqual(
            repairFirst
              ? [OpType.Repair, OpType.SyncImport]
              : [OpType.SyncImport, OpType.Repair],
          );
          expect(
            pendingBefore.find((op) => op.opType === OpType.Repair)?.repairBaseServerSeq,
          ).toBeUndefined();

          const { uploads, pendingAfterLoop } = await runOneSyncCycle();

          // The SYNC_IMPORT lands (file reset to syncVersion 1, cursor 1); the
          // REPAIR is answered REPAIR_STALE a bounded number of times, rebased
          // at that cursor, and accepted within the same cycle.
          expect(staleAnswers()).toBe(expectedStale);
          expect(phoneSnapshotResponses.filter((r) => r.accepted).length).toBe(2);
          expect(phoneSnapshotResponses.length).toBe(expectedStale + 2);
          expect(uploads.length).toBe(expectedStale + 1);
          expect(pendingAfterLoop).toBe(0);
          expect(await pendingFullStateOps()).toEqual([]);
          expect(await opLogStore.getUnsynced()).toEqual([]);

          const repairs = (await opLogStore.getOpsAfterSeq(0)).filter(
            (entry) => entry.op.opType === OpType.Repair,
          );
          expect(repairs.length).toBe(expectedStale + 1);
          const landedRepair = repairs[repairs.length - 1];
          expect(landedRepair.op.repairBaseServerSeq).toBe(1);
          expect(landedRepair.syncedAt).toBeDefined();
          expect(repairs.slice(0, -1).every((entry) => !!entry.rejectedAt)).toBeTrue();
          expect(await phone.getLastServerSeq()).toBe(1);

          const remoteState = await freshReaderSnapshotState();
          // The remote holds exactly the client's (imported) state.
          expect(taskIdsOf(remoteState)).toEqual(taskIdsOf(liveState));
          expect(taskIdsOf(remoteState)).toEqual(['imported-task-a', 'imported-task-b']);

          // A second cycle has nothing to do: no snapshot write, no stale answer.
          const answersBefore = phoneSnapshotResponses.length;
          const second = await runOneSyncCycle();
          expect(second.pendingAfterLoop).toBe(0);
          expect(phoneSnapshotResponses.length).toBe(answersBefore);
          expect(await opLogStore.getUnsynced()).toEqual([]);
        },
        TEST_TIMEOUT_MS,
      );
    }
  });
}
