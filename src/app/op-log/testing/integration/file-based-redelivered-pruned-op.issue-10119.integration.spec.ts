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
import { COMPACTION_RETENTION_MS } from '../../core/operation-log.const';
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
 * #10119: file-based providers (Dropbox/WebDAV/local file) return the WHOLE
 * `recentOps` buffer (up to MAX_RECENT_OPS) on every download whose file
 * changed, minus this client's own ops. Compaction deletes synced ops older
 * than 7 days locally, so their ids leave the applied-op-id set.
 *
 * Scenario: another device (Android) created a task; this device (Linux)
 * archived it; >7 days later compaction prunes both ops locally, while the
 * remote buffer still holds Android's create op. On the next download the old
 * create op must NOT be treated as new — the archived task is no longer in
 * the snapshot entity keys, so conflict detection's "no local state" fast path
 * would re-create it as an active task.
 *
 * Both devices talk to one shared in-memory file through REAL
 * FileBasedSyncAdapterService instances (real `sync-data.json` / split-file
 * format, real per-op `sv` tagging, real cursor), and Linux runs the REAL
 * download, conflict-detection, op-store (IndexedDB) and compaction path.
 */

const OTHER = 'android-client';
const ARCHIVED_TASK_ID = 'rpt_cfg_2026-08-18';
const FILE_CFG: EncryptAndCompressCfg = { isEncrypt: false, isCompress: false };

const clearAdapterLocalStorage = (): void => {
  Object.keys(localStorage)
    .filter((key) => key.startsWith('FILE_SYNC_VERSION_'))
    .forEach((key) => localStorage.removeItem(key));
};

for (const isUseSplitSyncFiles of [false, true]) {
  describe(`#10119 file-based re-delivery of pruned ops (integration, split=${isUseSplitSyncFiles})`, () => {
    let syncService: OperationLogSyncService;
    let compactionService: OperationLogCompactionService;
    let opLogStore: OperationLogStoreService;
    let remote: MockFileProvider;
    let linux: OperationSyncCapable;
    let android: OperationSyncCapable;
    let applierSpy: jasmine.SpyObj<OperationApplierService>;
    let stateSnapshotSpy: jasmine.SpyObj<StateSnapshotService>;
    let ownClientId: string;

    const taskOp = (
      id: string,
      clientId: string,
      actionType: ActionType,
      opType: OpType,
      entityId: string,
      payload: unknown,
      vectorClock: VectorClock,
    ): Operation => ({
      id,
      clientId,
      actionType,
      opType,
      entityType: 'TASK',
      entityId,
      payload,
      vectorClock,
      timestamp: Date.now(),
      schemaVersion: CURRENT_SCHEMA_VERSION,
    });

    const otherAddTask = (id: string, taskId: string, clock: VectorClock): Operation =>
      taskOp(
        id,
        OTHER,
        ActionType.TASK_SHARED_ADD,
        OpType.Create,
        taskId,
        {
          actionPayload: {
            task: { id: taskId, title: 'méditation', dueDay: '2026-08-18' },
            workContextId: 'INBOX_PROJECT',
            workContextType: 'PROJECT',
            isAddToBacklog: false,
            isAddToBottom: false,
          },
          entityChanges: [],
        },
        clock,
      );

    /** Another device writes ops to the shared file (its own sync cycle). */
    const androidUploads = async (...ops: Operation[]): Promise<void> => {
      await android.uploadOps(ops as SyncOperation[], OTHER);
    };

    /**
     * This device uploads ops the way OperationLogUploadService does for a
     * file-based provider: the adapter merges into the CURRENT remote file and
     * the returned latestSeq becomes the cursor.
     */
    const linuxUploads = async (...ops: Operation[]): Promise<void> => {
      const response = await linux.uploadOps(ops as SyncOperation[], ownClientId);
      await linux.setLastServerSeq(response.latestSeq);
    };

    const appliedOpIdsPassedToApplier = (): string[] =>
      applierSpy.applyOperations.calls
        .allArgs()
        .flatMap(([ops]) => (ops as Operation[]).map((op) => op.id));

    beforeEach(async () => {
      clearAdapterLocalStorage();
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
      const syncHydrationSpy = jasmine.createSpyObj('SyncHydrationService', [
        'hydrateFromRemoteSync',
      ]);
      syncHydrationSpy.hydrateFromRemoteSync.and.resolveTo();
      stateSnapshotSpy = jasmine.createSpyObj('StateSnapshotService', [
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
      // The compaction snapshot does NOT contain the archived task — exactly the
      // live store of a device that archived it.
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
          // REAL conflict detection (the gate the stale op would slip through).
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
      compactionService = TestBed.inject(OperationLogCompactionService);
      opLogStore = TestBed.inject(OperationLogStoreService);

      // One adapter service per device, as in production; one shared remote.
      remote = new MockFileProvider(SyncProviderId.WebDAV);
      const injector = TestBed.inject(EnvironmentInjector);
      const newAdapter = (): OperationSyncCapable =>
        runInInjectionContext(
          injector,
          () => new FileBasedSyncAdapterService(),
        ).createAdapter(remote, FILE_CFG, undefined);
      linux = newAdapter();
      android = newAdapter();

      await opLogStore.init();
      await opLogStore._clearAllDataForTesting();
      resetTestUuidCounter();
      clearDeferredActions();
      ownClientId = await TestBed.inject(CLIENT_ID_PROVIDER).getOrGenerateClientId();
    });

    afterEach(() => {
      clearAdapterLocalStorage();
    });

    /** Linux created the sync file earlier, so it carries a real cursor. */
    const seedRemoteFromLinux = async (): Promise<void> => {
      await linuxUploads(
        taskOp(
          'linux-seed',
          ownClientId,
          ActionType.TASK_SHARED_ADD,
          OpType.Create,
          'linux-seed-task',
          { actionPayload: {}, entityChanges: [] },
          { [ownClientId]: 1 },
        ),
      );
    };

    const runArchivedTaskScenario = async (): Promise<void> => {
      const oneHourMs = 60 * 60 * 1000;
      const nowSpy = spyOn(Date, 'now').and.returnValue(
        new Date().getTime() - COMPACTION_RETENTION_MS - oneHourMs,
      );
      // Installed client: carries a state cache from an earlier compaction.
      expect(await compactionService.compact()).toBeTrue();
      await seedRemoteFromLinux();

      // 1. Android creates the repeat instance; Linux downloads + applies it.
      await androidUploads(
        otherAddTask('android-add-old', ARCHIVED_TASK_ID, { [OTHER]: 1 }),
      );
      expect((await syncService.downloadRemoteOps(linux)).kind).toBe('ops_processed');
      expect(appliedOpIdsPassedToApplier()).toContain('android-add-old');
      expect(await opLogStore.hasOp('android-add-old')).toBeTrue();

      // 2. Linux archives it and uploads the archive op (synced).
      const archiveOp = taskOp(
        'linux-archive',
        ownClientId,
        ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
        OpType.Update,
        ARCHIVED_TASK_ID,
        { actionPayload: { tasks: [{ id: ARCHIVED_TASK_ID }] }, entityChanges: [] },
        { [OTHER]: 1, [ownClientId]: 2 },
      );
      const archiveSeq = await opLogStore.appendWithVectorClockOverwrite(
        archiveOp,
        'local',
      );
      await linuxUploads(archiveOp);
      await opLogStore.markSynced([archiveSeq]);
      nowSpy.and.callThrough();

      // 3. Normal traffic continues; a recent op keeps the client "synced".
      await androidUploads(
        otherAddTask('android-add-recent', 'other-task', {
          [OTHER]: 2,
          [ownClientId]: 2,
        }),
      );
      expect((await syncService.downloadRemoteOps(linux)).kind).toBe('ops_processed');

      // 4. Real compaction with the production 7-day retention.
      expect(await compactionService.compact()).toBeTrue();
      expect(await opLogStore.hasOp('android-add-old')).toBeFalse();
      expect(await opLogStore.hasOp('linux-archive')).toBeFalse();
      // Local clock still covers the pruned create op.
      expect((await opLogStore.getVectorClock())?.[OTHER]).toBe(2);

      // 5. Any later change on Android rewrites the file; the whole buffer
      // (still containing the old create op) is downloaded again.
      await androidUploads(
        otherAddTask('android-add-new', 'new-task', { [OTHER]: 3, [ownClientId]: 2 }),
      );
      applierSpy.applyOperations.calls.reset();
      await syncService.downloadRemoteOps(linux);
    };

    it('does not re-apply another device’s old create op for a task this device archived, after compaction pruned it', async () => {
      await runArchivedTaskScenario();

      // The genuinely new op must apply; the old create for the archived task must not.
      expect(appliedOpIdsPassedToApplier()).toContain('android-add-new');
      expect(appliedOpIdsPassedToApplier()).not.toContain('android-add-old');
      expect(appliedOpIdsPassedToApplier()).not.toContain('android-add-recent');
    });

    it('control: the same re-delivered op is skipped when the task is still active', async () => {
      stateSnapshotSpy.getStateSnapshotForOperationLog.and.callFake(() => {
        const data = createValidAppData();
        return {
          ...data,
          task: {
            ...data.task,
            ids: [ARCHIVED_TASK_ID],
            entities: { [ARCHIVED_TASK_ID]: { id: ARCHIVED_TASK_ID } },
          },
        } as unknown as ReturnType<
          StateSnapshotService['getStateSnapshotForOperationLog']
        >;
      });
      await runArchivedTaskScenario();

      expect(appliedOpIdsPassedToApplier()).toContain('android-add-new');
      expect(appliedOpIdsPassedToApplier()).not.toContain('android-add-old');
    });

    // The dangerous direction: the cursor can run AHEAD of what this device
    // applied, because an upload merges into the freshly read remote file and
    // its new syncVersion becomes the cursor. A remote op merged that way was
    // never applied here and must still be delivered by the next download.
    it('still delivers a remote op that an own upload merged past the cursor before it was downloaded', async () => {
      await seedRemoteFromLinux();
      await androidUploads(otherAddTask('android-unseen', 'unseen-task', { [OTHER]: 1 }));

      // Linux uploads WITHOUT downloading first (e.g. the in-cycle cache
      // expired while a dialog was open): the cursor jumps past android-unseen.
      await linuxUploads(
        taskOp(
          'linux-edit',
          ownClientId,
          ActionType.TASK_SHARED_UPDATE,
          OpType.Update,
          'linux-seed-task',
          { actionPayload: {}, entityChanges: [] },
          { [ownClientId]: 2 },
        ),
      );
      expect(await linux.getLastServerSeq()).toBe(3);

      await androidUploads(
        otherAddTask('android-after', 'after-task', { [OTHER]: 2, [ownClientId]: 2 }),
      );
      await syncService.downloadRemoteOps(linux);

      expect(appliedOpIdsPassedToApplier()).toContain('android-unseen');
      expect(appliedOpIdsPassedToApplier()).toContain('android-after');
    });
  });
}
