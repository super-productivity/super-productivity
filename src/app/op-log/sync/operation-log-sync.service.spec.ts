import { TestBed } from '@angular/core/testing';
import { OperationLogSyncService } from './operation-log-sync.service';
import { FILE_BASED_SYNC_CONSTANTS } from '../sync-providers/file-based/file-based-sync.types';
import { SchemaMigrationService } from '../persistence/schema-migration.service';
import { OperationLogHydratorService } from '../persistence/operation-log-hydrator.service';
import { SnackService } from '../../core/snack/snack.service';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { VectorClockService } from './vector-clock.service';
import { OperationApplierService } from '../apply/operation-applier.service';
import { HydrationStateService } from '../apply/hydration-state.service';
import { OperationLogEffects } from '../capture/operation-log.effects';
import {
  acknowledgeDeferredAction,
  bufferDeferredAction,
  clearDeferredActions,
  getDeferredActions,
} from '../capture/operation-capture.meta-reducer';
import { PersistentAction } from '../core/persistent-action.interface';
import { ConflictResolutionService } from './conflict-resolution.service';
import { ValidateStateService } from '../validation/validate-state.service';
import { SyncSessionValidationService } from './sync-session-validation.service';
import { RepairOperationService } from '../validation/repair-operation.service';
import { OperationLogUploadService } from './operation-log-upload.service';
import {
  DownloadResult,
  OperationLogDownloadService,
} from './operation-log-download.service';
import { LockService } from './lock.service';
import { OperationLogCompactionService } from '../persistence/operation-log-compaction.service';
import { SyncImportFilterService } from './sync-import-filter.service';
import { ServerMigrationService } from './server-migration.service';
import { SupersededOperationResolverService } from './superseded-operation-resolver.service';
import { RemoteOpsProcessingService } from './remote-ops-processing.service';
import { ConflictJournalService } from './conflict-journal.service';
import { RejectedOpsHandlerService } from './rejected-ops-handler.service';
import { OperationWriteFlushService } from './operation-write-flush.service';
import { SuperSyncStatusService } from './super-sync-status.service';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import {
  ActionType,
  Operation,
  OperationLogEntry,
  OpType,
} from '../core/operation.types';
import { TranslateService } from '@ngx-translate/core';
import {
  EncryptNoPasswordError,
  ForceUploadFailedError,
  ForceUploadPendingOpsError,
  IncompleteRemoteOperationsError,
  LocalDataConflictError,
} from '../core/errors/sync-errors';
import { SyncHydrationService } from '../persistence/sync-hydration.service';
import { SyncImportConflictDialogService } from './sync-import-conflict-dialog.service';
import { StateSnapshotService } from '../backup/state-snapshot.service';
import { BackupService } from '../backup/backup.service';
import { T } from '../../t.const';
import { INBOX_PROJECT } from '../../features/project/project.const';
import { TODAY_TAG, SYSTEM_TAG_IDS } from '../../features/tag/tag.const';
import { OperationSyncCapable } from '../sync-providers/provider.interface';
import { selectSyncConfig } from '../../features/config/store/global-config.reducer';
import { DEFAULT_GLOBAL_CONFIG } from '../../features/config/default-global-config.const';
import { SyncProviderId } from '../sync-providers/provider.const';
import { stripLocalOnlySyncSettingsFromAppData } from '../../features/config/local-only-sync-settings.util';
import { RepairSyncContextService } from '../validation/repair-sync-context.service';

describe('OperationLogSyncService', () => {
  let service: OperationLogSyncService;
  let snackServiceSpy: jasmine.SpyObj<SnackService>;
  let opLogStoreSpy: jasmine.SpyObj<OperationLogStoreService>;
  let serverMigrationServiceSpy: jasmine.SpyObj<ServerMigrationService>;
  let remoteOpsProcessingServiceSpy: jasmine.SpyObj<RemoteOpsProcessingService>;
  let conflictJournalServiceSpy: jasmine.SpyObj<ConflictJournalService>;
  let rejectedOpsHandlerServiceSpy: jasmine.SpyObj<RejectedOpsHandlerService>;
  let writeFlushServiceSpy: jasmine.SpyObj<OperationWriteFlushService>;
  let superSyncStatusServiceSpy: jasmine.SpyObj<SuperSyncStatusService>;
  let stateSnapshotServiceSpy: jasmine.SpyObj<StateSnapshotService>;
  let backupServiceSpy: jasmine.SpyObj<BackupService>;
  let syncImportConflictDialogServiceSpy: jasmine.SpyObj<SyncImportConflictDialogService>;
  let schemaMigrationServiceSpy: jasmine.SpyObj<SchemaMigrationService>;
  let validateStateServiceSpy: jasmine.SpyObj<ValidateStateService>;
  let lockServiceSpy: jasmine.SpyObj<LockService>;
  let operationApplierSpy: jasmine.SpyObj<OperationApplierService>;
  let hydrationStateServiceSpy: jasmine.SpyObj<HydrationStateService>;
  let operationLogEffectsSpy: jasmine.SpyObj<OperationLogEffects>;
  let hydratorServiceSpy: jasmine.SpyObj<OperationLogHydratorService>;
  const defaultBackupRef = { backupId: 'backup-1', savedAt: 1 };
  const backupRef4242 = { backupId: 'backup-4242', savedAt: 4242 };
  const backupRef12345 = { backupId: 'backup-12345', savedAt: 12345 };

  const createProviderSetupEntry = (): OperationLogEntry => ({
    seq: 1,
    op: {
      id: 'sync-provider-setup',
      clientId: 'client-A',
      actionType: ActionType.GLOBAL_CONFIG_UPDATE_SECTION,
      opType: OpType.Update,
      entityType: 'GLOBAL_CONFIG',
      entityId: 'sync',
      payload: { sectionKey: 'sync' },
      vectorClock: { clientA: 1 },
      timestamp: Date.now(),
      schemaVersion: 1,
    },
    appliedAt: Date.now(),
    source: 'local',
  });

  beforeEach(() => {
    snackServiceSpy = jasmine.createSpyObj('SnackService', [
      'open',
      'close',
      'hasPendingPersistentAction',
    ]);
    snackServiceSpy.hasPendingPersistentAction.and.returnValue(false);
    opLogStoreSpy = jasmine.createSpyObj('OperationLogStoreService', [
      'getUnsynced',
      'getPendingRemoteOps',
      'getFailedRemoteOps',
      'loadStateCache',
      'getLastSeq',
      'getOpById',
      'markSynced',
      'markRejected',
      'setVectorClock',
      'clearFullStateOps',
      'getVectorClock',
      'appendBatchSkipDuplicates',
      'appendSnapshotIncludedOps',
      'hasSyncedOps',
      'runRemoteStateReplacement',
      'isRawRebuildIncomplete',
      'loadRawRebuildIncomplete',
      'completeRawRebuild',
      'loadRawRebuildRecovery',
      'clearRawRebuildRecovery',
      'retireCompletedRawRebuildRecovery',
      'loadImportBackup',
    ]);
    opLogStoreSpy.hasSyncedOps.and.resolveTo(true);
    opLogStoreSpy.getUnsynced.and.resolveTo([]);
    opLogStoreSpy.getPendingRemoteOps.and.resolveTo([]);
    opLogStoreSpy.getFailedRemoteOps.and.resolveTo([]);
    opLogStoreSpy.markSynced.and.resolveTo();
    opLogStoreSpy.setVectorClock.and.resolveTo();
    opLogStoreSpy.clearFullStateOps.and.resolveTo();
    opLogStoreSpy.getVectorClock.and.resolveTo(null);
    opLogStoreSpy.appendBatchSkipDuplicates.and.resolveTo({
      seqs: [],
      writtenOps: [],
      skippedCount: 0,
    });
    opLogStoreSpy.appendSnapshotIncludedOps.and.resolveTo({
      seqs: [],
      writtenOps: [],
      skippedCount: 0,
    });
    opLogStoreSpy.runRemoteStateReplacement.and.resolveTo();
    opLogStoreSpy.isRawRebuildIncomplete.and.resolveTo(false);
    opLogStoreSpy.loadRawRebuildIncomplete.and.resolveTo(null);
    opLogStoreSpy.completeRawRebuild.and.resolveTo(true);
    opLogStoreSpy.loadRawRebuildRecovery.and.resolveTo(null);
    opLogStoreSpy.clearRawRebuildRecovery.and.resolveTo();
    opLogStoreSpy.retireCompletedRawRebuildRecovery.and.resolveTo(true);
    opLogStoreSpy.loadImportBackup.and.resolveTo(null);

    schemaMigrationServiceSpy = jasmine.createSpyObj('SchemaMigrationService', [
      'getCurrentVersion',
      'migrateOperation',
      'migrateOperations',
    ]);
    schemaMigrationServiceSpy.migrateOperations.and.callFake((ops) => ops);

    validateStateServiceSpy = jasmine.createSpyObj('ValidateStateService', [
      'validateAndRepair',
      'validateAndRepairCurrentState',
    ]);
    validateStateServiceSpy.validateAndRepair.and.resolveTo({
      isValid: true,
      wasRepaired: false,
    });

    lockServiceSpy = jasmine.createSpyObj('LockService', ['request']);
    lockServiceSpy.request.and.callFake(async (_name, callback) => callback());
    serverMigrationServiceSpy = jasmine.createSpyObj('ServerMigrationService', [
      'checkAndHandleMigration',
      'handleServerMigration',
    ]);
    serverMigrationServiceSpy.checkAndHandleMigration.and.resolveTo();
    serverMigrationServiceSpy.handleServerMigration.and.resolveTo();

    // Default: no meaningful local data (only system defaults)
    stateSnapshotServiceSpy = jasmine.createSpyObj('StateSnapshotService', [
      'getStateSnapshot',
    ]);
    stateSnapshotServiceSpy.getStateSnapshot.and.returnValue({
      task: { ids: [] },
      project: { ids: [INBOX_PROJECT.id] }, // Only default INBOX project
      tag: { ids: [TODAY_TAG.id] }, // Only default TODAY tag
      note: { ids: [] },
    } as any);

    backupServiceSpy = jasmine.createSpyObj('BackupService', [
      'captureImportBackup',
      'restoreImportBackup',
    ]);
    backupServiceSpy.captureImportBackup.and.resolveTo(defaultBackupRef);
    backupServiceSpy.restoreImportBackup.and.resolveTo(true);

    remoteOpsProcessingServiceSpy = jasmine.createSpyObj('RemoteOpsProcessingService', [
      'processRemoteOps',
    ]);
    conflictJournalServiceSpy = jasmine.createSpyObj('ConflictJournalService', [
      'clearAll',
    ]);
    conflictJournalServiceSpy.clearAll.and.resolveTo();
    remoteOpsProcessingServiceSpy.processRemoteOps.and.resolveTo({
      localWinOpsCreated: 0,
      allOpsFilteredBySyncImport: false,
      filteredOpCount: 0,
      isLocalUnsyncedImport: false,
      blockedByIncompatibleOp: false,
    });

    rejectedOpsHandlerServiceSpy = jasmine.createSpyObj('RejectedOpsHandlerService', [
      'handleRejectedOps',
    ]);
    rejectedOpsHandlerServiceSpy.handleRejectedOps.and.resolveTo({
      kind: 'completed',
      mergedOpsCreated: 0,
      permanentRejectionCount: 0,
    });

    writeFlushServiceSpy = jasmine.createSpyObj('OperationWriteFlushService', [
      'flushPendingWrites',
      'flushThenRunExclusive',
      'hasPendingWrites',
    ]);
    writeFlushServiceSpy.flushPendingWrites.and.resolveTo();
    writeFlushServiceSpy.hasPendingWrites.and.returnValue(false);
    // Mirror the real barrier semantics: flush BEFORE the exclusive section runs.
    writeFlushServiceSpy.flushThenRunExclusive.and.callFake(
      async <T>(fn: () => Promise<T>) => {
        await writeFlushServiceSpy.flushPendingWrites();
        return fn();
      },
    );

    superSyncStatusServiceSpy = jasmine.createSpyObj('SuperSyncStatusService', [
      'updatePendingOpsStatus',
    ]);

    syncImportConflictDialogServiceSpy = jasmine.createSpyObj(
      'SyncImportConflictDialogService',
      ['showConflictDialog'],
    );
    syncImportConflictDialogServiceSpy.showConflictDialog.and.resolveTo('CANCEL');
    operationApplierSpy = jasmine.createSpyObj('OperationApplierService', [
      'applyOperations',
    ]);
    operationApplierSpy.applyOperations.and.resolveTo({ appliedOps: [] });
    hydrationStateServiceSpy = jasmine.createSpyObj('HydrationStateService', [
      'startApplyingRemoteOps',
      'endApplyingRemoteOps',
    ]);
    operationLogEffectsSpy = jasmine.createSpyObj('OperationLogEffects', [
      'processDeferredActions',
    ]);
    operationLogEffectsSpy.processDeferredActions.and.callFake(async () => {
      for (const action of getDeferredActions()) {
        acknowledgeDeferredAction(action);
      }
    });
    hydratorServiceSpy = jasmine.createSpyObj('OperationLogHydratorService', [
      'retryFailedRemoteOps',
    ]);
    hydratorServiceSpy.retryFailedRemoteOps.and.resolveTo();

    TestBed.configureTestingModule({
      providers: [
        OperationLogSyncService,
        provideMockStore(),
        { provide: SchemaMigrationService, useValue: schemaMigrationServiceSpy },
        { provide: SnackService, useValue: snackServiceSpy },
        { provide: OperationLogStoreService, useValue: opLogStoreSpy },
        {
          provide: VectorClockService,
          useValue: jasmine.createSpyObj('VectorClockService', [
            'getEntityFrontier',
            'getSnapshotVectorClock',
            'getSnapshotEntityKeys',
            'getCurrentVectorClock',
          ]),
        },
        {
          provide: OperationApplierService,
          useValue: operationApplierSpy,
        },
        { provide: HydrationStateService, useValue: hydrationStateServiceSpy },
        { provide: OperationLogEffects, useValue: operationLogEffectsSpy },
        { provide: OperationLogHydratorService, useValue: hydratorServiceSpy },
        {
          provide: ConflictResolutionService,
          useValue: jasmine.createSpyObj('ConflictResolutionService', [
            'autoResolveConflictsLWW',
            'checkOpForConflicts',
          ]),
        },
        { provide: ValidateStateService, useValue: validateStateServiceSpy },
        {
          provide: RepairOperationService,
          useValue: jasmine.createSpyObj('RepairOperationService', [
            'createRepairOperation',
          ]),
        },
        {
          provide: OperationLogUploadService,
          useValue: jasmine.createSpyObj('OperationLogUploadService', [
            'uploadPendingOps',
          ]),
        },
        {
          provide: OperationLogDownloadService,
          useValue: jasmine.createSpyObj('OperationLogDownloadService', [
            'downloadRemoteOps',
          ]),
        },
        { provide: LockService, useValue: lockServiceSpy },
        {
          provide: OperationLogCompactionService,
          useValue: jasmine.createSpyObj('OperationLogCompactionService', ['compact']),
        },
        {
          provide: TranslateService,
          useValue: jasmine.createSpyObj('TranslateService', ['instant']),
        },
        {
          provide: SyncImportFilterService,
          useValue: jasmine.createSpyObj('SyncImportFilterService', [
            'filterOpsInvalidatedBySyncImport',
          ]),
        },
        { provide: ServerMigrationService, useValue: serverMigrationServiceSpy },
        {
          provide: SupersededOperationResolverService,
          useValue: jasmine.createSpyObj('SupersededOperationResolverService', [
            'resolveSupersededLocalOps',
          ]),
        },
        { provide: RemoteOpsProcessingService, useValue: remoteOpsProcessingServiceSpy },
        {
          provide: ConflictJournalService,
          useValue: conflictJournalServiceSpy,
        },
        { provide: RejectedOpsHandlerService, useValue: rejectedOpsHandlerServiceSpy },
        { provide: OperationWriteFlushService, useValue: writeFlushServiceSpy },
        { provide: SuperSyncStatusService, useValue: superSyncStatusServiceSpy },
        {
          provide: SyncHydrationService,
          useValue: jasmine.createSpyObj('SyncHydrationService', [
            'hydrateFromRemoteSync',
          ]),
        },
        { provide: StateSnapshotService, useValue: stateSnapshotServiceSpy },
        { provide: BackupService, useValue: backupServiceSpy },
        {
          provide: SyncImportConflictDialogService,
          useValue: syncImportConflictDialogServiceSpy,
        },
      ],
    });

    service = TestBed.inject(OperationLogSyncService);
    // Default: not a fresh client
    opLogStoreSpy.loadStateCache.and.resolveTo({
      state: {},
      lastAppliedOpSeq: 1,
      vectorClock: {},
      compactedAt: Date.now(),
    });
    opLogStoreSpy.getLastSeq.and.resolveTo(1);
    opLogStoreSpy.getUnsynced.and.resolveTo([]);
  });

  // NOTE: Tests for processRemoteOps, detectConflicts, and applyNonConflictingOps
  // have been moved to remote-ops-processing.service.spec.ts

  // NOTE: Tests for handleRejectedOps have been moved to rejected-ops-handler.service.spec.ts

  describe('localWinOpsCreated propagation', () => {
    let uploadServiceSpy: jasmine.SpyObj<OperationLogUploadService>;
    let downloadServiceSpy: jasmine.SpyObj<OperationLogDownloadService>;

    beforeEach(() => {
      uploadServiceSpy = TestBed.inject(
        OperationLogUploadService,
      ) as jasmine.SpyObj<OperationLogUploadService>;
      downloadServiceSpy = TestBed.inject(
        OperationLogDownloadService,
      ) as jasmine.SpyObj<OperationLogDownloadService>;

      // Mock loadStateCache to return null (no cache) so isWhollyFreshClient check passes
      (opLogStoreSpy as any).loadStateCache = jasmine
        .createSpy('loadStateCache')
        .and.returnValue(Promise.resolve(null));
      (opLogStoreSpy as any).getLastSeq = jasmine
        .createSpy('getLastSeq')
        .and.returnValue(Promise.resolve(1)); // Not fresh (has seq)
    });

    describe('uploadPendingOps', () => {
      it('should drain deferred local actions before selecting pending uploads', async () => {
        const callOrder: string[] = [];
        writeFlushServiceSpy.flushPendingWrites.and.callFake(async () => {
          callOrder.push('flush');
        });
        operationLogEffectsSpy.processDeferredActions.and.callFake(async () => {
          callOrder.push('deferred');
        });
        uploadServiceSpy.uploadPendingOps.and.callFake(async () => {
          callOrder.push('upload');
          return {
            uploadedCount: 0,
            piggybackedOps: [],
            rejectedCount: 0,
            rejectedOps: [],
          };
        });

        await service.uploadPendingOps({} as OperationSyncCapable);

        expect(callOrder).toEqual(['flush', 'deferred', 'flush', 'upload']);
      });

      it('should block upload while a remote operation is incompletely applied', async () => {
        opLogStoreSpy.getPendingRemoteOps.and.resolveTo([
          { applicationStatus: 'pending' } as OperationLogEntry,
        ]);

        await expectAsync(
          service.uploadPendingOps({} as OperationSyncCapable),
        ).toBeRejected();

        expect(uploadServiceSpy.uploadPendingOps).not.toHaveBeenCalled();
      });

      it('should block upload while a raw rebuild remains incomplete', async () => {
        opLogStoreSpy.isRawRebuildIncomplete.and.resolveTo(true);
        opLogStoreSpy.loadRawRebuildIncomplete.and.resolveTo({
          incomplete: true,
          startedAt: 1,
          preservedLocalOps: [],
          backupRef: backupRef4242,
        });

        await expectAsync(
          service.uploadPendingOps({} as OperationSyncCapable),
        ).toBeRejectedWithError(IncompleteRemoteOperationsError);

        expect(uploadServiceSpy.uploadPendingOps).not.toHaveBeenCalled();
      });

      it('should not attempt the in-session archive retry while a raw rebuild is incomplete', async () => {
        opLogStoreSpy.isRawRebuildIncomplete.and.resolveTo(true);
        opLogStoreSpy.loadRawRebuildIncomplete.and.resolveTo({
          incomplete: true,
          startedAt: 1,
          preservedLocalOps: [],
          backupRef: backupRef4242,
        });

        await expectAsync(
          service.uploadPendingOps({} as OperationSyncCapable),
        ).toBeRejectedWithError(IncompleteRemoteOperationsError);

        expect(hydratorServiceSpy.retryFailedRemoteOps).not.toHaveBeenCalled();
      });

      it('should return localWinOpsCreated: 0 when no piggybacked ops', async () => {
        opLogStoreSpy.getUnsynced.and.returnValue(Promise.resolve([]));
        uploadServiceSpy.uploadPendingOps.and.returnValue(
          Promise.resolve({
            uploadedCount: 0,
            piggybackedOps: [],
            rejectedCount: 0,
            rejectedOps: [],
          }),
        );

        const mockProvider = {
          isReady: () => Promise.resolve(true),
        } as any;

        const result = await service.uploadPendingOps(mockProvider);

        expect(result.kind).toBe('completed');
        if (result.kind === 'completed') {
          expect(result.localWinOpsCreated).toBe(0);
        }
      });

      it('should return localWinOpsCreated count from piggybacked ops processing', async () => {
        opLogStoreSpy.getUnsynced.and.returnValue(Promise.resolve([]));

        const piggybackedOp: Operation = {
          id: 'piggybacked-1',
          clientId: 'client-B',
          actionType: 'test' as ActionType,
          opType: OpType.Update,
          entityType: 'TASK',
          entityId: 'task-1',
          payload: { title: 'Remote Title' },
          vectorClock: { clientB: 1 },
          timestamp: Date.now(),
          schemaVersion: 1,
        };

        uploadServiceSpy.uploadPendingOps.and.returnValue(
          Promise.resolve({
            uploadedCount: 1,
            piggybackedOps: [piggybackedOp],
            rejectedCount: 0,
            rejectedOps: [],
          }),
        );

        // Mock remoteOpsProcessingService to return 2 local-win ops
        remoteOpsProcessingServiceSpy.processRemoteOps.and.resolveTo({
          localWinOpsCreated: 2,
          allOpsFilteredBySyncImport: false,
          filteredOpCount: 0,
          isLocalUnsyncedImport: false,
          blockedByIncompatibleOp: false,
        });

        const mockProvider = {
          isReady: () => Promise.resolve(true),
        } as any;

        const result = await service.uploadPendingOps(mockProvider);

        expect(result.kind).toBe('completed');
        if (result.kind === 'completed') {
          expect(result.localWinOpsCreated).toBe(2);
        }
      });

      it('should flag the piggybacked SYNC_IMPORT conflict as never-synced using PRE-upload history', async () => {
        // Regression: the never-synced guard must be captured before the upload marks
        // accepted ops synced. uploadService.uploadPendingOps flips hasSyncedOps() to true
        // as a side effect; if the gate read it afterwards it would clear the guard and
        // re-open the data-loss trap (USE_LOCAL force-overwriting a populated remote).
        opLogStoreSpy.hasSyncedOps.and.resolveTo(false);

        const piggybackedSyncImport: Operation = {
          id: 'remote-sync-import',
          clientId: 'client-B',
          actionType: ActionType.LOAD_ALL_DATA,
          opType: OpType.SyncImport,
          entityType: 'ALL',
          payload: {},
          vectorClock: { clientB: 5 },
          timestamp: Date.now(),
          schemaVersion: 1,
        };
        // A meaningful local op remains pending so the gate produces dialog data.
        opLogStoreSpy.getUnsynced.and.resolveTo([
          {
            seq: 1,
            op: {
              id: 'local-task-create',
              clientId: 'client-A',
              actionType: 'test' as ActionType,
              opType: OpType.Create,
              entityType: 'TASK',
              entityId: 'task-1',
              payload: { title: 'Example task' },
              vectorClock: { clientA: 1 },
              timestamp: Date.now(),
              schemaVersion: 1,
            },
            appliedAt: Date.now(),
            source: 'local',
          },
        ]);

        // Simulate the upload marking ops synced: hasSyncedOps() now reports true.
        uploadServiceSpy.uploadPendingOps.and.callFake(async () => {
          opLogStoreSpy.hasSyncedOps.and.resolveTo(true);
          return {
            uploadedCount: 1,
            piggybackedOps: [piggybackedSyncImport],
            rejectedCount: 0,
            rejectedOps: [],
          };
        });

        const mockProvider = { isReady: () => Promise.resolve(true) } as any;

        const result = await service.uploadPendingOps(mockProvider);

        // CANCEL is the default dialog result, so the upload reports cancelled.
        expect(result.kind).toBe('cancelled');
        // The dialog must have been shown with the PRE-upload never-synced value.
        expect(
          syncImportConflictDialogServiceSpy.showConflictDialog,
        ).toHaveBeenCalledWith(jasmine.objectContaining({ isNeverSynced: true }));
      });

      // #8304: the upload service defers persisting lastServerSeq for piggybacked ops;
      // the orchestrator must persist it ONLY after processRemoteOps applies them.
      describe('lastServerSeq persistence for piggybacked ops (#8304)', () => {
        it('should persist lastServerSeq AFTER processing piggybacked ops', async () => {
          opLogStoreSpy.getUnsynced.and.returnValue(Promise.resolve([]));

          const piggybackedOp: Operation = {
            id: 'piggybacked-1',
            clientId: 'client-B',
            actionType: 'test' as ActionType,
            opType: OpType.Update,
            entityType: 'TASK',
            entityId: 'task-1',
            payload: { title: 'Remote Title' },
            vectorClock: { clientB: 1 },
            timestamp: Date.now(),
            schemaVersion: 1,
          };

          uploadServiceSpy.uploadPendingOps.and.resolveTo({
            uploadedCount: 1,
            piggybackedOps: [piggybackedOp],
            rejectedCount: 0,
            rejectedOps: [],
            lastServerSeqToPersist: 77,
          });

          // Track order: setLastServerSeq must run AFTER processRemoteOps.
          const callOrder: string[] = [];
          remoteOpsProcessingServiceSpy.processRemoteOps.and.callFake(async () => {
            callOrder.push('processRemoteOps');
            return {
              localWinOpsCreated: 0,
              allOpsFilteredBySyncImport: false,
              filteredOpCount: 0,
              isLocalUnsyncedImport: false,
              blockedByIncompatibleOp: false,
            };
          });
          const setLastServerSeqSpy = jasmine
            .createSpy('setLastServerSeq')
            .and.callFake(async () => {
              callOrder.push('setLastServerSeq');
            });

          const mockProvider = {
            isReady: () => Promise.resolve(true),
            supportsOperationSync: true,
            setLastServerSeq: setLastServerSeqSpy,
          } as any;

          const result = await service.uploadPendingOps(mockProvider);

          expect(result.kind).toBe('completed');
          expect(setLastServerSeqSpy).toHaveBeenCalledWith(77);
          // The seq must NOT advance before the ops it covers are applied.
          expect(callOrder).toEqual(['processRemoteOps', 'setLastServerSeq']);
        });

        it('should NOT persist lastServerSeq when a piggybacked SYNC_IMPORT dialog is cancelled', async () => {
          // A meaningful local op remains pending so the gate produces dialog data for
          // the incoming SYNC_IMPORT, which the user then cancels (default dialog result).
          opLogStoreSpy.hasSyncedOps.and.resolveTo(false);
          opLogStoreSpy.getUnsynced.and.resolveTo([
            {
              seq: 1,
              op: {
                id: 'local-task-create',
                clientId: 'client-A',
                actionType: 'test' as ActionType,
                opType: OpType.Create,
                entityType: 'TASK',
                entityId: 'task-1',
                payload: { title: 'Real local task' },
                vectorClock: { clientA: 1 },
                timestamp: Date.now(),
                schemaVersion: 1,
              },
              appliedAt: Date.now(),
              source: 'local',
            },
          ]);

          const piggybackedSyncImport: Operation = {
            id: 'remote-sync-import',
            clientId: 'client-B',
            actionType: ActionType.LOAD_ALL_DATA,
            opType: OpType.SyncImport,
            entityType: 'ALL',
            payload: {},
            vectorClock: { clientB: 5 },
            timestamp: Date.now(),
            schemaVersion: 1,
          };

          uploadServiceSpy.uploadPendingOps.and.resolveTo({
            uploadedCount: 0,
            piggybackedOps: [piggybackedSyncImport],
            rejectedCount: 0,
            rejectedOps: [],
            lastServerSeqToPersist: 99,
          });

          const setLastServerSeqSpy = jasmine
            .createSpy('setLastServerSeq')
            .and.resolveTo();
          const mockProvider = {
            isReady: () => Promise.resolve(true),
            supportsOperationSync: true,
            setLastServerSeq: setLastServerSeqSpy,
          } as any;

          const result = await service.uploadPendingOps(mockProvider);

          expect(result.kind).toBe('cancelled');
          // CRITICAL: the seq must NOT advance — the piggybacked ops (the SYNC_IMPORT and
          // any siblings) were never applied, so the next download must re-fetch them.
          expect(setLastServerSeqSpy).not.toHaveBeenCalled();
          expect(remoteOpsProcessingServiceSpy.processRemoteOps).not.toHaveBeenCalled();
        });

        it('should NOT persist lastServerSeq if processRemoteOps throws (crash window)', async () => {
          opLogStoreSpy.getUnsynced.and.returnValue(Promise.resolve([]));

          const piggybackedOp: Operation = {
            id: 'piggybacked-1',
            clientId: 'client-B',
            actionType: 'test' as ActionType,
            opType: OpType.Update,
            entityType: 'TASK',
            entityId: 'task-1',
            payload: { title: 'Test' },
            vectorClock: { clientB: 1 },
            timestamp: Date.now(),
            schemaVersion: 1,
          };

          uploadServiceSpy.uploadPendingOps.and.resolveTo({
            uploadedCount: 1,
            piggybackedOps: [piggybackedOp],
            rejectedCount: 0,
            rejectedOps: [],
            lastServerSeqToPersist: 88,
          });

          // Simulate a crash mid-apply (e.g. DecryptNoPasswordError, validation throw).
          remoteOpsProcessingServiceSpy.processRemoteOps.and.rejectWith(
            new Error('apply failed mid-flight'),
          );

          const setLastServerSeqSpy = jasmine
            .createSpy('setLastServerSeq')
            .and.resolveTo();
          const mockProvider = {
            isReady: () => Promise.resolve(true),
            supportsOperationSync: true,
            setLastServerSeq: setLastServerSeqSpy,
          } as any;

          await expectAsync(service.uploadPendingOps(mockProvider)).toBeRejected();

          // The seq must NOT have advanced — the apply threw before completing, so the
          // next download must re-fetch the piggybacked ops instead of skipping them.
          expect(setLastServerSeqSpy).not.toHaveBeenCalled();
        });
      });

      describe('rejected ops handling delegation', () => {
        let mockProvider: any;

        beforeEach(() => {
          mockProvider = {
            isReady: () => Promise.resolve(true),
            supportsOperationSync: true,
            getLastServerSeq: () => Promise.resolve(12),
          };
        });

        it('should delegate rejected ops handling to RejectedOpsHandlerService', async () => {
          uploadServiceSpy.uploadPendingOps.and.returnValue(
            Promise.resolve({
              uploadedCount: 0,
              piggybackedOps: [],
              rejectedCount: 1,
              rejectedOps: [
                {
                  opId: 'local-op-1',
                  error: 'Some error',
                  errorCode: 'VALIDATION_ERROR',
                },
              ],
            }),
          );

          await service.uploadPendingOps(mockProvider, { isNeverSynced: true });

          expect(rejectedOpsHandlerServiceSpy.handleRejectedOps).toHaveBeenCalledWith(
            [{ opId: 'local-op-1', error: 'Some error', errorCode: 'VALIDATION_ERROR' }],
            jasmine.any(Function), // downloadCallback
          );
        });

        it('should pass download callback that calls downloadRemoteOps', async () => {
          opLogStoreSpy.hasSyncedOps.and.resolveTo(false);
          uploadServiceSpy.uploadPendingOps.and.callFake(async () => {
            opLogStoreSpy.hasSyncedOps.and.resolveTo(true);
            return {
              uploadedCount: 0,
              piggybackedOps: [],
              rejectedCount: 1,
              rejectedOps: [
                {
                  opId: 'local-op-1',
                  error: 'Concurrent',
                  errorCode: 'CONFLICT_CONCURRENT',
                },
              ],
            };
          });

          // Capture the callback passed to handleRejectedOps
          let capturedCallback: any;
          rejectedOpsHandlerServiceSpy.handleRejectedOps.and.callFake(
            async (_ops, callback) => {
              capturedCallback = callback;
              return {
                kind: 'completed',
                mergedOpsCreated: 0,
                permanentRejectionCount: 0,
              };
            },
          );

          const downloadSpy = spyOn(service, 'downloadRemoteOps').and.returnValue(
            Promise.resolve({
              kind: 'no_new_ops' as const,
            }),
          );

          await service.uploadPendingOps(mockProvider);

          // Verify callback was captured
          expect(capturedCallback).toBeDefined();

          // Call the callback and verify it delegates to downloadRemoteOps
          await capturedCallback();
          expect(downloadSpy).toHaveBeenCalledWith(mockProvider, {
            isNeverSynced: true,
          });

          // Test with forceFromSeq0 option
          await capturedCallback({ forceFromSeq0: true });
          expect(downloadSpy).toHaveBeenCalledWith(mockProvider, {
            forceFromSeq0: true,
            isNeverSynced: true,
          });

          const recoveryResult = await capturedCallback({
            ignoredLocalFullStateOpIds: ['stale-repair'],
          });
          expect(downloadSpy).toHaveBeenCalledWith(mockProvider, {
            ignoredLocalFullStateOpIds: ['stale-repair'],
            isNeverSynced: true,
          });
          expect(recoveryResult.latestServerSeq).toBe(12);
        });

        it('should propagate nested download cancellation as a cancelled upload', async () => {
          uploadServiceSpy.uploadPendingOps.and.resolveTo({
            uploadedCount: 0,
            piggybackedOps: [],
            rejectedCount: 1,
            rejectedOps: [
              {
                opId: 'local-op-1',
                error: 'Concurrent',
                errorCode: 'CONFLICT_CONCURRENT',
              },
            ],
          });
          spyOn(service, 'downloadRemoteOps').and.resolveTo({ kind: 'cancelled' });
          rejectedOpsHandlerServiceSpy.handleRejectedOps.and.callFake(
            async (_ops, callback) => {
              const nestedResult = await callback?.();
              if (nestedResult?.kind === 'cancelled') {
                return { kind: 'cancelled' };
              }
              return {
                kind: 'completed',
                mergedOpsCreated: 0,
                permanentRejectionCount: 0,
              };
            },
          );

          const result = await service.uploadPendingOps(mockProvider);

          expect(result.kind).toBe('cancelled');
        });

        it('should add mergedOpsFromRejection to localWinOpsCreated in result', async () => {
          const piggybackedOp: Operation = {
            id: 'piggybacked-1',
            clientId: 'client-B',
            actionType: 'test' as ActionType,
            opType: OpType.Update,
            entityType: 'TASK',
            entityId: 'task-1',
            payload: { title: 'Test' },
            vectorClock: { clientB: 1 },
            timestamp: Date.now(),
            schemaVersion: 1,
          };

          uploadServiceSpy.uploadPendingOps.and.returnValue(
            Promise.resolve({
              uploadedCount: 1,
              piggybackedOps: [piggybackedOp], // Include piggybacked op so processRemoteOps is called
              rejectedCount: 1,
              rejectedOps: [
                {
                  opId: 'local-op-1',
                  error: 'Concurrent',
                  errorCode: 'CONFLICT_CONCURRENT',
                },
              ],
            }),
          );

          // processRemoteOps returns 2 local-win ops
          remoteOpsProcessingServiceSpy.processRemoteOps.and.resolveTo({
            localWinOpsCreated: 2,
            allOpsFilteredBySyncImport: false,
            filteredOpCount: 0,
            isLocalUnsyncedImport: false,
            blockedByIncompatibleOp: false,
          });

          // handleRejectedOps returns 3 merged ops created
          rejectedOpsHandlerServiceSpy.handleRejectedOps.and.resolveTo({
            kind: 'completed',
            mergedOpsCreated: 3,
            permanentRejectionCount: 0,
          });

          const result = await service.uploadPendingOps(mockProvider);

          // Total should be 2 + 3 = 5
          expect(result.kind).toBe('completed');
          if (result.kind === 'completed') {
            expect(result.localWinOpsCreated).toBe(5);
          }
        });

        it('should not call handleRejectedOps if processRemoteOps throws', async () => {
          const piggybackedOp: Operation = {
            id: 'piggybacked-1',
            clientId: 'client-B',
            actionType: 'test' as ActionType,
            opType: OpType.Update,
            entityType: 'TASK',
            entityId: 'task-1',
            payload: { title: 'Test' },
            vectorClock: { clientB: 1 },
            timestamp: Date.now(),
            schemaVersion: 1,
          };

          uploadServiceSpy.uploadPendingOps.and.returnValue(
            Promise.resolve({
              uploadedCount: 0,
              piggybackedOps: [piggybackedOp],
              rejectedCount: 1,
              rejectedOps: [{ opId: 'local-op-1', error: 'error' }],
            }),
          );

          // Make processRemoteOps throw
          remoteOpsProcessingServiceSpy.processRemoteOps.and.rejectWith(
            new Error('Processing failed'),
          );

          await expectAsync(service.uploadPendingOps(mockProvider)).toBeRejectedWithError(
            'Processing failed',
          );

          // handleRejectedOps should NOT be called — error propagates before reaching rejection handling
          expect(rejectedOpsHandlerServiceSpy.handleRejectedOps).not.toHaveBeenCalled();
        });

        it('should return a terminal outcome and keep acknowledgements pending when piggyback processing is incompatible', async () => {
          const piggybackedOp = {
            id: 'future-op',
            clientId: 'client-B',
            actionType: 'test' as ActionType,
            opType: OpType.Update,
            entityType: 'TASK' as const,
            entityId: 'task-1',
            payload: {},
            vectorClock: { clientB: 1 },
            timestamp: Date.now(),
            schemaVersion: 99,
          };
          uploadServiceSpy.uploadPendingOps.and.resolveTo({
            uploadedCount: 1,
            piggybackedOps: [piggybackedOp],
            rejectedCount: 0,
            rejectedOps: [],
            pendingAcknowledgementSeqs: [1],
            lastServerSeqToPersist: 9,
          });
          remoteOpsProcessingServiceSpy.processRemoteOps.and.resolveTo({
            localWinOpsCreated: 0,
            allOpsFilteredBySyncImport: false,
            filteredOpCount: 0,
            isLocalUnsyncedImport: false,
            blockedByIncompatibleOp: true,
          });
          const setLastServerSeq = jasmine.createSpy('setLastServerSeq').and.resolveTo();
          const provider = {
            ...mockProvider,
            setLastServerSeq,
          } as unknown as OperationSyncCapable;

          const result = await service.uploadPendingOps(provider);

          expect(result.kind).toBe('blocked_incompatible');
          expect(opLogStoreSpy.markSynced).not.toHaveBeenCalled();
          expect(setLastServerSeq).not.toHaveBeenCalled();
          expect(rejectedOpsHandlerServiceSpy.handleRejectedOps).not.toHaveBeenCalled();
        });

        it('should not call handleRejectedOps when there are no rejected ops', async () => {
          uploadServiceSpy.uploadPendingOps.and.returnValue(
            Promise.resolve({
              uploadedCount: 1,
              piggybackedOps: [],
              rejectedCount: 0,
              rejectedOps: [],
            }),
          );

          await service.uploadPendingOps(mockProvider);

          // handleRejectedOps should be called with empty array
          expect(rejectedOpsHandlerServiceSpy.handleRejectedOps).toHaveBeenCalledWith(
            [],
            jasmine.any(Function),
          );
        });

        it('should surface a rejected full-state upload barrier to sync orchestrators', async () => {
          uploadServiceSpy.uploadPendingOps.and.resolveTo({
            uploadedCount: 0,
            piggybackedOps: [],
            rejectedCount: 0,
            rejectedOps: [],
            blockedByRejectedFullState: true,
          });

          const result = await service.uploadPendingOps(mockProvider);

          expect(result.kind).toBe('completed');
          if (result.kind === 'completed') {
            expect(result.blockedByRejectedFullState).toBe(true);
          }
        });

        // Issue #7330 follow-up: a download triggered from inside the
        // rejected-op handler can run post-sync validation. If validation
        // fails on that path, the boolean must surface through the eventual
        // uploadPendingOps return — otherwise sync-wrapper reports IN_SYNC.
        it('should surface validationFailed from a download triggered by handleRejectedOps callback', async () => {
          uploadServiceSpy.uploadPendingOps.and.returnValue(
            Promise.resolve({
              uploadedCount: 0,
              piggybackedOps: [],
              rejectedCount: 1,
              rejectedOps: [
                {
                  opId: 'local-op-1',
                  error: 'Concurrent',
                  errorCode: 'CONFLICT_CONCURRENT',
                },
              ],
            }),
          );

          rejectedOpsHandlerServiceSpy.handleRejectedOps.and.callFake(
            async (_ops, callback) => {
              // Real handler invokes the download callback for concurrent-mod
              // resolution. The latch is flipped inside the nested download's
              // validateAfterSync — here we just exercise the call.
              await callback?.();
              return {
                kind: 'completed',
                mergedOpsCreated: 0,
                permanentRejectionCount: 0,
              };
            },
          );

          // Simulate the nested download triggering validation failure by
          // flipping the latch directly, which the real
          // RemoteOpsProcessingService.validateAfterSync would do. The flow
          // runs inside a withSession() in production (opened by the wrapper);
          // mirror that here so setFailed() doesn't trip the no-session guard.
          const latch = TestBed.inject(SyncSessionValidationService);
          latch._resetForTest();
          spyOn(service, 'downloadRemoteOps').and.callFake(async () => {
            latch.setFailed();
            return {
              kind: 'ops_processed' as const,
              newOpsCount: 1,
              localWinOpsCreated: 0,
            };
          });

          await latch.withSession(async () => {
            await service.uploadPendingOps(mockProvider);
          });

          // The latch is the canonical signal that reaches the wrapper. The
          // upload result no longer carries validationFailed — that field is
          // gone (#7330 simplification).
          expect(latch.hasFailed()).toBe(true);
        });
      });
    });

    describe('downloadRemoteOps', () => {
      it('should block download while a prior remote operation is incompletely applied', async () => {
        opLogStoreSpy.getFailedRemoteOps.and.resolveTo([
          { applicationStatus: 'failed' } as OperationLogEntry,
        ]);

        await expectAsync(
          service.downloadRemoteOps({} as OperationSyncCapable),
        ).toBeRejected();

        // The one in-session repair attempt ran but couldn't clear the gate.
        expect(hydratorServiceSpy.retryFailedRemoteOps).toHaveBeenCalledTimes(1);
        expect(downloadServiceSpy.downloadRemoteOps).not.toHaveBeenCalled();
      });

      it('should proceed when the in-session archive retry clears the incomplete-remote gate', async () => {
        // Transient archive failure: quarantined at gate read, gone on re-check.
        opLogStoreSpy.getFailedRemoteOps.and.returnValues(
          Promise.resolve([{ applicationStatus: 'failed' } as OperationLogEntry]),
          Promise.resolve([]),
        );
        downloadServiceSpy.downloadRemoteOps.and.resolveTo({
          newOps: [],
          needsFullStateUpload: false,
          success: true,
          providerMode: 'superSyncOps',
          failedFileCount: 0,
        });

        await service.downloadRemoteOps({} as OperationSyncCapable);

        expect(hydratorServiceSpy.retryFailedRemoteOps).toHaveBeenCalledTimes(1);
        expect(downloadServiceSpy.downloadRemoteOps).toHaveBeenCalled();
      });

      it('should redo the raw rebuild when a prior USE_REMOTE replay was interrupted', async () => {
        // The normal download path excludes this client's own ops server-side,
        // so resuming an interrupted rebuild through it would silently lose them.
        opLogStoreSpy.isRawRebuildIncomplete.and.resolveTo(true);
        const forceDownloadSpy = spyOn(
          service,
          'forceDownloadRemoteState',
        ).and.resolveTo();
        const mockProvider = {
          isReady: () => Promise.resolve(true),
        } as any;

        const result = await service.downloadRemoteOps(mockProvider);

        expect(forceDownloadSpy).toHaveBeenCalledWith(mockProvider, {
          isCrashResume: true,
        });
        expect(result.kind).toBe('snapshot_hydrated');
        expect(downloadServiceSpy.downloadRemoteOps).not.toHaveBeenCalled();
      });

      it('should resume a raw rebuild whose marker appears while local writes flush', async () => {
        opLogStoreSpy.isRawRebuildIncomplete.and.returnValues(
          Promise.resolve(false),
          Promise.resolve(true),
        );
        const forceDownloadSpy = spyOn(
          service,
          'forceDownloadRemoteState',
        ).and.resolveTo();
        const mockProvider = {
          isReady: () => Promise.resolve(true),
        } as any;

        const result = await service.downloadRemoteOps(mockProvider);

        expect(opLogStoreSpy.isRawRebuildIncomplete).toHaveBeenCalledTimes(2);
        expect(forceDownloadSpy).toHaveBeenCalledWith(mockProvider, {
          isCrashResume: true,
        });
        expect(result.kind).toBe('snapshot_hydrated');
        expect(downloadServiceSpy.downloadRemoteOps).not.toHaveBeenCalled();
      });

      it('should flush deferred local work before entering crash-resume rebuild', async () => {
        opLogStoreSpy.isRawRebuildIncomplete.and.resolveTo(true);
        opLogStoreSpy.loadRawRebuildIncomplete.and.resolveTo({
          incomplete: true,
          startedAt: 1,
          preservedLocalOps: [],
          backupRef: backupRef4242,
        });
        opLogStoreSpy.loadImportBackup.and.resolveTo({
          state: {},
          ...backupRef4242,
        });
        operationLogEffectsSpy.processDeferredActions.and.rejectWith(
          new Error('deferred write failed'),
        );
        const forceDownloadSpy = spyOn(service, 'forceDownloadRemoteState');

        await expectAsync(
          service.downloadRemoteOps({} as OperationSyncCapable),
        ).toBeRejectedWithError(/deferred write failed/);

        expect(forceDownloadSpy).not.toHaveBeenCalled();
        expect(opLogStoreSpy.isRawRebuildIncomplete).toHaveBeenCalled();
        expect(snackServiceSpy.open).toHaveBeenCalledWith(
          jasmine.objectContaining({ msg: T.F.SYNC.S.LOCAL_DATA_REPLACE_UNDO }),
        );
      });

      it('should offer the stranded pre-replace backup when an interrupted rebuild resume cannot finish', async () => {
        // Resume path: the prior attempt already committed the destructive
        // baseline, but this resume aborts in its download/validate phase (e.g.
        // empty/newer-schema remote). Without an escape hatch the user is stuck
        // on the baseline with the pre-replace backup hidden — surface Undo.
        opLogStoreSpy.isRawRebuildIncomplete.and.resolveTo(true);
        opLogStoreSpy.loadRawRebuildIncomplete.and.resolveTo({
          incomplete: true,
          startedAt: 1,
          preservedLocalOps: [],
          backupRef: backupRef4242,
        });
        spyOn(service, 'forceDownloadRemoteState').and.rejectWith(
          new Error('USE_REMOTE aborted: remote returned no data to rebuild from.'),
        );
        opLogStoreSpy.loadImportBackup.and.resolveTo({
          state: {},
          ...backupRef4242,
        });
        snackServiceSpy.hasPendingPersistentAction.and.returnValue(false);
        const mockProvider = { isReady: () => Promise.resolve(true) } as any;

        await expectAsync(service.downloadRemoteOps(mockProvider)).toBeRejected();

        expect(snackServiceSpy.open).toHaveBeenCalledWith(
          jasmine.objectContaining({ msg: T.F.SYNC.S.LOCAL_DATA_REPLACE_UNDO }),
        );
      });

      it('should allow uploads after stranded-rebuild Undo clears the marker', async () => {
        let isRawRebuildIncomplete = true;
        opLogStoreSpy.loadRawRebuildIncomplete.and.resolveTo({
          incomplete: true,
          startedAt: 1,
          preservedLocalOps: [],
          backupRef: backupRef4242,
        });
        opLogStoreSpy.isRawRebuildIncomplete.and.callFake(
          async () => isRawRebuildIncomplete,
        );
        spyOn(service, 'forceDownloadRemoteState').and.rejectWith(
          new Error('USE_REMOTE aborted: remote returned no data to rebuild from.'),
        );
        opLogStoreSpy.loadImportBackup.and.resolveTo({
          state: {},
          ...backupRef4242,
        });
        backupServiceSpy.restoreImportBackup.and.callFake(async () => {
          isRawRebuildIncomplete = false;
          return true;
        });
        uploadServiceSpy.uploadPendingOps.and.resolveTo({
          uploadedCount: 0,
          piggybackedOps: [],
          rejectedCount: 0,
          rejectedOps: [],
        });
        const mockProvider = { isReady: () => Promise.resolve(true) } as any;

        await expectAsync(service.downloadRemoteOps(mockProvider)).toBeRejected();

        const undoSnack = snackServiceSpy.open.calls
          .allArgs()
          .map(([params]) => params)
          .find(
            (params) =>
              typeof params === 'object' &&
              params !== null &&
              params.msg === T.F.SYNC.S.LOCAL_DATA_REPLACE_UNDO,
          );
        expect(undoSnack).toBeDefined();
        if (typeof undoSnack !== 'object' || undoSnack === null || !undoSnack.actionFn) {
          throw new Error('Expected the stranded-rebuild Undo action');
        }
        await undoSnack.actionFn();

        await service.uploadPendingOps(mockProvider);

        expect(backupServiceSpy.restoreImportBackup).toHaveBeenCalledWith(backupRef4242);
        expect(opLogStoreSpy.clearRawRebuildRecovery).toHaveBeenCalledWith(
          backupRef4242.backupId,
        );
        expect(uploadServiceSpy.uploadPendingOps).toHaveBeenCalled();
      });

      it('should re-offer a completed rebuild Undo from its durable token', async () => {
        opLogStoreSpy.isRawRebuildIncomplete.and.resolveTo(false);
        opLogStoreSpy.loadRawRebuildRecovery.and.resolveTo({
          backupId: backupRef4242.backupId,
          backupSavedAt: 4242,
          completedAt: 5000,
        });
        opLogStoreSpy.loadImportBackup.and.resolveTo({
          state: {},
          ...backupRef4242,
        });

        await service.offerInterruptedRebuildRecovery();

        expect(snackServiceSpy.open).toHaveBeenCalledWith(
          jasmine.objectContaining({
            msg: T.F.SYNC.S.LOCAL_DATA_REPLACE_UNDO,
            actionStr: T.G.UNDO,
            config: { duration: 0 },
          }),
        );

        const recoverySnack = snackServiceSpy.open.calls.mostRecent().args[0];
        if (typeof recoverySnack === 'string' || recoverySnack.dismissFn === undefined) {
          throw new Error('Expected durable recovery dismissal callback');
        }
        await recoverySnack.dismissFn();
        expect(opLogStoreSpy.retireCompletedRawRebuildRecovery).toHaveBeenCalledWith(
          backupRef4242.backupId,
        );

        // A later startup sees no marker and does not resurrect dismissed Undo.
        snackServiceSpy.open.calls.reset();
        opLogStoreSpy.loadRawRebuildRecovery.and.resolveTo(null);
        await service.offerInterruptedRebuildRecovery();
        expect(snackServiceSpy.open).not.toHaveBeenCalled();
      });

      it('should not offer an incomplete rebuild backup whose identity no longer matches', async () => {
        opLogStoreSpy.loadRawRebuildIncomplete.and.resolveTo({
          incomplete: true,
          startedAt: 1,
          preservedLocalOps: [],
          backupRef: backupRef4242,
        });
        opLogStoreSpy.loadImportBackup.and.resolveTo({
          state: {},
          backupId: 'replacement-backup',
          savedAt: 4242,
        });

        await service.offerInterruptedRebuildRecovery();

        expect(snackServiceSpy.open).not.toHaveBeenCalled();
      });

      it('should discard a completed recovery token when the backup slot was superseded', async () => {
        opLogStoreSpy.isRawRebuildIncomplete.and.resolveTo(false);
        opLogStoreSpy.loadRawRebuildRecovery.and.resolveTo({
          backupId: backupRef4242.backupId,
          backupSavedAt: 4242,
          completedAt: 5000,
        });
        opLogStoreSpy.loadImportBackup.and.resolveTo({
          state: {},
          backupId: 'replacement-backup',
          savedAt: 9999,
        });

        await service.offerInterruptedRebuildRecovery();

        expect(opLogStoreSpy.clearRawRebuildRecovery).toHaveBeenCalledWith(
          backupRef4242.backupId,
        );
        expect(snackServiceSpy.open).not.toHaveBeenCalled();
      });

      it('should not respawn the recovery snack while one is already showing', async () => {
        opLogStoreSpy.isRawRebuildIncomplete.and.resolveTo(true);
        spyOn(service, 'forceDownloadRemoteState').and.rejectWith(
          new Error('USE_REMOTE aborted: remote returned no data to rebuild from.'),
        );
        opLogStoreSpy.loadImportBackup.and.resolveTo({
          state: {},
          ...backupRef4242,
        });
        // A persistent recovery snack from a previous resume attempt is still up.
        snackServiceSpy.hasPendingPersistentAction.and.returnValue(true);
        const mockProvider = { isReady: () => Promise.resolve(true) } as any;

        await expectAsync(service.downloadRemoteOps(mockProvider)).toBeRejected();

        expect(opLogStoreSpy.loadImportBackup).not.toHaveBeenCalled();
        expect(snackServiceSpy.open).not.toHaveBeenCalled();
      });

      it('should return localWinOpsCreated: 0 and newOpsCount: 0 when no new ops', async () => {
        downloadServiceSpy.downloadRemoteOps.and.returnValue(
          Promise.resolve({
            newOps: [],
            hasMore: false,
            latestSeq: 0,
            needsFullStateUpload: false,
            success: true,
            providerMode: 'superSyncOps',
            failedFileCount: 0,
          }),
        );

        const mockProvider = {
          isReady: () => Promise.resolve(true),
        } as any;

        const result = await service.downloadRemoteOps(mockProvider);

        expect(result.kind).toBe('no_new_ops');
      });

      it('should return localWinOpsCreated count and newOpsCount from processing remote ops', async () => {
        opLogStoreSpy.getUnsynced.and.returnValue(Promise.resolve([]));

        const remoteOp: Operation = {
          id: 'remote-1',
          clientId: 'client-B',
          actionType: 'test' as ActionType,
          opType: OpType.Update,
          entityType: 'TASK',
          entityId: 'task-1',
          payload: { title: 'Remote Title' },
          vectorClock: { clientB: 1 },
          timestamp: Date.now(),
          schemaVersion: 1,
        };

        downloadServiceSpy.downloadRemoteOps.and.returnValue(
          Promise.resolve({
            newOps: [remoteOp],
            hasMore: false,
            latestSeq: 1,
            needsFullStateUpload: false,
            success: true,
            providerMode: 'superSyncOps',
            failedFileCount: 0,
          }),
        );

        // Mock remoteOpsProcessingService to return 1 local-win op
        remoteOpsProcessingServiceSpy.processRemoteOps.and.resolveTo({
          localWinOpsCreated: 1,
          allOpsFilteredBySyncImport: false,
          filteredOpCount: 0,
          isLocalUnsyncedImport: false,
          blockedByIncompatibleOp: false,
        });

        const mockProvider = {
          isReady: () => Promise.resolve(true),
        } as any;

        const result = await service.downloadRemoteOps(mockProvider);

        expect(result.kind).toBe('ops_processed');
        if (result.kind === 'ops_processed') {
          expect(result.localWinOpsCreated).toBe(1);
          expect(result.newOpsCount).toBe(1);
        }
      });

      it('should preserve repair context and the final conflict guard together', async () => {
        const remoteOp = {
          id: 'remote-for-repair',
          clientId: 'client-B',
          actionType: 'test' as ActionType,
          opType: OpType.Update,
          entityType: 'TASK' as const,
          entityId: 'task-1',
          payload: {},
          vectorClock: { clientB: 1 },
          timestamp: Date.now(),
          schemaVersion: 1,
        };
        downloadServiceSpy.downloadRemoteOps.and.resolveTo({
          newOps: [remoteOp],
          latestServerSeq: 17,
          needsFullStateUpload: false,
          success: true,
          providerMode: 'superSyncOps',
          failedFileCount: 0,
        });
        const repairContext = TestBed.inject(RepairSyncContextService);
        let observedBaseServerSeq: number | undefined;
        remoteOpsProcessingServiceSpy.processRemoteOps.and.callFake(async () => {
          observedBaseServerSeq = repairContext.baseServerSeq;
          return {
            localWinOpsCreated: 0,
            allOpsFilteredBySyncImport: false,
            filteredOpCount: 0,
            isLocalUnsyncedImport: false,
            blockedByIncompatibleOp: false,
          };
        });

        await service.downloadRemoteOps(
          {
            isReady: async () => true,
            setLastServerSeq: async () => undefined,
          } as any,
          { ignoredLocalFullStateOpIds: ['stale-repair'] },
        );

        expect(observedBaseServerSeq).toBe(17);
        expect(repairContext.baseServerSeq).toBeUndefined();
        expect(remoteOpsProcessingServiceSpy.processRemoteOps).toHaveBeenCalledWith(
          [remoteOp],
          jasmine.objectContaining({
            ignoredLocalFullStateOpIds: ['stale-repair'],
            beforeFullStateApply: jasmine.any(Function),
          }),
        );
      });

      it('should NOT advance lastServerSeq when processing blocked at an incompatible op', async () => {
        const remoteOp: Operation = {
          id: 'op-future',
          clientId: 'client-B',
          actionType: 'test' as ActionType,
          opType: OpType.Update,
          entityType: 'TASK',
          entityId: 'task-1',
          payload: {},
          vectorClock: { clientB: 1 },
          timestamp: Date.now(),
          schemaVersion: 99,
        };

        downloadServiceSpy.downloadRemoteOps.and.returnValue(
          Promise.resolve({
            newOps: [remoteOp],
            hasMore: false,
            latestSeq: 5,
            latestServerSeq: 5,
            needsFullStateUpload: false,
            success: true,
            providerMode: 'superSyncOps',
            failedFileCount: 0,
          }),
        );

        remoteOpsProcessingServiceSpy.processRemoteOps.and.resolveTo({
          localWinOpsCreated: 0,
          allOpsFilteredBySyncImport: false,
          filteredOpCount: 0,
          isLocalUnsyncedImport: false,
          blockedByIncompatibleOp: true,
        });

        const setLastServerSeqSpy = jasmine.createSpy('setLastServerSeq').and.resolveTo();
        const mockProvider = {
          isReady: () => Promise.resolve(true),
          setLastServerSeq: setLastServerSeqSpy,
        } as any;

        const result = await service.downloadRemoteOps(mockProvider);

        // Cursor stays behind the blocked op so it is re-downloaded and retried
        // after an app update instead of skipped forever.
        expect(result.kind).toBe('blocked_incompatible');
        expect(setLastServerSeqSpy).not.toHaveBeenCalled();
      });

      it('should return localWinOpsCreated: 0 and newOpsCount: 0 on server migration', async () => {
        downloadServiceSpy.downloadRemoteOps.and.returnValue(
          Promise.resolve({
            newOps: [],
            hasMore: false,
            latestSeq: 0,
            needsFullStateUpload: true, // Server migration
            success: true,
            providerMode: 'superSyncOps',
            failedFileCount: 0,
          }),
        );

        // serverMigrationServiceSpy.handleServerMigration is already mocked in beforeEach

        const mockProvider = {
          isReady: () => Promise.resolve(true),
        } as any;

        const result = await service.downloadRemoteOps(mockProvider);

        expect(result.kind).toBe('server_migration_handled');
      });

      describe('lastServerSeq persistence', () => {
        it('should persist lastServerSeq AFTER processing ops (crash safety)', async () => {
          opLogStoreSpy.getUnsynced.and.returnValue(Promise.resolve([]));

          const remoteOp: Operation = {
            id: 'remote-1',
            clientId: 'client-B',
            actionType: 'test' as ActionType,
            opType: OpType.Update,
            entityType: 'TASK',
            entityId: 'task-1',
            payload: { title: 'Remote Title' },
            vectorClock: { clientB: 1 },
            timestamp: Date.now(),
            schemaVersion: 1,
          };

          downloadServiceSpy.downloadRemoteOps.and.returnValue(
            Promise.resolve({
              newOps: [remoteOp],
              hasMore: false,
              latestSeq: 1,
              needsFullStateUpload: false,
              success: true,
              providerMode: 'superSyncOps',
              failedFileCount: 0,
              latestServerSeq: 42, // Server sequence to persist
            }),
          );

          // Track call order to verify setLastServerSeq is called AFTER processRemoteOps
          const callOrder: string[] = [];
          remoteOpsProcessingServiceSpy.processRemoteOps.and.callFake(async () => {
            callOrder.push('processRemoteOps');
            return {
              localWinOpsCreated: 0,
              allOpsFilteredBySyncImport: false,
              filteredOpCount: 0,
              isLocalUnsyncedImport: false,
              blockedByIncompatibleOp: false,
            };
          });

          const setLastServerSeqSpy = jasmine
            .createSpy('setLastServerSeq')
            .and.callFake(async () => {
              callOrder.push('setLastServerSeq');
            });

          const mockProvider = {
            isReady: () => Promise.resolve(true),
            supportsOperationSync: true,
            setLastServerSeq: setLastServerSeqSpy,
          } as any;

          await service.downloadRemoteOps(mockProvider);

          // Verify setLastServerSeq was called with correct value
          expect(setLastServerSeqSpy).toHaveBeenCalledWith(42);
          // Verify order: processRemoteOps must complete BEFORE setLastServerSeq
          expect(callOrder).toEqual(['processRemoteOps', 'setLastServerSeq']);
        });

        it('should persist lastServerSeq even when no ops (to stay in sync with server)', async () => {
          downloadServiceSpy.downloadRemoteOps.and.returnValue(
            Promise.resolve({
              newOps: [],
              hasMore: false,
              latestSeq: 0,
              needsFullStateUpload: false,
              success: true,
              providerMode: 'superSyncOps',
              failedFileCount: 0,
              latestServerSeq: 100, // Server is at seq 100 but no new ops for us
            }),
          );

          const setLastServerSeqSpy = jasmine
            .createSpy('setLastServerSeq')
            .and.resolveTo();

          const mockProvider = {
            isReady: () => Promise.resolve(true),
            supportsOperationSync: true,
            setLastServerSeq: setLastServerSeqSpy,
          } as any;

          await service.downloadRemoteOps(mockProvider);

          // Should still update lastServerSeq to stay in sync with server
          expect(setLastServerSeqSpy).toHaveBeenCalledWith(100);
        });

        it('should not call setLastServerSeq if latestServerSeq is undefined', async () => {
          downloadServiceSpy.downloadRemoteOps.and.returnValue(
            Promise.resolve({
              newOps: [],
              hasMore: false,
              latestSeq: 0,
              needsFullStateUpload: false,
              success: true,
              providerMode: 'superSyncOps',
              failedFileCount: 0,
              // latestServerSeq not set
            }),
          );

          const setLastServerSeqSpy = jasmine
            .createSpy('setLastServerSeq')
            .and.resolveTo();

          const mockProvider = {
            isReady: () => Promise.resolve(true),
            supportsOperationSync: true,
            setLastServerSeq: setLastServerSeqSpy,
          } as any;

          await service.downloadRemoteOps(mockProvider);

          // Should NOT call setLastServerSeq when latestServerSeq is undefined
          expect(setLastServerSeqSpy).not.toHaveBeenCalled();
        });

        it('should not call setLastServerSeq if provider does not support operation sync', async () => {
          downloadServiceSpy.downloadRemoteOps.and.returnValue(
            Promise.resolve({
              newOps: [],
              hasMore: false,
              latestSeq: 0,
              needsFullStateUpload: false,
              success: true,
              providerMode: 'superSyncOps',
              failedFileCount: 0,
              latestServerSeq: 100,
            }),
          );

          const setLastServerSeqSpy = jasmine
            .createSpy('setLastServerSeq')
            .and.resolveTo();
          const mockProvider = {
            isReady: () => Promise.resolve(true),
            setLastServerSeq: setLastServerSeqSpy,
            // Operation-sync marker fields NOT set - but method still called since provider passed
          } as any;

          // Should not throw even though provider doesn't have operation-sync marker fields
          await expectAsync(service.downloadRemoteOps(mockProvider)).toBeResolved();

          // setLastServerSeq should still be called when latestServerSeq is present
          expect(setLastServerSeqSpy).toHaveBeenCalledWith(100);
        });
      });

      describe('LocalDataConflictError for file-based sync', () => {
        it('should abort snapshot hydration when a local op becomes durable after conflict detection', async () => {
          const lateLocalEntry: OperationLogEntry = {
            seq: 2,
            op: {
              id: 'late-local-op',
              clientId: 'client-A',
              actionType: ActionType.TASK_SHARED_UPDATE,
              opType: OpType.Update,
              entityType: 'TASK',
              entityId: 'task-late',
              payload: { task: { id: 'task-late', changes: { title: 'Keep me' } } },
              vectorClock: { clientA: 2 },
              timestamp: 2,
              schemaVersion: 1,
            },
            appliedAt: 2,
            source: 'local',
          };
          opLogStoreSpy.getUnsynced.and.returnValues(
            Promise.resolve([]),
            Promise.resolve([lateLocalEntry]),
          );
          downloadServiceSpy.downloadRemoteOps.and.resolveTo({
            newOps: [],
            needsFullStateUpload: false,
            success: true,
            providerMode: 'fileSnapshotOps',
            failedFileCount: 0,
            snapshotState: { task: { ids: ['remote-task'] } },
            snapshotVectorClock: { clientB: 5 },
            latestServerSeq: 1,
          });
          const syncHydrationServiceSpy = TestBed.inject(
            SyncHydrationService,
          ) as jasmine.SpyObj<SyncHydrationService>;
          const mockProvider = {
            supportsOperationSync: true,
            setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
          } as unknown as OperationSyncCapable;

          await expectAsync(
            service.downloadRemoteOps(mockProvider),
          ).toBeRejectedWithError(LocalDataConflictError);

          expect(syncHydrationServiceSpy.hydrateFromRemoteSync).not.toHaveBeenCalled();
          expect(mockProvider.setLastServerSeq).not.toHaveBeenCalled();
        });

        it('should restore and persist a local action buffered during snapshot hydration', async () => {
          clearDeferredActions();
          const localAction: PersistentAction = {
            type: ActionType.TASK_SHARED_UPDATE,
            task: { id: 'task-local', changes: { title: 'Keep me' } },
            meta: {
              isPersistent: true,
              entityType: 'TASK',
              entityId: 'task-local',
              opType: OpType.Update,
            },
          };
          const actionAfterStateLoad: PersistentAction = {
            ...localAction,
            task: { id: 'task-after-load', changes: { title: 'Already restored' } },
            meta: { ...localAction.meta, entityId: 'task-after-load' },
          };
          const persistedEntry: OperationLogEntry = {
            seq: 2,
            op: {
              id: 'buffered-local-op',
              clientId: 'client-A',
              actionType: ActionType.TASK_SHARED_UPDATE,
              opType: OpType.Update,
              entityType: 'TASK',
              entityId: 'task-local',
              payload: { task: localAction.task },
              vectorClock: { clientA: 2, clientB: 5 },
              timestamp: 2,
              schemaVersion: 1,
            },
            appliedAt: 2,
            source: 'local',
          };
          const persistedAfterLoadEntry: OperationLogEntry = {
            ...persistedEntry,
            seq: 3,
            op: {
              ...persistedEntry.op,
              id: 'after-load-local-op',
              entityId: 'task-after-load',
              payload: { task: actionAfterStateLoad.task },
              vectorClock: { clientA: 3, clientB: 5 },
              timestamp: 3,
            },
            appliedAt: 3,
          };
          opLogStoreSpy.getUnsynced.and.returnValues(
            Promise.resolve([]),
            Promise.resolve([]),
            Promise.resolve([persistedEntry, persistedAfterLoadEntry]),
            Promise.resolve([persistedEntry, persistedAfterLoadEntry]),
          );
          downloadServiceSpy.downloadRemoteOps.and.resolveTo({
            newOps: [],
            needsFullStateUpload: false,
            success: true,
            providerMode: 'fileSnapshotOps',
            failedFileCount: 0,
            snapshotState: { task: { ids: ['remote-task'] } },
            snapshotVectorClock: { clientB: 5 },
            latestServerSeq: 1,
          });
          const syncHydrationServiceSpy = TestBed.inject(
            SyncHydrationService,
          ) as jasmine.SpyObj<SyncHydrationService>;
          syncHydrationServiceSpy.hydrateFromRemoteSync.and.callFake(
            async (_state, _clock, _createImport, _reason, hooks) => {
              bufferDeferredAction(localAction);
              hooks?.afterArchiveReplacement?.();
              hooks?.beforeStateLoad?.();
              bufferDeferredAction(actionAfterStateLoad);
              hooks?.afterStateLoad?.();
            },
          );
          operationApplierSpy.applyOperations.and.resolveTo({
            appliedOps: [persistedEntry.op, persistedAfterLoadEntry.op],
          });
          const mockStore = TestBed.inject(MockStore);
          const dispatchSpy = spyOn(mockStore, 'dispatch').and.callThrough();
          const durabilityOrder: string[] = [];
          operationLogEffectsSpy.processDeferredActions.and.callFake(async () => {
            if (
              getDeferredActions().includes(localAction) &&
              !durabilityOrder.includes('persist')
            ) {
              const wasAlreadyReplayed = dispatchSpy.calls
                .allArgs()
                .some(([dispatched]) => {
                  const action = dispatched as unknown;
                  return (
                    typeof action === 'object' &&
                    action !== null &&
                    'type' in action &&
                    action.type === localAction.type &&
                    'meta' in action &&
                    typeof action.meta === 'object' &&
                    action.meta !== null &&
                    'isRemote' in action.meta &&
                    action.meta.isRemote === true
                  );
                });
              durabilityOrder.push(
                wasAlreadyReplayed ? 'replay-before-persist' : 'persist',
              );
            }
            for (const action of getDeferredActions()) {
              acknowledgeDeferredAction(action);
            }
          });
          const mockProvider = {
            supportsOperationSync: true,
            setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
          } as unknown as OperationSyncCapable;

          try {
            await service.downloadRemoteOps(mockProvider);

            expect(hydrationStateServiceSpy.startApplyingRemoteOps).toHaveBeenCalledTimes(
              1,
            );
            expect(hydrationStateServiceSpy.endApplyingRemoteOps).toHaveBeenCalledTimes(
              1,
            );
            expect(dispatchSpy).toHaveBeenCalledWith(
              jasmine.objectContaining({
                type: localAction.type,
                meta: jasmine.objectContaining({ isRemote: true }),
              }),
            );
            const remotelyReplayedTaskIds = dispatchSpy.calls
              .allArgs()
              .map(([action]) => action as unknown)
              .filter(
                (
                  action,
                ): action is {
                  task?: { id?: string };
                  meta?: { isRemote?: boolean };
                } => typeof action === 'object' && action !== null,
              )
              .filter((action) => action.meta?.isRemote)
              .map((action) => action.task?.id);
            expect(remotelyReplayedTaskIds).toContain('task-local');
            expect(remotelyReplayedTaskIds).not.toContain('task-after-load');
            expect(durabilityOrder).toEqual(['persist']);
            expect(operationLogEffectsSpy.processDeferredActions.calls.allArgs()).toEqual(
              [
                [{ callerHoldsOperationLogLock: false }],
                [{ callerHoldsOperationLogLock: true }],
              ],
            );
            expect(operationApplierSpy.applyOperations).toHaveBeenCalledOnceWith(
              [persistedEntry.op, persistedAfterLoadEntry.op],
              {
                isLocalHydration: false,
                skipDeferredLocalActions: true,
                skipReducerDispatch: true,
                remoteApplyWindowAlreadyOpen: true,
              },
            );
            expect(mockProvider.setLastServerSeq).toHaveBeenCalledOnceWith(1);
          } finally {
            clearDeferredActions();
          }
        });

        it('should persist and restore an action that arrives during the final deferred drain', async () => {
          clearDeferredActions();
          const lateAction: PersistentAction = {
            type: ActionType.TASK_SHARED_UPDATE,
            task: { id: 'task-late', changes: { title: 'Keep me too' } },
            meta: {
              isPersistent: true,
              entityType: 'TASK',
              entityId: 'task-late',
              opType: OpType.Update,
            },
          };
          const lateEntry: OperationLogEntry = {
            seq: 2,
            op: {
              id: 'late-during-final-drain',
              clientId: 'client-A',
              actionType: ActionType.TASK_SHARED_UPDATE,
              opType: OpType.Update,
              entityType: 'TASK',
              entityId: 'task-late',
              payload: { task: lateAction.task },
              vectorClock: { clientA: 2, clientB: 5 },
              timestamp: 2,
              schemaVersion: 1,
            },
            appliedAt: 2,
            source: 'local',
          };
          let hydrationFinished = false;
          let lateActionPersisted = false;
          opLogStoreSpy.getUnsynced.and.callFake(async () =>
            hydrationFinished && lateActionPersisted ? [lateEntry] : [],
          );
          downloadServiceSpy.downloadRemoteOps.and.resolveTo({
            newOps: [],
            needsFullStateUpload: false,
            success: true,
            providerMode: 'fileSnapshotOps',
            failedFileCount: 0,
            snapshotState: { task: { ids: ['remote-task'] } },
            snapshotVectorClock: { clientB: 5 },
            latestServerSeq: 1,
          });
          const syncHydrationServiceSpy = TestBed.inject(
            SyncHydrationService,
          ) as jasmine.SpyObj<SyncHydrationService>;
          syncHydrationServiceSpy.hydrateFromRemoteSync.and.callFake(
            async (_state, _clock, _createImport, _reason, hooks) => {
              hooks?.afterArchiveReplacement?.();
              hooks?.beforeStateLoad?.();
              hooks?.afterStateLoad?.();
              hydrationFinished = true;
            },
          );
          const callOrder: string[] = [];
          let heldLockDrainCount = 0;
          operationLogEffectsSpy.processDeferredActions.and.callFake(async (options) => {
            if (!options?.callerHoldsOperationLogLock) return;

            heldLockDrainCount++;
            if (heldLockDrainCount === 1) {
              // processDeferredActions snapshots the queue before awaiting its
              // writes. This action therefore belongs to the next drain.
              bufferDeferredAction(lateAction);
              callOrder.push('late-action-buffered');
              return;
            }

            lateActionPersisted = true;
            acknowledgeDeferredAction(lateAction);
            callOrder.push('late-action-persisted');
          });
          operationApplierSpy.applyOperations.and.callFake(async (ops) => {
            callOrder.push('late-archive-restored');
            return { appliedOps: ops };
          });
          hydrationStateServiceSpy.endApplyingRemoteOps.and.callFake(() => {
            callOrder.push('remote-window-closed');
          });
          const mockProvider = {
            supportsOperationSync: true,
            setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
          } as unknown as OperationSyncCapable;

          try {
            await service.downloadRemoteOps(mockProvider);

            expect(heldLockDrainCount).toBe(2);
            expect(getDeferredActions()).not.toContain(lateAction);
            expect(operationApplierSpy.applyOperations).toHaveBeenCalledOnceWith(
              [lateEntry.op],
              {
                isLocalHydration: false,
                skipDeferredLocalActions: true,
                skipReducerDispatch: true,
                remoteApplyWindowAlreadyOpen: true,
              },
            );
            expect(callOrder).toEqual([
              'late-action-buffered',
              'late-action-persisted',
              'late-archive-restored',
              'remote-window-closed',
            ]);
          } finally {
            clearDeferredActions();
          }
        });

        it('should commit snapshot-included remote ops BEFORE persisting deferred local intents', async () => {
          clearDeferredActions();
          const snapshotIncludedOp: Operation = {
            id: 'snap-op-1',
            clientId: 'client-B',
            actionType: ActionType.TASK_SHARED_UPDATE,
            opType: OpType.Update,
            entityType: 'TASK',
            entityId: 'task-x',
            payload: { task: { id: 'task-x', changes: {} } },
            vectorClock: { clientB: 4 },
            timestamp: 1,
            schemaVersion: 1,
          };
          opLogStoreSpy.getUnsynced.and.returnValues(
            Promise.resolve([]),
            Promise.resolve([]),
            Promise.resolve([]),
          );
          downloadServiceSpy.downloadRemoteOps.and.resolveTo({
            newOps: [snapshotIncludedOp],
            needsFullStateUpload: false,
            success: true,
            providerMode: 'fileSnapshotOps',
            failedFileCount: 0,
            snapshotState: { task: { ids: ['remote-task'] } },
            snapshotVectorClock: { clientB: 5 },
            snapshotAppliedOpIds: ['snap-op-1'],
            latestServerSeq: 1,
          });
          const callOrder: string[] = [];
          const syncHydrationServiceSpy = TestBed.inject(
            SyncHydrationService,
          ) as jasmine.SpyObj<SyncHydrationService>;
          syncHydrationServiceSpy.hydrateFromRemoteSync.and.callFake(
            async (_state, _clock, _createImport, _reason, hooks) => {
              expect(hooks?.snapshotIncludedOps).toEqual([snapshotIncludedOp]);
              callOrder.push('commit-snapshot-baseline');
            },
          );
          operationLogEffectsSpy.processDeferredActions.and.callFake(
            async (options?: { callerHoldsOperationLogLock?: boolean }) => {
              if (options?.callerHoldsOperationLogLock) {
                callOrder.push('persist-deferred');
              }
            },
          );
          const mockProvider = {
            supportsOperationSync: true,
            setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
          } as unknown as OperationSyncCapable;

          await service.downloadRemoteOps(mockProvider);

          // Frontier ordering: getEntityFrontier() takes the LAST op per entity
          // in seq order, so the snapshot's (older) remote ops must land at
          // lower seqs than any local intents persisted during hydration —
          // otherwise the frontier regresses and a later concurrent remote op
          // is misclassified as non-conflicting.
          expect(callOrder[0]).toBe('commit-snapshot-baseline');
          expect(callOrder).toContain('persist-deferred');
          expect(callOrder.indexOf('commit-snapshot-baseline')).toBeLessThan(
            callOrder.indexOf('persist-deferred'),
          );
        });

        it('should persist deferred local intents against the old baseline when the atomic snapshot commit fails', async () => {
          clearDeferredActions();
          const localAction: PersistentAction = {
            type: ActionType.TASK_SHARED_UPDATE,
            task: { id: 'task-local', changes: { title: 'Keep me' } },
            meta: {
              isPersistent: true,
              entityType: 'TASK',
              entityId: 'task-local',
              opType: OpType.Update,
            },
          };
          const snapshotIncludedOp: Operation = {
            id: 'snap-op-append-failure',
            clientId: 'client-B',
            actionType: ActionType.TASK_SHARED_UPDATE,
            opType: OpType.Update,
            entityType: 'TASK',
            entityId: 'task-x',
            payload: { task: { id: 'task-x', changes: {} } },
            vectorClock: { clientB: 4 },
            timestamp: 1,
            schemaVersion: 1,
          };
          opLogStoreSpy.getUnsynced.and.returnValues(
            Promise.resolve([]),
            Promise.resolve([]),
          );
          downloadServiceSpy.downloadRemoteOps.and.resolveTo({
            newOps: [snapshotIncludedOp],
            needsFullStateUpload: false,
            success: true,
            providerMode: 'fileSnapshotOps',
            failedFileCount: 0,
            snapshotState: { task: { ids: ['remote-task'] } },
            snapshotVectorClock: { clientB: 5 },
            snapshotAppliedOpIds: [snapshotIncludedOp.id],
            latestServerSeq: 1,
          });
          const syncHydrationServiceSpy = TestBed.inject(
            SyncHydrationService,
          ) as jasmine.SpyObj<SyncHydrationService>;
          syncHydrationServiceSpy.hydrateFromRemoteSync.and.callFake(
            async (_state, _clock, _createImport, _reason, hooks) => {
              expect(hooks?.snapshotIncludedOps).toEqual([snapshotIncludedOp]);
              bufferDeferredAction(localAction);
              throw new Error('snapshot baseline write failed');
            },
          );
          const callOrder: string[] = [];
          hydrationStateServiceSpy.endApplyingRemoteOps.and.callFake(() => {
            callOrder.push('end-remote-window');
          });
          operationLogEffectsSpy.processDeferredActions.and.callFake(async (options) => {
            if (options?.callerHoldsOperationLogLock) {
              callOrder.push('persist-deferred');
              acknowledgeDeferredAction(localAction);
            }
          });
          const mockProvider = {
            supportsOperationSync: true,
            setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
          } as unknown as OperationSyncCapable;

          try {
            await expectAsync(
              service.downloadRemoteOps(mockProvider),
            ).toBeRejectedWithError('snapshot baseline write failed');

            expect(operationLogEffectsSpy.processDeferredActions.calls.allArgs()).toEqual(
              [
                [{ callerHoldsOperationLogLock: false }],
                [{ callerHoldsOperationLogLock: true }],
              ],
            );
            expect(callOrder).toEqual(['persist-deferred', 'end-remote-window']);
            expect(getDeferredActions()).not.toContain(localAction);
            expect(operationApplierSpy.applyOperations).not.toHaveBeenCalled();
            expect(mockProvider.setLastServerSeq).not.toHaveBeenCalled();
          } finally {
            clearDeferredActions();
          }
        });

        it('should append snapshot ops before recovery when persistence completes before state dispatch', async () => {
          clearDeferredActions();
          const localAction: PersistentAction = {
            type: ActionType.TASK_SHARED_UPDATE,
            task: { id: 'task-local', changes: { title: 'Keep me' } },
            meta: {
              isPersistent: true,
              entityType: 'TASK',
              entityId: 'task-local',
              opType: OpType.Update,
            },
          };
          const snapshotIncludedOp: Operation = {
            id: 'snap-op-persisted-before-dispatch-failure',
            clientId: 'client-B',
            actionType: ActionType.TASK_SHARED_UPDATE,
            opType: OpType.Update,
            entityType: 'TASK',
            entityId: 'task-x',
            payload: { task: { id: 'task-x', changes: {} } },
            vectorClock: { clientB: 4 },
            timestamp: 1,
            schemaVersion: 1,
          };
          const persistedEntry: OperationLogEntry = {
            seq: 2,
            op: {
              id: 'local-op-persisted-before-dispatch-failure',
              clientId: 'client-A',
              actionType: ActionType.TASK_SHARED_UPDATE,
              opType: OpType.Update,
              entityType: 'TASK',
              entityId: 'task-local',
              payload: { task: localAction.task },
              vectorClock: { clientA: 2, clientB: 5 },
              timestamp: 2,
              schemaVersion: 1,
            },
            appliedAt: 2,
            source: 'local',
          };
          opLogStoreSpy.getUnsynced.and.returnValues(
            Promise.resolve([]),
            Promise.resolve([]),
            Promise.resolve([persistedEntry]),
            Promise.resolve([persistedEntry]),
          );
          downloadServiceSpy.downloadRemoteOps.and.resolveTo({
            newOps: [snapshotIncludedOp],
            needsFullStateUpload: false,
            success: true,
            providerMode: 'fileSnapshotOps',
            failedFileCount: 0,
            snapshotState: { task: { ids: ['remote-task'] } },
            snapshotVectorClock: { clientB: 5 },
            snapshotAppliedOpIds: [snapshotIncludedOp.id],
            latestServerSeq: 1,
          });
          const callOrder: string[] = [];
          const syncHydrationServiceSpy = TestBed.inject(
            SyncHydrationService,
          ) as jasmine.SpyObj<SyncHydrationService>;
          syncHydrationServiceSpy.hydrateFromRemoteSync.and.callFake(
            async (_state, _clock, _createImport, _reason, hooks) => {
              bufferDeferredAction(localAction);
              callOrder.push('commit-snapshot-baseline');
              hooks?.afterArchiveReplacement?.();
              hooks?.afterSnapshotCachePersisted?.();
              hooks?.afterSnapshotPersisted?.();
              hooks?.beforeStateLoad?.();
              throw new Error('failed before state dispatch');
            },
          );
          operationLogEffectsSpy.processDeferredActions.and.callFake(async (options) => {
            if (options?.callerHoldsOperationLogLock) {
              callOrder.push('persist-deferred');
              acknowledgeDeferredAction(localAction);
            }
          });
          operationApplierSpy.applyOperations.and.resolveTo({
            appliedOps: [persistedEntry.op],
          });
          const dispatchSpy = spyOn(
            TestBed.inject(MockStore),
            'dispatch',
          ).and.callThrough();
          const mockProvider = {
            supportsOperationSync: true,
            setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
          } as unknown as OperationSyncCapable;

          try {
            await expectAsync(
              service.downloadRemoteOps(mockProvider),
            ).toBeRejectedWithError('failed before state dispatch');

            expect(callOrder[0]).toBe('commit-snapshot-baseline');
            expect(callOrder).toContain('persist-deferred');
            expect(dispatchSpy).not.toHaveBeenCalledWith(
              jasmine.objectContaining({
                type: localAction.type,
                meta: jasmine.objectContaining({ isRemote: true }),
              }),
            );
            expect(operationApplierSpy.applyOperations).toHaveBeenCalledWith(
              [persistedEntry.op],
              jasmine.objectContaining({ skipReducerDispatch: true }),
            );
            expect(mockProvider.setLastServerSeq).not.toHaveBeenCalled();
          } finally {
            clearDeferredActions();
          }
        });

        it('should persist deferred intents when a vector write aborts the atomic snapshot transaction', async () => {
          clearDeferredActions();
          const localAction: PersistentAction = {
            type: ActionType.TASK_SHARED_UPDATE,
            task: { id: 'task-local', changes: { title: 'Keep me' } },
            meta: {
              isPersistent: true,
              entityType: 'TASK',
              entityId: 'task-local',
              opType: OpType.Update,
            },
          };
          const snapshotIncludedOp: Operation = {
            id: 'snap-op-partial-persistence',
            clientId: 'client-B',
            actionType: ActionType.TASK_SHARED_UPDATE,
            opType: OpType.Update,
            entityType: 'TASK',
            entityId: 'task-x',
            payload: { task: { id: 'task-x', changes: {} } },
            vectorClock: { clientB: 4 },
            timestamp: 1,
            schemaVersion: 1,
          };
          opLogStoreSpy.getUnsynced.and.returnValues(
            Promise.resolve([]),
            Promise.resolve([]),
          );
          downloadServiceSpy.downloadRemoteOps.and.resolveTo({
            newOps: [snapshotIncludedOp],
            needsFullStateUpload: false,
            success: true,
            providerMode: 'fileSnapshotOps',
            failedFileCount: 0,
            snapshotState: { task: { ids: ['remote-task'] } },
            snapshotVectorClock: { clientB: 5 },
            snapshotAppliedOpIds: [snapshotIncludedOp.id],
            latestServerSeq: 1,
          });
          const syncHydrationServiceSpy = TestBed.inject(
            SyncHydrationService,
          ) as jasmine.SpyObj<SyncHydrationService>;
          syncHydrationServiceSpy.hydrateFromRemoteSync.and.callFake(
            async (_state, _clock, _createImport, _reason, hooks) => {
              expect(hooks?.snapshotIncludedOps).toEqual([snapshotIncludedOp]);
              bufferDeferredAction(localAction);
              throw new Error('atomic vector clock write failed');
            },
          );
          operationLogEffectsSpy.processDeferredActions.and.callFake(async (options) => {
            if (options?.callerHoldsOperationLogLock) {
              acknowledgeDeferredAction(localAction);
            }
          });
          const mockProvider = {
            supportsOperationSync: true,
            setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
          } as unknown as OperationSyncCapable;

          try {
            await expectAsync(
              service.downloadRemoteOps(mockProvider),
            ).toBeRejectedWithError('atomic vector clock write failed');

            expect(operationLogEffectsSpy.processDeferredActions.calls.allArgs()).toEqual(
              [
                [{ callerHoldsOperationLogLock: false }],
                [{ callerHoldsOperationLogLock: true }],
              ],
            );
            expect(operationApplierSpy.applyOperations).not.toHaveBeenCalled();
            expect(getDeferredActions()).not.toContain(localAction);
            expect(mockProvider.setLastServerSeq).not.toHaveBeenCalled();
          } finally {
            clearDeferredActions();
          }
        });

        it('should persist buffered local actions when snapshot hydration fails', async () => {
          clearDeferredActions();
          opLogStoreSpy.getUnsynced.and.returnValues(
            Promise.resolve([]),
            Promise.resolve([]),
          );
          downloadServiceSpy.downloadRemoteOps.and.resolveTo({
            newOps: [],
            needsFullStateUpload: false,
            success: true,
            providerMode: 'fileSnapshotOps',
            failedFileCount: 0,
            snapshotState: { task: { ids: ['remote-task'] } },
            snapshotVectorClock: { clientB: 5 },
            latestServerSeq: 1,
          });
          const syncHydrationServiceSpy = TestBed.inject(
            SyncHydrationService,
          ) as jasmine.SpyObj<SyncHydrationService>;
          syncHydrationServiceSpy.hydrateFromRemoteSync.and.rejectWith(
            new Error('hydration boom'),
          );
          const mockProvider = {
            supportsOperationSync: true,
            setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
          } as unknown as OperationSyncCapable;

          await expectAsync(
            service.downloadRemoteOps(mockProvider),
          ).toBeRejectedWithError('hydration boom');

          // The remote-apply window must be closed AND the deferred buffer
          // persisted: edits made during the failed hydration are applied to
          // live NgRx state but would otherwise be silently lost on app exit.
          expect(hydrationStateServiceSpy.endApplyingRemoteOps).toHaveBeenCalled();
          expect(operationLogEffectsSpy.processDeferredActions).toHaveBeenCalledWith({
            callerHoldsOperationLogLock: true,
          });
          expect(mockProvider.setLastServerSeq).not.toHaveBeenCalled();
        });

        it('should restore overwritten reducers and archives when hydration fails after state load', async () => {
          clearDeferredActions();
          const localAction: PersistentAction = {
            type: ActionType.TASK_SHARED_UPDATE,
            task: { id: 'task-local', changes: { title: 'Keep me' } },
            meta: {
              isPersistent: true,
              entityType: 'TASK',
              entityId: 'task-local',
              opType: OpType.Update,
            },
          };
          const persistedEntry: OperationLogEntry = {
            seq: 2,
            op: {
              id: 'buffered-local-op-after-failure',
              clientId: 'client-A',
              actionType: ActionType.TASK_SHARED_UPDATE,
              opType: OpType.Update,
              entityType: 'TASK',
              entityId: 'task-local',
              payload: { task: localAction.task },
              vectorClock: { clientA: 2, clientB: 5 },
              timestamp: 2,
              schemaVersion: 1,
            },
            appliedAt: 2,
            source: 'local',
          };
          opLogStoreSpy.getUnsynced.and.returnValues(
            Promise.resolve([]),
            Promise.resolve([]),
            Promise.resolve([persistedEntry]),
            Promise.resolve([persistedEntry]),
          );
          downloadServiceSpy.downloadRemoteOps.and.resolveTo({
            newOps: [],
            needsFullStateUpload: false,
            success: true,
            providerMode: 'fileSnapshotOps',
            failedFileCount: 0,
            snapshotState: { task: { ids: ['remote-task'] } },
            snapshotVectorClock: { clientB: 5 },
            latestServerSeq: 1,
          });
          const syncHydrationServiceSpy = TestBed.inject(
            SyncHydrationService,
          ) as jasmine.SpyObj<SyncHydrationService>;
          syncHydrationServiceSpy.hydrateFromRemoteSync.and.callFake(
            async (_state, _clock, _createImport, _reason, hooks) => {
              bufferDeferredAction(localAction);
              hooks?.afterArchiveReplacement?.();
              hooks?.beforeStateLoad?.();
              hooks?.afterStateLoad?.();
              throw new Error('state load failed');
            },
          );
          operationApplierSpy.applyOperations.and.resolveTo({
            appliedOps: [persistedEntry.op],
          });
          const dispatchSpy = spyOn(
            TestBed.inject(MockStore),
            'dispatch',
          ).and.callThrough();
          const mockProvider = {
            supportsOperationSync: true,
            setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
          } as unknown as OperationSyncCapable;

          try {
            await expectAsync(
              service.downloadRemoteOps(mockProvider),
            ).toBeRejectedWithError('state load failed');

            expect(dispatchSpy).toHaveBeenCalledWith(
              jasmine.objectContaining({
                type: localAction.type,
                meta: jasmine.objectContaining({ isRemote: true }),
              }),
            );
            expect(operationApplierSpy.applyOperations).toHaveBeenCalledWith(
              [persistedEntry.op],
              jasmine.objectContaining({
                skipReducerDispatch: true,
                skipDeferredLocalActions: true,
                remoteApplyWindowAlreadyOpen: true,
              }),
            );
            expect(mockProvider.setLastServerSeq).not.toHaveBeenCalled();
          } finally {
            clearDeferredActions();
          }
        });

        it('should restore archives without replaying reducers when state load does not commit', async () => {
          clearDeferredActions();
          const localAction: PersistentAction = {
            type: ActionType.TASK_SHARED_UPDATE,
            task: { id: 'task-local', changes: { title: 'Keep me' } },
            meta: {
              isPersistent: true,
              entityType: 'TASK',
              entityId: 'task-local',
              opType: OpType.Update,
            },
          };
          const persistedEntry: OperationLogEntry = {
            seq: 2,
            op: {
              id: 'buffered-local-op-after-archive-replacement',
              clientId: 'client-A',
              actionType: ActionType.TASK_SHARED_UPDATE,
              opType: OpType.Update,
              entityType: 'TASK',
              entityId: 'task-local',
              payload: { task: localAction.task },
              vectorClock: { clientA: 2, clientB: 5 },
              timestamp: 2,
              schemaVersion: 1,
            },
            appliedAt: 2,
            source: 'local',
          };
          opLogStoreSpy.getUnsynced.and.returnValues(
            Promise.resolve([]),
            Promise.resolve([]),
            Promise.resolve([persistedEntry]),
            Promise.resolve([persistedEntry]),
          );
          downloadServiceSpy.downloadRemoteOps.and.resolveTo({
            newOps: [],
            needsFullStateUpload: false,
            success: true,
            providerMode: 'fileSnapshotOps',
            failedFileCount: 0,
            snapshotState: { task: { ids: ['remote-task'] } },
            snapshotVectorClock: { clientB: 5 },
            latestServerSeq: 1,
          });
          const syncHydrationServiceSpy = TestBed.inject(
            SyncHydrationService,
          ) as jasmine.SpyObj<SyncHydrationService>;
          syncHydrationServiceSpy.hydrateFromRemoteSync.and.callFake(
            async (_state, _clock, _createImport, _reason, hooks) => {
              bufferDeferredAction(localAction);
              hooks?.afterArchiveReplacement?.();
              hooks?.beforeStateLoad?.();
              throw new Error('state load failed before commit');
            },
          );
          operationApplierSpy.applyOperations.and.resolveTo({
            appliedOps: [persistedEntry.op],
          });
          const dispatchSpy = spyOn(
            TestBed.inject(MockStore),
            'dispatch',
          ).and.callThrough();
          const mockProvider = {
            supportsOperationSync: true,
            setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
          } as unknown as OperationSyncCapable;

          try {
            await expectAsync(
              service.downloadRemoteOps(mockProvider),
            ).toBeRejectedWithError('state load failed before commit');

            expect(dispatchSpy).not.toHaveBeenCalledWith(
              jasmine.objectContaining({
                type: localAction.type,
                meta: jasmine.objectContaining({ isRemote: true }),
              }),
            );
            expect(operationApplierSpy.applyOperations).toHaveBeenCalledWith(
              [persistedEntry.op],
              jasmine.objectContaining({
                skipReducerDispatch: true,
                skipDeferredLocalActions: true,
                remoteApplyWindowAlreadyOpen: true,
              }),
            );
            expect(mockProvider.setLastServerSeq).not.toHaveBeenCalled();
          } finally {
            clearDeferredActions();
          }
        });

        it('should continue reducer and archive restoration after a transient deferred drain failure', async () => {
          clearDeferredActions();
          const localAction: PersistentAction = {
            type: ActionType.TASK_SHARED_UPDATE,
            task: { id: 'task-local', changes: { title: 'Keep me' } },
            meta: {
              isPersistent: true,
              entityType: 'TASK',
              entityId: 'task-local',
              opType: OpType.Update,
            },
          };
          const persistedEntry: OperationLogEntry = {
            seq: 2,
            op: {
              id: 'buffered-local-op-after-drain-retry',
              clientId: 'client-A',
              actionType: ActionType.TASK_SHARED_UPDATE,
              opType: OpType.Update,
              entityType: 'TASK',
              entityId: 'task-local',
              payload: { task: localAction.task },
              vectorClock: { clientA: 2, clientB: 5 },
              timestamp: 2,
              schemaVersion: 1,
            },
            appliedAt: 2,
            source: 'local',
          };
          opLogStoreSpy.getUnsynced.and.returnValues(
            Promise.resolve([]),
            Promise.resolve([]),
            Promise.resolve([persistedEntry]),
            Promise.resolve([persistedEntry]),
          );
          downloadServiceSpy.downloadRemoteOps.and.resolveTo({
            newOps: [],
            needsFullStateUpload: false,
            success: true,
            providerMode: 'fileSnapshotOps',
            failedFileCount: 0,
            snapshotState: { task: { ids: ['remote-task'] } },
            snapshotVectorClock: { clientB: 5 },
            latestServerSeq: 1,
          });
          const syncHydrationServiceSpy = TestBed.inject(
            SyncHydrationService,
          ) as jasmine.SpyObj<SyncHydrationService>;
          syncHydrationServiceSpy.hydrateFromRemoteSync.and.callFake(
            async (_state, _clock, _createImport, _reason, hooks) => {
              bufferDeferredAction(localAction);
              hooks?.afterArchiveReplacement?.();
              hooks?.beforeStateLoad?.();
              hooks?.afterStateLoad?.();
            },
          );
          let heldLockDrainCount = 0;
          operationLogEffectsSpy.processDeferredActions.and.callFake(async (options) => {
            if (options?.callerHoldsOperationLogLock) {
              heldLockDrainCount++;
              if (heldLockDrainCount === 1) {
                throw new Error('transient deferred drain failure');
              }
              for (const action of getDeferredActions()) {
                acknowledgeDeferredAction(action);
              }
            }
          });
          operationApplierSpy.applyOperations.and.resolveTo({
            appliedOps: [persistedEntry.op],
          });
          const dispatchSpy = spyOn(
            TestBed.inject(MockStore),
            'dispatch',
          ).and.callThrough();
          const mockProvider = {
            supportsOperationSync: true,
            setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
          } as unknown as OperationSyncCapable;

          try {
            await service.downloadRemoteOps(mockProvider);

            expect(heldLockDrainCount).toBe(2);
            expect(dispatchSpy).toHaveBeenCalledWith(
              jasmine.objectContaining({
                type: localAction.type,
                meta: jasmine.objectContaining({ isRemote: true }),
              }),
            );
            expect(operationApplierSpy.applyOperations).toHaveBeenCalledWith(
              [persistedEntry.op],
              jasmine.objectContaining({
                skipReducerDispatch: true,
                skipDeferredLocalActions: true,
                remoteApplyWindowAlreadyOpen: true,
              }),
            );
            expect(mockProvider.setLastServerSeq).toHaveBeenCalledOnceWith(1);
          } finally {
            clearDeferredActions();
          }
        });

        it('should NOT throw LocalDataConflictError on normal incremental sync (no snapshotState)', async () => {
          // This tests the regression fix: normal incremental syncs should NOT throw
          // LocalDataConflictError, even if the client has unsynced ops.
          // The conflict error should ONLY occur on first sync with snapshotState.

          const unsyncedEntry: OperationLogEntry = {
            seq: 1,
            op: {
              id: 'local-op-1',
              clientId: 'client-A',
              actionType: 'test' as ActionType,
              opType: OpType.Update,
              entityType: 'TASK',
              entityId: 'task-1',
              payload: { title: 'Local Title' },
              vectorClock: { clientA: 1 },
              timestamp: Date.now(),
              schemaVersion: 1,
            },
            appliedAt: Date.now(),
            source: 'local',
          };
          opLogStoreSpy.getUnsynced.and.returnValue(Promise.resolve([unsyncedEntry]));

          // Normal incremental sync: newOps but NO snapshotState
          const remoteOp: Operation = {
            id: 'remote-op-1',
            clientId: 'client-B',
            actionType: 'test' as ActionType,
            opType: OpType.Update,
            entityType: 'TASK',
            entityId: 'task-2',
            payload: { title: 'Remote Title' },
            vectorClock: { clientB: 1 },
            timestamp: Date.now(),
            schemaVersion: 1,
          };

          downloadServiceSpy.downloadRemoteOps.and.returnValue(
            Promise.resolve({
              newOps: [remoteOp],
              hasMore: false,
              latestSeq: 1,
              needsFullStateUpload: false,
              success: true,
              providerMode: 'superSyncOps',
              failedFileCount: 0,
              latestServerSeq: 5,
              // NO snapshotState - this is incremental sync
            }),
          );

          const mockProvider = {
            isReady: () => Promise.resolve(true),
            supportsOperationSync: true,
            setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
          } as any;

          // Should NOT throw - incremental sync should process ops normally
          await expectAsync(service.downloadRemoteOps(mockProvider)).toBeResolved();
          expect(remoteOpsProcessingServiceSpy.processRemoteOps).toHaveBeenCalledWith(
            [remoteOp],
            jasmine.objectContaining({
              beforeFullStateApply: jasmine.any(Function),
            }),
          );
        });

        it('should protect unsynced user config from file-snapshot replacement', async () => {
          const unsyncedEntry: OperationLogEntry = {
            seq: 1,
            op: {
              id: 'local-op-1',
              clientId: 'client-A',
              actionType: 'test' as ActionType,
              opType: OpType.Update,
              entityType: 'GLOBAL_CONFIG', // Not a user entity type
              entityId: 'config-1',
              payload: { theme: 'dark' },
              vectorClock: { clientA: 1 },
              timestamp: Date.now(),
              schemaVersion: 1,
            },
            appliedAt: Date.now(),
            source: 'local',
          };
          opLogStoreSpy.getUnsynced.and.returnValue(Promise.resolve([unsyncedEntry]));

          const syncHydrationServiceSpy = TestBed.inject(
            SyncHydrationService,
          ) as jasmine.SpyObj<SyncHydrationService>;
          syncHydrationServiceSpy.hydrateFromRemoteSync.and.resolveTo();

          downloadServiceSpy.downloadRemoteOps.and.returnValue(
            Promise.resolve({
              newOps: [],
              hasMore: false,
              latestSeq: 0,
              needsFullStateUpload: false,
              success: true,
              providerMode: 'fileSnapshotOps',
              failedFileCount: 0,
              snapshotState: { tasks: [{ id: 'remote-task' }] },
              snapshotVectorClock: { clientB: 5 },
              latestServerSeq: 1,
            }),
          );

          const mockProvider = {
            isReady: () => Promise.resolve(true),
            supportsOperationSync: true,
            setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
          } as any;

          await expectAsync(
            service.downloadRemoteOps(mockProvider),
          ).toBeRejectedWithError(LocalDataConflictError);
          expect(syncHydrationServiceSpy.hydrateFromRemoteSync).not.toHaveBeenCalled();
        });

        it('should throw LocalDataConflictError when only config ops but store has meaningful data (provider switch)', async () => {
          const unsyncedEntry: OperationLogEntry = {
            seq: 1,
            op: {
              id: 'config-op-1',
              clientId: 'client-A',
              actionType: '[Global Config] Update Global Config Section' as ActionType,
              opType: OpType.Update,
              entityType: 'GLOBAL_CONFIG',
              entityId: 'config-1',
              payload: { sectionKey: 'sync' },
              vectorClock: { clientA: 2 },
              timestamp: Date.now(),
              schemaVersion: 1,
            },
            appliedAt: Date.now(),
            source: 'local',
          };
          opLogStoreSpy.getUnsynced.and.returnValue(Promise.resolve([unsyncedEntry]));

          // Store has real user data (tasks from SuperSync)
          stateSnapshotServiceSpy.getStateSnapshot.and.returnValue({
            task: { ids: ['task-1', 'task-2'] },
            project: { ids: [INBOX_PROJECT.id] },
            tag: { ids: [TODAY_TAG.id] },
            note: { ids: [] },
          } as any);

          downloadServiceSpy.downloadRemoteOps.and.returnValue(
            Promise.resolve({
              newOps: [],
              hasMore: false,
              latestSeq: 0,
              needsFullStateUpload: false,
              success: true,
              providerMode: 'fileSnapshotOps',
              failedFileCount: 0,
              snapshotState: { tasks: [{ id: 'old-dropbox-task' }] },
              snapshotVectorClock: { clientB: 5 },
              latestServerSeq: 1,
            }),
          );

          const mockProvider = {
            isReady: () => Promise.resolve(true),
            supportsOperationSync: true,
            setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
          } as any;

          // Should throw - store has meaningful data even though pending ops are config-only
          await expectAsync(service.downloadRemoteOps(mockProvider)).toBeRejectedWith(
            jasmine.any(LocalDataConflictError),
          );
        });

        it('should throw LocalDataConflictError when client has meaningful user data (tasks)', async () => {
          // Client with task operations should see conflict dialog when receiving
          // snapshotState, to prevent losing user-created data.

          // Mock unsynced local ops with TASK entity type (user data)
          const unsyncedEntry: OperationLogEntry = {
            seq: 1,
            op: {
              id: 'local-op-1',
              clientId: 'client-A',
              actionType: 'test' as ActionType,
              opType: OpType.Create, // CREATE or UPDATE for TASK triggers conflict
              entityType: 'TASK',
              entityId: 'task-1',
              payload: { title: 'Local Title' },
              vectorClock: { clientA: 1 },
              timestamp: Date.now(),
              schemaVersion: 1,
            },
            appliedAt: Date.now(),
            source: 'local',
          };
          opLogStoreSpy.getUnsynced.and.returnValue(Promise.resolve([unsyncedEntry]));

          // Mock download service returning snapshotState (file-based sync scenario)
          downloadServiceSpy.downloadRemoteOps.and.returnValue(
            Promise.resolve({
              newOps: [],
              hasMore: false,
              latestSeq: 0,
              needsFullStateUpload: false,
              success: true,
              providerMode: 'fileSnapshotOps',
              failedFileCount: 0,
              snapshotState: { tasks: [{ id: 'remote-task' }] }, // Remote snapshot
              snapshotVectorClock: { clientB: 5 },
            }),
          );

          const mockProvider = {
            isReady: () => Promise.resolve(true),
            supportsOperationSync: true,
          } as any;

          // Should throw LocalDataConflictError
          await expectAsync(service.downloadRemoteOps(mockProvider)).toBeRejectedWith(
            jasmine.any(LocalDataConflictError),
          );
        });

        // #7985: a never-synced file-based client whose store + pending ops contain only
        // onboarding example tasks must not see the spurious conflict dialog.
        const exampleCreateEntry = (taskId: string): OperationLogEntry => ({
          seq: 1,
          op: {
            id: `ex-op-${taskId}`,
            clientId: 'client-A',
            actionType: ActionType.TASK_SHARED_ADD,
            opType: OpType.Create,
            entityType: 'TASK',
            entityId: taskId,
            payload: {
              actionPayload: { task: { id: taskId }, isExampleTask: true },
              entityChanges: [],
            },
            vectorClock: { clientA: 1 },
            timestamp: Date.now(),
            schemaVersion: 1,
          },
          appliedAt: Date.now(),
          source: 'local',
        });

        const fileSnapshotDownloadResult: DownloadResult = {
          newOps: [],
          needsFullStateUpload: false,
          success: true,
          providerMode: 'fileSnapshotOps',
          failedFileCount: 0,
          snapshotState: { tasks: [{ id: 'remote-task' }] },
          snapshotVectorClock: { clientB: 5 },
          latestServerSeq: 1,
        };

        it('silently adopts a file snapshot and rejects the never-synced provider setup op', async () => {
          const setupEntry = createProviderSetupEntry();
          opLogStoreSpy.hasSyncedOps.and.resolveTo(false);
          opLogStoreSpy.getUnsynced.and.resolveTo([setupEntry]);

          const syncHydrationServiceSpy = TestBed.inject(
            SyncHydrationService,
          ) as jasmine.SpyObj<SyncHydrationService>;
          syncHydrationServiceSpy.hydrateFromRemoteSync.and.resolveTo();
          downloadServiceSpy.downloadRemoteOps.and.resolveTo(fileSnapshotDownloadResult);

          const mockProvider = {
            isReady: () => Promise.resolve(true),
            supportsOperationSync: true,
            setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
          } as unknown as OperationSyncCapable;

          await expectAsync(
            service.downloadRemoteOps(mockProvider, { isNeverSynced: true }),
          ).toBeResolved();
          expect(syncHydrationServiceSpy.hydrateFromRemoteSync).toHaveBeenCalled();
          expect(opLogStoreSpy.markRejected).toHaveBeenCalledOnceWith([
            'sync-provider-setup',
          ]);
        });

        it('applies split-file operations newer than the downloaded snapshot before advancing the cursor', async () => {
          const snapshotIncludedOp: Operation = {
            id: 'snapshot-included-op',
            clientId: 'client-B',
            actionType: 'test' as ActionType,
            opType: OpType.Update,
            entityType: 'TASK',
            entityId: 'task-in-snapshot',
            payload: { title: 'Already in snapshot' },
            vectorClock: { clientB: 4 },
            timestamp: 4,
            schemaVersion: 1,
          };
          const postSnapshotOp: Operation = {
            id: 'post-snapshot-op',
            clientId: 'client-B',
            actionType: 'test' as ActionType,
            opType: OpType.Create,
            entityType: 'TASK',
            entityId: 'task-after-snapshot',
            payload: { title: 'Created after snapshot' },
            vectorClock: { clientB: 5 },
            timestamp: 5,
            schemaVersion: 1,
          };
          const syncHydrationServiceSpy = TestBed.inject(
            SyncHydrationService,
          ) as jasmine.SpyObj<SyncHydrationService>;
          syncHydrationServiceSpy.hydrateFromRemoteSync.and.resolveTo();
          downloadServiceSpy.downloadRemoteOps.and.resolveTo({
            newOps: [snapshotIncludedOp, postSnapshotOp],
            needsFullStateUpload: false,
            success: true,
            providerMode: 'fileSnapshotOps',
            failedFileCount: 0,
            snapshotState: { task: { ids: ['task-in-snapshot'] } },
            snapshotVectorClock: { clientB: 4 },
            snapshotAppliedOpIds: [snapshotIncludedOp.id],
            latestServerSeq: 5,
          } as unknown as DownloadResult);
          const callOrder: string[] = [];
          remoteOpsProcessingServiceSpy.processRemoteOps.and.callFake(async () => {
            callOrder.push('processRemoteOps');
            return {
              localWinOpsCreated: 0,
              allOpsFilteredBySyncImport: false,
              filteredOpCount: 0,
              isLocalUnsyncedImport: false,
              blockedByIncompatibleOp: false,
            };
          });
          const setLastServerSeqSpy = jasmine
            .createSpy('setLastServerSeq')
            .and.callFake(async () => {
              callOrder.push('setLastServerSeq');
            });
          const mockProvider = {
            supportsOperationSync: true,
            setLastServerSeq: setLastServerSeqSpy,
          } as unknown as OperationSyncCapable;

          await service.downloadRemoteOps(mockProvider);

          expect(
            syncHydrationServiceSpy.hydrateFromRemoteSync.calls.mostRecent().args[4]
              ?.snapshotIncludedOps,
          ).toEqual([snapshotIncludedOp]);
          expect(remoteOpsProcessingServiceSpy.processRemoteOps).toHaveBeenCalledOnceWith(
            [postSnapshotOp],
            {},
          );
          expect(callOrder).toEqual(['processRemoteOps', 'setLastServerSeq']);
        });

        it('retries only the remaining split suffix after an incompatible op blocks a hydrated batch', async () => {
          const op5: Operation = {
            id: 'post-snapshot-op-5',
            clientId: 'client-B',
            actionType: 'test' as ActionType,
            opType: OpType.Create,
            entityType: 'TASK',
            entityId: 'task-5',
            payload: {},
            vectorClock: { clientB: 5 },
            timestamp: 5,
            schemaVersion: 1,
          };
          const op6: Operation = {
            ...op5,
            id: 'post-snapshot-op-6',
            entityId: 'task-6',
            vectorClock: { clientB: 6 },
            timestamp: 6,
          };
          const snapshotResult = (newOps: Operation[]): DownloadResult =>
            ({
              newOps,
              needsFullStateUpload: false,
              success: true,
              providerMode: 'fileSnapshotOps',
              failedFileCount: 0,
              snapshotState: { task: { ids: ['snapshot-task'] } },
              snapshotVectorClock: { clientB: 4 },
              snapshotAppliedOpIds: [],
              latestServerSeq: 6,
            }) as DownloadResult;
          downloadServiceSpy.downloadRemoteOps.and.returnValues(
            Promise.resolve(snapshotResult([op5, op6])),
            Promise.resolve(snapshotResult([op6])),
          );
          opLogStoreSpy.getVectorClock.and.returnValues(
            Promise.resolve(null),
            Promise.resolve({ clientB: 5 }),
          );
          remoteOpsProcessingServiceSpy.processRemoteOps.and.returnValues(
            Promise.resolve({
              localWinOpsCreated: 0,
              allOpsFilteredBySyncImport: false,
              filteredOpCount: 0,
              isLocalUnsyncedImport: false,
              blockedByIncompatibleOp: true,
            }),
            Promise.resolve({
              localWinOpsCreated: 0,
              allOpsFilteredBySyncImport: false,
              filteredOpCount: 0,
              isLocalUnsyncedImport: false,
              blockedByIncompatibleOp: false,
            }),
          );
          const syncHydrationServiceSpy = TestBed.inject(
            SyncHydrationService,
          ) as jasmine.SpyObj<SyncHydrationService>;
          const setLastServerSeqSpy = jasmine
            .createSpy('setLastServerSeq')
            .and.resolveTo();
          const mockProvider = {
            supportsOperationSync: true,
            setLastServerSeq: setLastServerSeqSpy,
          } as unknown as OperationSyncCapable;

          const first = await service.downloadRemoteOps(mockProvider);
          const second = await service.downloadRemoteOps(mockProvider);

          expect(first.kind).toBe('blocked_incompatible');
          expect(second.kind).toBe('ops_processed');
          expect(syncHydrationServiceSpy.hydrateFromRemoteSync).toHaveBeenCalledTimes(1);
          expect(remoteOpsProcessingServiceSpy.processRemoteOps.calls.allArgs()).toEqual([
            [[op5, op6], {}],
            [[op6], {}],
          ]);
          expect(setLastServerSeqSpy).toHaveBeenCalledOnceWith(6);
        });

        it('does NOT throw LocalDataConflictError when store + pending ops contain only example tasks (#7985)', async () => {
          opLogStoreSpy.getUnsynced.and.returnValue(
            Promise.resolve([exampleCreateEntry('ex-task-1')]),
          );
          // Store holds ONLY that example task (the marker lives on the op, not the entity).
          stateSnapshotServiceSpy.getStateSnapshot.and.returnValue({
            task: { ids: ['ex-task-1'] },
            project: { ids: [INBOX_PROJECT.id] },
            tag: { ids: [TODAY_TAG.id] },
            note: { ids: [] },
          } as any);

          const syncHydrationServiceSpy = TestBed.inject(
            SyncHydrationService,
          ) as jasmine.SpyObj<SyncHydrationService>;
          syncHydrationServiceSpy.hydrateFromRemoteSync.and.resolveTo();

          downloadServiceSpy.downloadRemoteOps.and.returnValue(
            Promise.resolve(fileSnapshotDownloadResult),
          );

          const mockProvider = {
            isReady: () => Promise.resolve(true),
            supportsOperationSync: true,
            setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
          } as any;

          await expectAsync(service.downloadRemoteOps(mockProvider)).toBeResolved();
          expect(syncHydrationServiceSpy.hydrateFromRemoteSync).toHaveBeenCalled();
          expect(opLogStoreSpy.markRejected).toHaveBeenCalledWith(['ex-op-ex-task-1']);
          // markRejected must run AFTER hydrateFromRemoteSync — otherwise a
          // hydration failure would drop the example ops while leaving the
          // user without the remote snapshot.
          const hydrateOrder = (
            syncHydrationServiceSpy.hydrateFromRemoteSync.calls.mostRecent() as unknown as {
              invocationOrder: number;
            }
          ).invocationOrder;
          const markRejectedOrder = (
            opLogStoreSpy.markRejected.calls.mostRecent() as unknown as {
              invocationOrder: number;
            }
          ).invocationOrder;
          expect(markRejectedOrder).toBeGreaterThan(hydrateOrder);
        });

        it('does NOT call markRejected when hydrateFromRemoteSync rejects (#7985)', async () => {
          opLogStoreSpy.getUnsynced.and.returnValue(
            Promise.resolve([exampleCreateEntry('ex-task-1')]),
          );
          stateSnapshotServiceSpy.getStateSnapshot.and.returnValue({
            task: { ids: ['ex-task-1'] },
            project: { ids: [INBOX_PROJECT.id] },
            tag: { ids: [TODAY_TAG.id] },
            note: { ids: [] },
          } as any);

          const syncHydrationServiceSpy = TestBed.inject(
            SyncHydrationService,
          ) as jasmine.SpyObj<SyncHydrationService>;
          syncHydrationServiceSpy.hydrateFromRemoteSync.and.rejectWith(
            new Error('hydrate failed'),
          );

          downloadServiceSpy.downloadRemoteOps.and.returnValue(
            Promise.resolve(fileSnapshotDownloadResult),
          );

          const mockProvider = {
            isReady: () => Promise.resolve(true),
            supportsOperationSync: true,
            setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
          } as any;

          await expectAsync(service.downloadRemoteOps(mockProvider)).toBeRejected();
          expect(syncHydrationServiceSpy.hydrateFromRemoteSync).toHaveBeenCalled();
          expect(opLogStoreSpy.markRejected).not.toHaveBeenCalled();
        });

        it('still throws LocalDataConflictError when a real task exists alongside example tasks (#7985)', async () => {
          opLogStoreSpy.getUnsynced.and.returnValue(
            Promise.resolve([exampleCreateEntry('ex-task-1')]),
          );
          // Store has the example task AND a real one — the real task must still be protected.
          stateSnapshotServiceSpy.getStateSnapshot.and.returnValue({
            task: { ids: ['ex-task-1', 'real-task-1'] },
            project: { ids: [INBOX_PROJECT.id] },
            tag: { ids: [TODAY_TAG.id] },
            note: { ids: [] },
          } as any);

          downloadServiceSpy.downloadRemoteOps.and.returnValue(
            Promise.resolve(fileSnapshotDownloadResult),
          );

          const mockProvider = {
            isReady: () => Promise.resolve(true),
            supportsOperationSync: true,
            setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
          } as any;

          await expectAsync(service.downloadRemoteOps(mockProvider)).toBeRejectedWith(
            jasmine.any(LocalDataConflictError),
          );
        });

        it('should include correct context in LocalDataConflictError', async () => {
          const unsyncedEntries: OperationLogEntry[] = [
            {
              seq: 1,
              op: {
                id: 'local-op-1',
                clientId: 'client-A',
                actionType: 'test' as ActionType,
                opType: OpType.Update,
                entityType: 'TASK',
                entityId: 'task-1',
                payload: {},
                vectorClock: { clientA: 1 },
                timestamp: Date.now(),
                schemaVersion: 1,
              },
              appliedAt: Date.now(),
              source: 'local',
            },
            {
              seq: 2,
              op: {
                id: 'local-op-2',
                clientId: 'client-A',
                actionType: 'test' as ActionType,
                opType: OpType.Create,
                entityType: 'TASK',
                entityId: 'task-2',
                payload: {},
                vectorClock: { clientA: 2 },
                timestamp: Date.now(),
                schemaVersion: 1,
              },
              appliedAt: Date.now(),
              source: 'local',
            },
          ];
          opLogStoreSpy.getUnsynced.and.returnValue(Promise.resolve(unsyncedEntries));

          // Both ops are TASK entity type, so conflict dialog should appear

          const remoteSnapshot = { tasks: [{ id: 'remote-task' }] };
          const remoteVectorClock = { clientB: 5, clientC: 3 };
          const remoteLastModified = 1_720_000_000_000;

          downloadServiceSpy.downloadRemoteOps.and.returnValue(
            Promise.resolve({
              newOps: [],
              hasMore: false,
              latestSeq: 0,
              needsFullStateUpload: false,
              success: true,
              providerMode: 'fileSnapshotOps',
              failedFileCount: 0,
              snapshotState: remoteSnapshot,
              snapshotVectorClock: remoteVectorClock,
              remoteLastModified,
            }),
          );

          const mockProvider = {
            isReady: () => Promise.resolve(true),
            supportsOperationSync: true,
          } as any;

          try {
            await service.downloadRemoteOps(mockProvider);
            fail('Expected LocalDataConflictError to be thrown');
          } catch (error) {
            expect(error).toBeInstanceOf(LocalDataConflictError);
            const conflictError = error as LocalDataConflictError;
            expect(conflictError.unsyncedCount).toBe(2);
            expect(conflictError.remoteSnapshotState).toEqual(remoteSnapshot);
            expect(conflictError.remoteVectorClock).toEqual(remoteVectorClock);
            expect(conflictError.remoteLastModified).toBe(remoteLastModified);
          }
        });

        it('carries the last-synced vector clock (from snapshot) on the seq-0-download-with-local-ops path', async () => {
          const unsyncedEntries: OperationLogEntry[] = [
            {
              seq: 1,
              op: {
                id: 'local-op-1',
                clientId: 'client-A',
                actionType: 'test' as ActionType,
                opType: OpType.Update,
                entityType: 'TASK',
                entityId: 'task-1',
                payload: {},
                vectorClock: { clientA: 6 },
                timestamp: Date.now(),
                schemaVersion: 1,
              },
              appliedAt: Date.now(),
              source: 'local',
            },
          ];
          opLogStoreSpy.getUnsynced.and.returnValue(Promise.resolve(unsyncedEntries));

          // The snapshot's clock is the last-synced baseline this client had.
          const lastSyncedClock = { clientA: 3, clientB: 5 };
          const vectorClockService = TestBed.inject(
            VectorClockService,
          ) as jasmine.SpyObj<VectorClockService>;
          vectorClockService.getSnapshotVectorClock.and.resolveTo(lastSyncedClock);

          downloadServiceSpy.downloadRemoteOps.and.returnValue(
            Promise.resolve({
              newOps: [],
              hasMore: false,
              latestSeq: 0,
              needsFullStateUpload: false,
              success: true,
              providerMode: 'fileSnapshotOps',
              failedFileCount: 0,
              snapshotState: { tasks: [{ id: 'remote-task' }] },
              snapshotVectorClock: { clientB: 5 },
            }),
          );

          const mockProvider = {
            isReady: () => Promise.resolve(true),
            supportsOperationSync: true,
          } as any;

          try {
            await service.downloadRemoteOps(mockProvider);
            fail('Expected LocalDataConflictError to be thrown');
          } catch (error) {
            expect(error).toBeInstanceOf(LocalDataConflictError);
            const conflictError = error as LocalDataConflictError;
            expect(conflictError.lastSyncedVectorClock).toEqual(lastSyncedClock);
          }
        });

        it('should NOT throw LocalDataConflictError when client has no unsynced ops', async () => {
          // No unsynced ops
          opLogStoreSpy.getUnsynced.and.returnValue(Promise.resolve([]));

          const syncHydrationServiceSpy = TestBed.inject(
            SyncHydrationService,
          ) as jasmine.SpyObj<SyncHydrationService>;
          syncHydrationServiceSpy.hydrateFromRemoteSync.and.resolveTo();

          downloadServiceSpy.downloadRemoteOps.and.returnValue(
            Promise.resolve({
              newOps: [],
              hasMore: false,
              latestSeq: 0,
              needsFullStateUpload: false,
              success: true,
              providerMode: 'fileSnapshotOps',
              failedFileCount: 0,
              snapshotState: { tasks: [] },
              snapshotVectorClock: { clientB: 5 },
            }),
          );

          const mockProvider = {
            isReady: () => Promise.resolve(true),
            supportsOperationSync: true,
            setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
          } as any;

          // Should NOT throw - should hydrate from snapshot instead
          await expectAsync(service.downloadRemoteOps(mockProvider)).toBeResolved();
          expect(syncHydrationServiceSpy.hydrateFromRemoteSync).toHaveBeenCalled();
        });

        it('should skip hydration AND conflict when local clock dominates remote snapshot (issue #7339)', async () => {
          // Reproduces the iOS WebDAV loop: a foreign-written snapshot with the
          // same syncVersion fires gap detection on every sync from a client that
          // never uploaded its own snapshot. If our local clock already dominates
          // that snapshot's clock, hydration would discard local-only ops and a
          // conflict dialog has nothing to resolve.
          const unsyncedEntry: OperationLogEntry = {
            seq: 1,
            op: {
              id: 'local-op-1',
              clientId: 'iosClient',
              actionType: '[Global Config] Update Global Config Section' as ActionType,
              opType: OpType.Update,
              entityType: 'GLOBAL_CONFIG',
              entityId: 'config-1',
              payload: { sectionKey: 'sync' },
              vectorClock: { windowsClient: 1, iosClient: 5 },
              timestamp: Date.now(),
              schemaVersion: 1,
            },
            appliedAt: Date.now(),
            source: 'local',
          };
          opLogStoreSpy.getUnsynced.and.returnValue(Promise.resolve([unsyncedEntry]));

          // Store has real user data — without the dominate-check this would
          // trigger the conflict dialog every sync.
          stateSnapshotServiceSpy.getStateSnapshot.and.returnValue({
            task: { ids: ['task-1', 'task-2'] },
            project: { ids: [INBOX_PROJECT.id] },
            tag: { ids: [TODAY_TAG.id] },
            note: { ids: [] },
          } as any);

          // Local strictly dominates remote: local has both clients, remote only windowsClient.
          opLogStoreSpy.getVectorClock.and.resolveTo({ windowsClient: 1, iosClient: 5 });

          const syncHydrationServiceSpy = TestBed.inject(
            SyncHydrationService,
          ) as jasmine.SpyObj<SyncHydrationService>;
          syncHydrationServiceSpy.hydrateFromRemoteSync.and.resolveTo();

          downloadServiceSpy.downloadRemoteOps.and.returnValue(
            Promise.resolve({
              newOps: [],
              hasMore: false,
              latestSeq: 1,
              needsFullStateUpload: false,
              success: true,
              providerMode: 'fileSnapshotOps',
              failedFileCount: 0,
              snapshotState: { tasks: [{ id: 'old-windows-task' }] },
              snapshotVectorClock: { windowsClient: 1 },
              latestServerSeq: 1,
            }),
          );

          const setLastServerSeqSpy = jasmine
            .createSpy('setLastServerSeq')
            .and.resolveTo();
          const mockProvider = {
            isReady: () => Promise.resolve(true),
            supportsOperationSync: true,
            setLastServerSeq: setLastServerSeqSpy,
          } as any;

          const result = await service.downloadRemoteOps(mockProvider);

          // No conflict dialog, no hydration — local already has everything.
          expect(syncHydrationServiceSpy.hydrateFromRemoteSync).not.toHaveBeenCalled();
          expect(result.kind).toBe('no_new_ops');
          // lastServerSeq still advanced so future syncs use the right cursor.
          expect(setLastServerSeqSpy).toHaveBeenCalledWith(1);
        });

        it('should apply a split suffix before advancing when local dominates only the snapshot', async () => {
          const suffixOp: Operation = {
            id: 'post-snapshot-op',
            clientId: 'windowsClient',
            actionType: 'test' as ActionType,
            opType: OpType.Create,
            entityType: 'TASK',
            entityId: 'remote-new-task',
            payload: {},
            vectorClock: { windowsClient: 2 },
            timestamp: 2,
            schemaVersion: 1,
          };
          opLogStoreSpy.getVectorClock.and.resolveTo({
            windowsClient: 1,
            iosClient: 5,
          });
          downloadServiceSpy.downloadRemoteOps.and.resolveTo({
            newOps: [suffixOp],
            needsFullStateUpload: false,
            success: true,
            providerMode: 'fileSnapshotOps',
            failedFileCount: 0,
            snapshotState: { tasks: [{ id: 'snapshot-task' }] },
            snapshotVectorClock: { windowsClient: 1 },
            snapshotAppliedOpIds: [],
            latestServerSeq: 2,
          });
          remoteOpsProcessingServiceSpy.processRemoteOps.and.resolveTo({
            localWinOpsCreated: 2,
            allOpsFilteredBySyncImport: false,
            filteredOpCount: 0,
            isLocalUnsyncedImport: false,
            blockedByIncompatibleOp: false,
          });
          const syncHydrationServiceSpy = TestBed.inject(
            SyncHydrationService,
          ) as jasmine.SpyObj<SyncHydrationService>;
          const setLastServerSeqSpy = jasmine
            .createSpy('setLastServerSeq')
            .and.resolveTo();
          const mockProvider = {
            supportsOperationSync: true,
            setLastServerSeq: setLastServerSeqSpy,
          } as unknown as OperationSyncCapable;

          const result = await service.downloadRemoteOps(mockProvider);

          expect(result.kind).toBe('ops_processed');
          if (result.kind === 'ops_processed') {
            expect(result.localWinOpsCreated).toBe(2);
          }
          expect(syncHydrationServiceSpy.hydrateFromRemoteSync).not.toHaveBeenCalled();
          expect(remoteOpsProcessingServiceSpy.processRemoteOps).toHaveBeenCalledOnceWith(
            [suffixOp],
            {},
          );
          expect(setLastServerSeqSpy).toHaveBeenCalledOnceWith(2);
        });

        it('should NOT persist accompanying newOps on the dominate path — would corrupt per-entity frontiers (codex re-review)', async () => {
          // VectorClockService.getEntityFrontier() builds per-entity frontiers
          // by iterating the op log in seq order with last-write-wins semantics.
          // Appending historical remote ops at the current tail would regress
          // the frontier for any entity where local already has newer ops,
          // letting future remote ops be classified as non-conflicting and
          // silently overwrite local changes. The dominate path must therefore
          // skip the append; the trade-off is bounded re-download bandwidth
          // (those ops keep coming back in result.newOps each sync until the
          // file's snapshot advances), with no risk of state-level duplication
          // because the dominate path never replays ops to NgRx.
          const unsyncedEntry: OperationLogEntry = {
            seq: 1,
            op: {
              id: 'local-op-1',
              clientId: 'iosClient',
              actionType: '[Global Config] Update Global Config Section' as ActionType,
              opType: OpType.Update,
              entityType: 'GLOBAL_CONFIG',
              entityId: 'config-1',
              payload: { sectionKey: 'sync' },
              vectorClock: { windowsClient: 5, iosClient: 5 },
              timestamp: Date.now(),
              schemaVersion: 1,
            },
            appliedAt: Date.now(),
            source: 'local',
          };
          opLogStoreSpy.getUnsynced.and.returnValue(Promise.resolve([unsyncedEntry]));
          stateSnapshotServiceSpy.getStateSnapshot.and.returnValue({
            task: { ids: ['task-1'] },
            project: { ids: [INBOX_PROJECT.id] },
            tag: { ids: [TODAY_TAG.id] },
            note: { ids: [] },
          } as any);

          opLogStoreSpy.getVectorClock.and.resolveTo({ windowsClient: 5, iosClient: 5 });

          const remoteOps: Operation[] = [
            {
              id: 'remote-op-2',
              clientId: 'windowsClient',
              actionType: 'test' as ActionType,
              opType: OpType.Update,
              entityType: 'TASK',
              entityId: 'task-w-2',
              payload: {},
              vectorClock: { windowsClient: 2 },
              timestamp: Date.now(),
              schemaVersion: 1,
            },
            {
              id: 'remote-op-3',
              clientId: 'windowsClient',
              actionType: 'test' as ActionType,
              opType: OpType.Update,
              entityType: 'TASK',
              entityId: 'task-w-3',
              payload: {},
              vectorClock: { windowsClient: 3 },
              timestamp: Date.now(),
              schemaVersion: 1,
            },
          ];

          downloadServiceSpy.downloadRemoteOps.and.returnValue(
            Promise.resolve({
              newOps: remoteOps,
              hasMore: false,
              latestSeq: 5,
              needsFullStateUpload: false,
              success: true,
              providerMode: 'fileSnapshotOps',
              failedFileCount: 0,
              snapshotState: { tasks: [{ id: 'task-w-1' }] },
              snapshotVectorClock: { windowsClient: 5 },
              latestServerSeq: 5,
            }),
          );

          const mockProvider = {
            isReady: () => Promise.resolve(true),
            supportsOperationSync: true,
            setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
          } as any;

          const result = await service.downloadRemoteOps(mockProvider);

          expect(result.kind).toBe('no_new_ops');
          // CRITICAL: the dominate path must NOT append historical remote ops
          // at the current op-log tail; doing so regresses per-entity frontiers
          // and enables future LWW resolution to overwrite local data.
          expect(opLogStoreSpy.appendBatchSkipDuplicates).not.toHaveBeenCalled();
        });

        it('should still throw LocalDataConflictError when remote snapshot has work local does not (concurrent clocks)', async () => {
          // Sanity check that the dominate-check is conservative: only skips when
          // local truly has every entry of the remote snapshot.
          const unsyncedEntry: OperationLogEntry = {
            seq: 1,
            op: {
              id: 'local-op-1',
              clientId: 'client-A',
              actionType: 'test' as ActionType,
              opType: OpType.Update,
              entityType: 'TASK',
              entityId: 'task-1',
              payload: {},
              vectorClock: { clientA: 5 },
              timestamp: Date.now(),
              schemaVersion: 1,
            },
            appliedAt: Date.now(),
            source: 'local',
          };
          opLogStoreSpy.getUnsynced.and.returnValue(Promise.resolve([unsyncedEntry]));

          // CONCURRENT: local has clientA only, remote has clientB only.
          opLogStoreSpy.getVectorClock.and.resolveTo({ clientA: 5 });

          downloadServiceSpy.downloadRemoteOps.and.returnValue(
            Promise.resolve({
              newOps: [],
              hasMore: false,
              latestSeq: 1,
              needsFullStateUpload: false,
              success: true,
              providerMode: 'fileSnapshotOps',
              failedFileCount: 0,
              snapshotState: { tasks: [{ id: 'remote-task' }] },
              snapshotVectorClock: { clientB: 3 },
              latestServerSeq: 1,
            }),
          );

          const mockProvider = {
            isReady: () => Promise.resolve(true),
            supportsOperationSync: true,
            setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
          } as any;

          await expectAsync(service.downloadRemoteOps(mockProvider)).toBeRejectedWith(
            jasmine.any(LocalDataConflictError),
          );
        });

        describe('SPAP-9 causality-aware conflict gating', () => {
          const meaningfulLocalOp = (
            clock: Record<string, number>,
          ): OperationLogEntry => ({
            seq: 1,
            op: {
              id: 'local-op-1',
              clientId: 'clientA',
              actionType: 'test' as ActionType,
              opType: OpType.Update,
              entityType: 'TASK',
              entityId: 'task-1',
              payload: { title: 'Local edit' },
              vectorClock: clock,
              timestamp: Date.now(),
              schemaVersion: 1,
            },
            appliedAt: Date.now(),
            source: 'local',
          });

          it('(a) applies a strictly-ahead remote snapshot with NO conflict dialog', async () => {
            // Remote snapshot {clientA:5} strictly dominates local {clientA:2}:
            // local is clean relative to remote, so adopt the snapshot silently.
            opLogStoreSpy.getUnsynced.and.returnValue(
              Promise.resolve([meaningfulLocalOp({ clientA: 2 })]),
            );
            opLogStoreSpy.getVectorClock.and.resolveTo({ clientA: 2 });

            const syncHydrationServiceSpy = TestBed.inject(
              SyncHydrationService,
            ) as jasmine.SpyObj<SyncHydrationService>;
            syncHydrationServiceSpy.hydrateFromRemoteSync.and.resolveTo();

            downloadServiceSpy.downloadRemoteOps.and.returnValue(
              Promise.resolve({
                newOps: [],
                hasMore: false,
                latestSeq: 1,
                needsFullStateUpload: false,
                success: true,
                providerMode: 'fileSnapshotOps',
                failedFileCount: 0,
                snapshotState: { tasks: [{ id: 'remote-task' }] },
                snapshotVectorClock: { clientA: 5 },
                latestServerSeq: 1,
              }),
            );

            const mockProvider = {
              isReady: () => Promise.resolve(true),
              supportsOperationSync: true,
              setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
            } as any;

            await expectAsync(service.downloadRemoteOps(mockProvider)).toBeResolved();
            expect(syncHydrationServiceSpy.hydrateFromRemoteSync).toHaveBeenCalled();
          });

          it('(b) keeps strictly-ahead local with NO dialog and no hydration (upload left to the normal cycle)', async () => {
            // Local {clientA:5} strictly dominates snapshot {clientA:2}: keep local,
            // do not hydrate, do not reject the pending op (it uploads next cycle).
            opLogStoreSpy.getUnsynced.and.returnValue(
              Promise.resolve([meaningfulLocalOp({ clientA: 5 })]),
            );
            opLogStoreSpy.getVectorClock.and.resolveTo({ clientA: 5 });

            const syncHydrationServiceSpy = TestBed.inject(
              SyncHydrationService,
            ) as jasmine.SpyObj<SyncHydrationService>;
            syncHydrationServiceSpy.hydrateFromRemoteSync.and.resolveTo();

            const setLastServerSeqSpy = jasmine
              .createSpy('setLastServerSeq')
              .and.resolveTo();
            downloadServiceSpy.downloadRemoteOps.and.returnValue(
              Promise.resolve({
                newOps: [],
                hasMore: false,
                latestSeq: 1,
                needsFullStateUpload: false,
                success: true,
                providerMode: 'fileSnapshotOps',
                failedFileCount: 0,
                snapshotState: { tasks: [{ id: 'old-task' }] },
                snapshotVectorClock: { clientA: 2 },
                latestServerSeq: 1,
              }),
            );

            const mockProvider = {
              isReady: () => Promise.resolve(true),
              supportsOperationSync: true,
              setLastServerSeq: setLastServerSeqSpy,
            } as any;

            const result = await service.downloadRemoteOps(mockProvider);
            expect(syncHydrationServiceSpy.hydrateFromRemoteSync).not.toHaveBeenCalled();
            expect(result.kind).toBe('no_new_ops');
            expect(setLastServerSeqSpy).toHaveBeenCalledWith(1);
          });

          const remoteOpWithClock = (clock: Record<string, number>): Operation => ({
            id: 'remote-op-1',
            clientId: 'clientB',
            actionType: 'test' as ActionType,
            opType: OpType.Update,
            entityType: 'TASK',
            entityId: 'task-1',
            payload: { title: 'Remote edit' },
            vectorClock: clock,
            timestamp: Date.now(),
            schemaVersion: 1,
          });

          const withAutoMergeEnabled = async (fn: () => Promise<void>): Promise<void> => {
            const prev = FILE_BASED_SYNC_CONSTANTS.AUTO_MERGE_CONCURRENT_SNAPSHOT;
            (
              FILE_BASED_SYNC_CONSTANTS as { AUTO_MERGE_CONCURRENT_SNAPSHOT: boolean }
            ).AUTO_MERGE_CONCURRENT_SNAPSHOT = true;
            try {
              await fn();
            } finally {
              (
                FILE_BASED_SYNC_CONSTANTS as { AUTO_MERGE_CONCURRENT_SNAPSHOT: boolean }
              ).AUTO_MERGE_CONCURRENT_SNAPSHOT = prev;
            }
          };

          it('(c) CONCURRENT snapshot with meaningful local data falls back to the dialog when auto-merge is disabled (the default)', async () => {
            // Review follow-up: auto-merge defaults OFF, so a CONCURRENT seq-0
            // snapshot with meaningful local data must surface the user-recoverable
            // conflict dialog rather than silently merging.
            expect(FILE_BASED_SYNC_CONSTANTS.AUTO_MERGE_CONCURRENT_SNAPSHOT).toBe(false);
            opLogStoreSpy.getUnsynced.and.returnValue(
              Promise.resolve([meaningfulLocalOp({ clientA: 5 })]),
            );
            opLogStoreSpy.getVectorClock.and.resolveTo({ clientA: 5 });

            downloadServiceSpy.downloadRemoteOps.and.returnValue(
              Promise.resolve({
                newOps: [remoteOpWithClock({ clientB: 3 })],
                allOpClocks: [{ clientB: 3 }],
                hasMore: false,
                latestSeq: 1,
                needsFullStateUpload: false,
                success: true,
                providerMode: 'fileSnapshotOps',
                failedFileCount: 0,
                snapshotState: { tasks: [{ id: 'remote-task' }] },
                snapshotVectorClock: { clientB: 3 },
                latestServerSeq: 1,
              }),
            );

            const mockProvider = {
              isReady: () => Promise.resolve(true),
              supportsOperationSync: true,
              setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
            } as any;

            await expectAsync(service.downloadRemoteOps(mockProvider)).toBeRejectedWith(
              jasmine.any(LocalDataConflictError),
            );
            expect(remoteOpsProcessingServiceSpy.processRemoteOps).not.toHaveBeenCalled();
          });

          it('(d) auto-merges via LWW when enabled AND retained ops bridge the full gap', async () => {
            // Local {clientA:5}, snapshot {clientB:3} — CONCURRENT. The retained op
            // clocks reconstruct the snapshot on top of local
            // (local ⊔ {clientB:3} = {clientA:5,clientB:3} ⊒ {clientB:3}), so the
            // merge is provably lossless and runs instead of the dialog.
            await withAutoMergeEnabled(async () => {
              opLogStoreSpy.getUnsynced.and.returnValue(
                Promise.resolve([meaningfulLocalOp({ clientA: 5 })]),
              );
              opLogStoreSpy.getVectorClock.and.resolveTo({ clientA: 5 });

              const syncHydrationServiceSpy = TestBed.inject(
                SyncHydrationService,
              ) as jasmine.SpyObj<SyncHydrationService>;
              syncHydrationServiceSpy.hydrateFromRemoteSync.and.resolveTo();

              const remoteOp = remoteOpWithClock({ clientB: 3 });
              downloadServiceSpy.downloadRemoteOps.and.returnValue(
                Promise.resolve({
                  newOps: [remoteOp],
                  allOpClocks: [{ clientB: 3 }],
                  hasMore: false,
                  latestSeq: 1,
                  needsFullStateUpload: false,
                  success: true,
                  providerMode: 'fileSnapshotOps',
                  failedFileCount: 0,
                  snapshotState: { tasks: [{ id: 'remote-task' }] },
                  snapshotVectorClock: { clientB: 3 },
                  latestServerSeq: 1,
                }),
              );

              const mockProvider = {
                isReady: () => Promise.resolve(true),
                supportsOperationSync: true,
                setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
              } as any;

              const result = await service.downloadRemoteOps(mockProvider);
              expect(remoteOpsProcessingServiceSpy.processRemoteOps).toHaveBeenCalledWith(
                [remoteOp],
              );
              expect(
                syncHydrationServiceSpy.hydrateFromRemoteSync,
              ).not.toHaveBeenCalled();
              expect(result.kind).toBe('ops_processed');
            });
          });

          it('(e) refuses to auto-merge and falls back to the dialog when the snapshot base holds compacted ops the client never saw', async () => {
            // The data-loss case: snapshot clock {clientB:3, clientC:2} but only
            // clientB:3 survives as a retained op — clientC:2 was compacted into the
            // snapshot base. Replaying recentOps on top of local {clientA:5} yields
            // {clientA:5, clientB:3}, which is CONCURRENT with the snapshot (missing
            // clientC:2). Merging only recentOps would silently drop clientC's
            // entities, so the guard must refuse and surface the dialog.
            await withAutoMergeEnabled(async () => {
              opLogStoreSpy.getUnsynced.and.returnValue(
                Promise.resolve([meaningfulLocalOp({ clientA: 5 })]),
              );
              opLogStoreSpy.getVectorClock.and.resolveTo({ clientA: 5 });

              downloadServiceSpy.downloadRemoteOps.and.returnValue(
                Promise.resolve({
                  newOps: [remoteOpWithClock({ clientB: 3 })],
                  allOpClocks: [{ clientB: 3 }],
                  hasMore: false,
                  latestSeq: 1,
                  needsFullStateUpload: false,
                  success: true,
                  providerMode: 'fileSnapshotOps',
                  failedFileCount: 0,
                  snapshotState: { tasks: [{ id: 'remote-task' }] },
                  snapshotVectorClock: { clientB: 3, clientC: 2 },
                  latestServerSeq: 1,
                }),
              );

              const mockProvider = {
                isReady: () => Promise.resolve(true),
                supportsOperationSync: true,
                setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
              } as any;

              await expectAsync(service.downloadRemoteOps(mockProvider)).toBeRejectedWith(
                jasmine.any(LocalDataConflictError),
              );
              expect(
                remoteOpsProcessingServiceSpy.processRemoteOps,
              ).not.toHaveBeenCalled();
            });
          });
        });

        it('should hydrate (NOT skip) when both clocks are empty — fresh client receiving a legacy snapshot', async () => {
          // Edge case from codex review of issue #7339 fix: an empty remote
          // snapshot clock compares EQUAL to a fresh local client. Without the
          // non-empty guard, the dominate-shortcut would silently skip hydrating
          // a snapshot that carries real legacy state.
          opLogStoreSpy.getUnsynced.and.returnValue(Promise.resolve([]));
          // Fresh local: no vector clock at all.
          opLogStoreSpy.getVectorClock.and.resolveTo(null);
          // No meaningful local data → fresh client hydration path applies.
          stateSnapshotServiceSpy.getStateSnapshot.and.returnValue({
            task: { ids: [] },
            project: { ids: [INBOX_PROJECT.id] },
            tag: { ids: [TODAY_TAG.id] },
            note: { ids: [] },
          } as any);

          const syncHydrationServiceSpy = TestBed.inject(
            SyncHydrationService,
          ) as jasmine.SpyObj<SyncHydrationService>;
          syncHydrationServiceSpy.hydrateFromRemoteSync.and.resolveTo();

          downloadServiceSpy.downloadRemoteOps.and.returnValue(
            Promise.resolve({
              newOps: [],
              hasMore: false,
              latestSeq: 1,
              needsFullStateUpload: false,
              success: true,
              providerMode: 'fileSnapshotOps',
              failedFileCount: 0,
              snapshotState: { tasks: [{ id: 'legacy-task' }] },
              snapshotVectorClock: {}, // empty — legacy file or never populated
              latestServerSeq: 1,
            }),
          );

          const mockProvider = {
            isReady: () => Promise.resolve(true),
            supportsOperationSync: true,
            setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
          } as any;

          await expectAsync(service.downloadRemoteOps(mockProvider)).toBeResolved();
          // Hydration must run — the empty-clock guard prevents the dominate
          // shortcut from silently dropping the snapshot's state.
          expect(syncHydrationServiceSpy.hydrateFromRemoteSync).toHaveBeenCalled();
        });

        it('should NOT loop on consecutive syncs when remote keeps returning the same dominated snapshot (issue #7339)', async () => {
          // The iOS bug: file-based gap detection signals snapshot replacement on
          // every sync from a non-writing client. Without the dominate-check, the
          // conflict dialog re-fires every sync. Verify the dominate-check breaks
          // the loop across multiple consecutive sync attempts.
          const unsyncedEntry: OperationLogEntry = {
            seq: 1,
            op: {
              id: 'local-op-1',
              clientId: 'iosClient',
              actionType: '[Global Config] Update Global Config Section' as ActionType,
              opType: OpType.Update,
              entityType: 'GLOBAL_CONFIG',
              entityId: 'config-1',
              payload: { sectionKey: 'sync' },
              vectorClock: { windowsClient: 1, iosClient: 5 },
              timestamp: Date.now(),
              schemaVersion: 1,
            },
            appliedAt: Date.now(),
            source: 'local',
          };
          opLogStoreSpy.getUnsynced.and.returnValue(Promise.resolve([unsyncedEntry]));
          stateSnapshotServiceSpy.getStateSnapshot.and.returnValue({
            task: { ids: ['task-1'] },
            project: { ids: [INBOX_PROJECT.id] },
            tag: { ids: [TODAY_TAG.id] },
            note: { ids: [] },
          } as any);

          opLogStoreSpy.getVectorClock.and.resolveTo({ windowsClient: 1, iosClient: 5 });

          downloadServiceSpy.downloadRemoteOps.and.returnValue(
            Promise.resolve({
              newOps: [],
              hasMore: false,
              latestSeq: 1,
              needsFullStateUpload: false,
              success: true,
              providerMode: 'fileSnapshotOps',
              failedFileCount: 0,
              snapshotState: { tasks: [{ id: 'old-windows-task' }] },
              snapshotVectorClock: { windowsClient: 1 },
              latestServerSeq: 1,
            }),
          );

          const syncHydrationServiceSpy = TestBed.inject(
            SyncHydrationService,
          ) as jasmine.SpyObj<SyncHydrationService>;
          syncHydrationServiceSpy.hydrateFromRemoteSync.and.resolveTo();

          const mockProvider = {
            isReady: () => Promise.resolve(true),
            supportsOperationSync: true,
            setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
          } as any;

          // First sync — local already has all of remote.
          const first = await service.downloadRemoteOps(mockProvider);
          // Second sync immediately after — server still returns same snapshot
          // (because iOS hasn't uploaded yet); must not throw or hydrate.
          const second = await service.downloadRemoteOps(mockProvider);

          expect(first.kind).toBe('no_new_ops');
          expect(second.kind).toBe('no_new_ops');
          expect(syncHydrationServiceSpy.hydrateFromRemoteSync).not.toHaveBeenCalled();
        });
      });
    });
  });

  // NOTE: Old _handleServerMigration state validation tests (600+ lines) have been moved to
  // server-migration.service.spec.ts. The OperationLogSyncService now delegates to ServerMigrationService.

  // Tests for _resolveSupersededLocalOps have been moved to superseded-operation-resolver.service.spec.ts
  // The functionality is now in SupersededOperationResolverService

  describe('forceUploadLocalState', () => {
    let uploadServiceSpy: jasmine.SpyObj<OperationLogUploadService>;

    beforeEach(() => {
      uploadServiceSpy = TestBed.inject(
        OperationLogUploadService,
      ) as jasmine.SpyObj<OperationLogUploadService>;

      // Default mock behaviors
      uploadServiceSpy.uploadPendingOps.and.resolveTo({
        uploadedCount: 1,
        piggybackedOps: [],
        rejectedCount: 0,
        rejectedOps: [],
        localWinOpsCreated: 0,
      });
      serverMigrationServiceSpy.handleServerMigration.and.resolveTo('force-import');
      opLogStoreSpy.getOpById.and.resolveTo({
        syncedAt: Date.now(),
      } as OperationLogEntry);
    });

    it('should call handleServerMigration to create SYNC_IMPORT', async () => {
      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as unknown as OperationSyncCapable;

      const result = await service.forceUploadLocalState(mockProvider);

      expect(serverMigrationServiceSpy.handleServerMigration).toHaveBeenCalledWith(
        mockProvider,
        { skipServerEmptyCheck: true, syncImportReason: 'FORCE_UPLOAD' },
      );
      expect(opLogStoreSpy.getOpById).toHaveBeenCalledOnceWith('force-import');
      expect(result).toEqual({ hasUnresolvedOps: false });
    });

    it('should upload pending ops after creating SYNC_IMPORT', async () => {
      const callOrder: string[] = [];
      serverMigrationServiceSpy.handleServerMigration.and.callFake(async () => {
        callOrder.push('handleServerMigration');
        return 'force-import';
      });
      uploadServiceSpy.uploadPendingOps.and.callFake(async () => {
        callOrder.push('uploadPendingOps');
        return {
          uploadedCount: 1,
          piggybackedOps: [],
          rejectedCount: 0,
          rejectedOps: [],
          localWinOpsCreated: 0,
        };
      });

      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as unknown as OperationSyncCapable;

      await service.forceUploadLocalState(mockProvider);

      expect(callOrder).toEqual(['handleServerMigration', 'uploadPendingOps']);
    });

    it('should propagate errors from handleServerMigration', async () => {
      const error = new Error('Failed to create SYNC_IMPORT');
      serverMigrationServiceSpy.handleServerMigration.and.rejectWith(error);

      const mockProvider = {
        supportsOperationSync: true,
      } as unknown as OperationSyncCapable;

      await expectAsync(service.forceUploadLocalState(mockProvider)).toBeRejectedWith(
        error,
      );
    });

    it('should reject when no FORCE_UPLOAD operation was created', async () => {
      serverMigrationServiceSpy.handleServerMigration.and.resolveTo();

      const mockProvider = {
        supportsOperationSync: true,
      } as unknown as OperationSyncCapable;

      await expectAsync(
        service.forceUploadLocalState(mockProvider),
      ).toBeRejectedWithError(ForceUploadFailedError);
      expect(uploadServiceSpy.uploadPendingOps).not.toHaveBeenCalled();
    });

    it('should propagate errors from uploadPendingOps', async () => {
      const error = new Error('Upload failed');
      uploadServiceSpy.uploadPendingOps.and.rejectWith(error);

      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as unknown as OperationSyncCapable;

      await expectAsync(service.forceUploadLocalState(mockProvider)).toBeRejectedWith(
        error,
      );
    });

    it('should reject when mandatory encryption blocks the force upload', async () => {
      uploadServiceSpy.uploadPendingOps.and.resolveTo({
        uploadedCount: 0,
        piggybackedOps: [],
        rejectedCount: 0,
        rejectedOps: [],
        encryptionRequiredKeyMissing: true,
      });

      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as unknown as OperationSyncCapable;

      await expectAsync(
        service.forceUploadLocalState(mockProvider),
      ).toBeRejectedWithError(EncryptNoPasswordError);
    });

    it('should reject with a typed error when the FORCE_UPLOAD op is not acknowledged', async () => {
      uploadServiceSpy.uploadPendingOps.and.resolveTo({
        uploadedCount: 0,
        piggybackedOps: [],
        rejectedCount: 1,
        rejectedOps: [
          {
            opId: 'force-import',
            error: 'snapshot rejected',
            errorCode: 'VALIDATION_ERROR',
          },
        ],
      });
      opLogStoreSpy.getOpById.and.resolveTo({} as OperationLogEntry);

      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as unknown as OperationSyncCapable;

      await expectAsync(
        service.forceUploadLocalState(mockProvider),
      ).toBeRejectedWithError(ForceUploadFailedError);
    });

    it('should succeed when the FORCE_UPLOAD op is accepted despite an unrelated rejection', async () => {
      uploadServiceSpy.uploadPendingOps.and.resolveTo({
        uploadedCount: 1,
        piggybackedOps: [],
        rejectedCount: 1,
        rejectedOps: [
          {
            opId: 'older-op',
            error: 'superseded',
            errorCode: 'VALIDATION_ERROR',
          },
        ],
        localWinOpsCreated: 0,
      });

      const mockProvider = {
        supportsOperationSync: true,
      } as unknown as OperationSyncCapable;

      const result = await service.forceUploadLocalState(mockProvider);

      expect(result).toEqual({ hasUnresolvedOps: true });
      expect(opLogStoreSpy.getOpById).toHaveBeenCalledOnceWith('force-import');
    });

    it('should upload with isCleanSlate=true to delete server data before accepting new data', async () => {
      // This is critical for recovery scenarios like decrypt errors where the server
      // may have data encrypted with a different password. Clean slate ensures the
      // server deletes ALL existing data before accepting the new SYNC_IMPORT.
      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as unknown as OperationSyncCapable;

      await service.forceUploadLocalState(mockProvider);

      expect(uploadServiceSpy.uploadPendingOps).toHaveBeenCalledWith(mockProvider, {
        skipPiggybackProcessing: true,
        isCleanSlate: true,
      });
    });
  });

  describe('forceDownloadRemoteState', () => {
    let downloadServiceSpy: jasmine.SpyObj<OperationLogDownloadService>;

    const makeRemoteOp = (id: string = 'op1'): Operation => ({
      id,
      actionType: 'ACTION' as ActionType,
      opType: 'UPDATE' as OpType,
      entityType: 'TASK',
      entityId: 'task1',
      payload: {},
      clientId: 'remote',
      vectorClock: { remote: 1 },
      timestamp: Date.now(),
      schemaVersion: 1,
    });

    beforeEach(() => {
      downloadServiceSpy = TestBed.inject(
        OperationLogDownloadService,
      ) as jasmine.SpyObj<OperationLogDownloadService>;

      opLogStoreSpy.runRemoteStateReplacement.calls.reset();
    });

    it('should download BEFORE any destructive local mutation', async () => {
      const callOrder: string[] = [];
      opLogStoreSpy.runRemoteStateReplacement.and.callFake(async () => {
        callOrder.push('runRemoteStateReplacement');
      });
      downloadServiceSpy.downloadRemoteOps.and.callFake(async () => {
        callOrder.push('downloadRemoteOps');
        return {
          newOps: [makeRemoteOp()],
          needsFullStateUpload: false,
          success: true,
          providerMode: 'superSyncOps',
          failedFileCount: 0,
          latestServerSeq: 1,
        };
      });

      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as any;

      await service.forceDownloadRemoteState(mockProvider);

      expect(callOrder).toEqual(['downloadRemoteOps', 'runRemoteStateReplacement']);
    });

    it('should preserve device-local sync settings in the atomic rebuild baseline', async () => {
      const mockStore = TestBed.inject(MockStore);
      mockStore.overrideSelector(selectSyncConfig, {
        ...DEFAULT_GLOBAL_CONFIG.sync,
        syncProvider: SyncProviderId.SuperSync,
        isEnabled: true,
        isEncryptionEnabled: true,
        syncInterval: 17,
        isManualSyncOnly: true,
      });
      mockStore.refreshState();
      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [makeRemoteOp()],
        needsFullStateUpload: false,
        success: true,
        providerMode: 'superSyncOps',
        failedFileCount: 0,
        latestServerSeq: 1,
      });
      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as unknown as OperationSyncCapable;

      await service.forceDownloadRemoteState(mockProvider);

      const baselineState = opLogStoreSpy.runRemoteStateReplacement.calls.mostRecent()
        .args[0].baselineState as {
        globalConfig: { sync: Record<string, unknown> };
      };
      expect(baselineState.globalConfig.sync).toEqual(
        jasmine.objectContaining({
          syncProvider: SyncProviderId.SuperSync,
          isEnabled: true,
          isEncryptionEnabled: true,
          syncInterval: 17,
          isManualSyncOnly: true,
        }),
      );
    });

    it('should capture a safety backup after download but before replacement (#8107)', async () => {
      const callOrder: string[] = [];
      downloadServiceSpy.downloadRemoteOps.and.callFake(async () => {
        callOrder.push('downloadRemoteOps');
        return {
          newOps: [makeRemoteOp()],
          needsFullStateUpload: false,
          success: true,
          providerMode: 'superSyncOps',
          failedFileCount: 0,
          latestServerSeq: 1,
        };
      });
      backupServiceSpy.captureImportBackup.and.callFake(async () => {
        callOrder.push('captureImportBackup');
        return defaultBackupRef;
      });
      writeFlushServiceSpy.flushPendingWrites.and.callFake(async () => {
        callOrder.push('flushPendingWrites');
      });
      opLogStoreSpy.runRemoteStateReplacement.and.callFake(async () => {
        callOrder.push('runRemoteStateReplacement');
      });
      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as any;

      await service.forceDownloadRemoteState(mockProvider);

      expect(callOrder).toEqual([
        'downloadRemoteOps',
        'flushPendingWrites',
        'captureImportBackup',
        'runRemoteStateReplacement',
      ]);
    });

    it('should ABORT without wiping local data if the safety backup fails (#8107)', async () => {
      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [makeRemoteOp()],
        needsFullStateUpload: false,
        success: true,
        providerMode: 'superSyncOps',
        failedFileCount: 0,
        latestServerSeq: 1,
      });
      backupServiceSpy.captureImportBackup.and.rejectWith(new Error('disk full'));
      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as any;

      await expectAsync(service.forceDownloadRemoteState(mockProvider)).toBeRejected();

      expect(opLogStoreSpy.runRemoteStateReplacement).not.toHaveBeenCalled();
      expect(downloadServiceSpy.downloadRemoteOps).toHaveBeenCalled();
      expect(backupServiceSpy.captureImportBackup).toHaveBeenCalled();
    });

    it('should clear the raw-rebuild-incomplete marker only after the replay committed', async () => {
      const callOrder: string[] = [];
      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [makeRemoteOp()],
        needsFullStateUpload: false,
        success: true,
        providerMode: 'superSyncOps',
        failedFileCount: 0,
        latestServerSeq: 1,
      });
      remoteOpsProcessingServiceSpy.processRemoteOps.and.callFake(async () => {
        callOrder.push('processRemoteOps');
        return {
          localWinOpsCreated: 0,
          allOpsFilteredBySyncImport: false,
          filteredOpCount: 0,
          isLocalUnsyncedImport: false,
          blockedByIncompatibleOp: false,
        };
      });
      opLogStoreSpy.completeRawRebuild.and.callFake(async () => {
        callOrder.push('completeRawRebuild');
        return true;
      });
      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as any;

      await service.forceDownloadRemoteState(mockProvider);

      expect(callOrder).toEqual(['processRemoteOps', 'completeRawRebuild']);
      expect(opLogStoreSpy.completeRawRebuild).toHaveBeenCalledWith(defaultBackupRef);
    });

    it('should NOT clear the raw-rebuild-incomplete marker when the replay is blocked', async () => {
      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [makeRemoteOp()],
        needsFullStateUpload: false,
        success: true,
        providerMode: 'superSyncOps',
        failedFileCount: 0,
        latestServerSeq: 1,
      });
      remoteOpsProcessingServiceSpy.processRemoteOps.and.resolveTo({
        localWinOpsCreated: 0,
        allOpsFilteredBySyncImport: false,
        filteredOpCount: 0,
        isLocalUnsyncedImport: false,
        blockedByIncompatibleOp: true,
      });
      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as any;

      await expectAsync(service.forceDownloadRemoteState(mockProvider)).toBeRejected();

      expect(opLogStoreSpy.completeRawRebuild).not.toHaveBeenCalled();
    });

    it('should keep the first attempt backup on crash resume instead of re-capturing', async () => {
      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [makeRemoteOp()],
        needsFullStateUpload: false,
        success: true,
        providerMode: 'superSyncOps',
        failedFileCount: 0,
        latestServerSeq: 1,
      });
      opLogStoreSpy.loadImportBackup.and.resolveTo({
        state: {},
        ...backupRef12345,
      });
      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as any;

      await service.forceDownloadRemoteState(mockProvider, { isCrashResume: true });

      // Re-capturing would overwrite the single backup slot with the partial
      // baseline; the original pre-replace snapshot must survive the resume.
      expect(backupServiceSpy.captureImportBackup).not.toHaveBeenCalled();
      expect(snackServiceSpy.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          msg: T.F.SYNC.S.LOCAL_DATA_REPLACE_UNDO,
          actionStr: T.G.UNDO,
        }),
      );
    });

    it('should preserve and replay local edits made after an interrupted rebuild', async () => {
      const restoreOrder: string[] = [];
      const previouslyPreserved = makeRemoteOp('local-before-second-crash');
      previouslyPreserved.clientId = 'local';
      previouslyPreserved.vectorClock = { local: 2, remote: 1 };
      const liveLocalEdit = makeRemoteOp('local-after-restart');
      liveLocalEdit.clientId = 'local';
      liveLocalEdit.vectorClock = { local: 3, remote: 1 };
      const liveEntry = {
        seq: 2,
        op: liveLocalEdit,
        source: 'local' as const,
        appliedAt: Date.now(),
      };
      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [makeRemoteOp('remote-op')],
        needsFullStateUpload: false,
        success: true,
        providerMode: 'superSyncOps',
        failedFileCount: 0,
        latestServerSeq: 4,
      });
      opLogStoreSpy.loadImportBackup.and.resolveTo({
        state: {},
        ...backupRef12345,
      });
      opLogStoreSpy.loadRawRebuildIncomplete.and.resolveTo({
        incomplete: true,
        startedAt: 1,
        preservedLocalOps: [previouslyPreserved],
      });
      opLogStoreSpy.getUnsynced.and.resolveTo([liveEntry]);
      opLogStoreSpy.appendBatchSkipDuplicates.and.callFake(async (ops, source) => ({
        seqs: ops.map((_, index) => index + 10),
        writtenOps: source === 'local' ? ops : [],
        skippedCount: 0,
      }));
      operationApplierSpy.applyOperations.and.callFake(async (ops) => {
        restoreOrder.push('apply');
        return { appliedOps: ops };
      });
      opLogStoreSpy.getVectorClock.and.resolveTo({ remote: 4 });
      opLogStoreSpy.setVectorClock.and.callFake(async () => {
        restoreOrder.push('merge-clock');
      });
      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as unknown as OperationSyncCapable;

      await service.forceDownloadRemoteState(mockProvider, { isCrashResume: true });

      const preservedLocalOps = [previouslyPreserved, liveLocalEdit];
      expect(
        opLogStoreSpy.runRemoteStateReplacement.calls.mostRecent().args[0]
          .preservedLocalOps,
      ).toEqual(preservedLocalOps);
      expect(opLogStoreSpy.appendBatchSkipDuplicates).toHaveBeenCalledWith(
        preservedLocalOps,
        'local',
      );
      expect(operationApplierSpy.applyOperations).toHaveBeenCalledWith(
        preservedLocalOps,
        jasmine.objectContaining({
          isLocalHydration: false,
          skipDeferredLocalActions: true,
        }),
      );
      expect(opLogStoreSpy.setVectorClock).toHaveBeenCalledWith({
        remote: 4,
        local: 3,
      });
      expect(restoreOrder).toEqual(['merge-clock', 'apply']);
      expect(opLogStoreSpy.completeRawRebuild).toHaveBeenCalledWith(backupRef12345);
      expect(operationLogEffectsSpy.processDeferredActions).toHaveBeenCalledWith({
        callerHoldsOperationLogLock: true,
      });
    });

    it('should keep crash recovery armed when a local capture arrives during rebuild', async () => {
      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [makeRemoteOp()],
        needsFullStateUpload: false,
        success: true,
        providerMode: 'superSyncOps',
        failedFileCount: 0,
        latestServerSeq: 50,
      });
      writeFlushServiceSpy.hasPendingWrites.and.returnValue(true);
      const setLastServerSeq = jasmine.createSpy('setLastServerSeq').and.resolveTo();

      await expectAsync(
        service.forceDownloadRemoteState({
          supportsOperationSync: true,
          setLastServerSeq,
        } as unknown as OperationSyncCapable),
      ).toBeRejectedWithError(/local change arrived/);

      expect(setLastServerSeq).not.toHaveBeenCalledWith(50);
      expect(opLogStoreSpy.completeRawRebuild).not.toHaveBeenCalled();
    });

    it('should retry the rebuild in-call on a capture race and converge without re-downloading', async () => {
      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [makeRemoteOp()],
        needsFullStateUpload: false,
        success: true,
        providerMode: 'superSyncOps',
        failedFileCount: 0,
        latestServerSeq: 50,
      });
      // Attempt 1 trips the completion assert (e.g. a tracking tick landed in
      // an unprotected gap); the in-call retry runs clean.
      writeFlushServiceSpy.hasPendingWrites.and.returnValues(true, false, false);
      opLogStoreSpy.loadImportBackup.and.resolveTo({
        state: {},
        ...defaultBackupRef,
      });
      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as any;

      await service.forceDownloadRemoteState(mockProvider);

      // One network download, two local rebuild attempts.
      expect(downloadServiceSpy.downloadRemoteOps).toHaveBeenCalledTimes(1);
      expect(opLogStoreSpy.runRemoteStateReplacement).toHaveBeenCalledTimes(2);
      // The retry re-enters through the crash-resume branch: the FIRST
      // attempt's pre-replace backup is kept, never re-captured over.
      expect(backupServiceSpy.captureImportBackup).toHaveBeenCalledTimes(1);
      expect(opLogStoreSpy.loadImportBackup).toHaveBeenCalled();
      expect(opLogStoreSpy.completeRawRebuild).toHaveBeenCalledWith(defaultBackupRef);
    });

    it('should warn only once per session when the remote history requires a newer app', async () => {
      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [{ ...makeRemoteOp(), schemaVersion: 9999 }],
        needsFullStateUpload: false,
        success: true,
        providerMode: 'superSyncOps',
        failedFileCount: 0,
        latestServerSeq: 1,
      });
      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as any;

      await expectAsync(
        service.forceDownloadRemoteState(mockProvider),
      ).toBeRejectedWithError(/newer schema version/);
      await expectAsync(
        service.forceDownloadRemoteState(mockProvider),
      ).toBeRejectedWithError(/newer schema version/);

      const versionSnackCount = snackServiceSpy.open.calls
        .allArgs()
        .filter(
          ([cfg]) => typeof cfg !== 'string' && cfg.msg === T.F.SYNC.S.VERSION_TOO_OLD,
        ).length;
      expect(versionSnackCount).toBe(1);
    });

    it('should offer to restore the previous data after replacing (#8107)', async () => {
      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [makeRemoteOp()],
        needsFullStateUpload: false,
        success: true,
        providerMode: 'superSyncOps',
        failedFileCount: 0,
        latestServerSeq: 1,
      });
      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as any;

      await service.forceDownloadRemoteState(mockProvider);

      expect(snackServiceSpy.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          msg: T.F.SYNC.S.LOCAL_DATA_REPLACE_UNDO,
          actionStr: T.G.UNDO,
        }),
      );
    });

    it('should acknowledge only the final cursor after a successful rebuild', async () => {
      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [makeRemoteOp()],
        needsFullStateUpload: false,
        success: true,
        providerMode: 'superSyncOps',
        failedFileCount: 0,
        latestServerSeq: 1,
      });

      const setLastServerSeqSpy = jasmine.createSpy('setLastServerSeq').and.resolveTo();

      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: setLastServerSeqSpy,
      } as any;

      await service.forceDownloadRemoteState(mockProvider);

      expect(setLastServerSeqSpy).toHaveBeenCalledOnceWith(1);
    });

    it('should commit the local replacement before acknowledging the external cursor', async () => {
      const callOrder: string[] = [];
      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [makeRemoteOp()],
        needsFullStateUpload: false,
        success: true,
        providerMode: 'superSyncOps',
        failedFileCount: 0,
        latestServerSeq: 1,
      });
      opLogStoreSpy.runRemoteStateReplacement.and.callFake(async () => {
        callOrder.push('replace');
      });
      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine
          .createSpy('setLastServerSeq')
          .and.callFake(async (seq: number) => {
            callOrder.push(`cursor-${seq}`);
          }),
      } as unknown as OperationSyncCapable;

      await service.forceDownloadRemoteState(mockProvider);

      expect(callOrder).toEqual(['replace', 'cursor-1']);
    });

    it('should download raw history: forceFromSeq0 AND includeOwnAndAppliedOps', async () => {
      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [makeRemoteOp()],
        needsFullStateUpload: false,
        success: true,
        providerMode: 'superSyncOps',
        failedFileCount: 0,
        latestServerSeq: 1,
      });

      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as any;

      await service.forceDownloadRemoteState(mockProvider);

      expect(downloadServiceSpy.downloadRemoteOps).toHaveBeenCalledWith(mockProvider, {
        forceFromSeq0: true,
        includeOwnAndAppliedOps: true,
      });
    });

    it('should throw when force download fails and leave local data untouched', async () => {
      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [],
        needsFullStateUpload: false,
        success: false,
        failedFileCount: 1,
      });

      const setLastServerSeqSpy = jasmine.createSpy('setLastServerSeq').and.resolveTo();
      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: setLastServerSeqSpy,
      } as any;

      await expectAsync(
        service.forceDownloadRemoteState(mockProvider),
      ).toBeRejectedWithError(/Download failed/);
      expect(remoteOpsProcessingServiceSpy.processRemoteOps).not.toHaveBeenCalled();
      expect(opLogStoreSpy.runRemoteStateReplacement).not.toHaveBeenCalled();
      expect(setLastServerSeqSpy).not.toHaveBeenCalled();
    });

    it('should refuse to rebuild from ops with a newer schema version BEFORE destroying anything', async () => {
      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [{ ...makeRemoteOp('op-future'), schemaVersion: 99 }],
        needsFullStateUpload: false,
        success: true,
        providerMode: 'superSyncOps',
        failedFileCount: 0,
        latestServerSeq: 1,
      });

      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as any;

      await expectAsync(
        service.forceDownloadRemoteState(mockProvider),
      ).toBeRejectedWithError(/newer schema version/);
      expect(opLogStoreSpy.runRemoteStateReplacement).not.toHaveBeenCalled();
      expect(remoteOpsProcessingServiceSpy.processRemoteOps).not.toHaveBeenCalled();
    });

    it('should run all operation migrations before backup or replacement', async () => {
      const remoteOp = { ...makeRemoteOp(), schemaVersion: 1 };
      const migratedOp = { ...remoteOp, schemaVersion: 4 };
      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [remoteOp],
        needsFullStateUpload: false,
        success: true,
        providerMode: 'superSyncOps',
        failedFileCount: 0,
        latestServerSeq: 1,
      });
      schemaMigrationServiceSpy.migrateOperations.and.returnValue([migratedOp]);
      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as unknown as OperationSyncCapable;

      await service.forceDownloadRemoteState(mockProvider);

      expect(schemaMigrationServiceSpy.migrateOperations).toHaveBeenCalledOnceWith([
        remoteOp,
      ]);
      expect(remoteOpsProcessingServiceSpy.processRemoteOps).toHaveBeenCalledWith(
        [migratedOp],
        {
          skipConflictDetection: true,
          callerHoldsOperationLogLock: true,
        },
      );
    });

    it('should abort before backup and replacement when operation migration fails', async () => {
      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [makeRemoteOp()],
        needsFullStateUpload: false,
        success: true,
        providerMode: 'superSyncOps',
        failedFileCount: 0,
        latestServerSeq: 1,
      });
      schemaMigrationServiceSpy.migrateOperations.and.throwError('bad migration');
      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as unknown as OperationSyncCapable;

      await expectAsync(
        service.forceDownloadRemoteState(mockProvider),
      ).toBeRejectedWithError(/migration failed/);

      expect(backupServiceSpy.captureImportBackup).not.toHaveBeenCalled();
      expect(opLogStoreSpy.runRemoteStateReplacement).not.toHaveBeenCalled();
    });

    it('should validate a file snapshot before backup and replacement', async () => {
      const snapshotState = { task: { ids: ['remote-task'] } };
      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [],
        needsFullStateUpload: false,
        success: true,
        providerMode: 'fileSnapshotOps',
        failedFileCount: 0,
        snapshotState,
        latestServerSeq: 1,
      });
      validateStateServiceSpy.validateAndRepair.and.resolveTo({
        isValid: false,
        wasRepaired: false,
      });
      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as unknown as OperationSyncCapable;

      await expectAsync(
        service.forceDownloadRemoteState(mockProvider),
      ).toBeRejectedWithError(/snapshot is invalid/);

      // USE_REMOTE is a foreground, user-initiated recovery → interactive (#9026).
      expect(validateStateServiceSpy.validateAndRepair).toHaveBeenCalledOnceWith(
        snapshotState,
        { interactive: true },
      );
      expect(backupServiceSpy.captureImportBackup).not.toHaveBeenCalled();
      expect(opLogStoreSpy.runRemoteStateReplacement).not.toHaveBeenCalled();
    });

    it('should restore device-local sync settings before validating a file snapshot', async () => {
      const mockStore = TestBed.inject(MockStore);
      mockStore.overrideSelector(selectSyncConfig, {
        ...DEFAULT_GLOBAL_CONFIG.sync,
        syncProvider: SyncProviderId.WebDAV,
        isEnabled: true,
        isEncryptionEnabled: true,
        syncInterval: 23,
        isManualSyncOnly: true,
      });
      mockStore.refreshState();
      const wireSnapshot = stripLocalOnlySyncSettingsFromAppData({
        globalConfig: DEFAULT_GLOBAL_CONFIG,
      });
      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [],
        needsFullStateUpload: false,
        success: true,
        providerMode: 'fileSnapshotOps',
        failedFileCount: 0,
        snapshotState: wireSnapshot,
        latestServerSeq: 1,
      });
      validateStateServiceSpy.validateAndRepair.and.resolveTo({
        isValid: true,
        wasRepaired: false,
      });
      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as unknown as OperationSyncCapable;

      await service.forceDownloadRemoteState(mockProvider);

      expect(validateStateServiceSpy.validateAndRepair).toHaveBeenCalledOnceWith(
        jasmine.objectContaining({
          globalConfig: jasmine.objectContaining({
            sync: jasmine.objectContaining({
              syncProvider: SyncProviderId.WebDAV,
              isEnabled: true,
              isEncryptionEnabled: true,
              syncInterval: 23,
              isManualSyncOnly: true,
            }),
          }),
        }),
        { interactive: true },
      );
    });

    it('should not acknowledge the cursor when replay blocks on a migration failure', async () => {
      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [makeRemoteOp()],
        needsFullStateUpload: false,
        success: true,
        providerMode: 'superSyncOps',
        failedFileCount: 0,
        latestServerSeq: 50,
      });
      remoteOpsProcessingServiceSpy.processRemoteOps.and.resolveTo({
        localWinOpsCreated: 0,
        allOpsFilteredBySyncImport: false,
        filteredOpCount: 0,
        isLocalUnsyncedImport: false,
        blockedByIncompatibleOp: true,
      });

      const setLastServerSeqSpy = jasmine.createSpy('setLastServerSeq').and.resolveTo();
      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: setLastServerSeqSpy,
      } as any;

      await expectAsync(
        service.forceDownloadRemoteState(mockProvider),
      ).toBeRejectedWithError(/USE_REMOTE incomplete/);
      expect(setLastServerSeqSpy).not.toHaveBeenCalled();
    });

    it('should process downloaded ops without confirmation', async () => {
      const mockOps: Operation[] = [
        {
          id: 'op1',
          actionType: 'ACTION' as ActionType,
          opType: 'UPDATE' as OpType,
          entityType: 'TASK',
          entityId: 'task1',
          payload: {},
          clientId: 'remote',
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ];

      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: mockOps,
        needsFullStateUpload: false,
        success: true,
        providerMode: 'superSyncOps',
        failedFileCount: 0,
        latestServerSeq: 1,
      });

      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as any;

      await service.forceDownloadRemoteState(mockProvider);

      expect(remoteOpsProcessingServiceSpy.processRemoteOps).toHaveBeenCalledWith(
        mockOps,
        {
          skipConflictDetection: true,
          callerHoldsOperationLogLock: true,
        },
      );
    });

    it('should update lastServerSeq after processing ops', async () => {
      const mockOp: Operation = {
        id: 'op1',
        actionType: 'ACTION' as ActionType,
        opType: 'UPDATE' as OpType,
        entityType: 'TASK',
        entityId: 'task1',
        payload: {},
        clientId: 'remote',
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [mockOp],
        needsFullStateUpload: false,
        success: true,
        providerMode: 'superSyncOps',
        failedFileCount: 0,
        latestServerSeq: 50,
      });

      const setLastServerSeqSpy = jasmine.createSpy('setLastServerSeq').and.resolveTo();

      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: setLastServerSeqSpy,
      } as any;

      await service.forceDownloadRemoteState(mockProvider);

      expect(setLastServerSeqSpy).toHaveBeenCalledOnceWith(50);
    });

    it('should REJECT an empty remote instead of silently succeeding', async () => {
      // An empty remote is not a state to adopt: succeeding here used to wipe
      // the local op-log bookkeeping while leaving live state unchanged.
      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [],
        needsFullStateUpload: false,
        success: true,
        providerMode: 'superSyncOps',
        failedFileCount: 0,
      });

      const setLastServerSeqSpy = jasmine.createSpy('setLastServerSeq').and.resolveTo();
      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: setLastServerSeqSpy,
      } as any;

      await expectAsync(
        service.forceDownloadRemoteState(mockProvider),
      ).toBeRejectedWithError(/no data to rebuild from/);
      expect(remoteOpsProcessingServiceSpy.processRemoteOps).not.toHaveBeenCalled();
      expect(opLogStoreSpy.runRemoteStateReplacement).not.toHaveBeenCalled();
      expect(setLastServerSeqSpy).not.toHaveBeenCalled();
    });

    it('should hydrate from snapshotState when present (file-based sync)', async () => {
      // When force downloading from a file-based provider that has a snapshot
      // (e.g., after another client used USE_LOCAL), we should hydrate from
      // the snapshot instead of processing ops (which would be empty).

      const snapshotState = { task: { ids: ['remote-task-1'] } };
      const snapshotVectorClock = { clientB: 5 };

      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [], // Empty - snapshot replaces incremental ops
        needsFullStateUpload: false,
        success: true,
        providerMode: 'fileSnapshotOps',
        failedFileCount: 0,
        snapshotState,
        snapshotVectorClock,
        latestServerSeq: 1,
      });

      const syncHydrationServiceSpy = TestBed.inject(
        SyncHydrationService,
      ) as jasmine.SpyObj<SyncHydrationService>;
      syncHydrationServiceSpy.hydrateFromRemoteSync.and.resolveTo();

      const setLastServerSeqSpy = jasmine.createSpy('setLastServerSeq').and.resolveTo();
      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: setLastServerSeqSpy,
      } as any;

      await service.forceDownloadRemoteState(mockProvider);

      // Should hydrate from snapshot
      expect(syncHydrationServiceSpy.hydrateFromRemoteSync).toHaveBeenCalledWith(
        snapshotState,
        snapshotVectorClock,
        false, // Don't create SYNC_IMPORT
      );

      // Should NOT process ops (empty)
      expect(remoteOpsProcessingServiceSpy.processRemoteOps).not.toHaveBeenCalled();

      // Should update lastServerSeq after hydration
      expect(setLastServerSeqSpy).toHaveBeenCalledWith(1);
    });

    it('should propagate errors from the atomic replacement', async () => {
      const error = new Error('Failed to clear ops');
      opLogStoreSpy.runRemoteStateReplacement.and.rejectWith(error);
      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [makeRemoteOp()],
        needsFullStateUpload: false,
        success: true,
        providerMode: 'superSyncOps',
        failedFileCount: 0,
        latestServerSeq: 1,
      });

      const setLastServerSeqSpy = jasmine.createSpy('setLastServerSeq').and.resolveTo();
      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: setLastServerSeqSpy,
      } as any;

      await expectAsync(service.forceDownloadRemoteState(mockProvider)).toBeRejectedWith(
        error,
      );
      // A failed replacement must not acknowledge the staged download baseline.
      // The raw-rebuild marker drives seq-0 recovery after a committed crash, so
      // there is no need for an eager external cursor reset before the transaction.
      expect(setLastServerSeqSpy).not.toHaveBeenCalled();
    });

    // Issue #7330: post-sync validation failure must be surfaced so
    // SyncWrapperService can refuse IN_SYNC. After the latch refactor,
    // failure flows via SyncSessionValidationService rather than the return
    // shape — but processRemoteOps is the layer that flips the latch via
    // validateAfterSync. We assert here that forceDownloadRemoteState
    // delegates through processRemoteOps, leaving the latch intact for the
    // wrapper to read. (The flip itself is unit-tested in
    // remote-ops-processing.service.spec.ts.)
    it('forceDownloadRemoteState invokes processRemoteOps with skipConflictDetection', async () => {
      const mockOps: Operation[] = [
        {
          id: 'op1',
          actionType: 'ACTION' as ActionType,
          opType: 'UPDATE' as OpType,
          entityType: 'TASK',
          entityId: 'task1',
          payload: {},
          clientId: 'remote',
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ];

      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: mockOps,
        needsFullStateUpload: false,
        success: true,
        providerMode: 'superSyncOps',
        failedFileCount: 0,
        latestServerSeq: 1,
      });

      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as any;

      await service.forceDownloadRemoteState(mockProvider);
      expect(remoteOpsProcessingServiceSpy.processRemoteOps).toHaveBeenCalledWith(
        mockOps,
        {
          skipConflictDetection: true,
          callerHoldsOperationLogLock: true,
        },
      );
    });

    it('hydrates a split snapshot and replays only its post-snapshot suffix', async () => {
      const snapshotOp = makeRemoteOp('snapshot-op');
      const suffixOp = {
        ...makeRemoteOp('suffix-op'),
        entityId: 'task-after-snapshot',
        vectorClock: { remote: 2 },
      };
      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [snapshotOp, suffixOp],
        needsFullStateUpload: false,
        success: true,
        providerMode: 'fileSnapshotOps',
        failedFileCount: 0,
        snapshotState: { task: { ids: ['task1'] } },
        snapshotVectorClock: { remote: 1 },
        snapshotAppliedOpIds: [snapshotOp.id],
        latestServerSeq: 2,
      });
      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as unknown as OperationSyncCapable;

      await service.forceDownloadRemoteState(mockProvider);

      expect(opLogStoreSpy.appendSnapshotIncludedOps).toHaveBeenCalledOnceWith([
        snapshotOp,
      ]);
      expect(remoteOpsProcessingServiceSpy.processRemoteOps).toHaveBeenCalledOnceWith(
        [suffixOp],
        {
          skipConflictDetection: true,
          callerHoldsOperationLogLock: true,
        },
      );
    });
  });

  describe('_hasMeaningfulStoreData detection for first-time sync', () => {
    let downloadServiceSpy: jasmine.SpyObj<OperationLogDownloadService>;

    beforeEach(() => {
      downloadServiceSpy = TestBed.inject(
        OperationLogDownloadService,
      ) as jasmine.SpyObj<OperationLogDownloadService>;

      // Make this a fresh client (no snapshot, no ops)
      opLogStoreSpy.loadStateCache.and.resolveTo(null);
      opLogStoreSpy.getLastSeq.and.resolveTo(0);
      opLogStoreSpy.getUnsynced.and.resolveTo([]); // No unsynced ops
    });

    it('should throw LocalDataConflictError when fresh client has tasks in NgRx store', async () => {
      // Store has tasks (meaningful data)
      stateSnapshotServiceSpy.getStateSnapshot.and.returnValue({
        task: { ids: ['task-1', 'task-2'] },
        project: { ids: [INBOX_PROJECT.id] },
        tag: { ids: [TODAY_TAG.id] },
        note: { ids: [] },
      } as any);

      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [],
        needsFullStateUpload: false,
        success: true,
        providerMode: 'fileSnapshotOps',
        failedFileCount: 0,
        snapshotState: { task: { ids: ['remote-task'] } },
        snapshotVectorClock: { clientB: 5 },
      });

      const mockProvider = {
        supportsOperationSync: true,
      } as any;

      await expectAsync(service.downloadRemoteOps(mockProvider)).toBeRejectedWith(
        jasmine.any(LocalDataConflictError),
      );
    });

    it('should throw LocalDataConflictError when fresh client has custom projects', async () => {
      // Store has custom project (not INBOX)
      stateSnapshotServiceSpy.getStateSnapshot.and.returnValue({
        task: { ids: [] },
        project: { ids: [INBOX_PROJECT.id, 'custom-project-1'] },
        tag: { ids: [TODAY_TAG.id] },
        note: { ids: [] },
      } as any);

      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [],
        needsFullStateUpload: false,
        success: true,
        providerMode: 'fileSnapshotOps',
        failedFileCount: 0,
        snapshotState: { task: { ids: [] } },
        snapshotVectorClock: { clientB: 5 },
      });

      const mockProvider = {
        supportsOperationSync: true,
      } as any;

      await expectAsync(service.downloadRemoteOps(mockProvider)).toBeRejectedWith(
        jasmine.any(LocalDataConflictError),
      );
    });

    it('should throw LocalDataConflictError when fresh client has custom tags', async () => {
      // Store has custom tag (not TODAY or other system tags)
      stateSnapshotServiceSpy.getStateSnapshot.and.returnValue({
        task: { ids: [] },
        project: { ids: [INBOX_PROJECT.id] },
        tag: { ids: [TODAY_TAG.id, 'custom-tag-1'] },
        note: { ids: [] },
      } as any);

      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [],
        needsFullStateUpload: false,
        success: true,
        providerMode: 'fileSnapshotOps',
        failedFileCount: 0,
        snapshotState: { task: { ids: [] } },
        snapshotVectorClock: { clientB: 5 },
      });

      const mockProvider = {
        supportsOperationSync: true,
      } as any;

      await expectAsync(service.downloadRemoteOps(mockProvider)).toBeRejectedWith(
        jasmine.any(LocalDataConflictError),
      );
    });

    it('should throw LocalDataConflictError when fresh client has notes', async () => {
      // Store has notes
      stateSnapshotServiceSpy.getStateSnapshot.and.returnValue({
        task: { ids: [] },
        project: { ids: [INBOX_PROJECT.id] },
        tag: { ids: [TODAY_TAG.id] },
        note: { ids: ['note-1'] },
      } as any);

      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [],
        needsFullStateUpload: false,
        success: true,
        providerMode: 'fileSnapshotOps',
        failedFileCount: 0,
        snapshotState: { task: { ids: [] } },
        snapshotVectorClock: { clientB: 5 },
      });

      const mockProvider = {
        supportsOperationSync: true,
      } as any;

      await expectAsync(service.downloadRemoteOps(mockProvider)).toBeRejectedWith(
        jasmine.any(LocalDataConflictError),
      );
    });

    it('should NOT throw LocalDataConflictError when fresh client has only default data', async () => {
      // Store has only default data (INBOX project, TODAY tag, no tasks/notes)
      stateSnapshotServiceSpy.getStateSnapshot.and.returnValue({
        task: { ids: [] },
        project: { ids: [INBOX_PROJECT.id] },
        tag: { ids: [TODAY_TAG.id] },
        note: { ids: [] },
      } as any);

      const syncHydrationServiceSpy = TestBed.inject(
        SyncHydrationService,
      ) as jasmine.SpyObj<SyncHydrationService>;
      syncHydrationServiceSpy.hydrateFromRemoteSync.and.resolveTo();

      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [],
        needsFullStateUpload: false,
        success: true,
        providerMode: 'fileSnapshotOps',
        failedFileCount: 0,
        snapshotState: { task: { ids: ['remote-task'] } },
        snapshotVectorClock: { clientB: 5 },
        latestServerSeq: 1,
      });

      // Mock window.confirm since it's called for fresh clients - stub method directly
      const originalConfirm = window.confirm;
      window.confirm = jasmine.createSpy('confirm').and.returnValue(true);

      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as any;

      try {
        // Should NOT throw - should show confirmation dialog and proceed
        await expectAsync(service.downloadRemoteOps(mockProvider)).toBeResolved();
        expect(syncHydrationServiceSpy.hydrateFromRemoteSync).toHaveBeenCalled();
      } finally {
        window.confirm = originalConfirm;
      }
    });

    it('should NOT throw LocalDataConflictError when client already has op-log history', async () => {
      // Client has op-log history (not a fresh client)
      opLogStoreSpy.loadStateCache.and.resolveTo({
        state: {},
        lastAppliedOpSeq: 5,
        vectorClock: { clientA: 5 },
        compactedAt: Date.now(),
      });
      opLogStoreSpy.getLastSeq.and.resolveTo(5);

      // Store has tasks (meaningful data), but client is not fresh
      stateSnapshotServiceSpy.getStateSnapshot.and.returnValue({
        task: { ids: ['task-1'] },
        project: { ids: [INBOX_PROJECT.id] },
        tag: { ids: [TODAY_TAG.id] },
        note: { ids: [] },
      } as any);

      const syncHydrationServiceSpy = TestBed.inject(
        SyncHydrationService,
      ) as jasmine.SpyObj<SyncHydrationService>;
      syncHydrationServiceSpy.hydrateFromRemoteSync.and.resolveTo();

      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [],
        needsFullStateUpload: false,
        success: true,
        providerMode: 'fileSnapshotOps',
        failedFileCount: 0,
        snapshotState: { task: { ids: ['remote-task'] } },
        snapshotVectorClock: { clientB: 5 },
        latestServerSeq: 1,
      });

      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as any;

      // Should NOT throw - client has history, so it's not "fresh"
      await expectAsync(service.downloadRemoteOps(mockProvider)).toBeResolved();
    });

    it('should include correct context in LocalDataConflictError when fresh client has store data', async () => {
      // Store has tasks (meaningful data)
      stateSnapshotServiceSpy.getStateSnapshot.and.returnValue({
        task: { ids: ['task-1'] },
        project: { ids: [INBOX_PROJECT.id] },
        tag: { ids: [TODAY_TAG.id] },
        note: { ids: [] },
      } as any);

      const remoteSnapshot = { task: { ids: ['remote-task'] } };
      const remoteVectorClock = { clientB: 5, clientC: 3 };

      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [],
        needsFullStateUpload: false,
        success: true,
        providerMode: 'fileSnapshotOps',
        failedFileCount: 0,
        snapshotState: remoteSnapshot,
        snapshotVectorClock: remoteVectorClock,
      });

      const mockProvider = {
        supportsOperationSync: true,
      } as any;

      try {
        await service.downloadRemoteOps(mockProvider);
        fail('Expected LocalDataConflictError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(LocalDataConflictError);
        const conflictError = error as LocalDataConflictError;
        expect(conflictError.unsyncedCount).toBe(0); // No unsynced ops
        expect(conflictError.remoteSnapshotState).toEqual(remoteSnapshot);
        expect(conflictError.remoteVectorClock).toEqual(remoteVectorClock);
        // Fresh client has no prior sync — the last-synced baseline must be
        // explicitly null (SPAP-7), not undefined or a clock.
        expect(conflictError.lastSyncedVectorClock).toBeNull();
      }
    });

    it('passes a null last-synced clock when fresh client with store data receives remote ops (no snapshot)', async () => {
      // Covers the second fresh-client throw site: incremental ops without a
      // snapshotState. The error must carry an explicit null baseline (SPAP-7).
      stateSnapshotServiceSpy.getStateSnapshot.and.returnValue({
        task: { ids: ['task-1'] },
        project: { ids: [INBOX_PROJECT.id] },
        tag: { ids: [TODAY_TAG.id] },
        note: { ids: [] },
      } as any);

      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [
          {
            id: 'remote-op-1',
            clientId: 'clientB',
            actionType: 'test' as ActionType,
            opType: OpType.Update,
            entityType: 'TASK',
            entityId: 'task-1',
            payload: {},
            vectorClock: { clientB: 1 },
            timestamp: Date.now(),
            schemaVersion: 1,
          },
        ],
        needsFullStateUpload: false,
        success: true,
        providerMode: 'superSyncOps',
        failedFileCount: 0,
        latestServerSeq: 1,
      });

      const mockProvider = {
        supportsOperationSync: true,
      } as any;

      try {
        await service.downloadRemoteOps(mockProvider);
        fail('Expected LocalDataConflictError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(LocalDataConflictError);
        const conflictError = error as LocalDataConflictError;
        expect(conflictError.unsyncedCount).toBe(0);
        expect(conflictError.lastSyncedVectorClock).toBeNull();
      }
    });

    it('should NOT throw when store has only system tags (TODAY, URGENT, IMPORTANT, IN_PROGRESS)', async () => {
      // Store has all system tags but no user data
      stateSnapshotServiceSpy.getStateSnapshot.and.returnValue({
        task: { ids: [] },
        project: { ids: [INBOX_PROJECT.id] },
        tag: { ids: Array.from(SYSTEM_TAG_IDS) }, // All system tags
        note: { ids: [] },
      } as any);

      const syncHydrationServiceSpy = TestBed.inject(
        SyncHydrationService,
      ) as jasmine.SpyObj<SyncHydrationService>;
      syncHydrationServiceSpy.hydrateFromRemoteSync.and.resolveTo();

      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [],
        needsFullStateUpload: false,
        success: true,
        providerMode: 'fileSnapshotOps',
        failedFileCount: 0,
        snapshotState: { task: { ids: [] } },
        snapshotVectorClock: { clientB: 5 },
        latestServerSeq: 1,
      });

      // Mock window.confirm - stub method directly
      const originalConfirm = window.confirm;
      window.confirm = jasmine.createSpy('confirm').and.returnValue(true);

      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as any;

      try {
        // Should NOT throw - system tags don't count as meaningful user data
        await expectAsync(service.downloadRemoteOps(mockProvider)).toBeResolved();
      } finally {
        window.confirm = originalConfirm;
      }
    });
  });

  describe('pre-op-log client on empty server (I.2 fix)', () => {
    let downloadServiceSpy: jasmine.SpyObj<OperationLogDownloadService>;

    beforeEach(() => {
      downloadServiceSpy = TestBed.inject(
        OperationLogDownloadService,
      ) as jasmine.SpyObj<OperationLogDownloadService>;

      // Make this a fresh client (no snapshot, no ops)
      opLogStoreSpy.loadStateCache.and.resolveTo(null);
      opLogStoreSpy.getLastSeq.and.resolveTo(0);
      opLogStoreSpy.getUnsynced.and.resolveTo([]);
    });

    it('should create SYNC_IMPORT via migration service when fresh client has meaningful data on empty server', async () => {
      // Store has tasks (meaningful data)
      stateSnapshotServiceSpy.getStateSnapshot.and.returnValue({
        task: { ids: ['task-1'] },
        project: { ids: [INBOX_PROJECT.id] },
        tag: { ids: [TODAY_TAG.id] },
        note: { ids: [] },
      } as any);

      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [],
        needsFullStateUpload: false,
        success: true,
        providerMode: 'superSyncOps',
        failedFileCount: 0,
        latestServerSeq: 0, // Empty server
      });

      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as any;

      const result = await service.downloadRemoteOps(mockProvider);

      expect(serverMigrationServiceSpy.handleServerMigration).toHaveBeenCalledWith(
        mockProvider,
        { syncImportReason: 'SERVER_MIGRATION' },
      );
      expect(result.kind).toBe('server_migration_handled');
    });

    it('should NOT create SYNC_IMPORT when fresh client has no meaningful data on empty server', async () => {
      // Store has only default data
      stateSnapshotServiceSpy.getStateSnapshot.and.returnValue({
        task: { ids: [] },
        project: { ids: [INBOX_PROJECT.id] },
        tag: { ids: [TODAY_TAG.id] },
        note: { ids: [] },
      } as any);

      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [],
        needsFullStateUpload: false,
        success: true,
        providerMode: 'superSyncOps',
        failedFileCount: 0,
        latestServerSeq: 0, // Empty server
      });

      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as any;

      const result = await service.downloadRemoteOps(mockProvider);

      expect(serverMigrationServiceSpy.handleServerMigration).not.toHaveBeenCalled();
      expect(result.kind).not.toBe('server_migration_handled');
    });

    it('should NOT create SYNC_IMPORT when server is not empty (latestServerSeq > 0)', async () => {
      // Store has tasks
      stateSnapshotServiceSpy.getStateSnapshot.and.returnValue({
        task: { ids: ['task-1'] },
        project: { ids: [INBOX_PROJECT.id] },
        tag: { ids: [TODAY_TAG.id] },
        note: { ids: [] },
      } as any);

      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [],
        needsFullStateUpload: false,
        success: true,
        providerMode: 'superSyncOps',
        failedFileCount: 0,
        latestServerSeq: 5, // Server has data (just no new ops for us)
      });

      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as any;

      const result = await service.downloadRemoteOps(mockProvider);

      expect(serverMigrationServiceSpy.handleServerMigration).not.toHaveBeenCalled();
      expect(result.kind).not.toBe('server_migration_handled');
    });

    it('should NOT create SYNC_IMPORT when client is not fresh (has op-log history)', async () => {
      // Client has history (not fresh)
      opLogStoreSpy.loadStateCache.and.resolveTo({
        state: {},
        lastAppliedOpSeq: 5,
        vectorClock: { clientA: 5 },
        compactedAt: Date.now(),
      });
      opLogStoreSpy.getLastSeq.and.resolveTo(5);

      // Store has tasks
      stateSnapshotServiceSpy.getStateSnapshot.and.returnValue({
        task: { ids: ['task-1'] },
        project: { ids: [INBOX_PROJECT.id] },
        tag: { ids: [TODAY_TAG.id] },
        note: { ids: [] },
      } as any);

      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [],
        needsFullStateUpload: false,
        success: true,
        providerMode: 'superSyncOps',
        failedFileCount: 0,
        latestServerSeq: 0,
      });

      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as any;

      const result = await service.downloadRemoteOps(mockProvider);

      // Should NOT call handleServerMigration - client is not fresh
      expect(serverMigrationServiceSpy.handleServerMigration).not.toHaveBeenCalled();
      expect(result.kind).not.toBe('server_migration_handled');
    });
  });

  describe('downloaded SYNC_IMPORT conflict dialog', () => {
    let downloadServiceSpy: jasmine.SpyObj<OperationLogDownloadService>;

    beforeEach(() => {
      downloadServiceSpy = TestBed.inject(
        OperationLogDownloadService,
      ) as jasmine.SpyObj<OperationLogDownloadService>;
    });

    const createIncomingSyncImport = (): Operation => ({
      id: 'import-1',
      clientId: 'client-B',
      actionType: ActionType.LOAD_ALL_DATA,
      opType: OpType.SyncImport,
      entityType: 'ALL',
      payload: { task: { ids: ['remote-task'] } },
      vectorClock: { clientB: 5 },
      timestamp: Date.now(),
      schemaVersion: 1,
      syncImportReason: 'SERVER_MIGRATION',
    });

    it('should process incoming SYNC_IMPORT silently when client only has already-synced meaningful data', async () => {
      const incomingSyncImport = createIncomingSyncImport();

      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [incomingSyncImport],
        success: true,
        providerMode: 'superSyncOps',
        failedFileCount: 0,
        latestServerSeq: 42,
      });

      opLogStoreSpy.getUnsynced.and.resolveTo([]);
      stateSnapshotServiceSpy.getStateSnapshot.and.returnValue({
        task: { ids: ['task-1'] },
        project: { ids: [INBOX_PROJECT.id] },
        tag: { ids: [TODAY_TAG.id] },
        note: { ids: [] },
      } as any);

      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as any;

      const result = await service.downloadRemoteOps(mockProvider);

      expect(
        syncImportConflictDialogServiceSpy.showConflictDialog,
      ).not.toHaveBeenCalled();
      expect(remoteOpsProcessingServiceSpy.processRemoteOps).toHaveBeenCalledWith(
        [incomingSyncImport],
        jasmine.objectContaining({
          beforeFullStateApply: jasmine.any(Function),
        }),
      );
      expect(mockProvider.setLastServerSeq).toHaveBeenCalledWith(42);
      expect(result.kind).toBe('ops_processed');
    });

    it('should discard initial provider setup only after the incoming import commits', async () => {
      const incomingSyncImport = createIncomingSyncImport();
      const setupEntry = createProviderSetupEntry();
      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [incomingSyncImport],
        success: true,
        providerMode: 'superSyncOps',
        failedFileCount: 0,
        latestServerSeq: 42,
      });
      opLogStoreSpy.getUnsynced.and.resolveTo([setupEntry]);
      remoteOpsProcessingServiceSpy.processRemoteOps.and.resolveTo({
        localWinOpsCreated: 0,
        allOpsFilteredBySyncImport: false,
        filteredOpCount: 0,
        isLocalUnsyncedImport: false,
        blockedByIncompatibleOp: true,
      });
      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as unknown as OperationSyncCapable;

      const result = await service.downloadRemoteOps(mockProvider, {
        isNeverSynced: true,
      });

      expect(result.kind).toBe('blocked_incompatible');
      expect(opLogStoreSpy.markRejected).not.toHaveBeenCalled();
      expect(mockProvider.setLastServerSeq).not.toHaveBeenCalled();

      remoteOpsProcessingServiceSpy.processRemoteOps.and.resolveTo({
        localWinOpsCreated: 0,
        allOpsFilteredBySyncImport: false,
        filteredOpCount: 0,
        isLocalUnsyncedImport: false,
        blockedByIncompatibleOp: true,
        committedFullStateOpIds: [incomingSyncImport.id],
      });

      const committedPrefixResult = await service.downloadRemoteOps(mockProvider, {
        isNeverSynced: true,
      });

      expect(committedPrefixResult.kind).toBe('blocked_incompatible');
      expect(opLogStoreSpy.markRejected).toHaveBeenCalledOnceWith([setupEntry.op.id]);
      expect(mockProvider.setLastServerSeq).not.toHaveBeenCalled();

      const processingError = new Error('deferred drain failed');
      opLogStoreSpy.markRejected.calls.reset();
      opLogStoreSpy.getOpById.and.resolveTo(undefined);
      remoteOpsProcessingServiceSpy.processRemoteOps.and.rejectWith(processingError);

      await expectAsync(
        service.downloadRemoteOps(mockProvider, { isNeverSynced: true }),
      ).toBeRejectedWith(processingError);
      expect(opLogStoreSpy.markRejected).not.toHaveBeenCalled();

      for (const applicationStatus of ['applied', 'archive_pending', 'failed'] as const) {
        opLogStoreSpy.markRejected.calls.reset();
        opLogStoreSpy.getOpById.and.resolveTo({
          seq: 2,
          op: incomingSyncImport,
          appliedAt: Date.now(),
          source: 'remote',
          applicationStatus,
        });

        await expectAsync(
          service.downloadRemoteOps(mockProvider, { isNeverSynced: true }),
        ).toBeRejectedWith(processingError);
        expect(opLogStoreSpy.markRejected).toHaveBeenCalledOnceWith([setupEntry.op.id]);
      }
    });

    it('should show conflict dialog for incoming SYNC_IMPORT when client has pending meaningful ops', async () => {
      const incomingSyncImport = createIncomingSyncImport();

      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [incomingSyncImport],
        success: true,
        providerMode: 'superSyncOps',
        failedFileCount: 0,
        latestServerSeq: 42,
      });

      opLogStoreSpy.getUnsynced.and.resolveTo([
        {
          seq: 1,
          op: {
            id: 'local-op-1',
            clientId: 'client-A',
            actionType: 'test' as ActionType,
            opType: OpType.Update,
            entityType: 'TASK',
            entityId: 'task-1',
            payload: { title: 'Local Title' },
            vectorClock: { clientA: 1 },
            timestamp: Date.now(),
            schemaVersion: 1,
          },
          appliedAt: Date.now(),
          source: 'local',
        },
      ]);
      syncImportConflictDialogServiceSpy.showConflictDialog.and.resolveTo('CANCEL');

      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as any;

      const result = await service.downloadRemoteOps(mockProvider);

      expect(syncImportConflictDialogServiceSpy.showConflictDialog).toHaveBeenCalledWith(
        jasmine.objectContaining({
          scenario: 'INCOMING_IMPORT',
          syncImportReason: 'SERVER_MIGRATION',
        }),
      );
      expect(remoteOpsProcessingServiceSpy.processRemoteOps).not.toHaveBeenCalled();
      expect(mockProvider.setLastServerSeq).not.toHaveBeenCalled();
      expect(result.kind).toBe('cancelled');
    });

    // End-to-end guard for the reported data-loss trap: a genuinely-fresh client
    // (only the seeded example-task ops, never synced) meets a populated remote
    // SYNC_IMPORT. The dialog must receive isNeverSynced=true so USE_LOCAL — which
    // would overwrite the real remote with throwaway data — is guarded. Spans
    // service -> real conflict gate -> real coordinator -> dialog.
    it('flags isNeverSynced=true on the dialog for a never-synced client meeting a populated remote SYNC_IMPORT', async () => {
      const incomingSyncImport = createIncomingSyncImport();

      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [incomingSyncImport],
        success: true,
        providerMode: 'superSyncOps',
        failedFileCount: 0,
        latestServerSeq: 42,
      });

      // Fresh client: has meaningful pending work (a seeded example task) but has
      // never completed a sync.
      opLogStoreSpy.hasSyncedOps.and.resolveTo(false);
      opLogStoreSpy.getUnsynced.and.resolveTo([
        {
          seq: 1,
          op: {
            id: 'example-task-create',
            clientId: 'client-A',
            actionType: 'test' as ActionType,
            opType: OpType.Create,
            entityType: 'TASK',
            entityId: 'task-1',
            payload: { title: 'Example Task' },
            vectorClock: { clientA: 1 },
            timestamp: Date.now(),
            schemaVersion: 1,
          },
          appliedAt: Date.now(),
          source: 'local',
        },
      ]);
      syncImportConflictDialogServiceSpy.showConflictDialog.and.resolveTo('CANCEL');

      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as any;

      await service.downloadRemoteOps(mockProvider);

      expect(syncImportConflictDialogServiceSpy.showConflictDialog).toHaveBeenCalledWith(
        jasmine.objectContaining({
          scenario: 'INCOMING_IMPORT',
          isNeverSynced: true,
        }),
      );
    });

    it('should flush pending writes before checking incoming SYNC_IMPORT conflicts', async () => {
      const incomingSyncImport = createIncomingSyncImport();
      const events: string[] = [];

      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [incomingSyncImport],
        success: true,
        providerMode: 'superSyncOps',
        failedFileCount: 0,
        latestServerSeq: 42,
      });
      writeFlushServiceSpy.flushPendingWrites.and.callFake(async () => {
        events.push('flush');
      });
      opLogStoreSpy.getUnsynced.and.callFake(async () => {
        events.push('getUnsynced');
        return [];
      });

      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as any;

      const result = await service.downloadRemoteOps(mockProvider);

      expect(events.slice(0, 4)).toEqual(['flush', 'flush', 'flush', 'getUnsynced']);
      expect(remoteOpsProcessingServiceSpy.processRemoteOps).toHaveBeenCalledWith(
        [incomingSyncImport],
        jasmine.objectContaining({
          beforeFullStateApply: jasmine.any(Function),
        }),
      );
      expect(result.kind).toBe('ops_processed');
    });

    it('should abort downloaded SYNC_IMPORT apply when meaningful work appears after the initial gate', async () => {
      const incomingSyncImport = createIncomingSyncImport();
      const latePendingEntry: OperationLogEntry = {
        seq: 2,
        op: {
          id: 'late-download-local-op',
          clientId: 'client-A',
          actionType: 'test' as ActionType,
          opType: OpType.Update,
          entityType: 'TASK',
          entityId: 'task-1',
          payload: { title: 'Late local title' },
          vectorClock: { clientA: 2 },
          timestamp: Date.now(),
          schemaVersion: 1,
        },
        appliedAt: Date.now(),
        source: 'local',
      };

      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [incomingSyncImport],
        success: true,
        providerMode: 'superSyncOps',
        failedFileCount: 0,
        latestServerSeq: 42,
      });
      opLogStoreSpy.getUnsynced.and.returnValues(
        Promise.resolve([]),
        Promise.resolve([latePendingEntry]),
      );
      remoteOpsProcessingServiceSpy.processRemoteOps.and.callFake(
        async (ops, options) => {
          const shouldApply = options?.beforeFullStateApply
            ? await options.beforeFullStateApply(ops)
            : true;
          return {
            localWinOpsCreated: 0,
            allOpsFilteredBySyncImport: false,
            filteredOpCount: 0,
            isLocalUnsyncedImport: false,
            blockedByIncompatibleOp: false,
            fullStateApplyBlockedByLocalConflict: !shouldApply,
          };
        },
      );
      syncImportConflictDialogServiceSpy.showConflictDialog.and.resolveTo('CANCEL');
      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as unknown as OperationSyncCapable;

      const result = await service.downloadRemoteOps(mockProvider);

      expect(syncImportConflictDialogServiceSpy.showConflictDialog).toHaveBeenCalledWith(
        jasmine.objectContaining({ scenario: 'INCOMING_IMPORT' }),
      );
      expect(mockProvider.setLastServerSeq).not.toHaveBeenCalled();
      expect(result.kind).toBe('cancelled');
    });

    it('should prompt before replacing pending user config with an incoming SYNC_IMPORT', async () => {
      const incomingSyncImport = createIncomingSyncImport();

      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [incomingSyncImport],
        success: true,
        providerMode: 'superSyncOps',
        failedFileCount: 0,
        latestServerSeq: 42,
      });

      opLogStoreSpy.getUnsynced.and.resolveTo([
        {
          seq: 1,
          op: {
            id: 'local-config-op-1',
            clientId: 'client-A',
            actionType: '[Global Config] Update Global Config Section' as ActionType,
            opType: OpType.Update,
            entityType: 'GLOBAL_CONFIG',
            entityId: 'sync',
            payload: { sectionKey: 'sync' },
            vectorClock: { clientA: 1 },
            timestamp: Date.now(),
            schemaVersion: 1,
          },
          appliedAt: Date.now(),
          source: 'local',
        },
      ]);

      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as any;

      const result = await service.downloadRemoteOps(mockProvider);

      expect(syncImportConflictDialogServiceSpy.showConflictDialog).toHaveBeenCalled();
      expect(opLogStoreSpy.markRejected).not.toHaveBeenCalled();
      expect(remoteOpsProcessingServiceSpy.processRemoteOps).not.toHaveBeenCalled();
      expect(mockProvider.setLastServerSeq).not.toHaveBeenCalled();
      expect(result.kind).toBe('cancelled');
    });

    it('should prompt when pending user config exists alongside startup example tasks', async () => {
      const incomingSyncImport = createIncomingSyncImport();

      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [incomingSyncImport],
        success: true,
        providerMode: 'superSyncOps',
        failedFileCount: 0,
        latestServerSeq: 42,
      });

      const pendingConfigEntry: OperationLogEntry = {
        seq: 1,
        op: {
          id: 'local-config-op-1',
          clientId: 'client-A',
          actionType: ActionType.GLOBAL_CONFIG_UPDATE_SECTION,
          opType: OpType.Update,
          entityType: 'GLOBAL_CONFIG',
          entityId: 'sync',
          payload: { sectionKey: 'sync' },
          vectorClock: { clientA: 1 },
          timestamp: Date.now(),
          schemaVersion: 1,
        },
        appliedAt: Date.now(),
        source: 'local',
      };
      const pendingExampleTaskEntries: OperationLogEntry[] = [1, 2, 3, 4].map(
        (counter) => ({
          seq: counter + 1,
          op: {
            id: `local-example-task-op-${counter}`,
            clientId: 'client-A',
            actionType: ActionType.TASK_SHARED_ADD,
            opType: OpType.Create,
            entityType: 'TASK',
            entityId: `example-task-${counter}`,
            payload: {
              actionPayload: {
                task: { id: `example-task-${counter}` },
                isExampleTask: true,
              },
              entityChanges: [],
            },
            vectorClock: { clientA: counter + 1 },
            timestamp: Date.now(),
            schemaVersion: 1,
          },
          appliedAt: Date.now(),
          source: 'local',
        }),
      );
      opLogStoreSpy.getUnsynced.and.resolveTo([
        pendingConfigEntry,
        ...pendingExampleTaskEntries,
      ]);

      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as any;

      const result = await service.downloadRemoteOps(mockProvider);

      expect(syncImportConflictDialogServiceSpy.showConflictDialog).toHaveBeenCalled();
      expect(opLogStoreSpy.markRejected).not.toHaveBeenCalled();
      expect(remoteOpsProcessingServiceSpy.processRemoteOps).not.toHaveBeenCalled();
      expect(mockProvider.setLastServerSeq).not.toHaveBeenCalled();
      expect(result.kind).toBe('cancelled');
    });
  });

  describe('piggybacked SYNC_IMPORT conflict dialog', () => {
    let uploadServiceSpy: jasmine.SpyObj<OperationLogUploadService>;

    beforeEach(() => {
      uploadServiceSpy = TestBed.inject(
        OperationLogUploadService,
      ) as jasmine.SpyObj<OperationLogUploadService>;

      // Not a fresh client
      opLogStoreSpy.loadStateCache.and.resolveTo({
        state: {},
        lastAppliedOpSeq: 1,
        vectorClock: {},
        compactedAt: Date.now(),
      });
      opLogStoreSpy.getLastSeq.and.resolveTo(1);
    });

    it('should show conflict dialog when piggybacked ops contain SYNC_IMPORT and client has pending ops', async () => {
      const piggybackedSyncImport: Operation = {
        id: 'import-1',
        clientId: 'client-B',
        actionType: ActionType.LOAD_ALL_DATA,
        opType: OpType.SyncImport,
        entityType: 'ALL',
        payload: { task: { ids: ['remote-task'] } },
        vectorClock: { clientB: 5 },
        timestamp: Date.now(),
        schemaVersion: 1,
        syncImportReason: 'SERVER_MIGRATION',
      };

      uploadServiceSpy.uploadPendingOps.and.resolveTo({
        uploadedCount: 1,
        piggybackedOps: [piggybackedSyncImport],
        rejectedCount: 0,
        rejectedOps: [],
        pendingAcknowledgementSeqs: [1],
        lastServerSeqToPersist: 42,
      });

      // Client has pending ops
      const pendingEntry: OperationLogEntry = {
        seq: 1,
        op: {
          id: 'local-op-1',
          clientId: 'client-A',
          actionType: 'test' as ActionType,
          opType: OpType.Update,
          entityType: 'TASK',
          entityId: 'task-1',
          payload: { title: 'Local Title' },
          vectorClock: { clientA: 1 },
          timestamp: Date.now(),
          schemaVersion: 1,
        },
        appliedAt: Date.now(),
        source: 'local',
      };
      opLogStoreSpy.getUnsynced.and.resolveTo([pendingEntry]);

      syncImportConflictDialogServiceSpy.showConflictDialog.and.resolveTo('CANCEL');

      const mockProvider = {
        isReady: () => Promise.resolve(true),
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as unknown as OperationSyncCapable;

      const result = await service.uploadPendingOps(mockProvider);

      expect(syncImportConflictDialogServiceSpy.showConflictDialog).toHaveBeenCalledWith(
        jasmine.objectContaining({
          scenario: 'INCOMING_IMPORT',
          syncImportReason: 'SERVER_MIGRATION',
        }),
      );
      expect(opLogStoreSpy.markSynced).not.toHaveBeenCalled();
      expect(mockProvider.setLastServerSeq).not.toHaveBeenCalled();
      expect(result.kind).toBe('cancelled');
    });

    it('should show conflict dialog for local work accepted in the SAME upload round (pre-upload snapshot race)', async () => {
      const piggybackedSyncImport: Operation = {
        id: 'import-1',
        clientId: 'client-B',
        actionType: ActionType.LOAD_ALL_DATA,
        opType: OpType.SyncImport,
        entityType: 'ALL',
        payload: { task: { ids: ['remote-task'] } },
        vectorClock: { clientB: 5 },
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      const pendingEntry: OperationLogEntry = {
        seq: 1,
        op: {
          id: 'local-op-1',
          clientId: 'client-A',
          actionType: 'test' as ActionType,
          opType: OpType.Update,
          entityType: 'TASK',
          entityId: 'task-1',
          payload: { title: 'Local Title' },
          vectorClock: { clientA: 1 },
          timestamp: Date.now(),
          schemaVersion: 1,
        },
        appliedAt: Date.now(),
        source: 'local',
      };
      uploadServiceSpy.uploadPendingOps.and.resolveTo({
        uploadedCount: 1,
        piggybackedOps: [piggybackedSyncImport],
        rejectedCount: 0,
        rejectedOps: [],
        selectedPendingOps: [pendingEntry],
        pendingAcknowledgementSeqs: [pendingEntry.seq],
      });
      // The accepted operation is represented by the exact in-lock upload snapshot;
      // it no longer needs to remain live-unsynced for the gate to protect it.
      opLogStoreSpy.getUnsynced.and.resolveTo([]);

      syncImportConflictDialogServiceSpy.showConflictDialog.and.resolveTo('CANCEL');

      const mockProvider = {
        isReady: () => Promise.resolve(true),
      } as unknown as OperationSyncCapable;

      const result = await service.uploadPendingOps(mockProvider);

      // Without the pre-upload snapshot, the gate would read the (now empty)
      // live pending set and silently accept the import over the local edit.
      expect(syncImportConflictDialogServiceSpy.showConflictDialog).toHaveBeenCalledWith(
        jasmine.objectContaining({ scenario: 'INCOMING_IMPORT' }),
      );
      expect(opLogStoreSpy.markSynced).not.toHaveBeenCalled();
      expect(result.kind).toBe('cancelled');
    });

    it('should process piggybacked SYNC_IMPORT silently when client only has already-synced meaningful data', async () => {
      const piggybackedSyncImport: Operation = {
        id: 'import-1',
        clientId: 'client-B',
        actionType: ActionType.LOAD_ALL_DATA,
        opType: OpType.SyncImport,
        entityType: 'ALL',
        payload: {},
        vectorClock: { clientB: 5 },
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      uploadServiceSpy.uploadPendingOps.and.resolveTo({
        uploadedCount: 1,
        piggybackedOps: [piggybackedSyncImport],
        rejectedCount: 0,
        rejectedOps: [],
      });

      // No pending ops but meaningful local data — this is already-synced state,
      // not a conflict with the incoming full-state op.
      opLogStoreSpy.getUnsynced.and.resolveTo([]);
      stateSnapshotServiceSpy.getStateSnapshot.and.returnValue({
        task: { ids: ['task-1'] },
        project: { ids: [INBOX_PROJECT.id] },
        tag: { ids: [TODAY_TAG.id] },
        note: { ids: [] },
      } as any);

      const mockProvider = {
        isReady: () => Promise.resolve(true),
      } as any;

      const result = await service.uploadPendingOps(mockProvider);

      expect(
        syncImportConflictDialogServiceSpy.showConflictDialog,
      ).not.toHaveBeenCalled();
      expect(remoteOpsProcessingServiceSpy.processRemoteOps).toHaveBeenCalledWith(
        [piggybackedSyncImport],
        jasmine.objectContaining({
          beforeFullStateApply: jasmine.any(Function),
        }),
      );
      expect(result.kind).toBe('completed');
    });

    it('should reject a live provider setup op after silently applying a piggybacked import on initial sync', async () => {
      const piggybackedSyncImport: Operation = {
        id: 'import-1',
        clientId: 'client-B',
        actionType: ActionType.LOAD_ALL_DATA,
        opType: OpType.SyncImport,
        entityType: 'ALL',
        payload: {},
        vectorClock: { clientB: 5 },
        timestamp: Date.now(),
        schemaVersion: 1,
      };
      const setupEntry = createProviderSetupEntry();

      uploadServiceSpy.uploadPendingOps.and.resolveTo({
        uploadedCount: 1,
        piggybackedOps: [piggybackedSyncImport],
        rejectedCount: 0,
        rejectedOps: [],
        selectedPendingOps: [setupEntry],
      });
      opLogStoreSpy.getUnsynced.and.resolveTo([setupEntry]);
      remoteOpsProcessingServiceSpy.processRemoteOps.and.resolveTo({
        localWinOpsCreated: 0,
        allOpsFilteredBySyncImport: false,
        filteredOpCount: 0,
        isLocalUnsyncedImport: false,
        blockedByIncompatibleOp: false,
        committedFullStateOpIds: [piggybackedSyncImport.id],
      });

      const mockProvider = {
        isReady: () => Promise.resolve(true),
      } as unknown as OperationSyncCapable;

      const result = await service.uploadPendingOps(mockProvider, {
        isNeverSynced: true,
      });

      expect(
        syncImportConflictDialogServiceSpy.showConflictDialog,
      ).not.toHaveBeenCalled();
      expect(opLogStoreSpy.markRejected).toHaveBeenCalledOnceWith([
        'sync-provider-setup',
      ]);
      expect(remoteOpsProcessingServiceSpy.processRemoteOps).toHaveBeenCalledWith(
        [piggybackedSyncImport],
        jasmine.objectContaining({
          beforeFullStateApply: jasmine.any(Function),
        }),
      );
      expect(result.kind).toBe('completed');
    });

    it('should keep the initial provider setup op pending when piggybacked import processing is blocked', async () => {
      const piggybackedSyncImport: Operation = {
        id: 'import-1',
        clientId: 'client-B',
        actionType: ActionType.LOAD_ALL_DATA,
        opType: OpType.SyncImport,
        entityType: 'ALL',
        payload: {},
        vectorClock: { clientB: 5 },
        timestamp: Date.now(),
        schemaVersion: 1,
      };
      const setupEntry = createProviderSetupEntry();
      uploadServiceSpy.uploadPendingOps.and.resolveTo({
        uploadedCount: 1,
        piggybackedOps: [piggybackedSyncImport],
        rejectedCount: 0,
        rejectedOps: [],
        selectedPendingOps: [setupEntry],
      });
      opLogStoreSpy.getUnsynced.and.resolveTo([setupEntry]);
      remoteOpsProcessingServiceSpy.processRemoteOps.and.resolveTo({
        localWinOpsCreated: 0,
        allOpsFilteredBySyncImport: false,
        filteredOpCount: 0,
        isLocalUnsyncedImport: false,
        blockedByIncompatibleOp: true,
      });
      const mockProvider = {
        isReady: () => Promise.resolve(true),
      } as unknown as OperationSyncCapable;

      const result = await service.uploadPendingOps(mockProvider, {
        isNeverSynced: true,
      });

      expect(result.kind).toBe('blocked_incompatible');
      expect(opLogStoreSpy.markRejected).not.toHaveBeenCalled();

      remoteOpsProcessingServiceSpy.processRemoteOps.and.resolveTo({
        localWinOpsCreated: 0,
        allOpsFilteredBySyncImport: false,
        filteredOpCount: 0,
        isLocalUnsyncedImport: false,
        blockedByIncompatibleOp: true,
        committedFullStateOpIds: [piggybackedSyncImport.id],
      });

      const committedPrefixResult = await service.uploadPendingOps(mockProvider, {
        isNeverSynced: true,
      });

      expect(committedPrefixResult.kind).toBe('blocked_incompatible');
      expect(opLogStoreSpy.markRejected).toHaveBeenCalledOnceWith([setupEntry.op.id]);
    });

    it('should flush again before checking piggybacked SYNC_IMPORT conflicts', async () => {
      const piggybackedSyncImport: Operation = {
        id: 'import-1',
        clientId: 'client-B',
        actionType: ActionType.LOAD_ALL_DATA,
        opType: OpType.SyncImport,
        entityType: 'ALL',
        payload: {},
        vectorClock: { clientB: 5 },
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      uploadServiceSpy.uploadPendingOps.and.resolveTo({
        uploadedCount: 1,
        piggybackedOps: [piggybackedSyncImport],
        rejectedCount: 0,
        rejectedOps: [],
      });
      opLogStoreSpy.getUnsynced.and.resolveTo([]);

      const mockProvider = {
        isReady: () => Promise.resolve(true),
      } as any;

      const result = await service.uploadPendingOps(mockProvider);

      expect(writeFlushServiceSpy.flushPendingWrites).toHaveBeenCalledTimes(3);
      expect(opLogStoreSpy.getUnsynced).toHaveBeenCalled();
      expect(result.kind).toBe('completed');
    });

    it('should abort piggybacked SYNC_IMPORT apply when meaningful work appears after the initial gate', async () => {
      const piggybackedSyncImport: Operation = {
        id: 'import-1',
        clientId: 'client-B',
        actionType: ActionType.LOAD_ALL_DATA,
        opType: OpType.SyncImport,
        entityType: 'ALL',
        payload: {},
        vectorClock: { clientB: 5 },
        timestamp: Date.now(),
        schemaVersion: 1,
      };
      const latePendingEntry: OperationLogEntry = {
        seq: 2,
        op: {
          id: 'late-local-op',
          clientId: 'client-A',
          actionType: 'test' as ActionType,
          opType: OpType.Update,
          entityType: 'TASK',
          entityId: 'task-1',
          payload: { title: 'Late local title' },
          vectorClock: { clientA: 2 },
          timestamp: Date.now(),
          schemaVersion: 1,
        },
        appliedAt: Date.now(),
        source: 'local',
      };

      uploadServiceSpy.uploadPendingOps.and.resolveTo({
        uploadedCount: 1,
        piggybackedOps: [piggybackedSyncImport],
        rejectedCount: 0,
        rejectedOps: [],
        pendingAcknowledgementSeqs: [1],
      });
      // The first read is the initial post-upload gate. The second read is the
      // final in-lock recheck immediately before full-state application.
      opLogStoreSpy.getUnsynced.and.returnValues(
        Promise.resolve([]),
        Promise.resolve([latePendingEntry]),
      );
      remoteOpsProcessingServiceSpy.processRemoteOps.and.callFake(
        async (ops, options) => {
          const finalGuard = (
            options as
              | {
                  beforeFullStateApply?: (fullStateOps: Operation[]) => Promise<boolean>;
                }
              | undefined
          )?.beforeFullStateApply;
          const shouldApply = finalGuard ? await finalGuard(ops) : true;
          return {
            localWinOpsCreated: 0,
            allOpsFilteredBySyncImport: false,
            filteredOpCount: 0,
            isLocalUnsyncedImport: false,
            blockedByIncompatibleOp: false,
            fullStateApplyBlockedByLocalConflict: !shouldApply,
          };
        },
      );
      syncImportConflictDialogServiceSpy.showConflictDialog.and.resolveTo('CANCEL');

      const mockProvider = {
        isReady: () => Promise.resolve(true),
      } as unknown as OperationSyncCapable;

      const result = await service.uploadPendingOps(mockProvider);

      expect(syncImportConflictDialogServiceSpy.showConflictDialog).toHaveBeenCalledWith(
        jasmine.objectContaining({ scenario: 'INCOMING_IMPORT' }),
      );
      expect(opLogStoreSpy.markSynced).not.toHaveBeenCalled();
      expect(result.kind).toBe('cancelled');
    });

    it('should process piggybacked SYNC_IMPORT silently when no meaningful local data', async () => {
      const piggybackedSyncImport: Operation = {
        id: 'import-1',
        clientId: 'client-B',
        actionType: ActionType.LOAD_ALL_DATA,
        opType: OpType.SyncImport,
        entityType: 'ALL',
        payload: {},
        vectorClock: { clientB: 5 },
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      uploadServiceSpy.uploadPendingOps.and.resolveTo({
        uploadedCount: 1,
        piggybackedOps: [piggybackedSyncImport],
        rejectedCount: 0,
        rejectedOps: [],
      });

      // No pending ops AND no meaningful data (only defaults)
      opLogStoreSpy.getUnsynced.and.resolveTo([]);
      stateSnapshotServiceSpy.getStateSnapshot.and.returnValue({
        task: { ids: [] },
        project: { ids: [INBOX_PROJECT.id] },
        tag: { ids: [TODAY_TAG.id] },
        note: { ids: [] },
      } as any);

      const mockProvider = {
        isReady: () => Promise.resolve(true),
      } as any;

      const result = await service.uploadPendingOps(mockProvider);

      // Should NOT show dialog
      expect(
        syncImportConflictDialogServiceSpy.showConflictDialog,
      ).not.toHaveBeenCalled();
      // Should process normally via processRemoteOps
      expect(remoteOpsProcessingServiceSpy.processRemoteOps).toHaveBeenCalledWith(
        [piggybackedSyncImport],
        jasmine.objectContaining({
          beforeFullStateApply: jasmine.any(Function),
        }),
      );
      expect(result.kind).not.toBe('cancelled');
    });

    it('should process piggybacked ops normally when no SYNC_IMPORT present', async () => {
      const events: string[] = [];
      const piggybackedOp: Operation = {
        id: 'op-1',
        clientId: 'client-B',
        actionType: 'test' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Remote Title' },
        vectorClock: { clientB: 1 },
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      uploadServiceSpy.uploadPendingOps.and.resolveTo({
        uploadedCount: 1,
        piggybackedOps: [piggybackedOp],
        rejectedCount: 0,
        rejectedOps: [],
        pendingAcknowledgementSeqs: [1],
      });

      opLogStoreSpy.getUnsynced.and.resolveTo([]);
      remoteOpsProcessingServiceSpy.processRemoteOps.and.callFake(async () => {
        events.push('processRemoteOps');
        return {
          localWinOpsCreated: 0,
          allOpsFilteredBySyncImport: false,
          filteredOpCount: 0,
          isLocalUnsyncedImport: false,
          blockedByIncompatibleOp: false,
        };
      });
      opLogStoreSpy.markSynced.and.callFake(async () => {
        events.push('markSynced');
      });

      const mockProvider = {
        isReady: () => Promise.resolve(true),
      } as any;

      const result = await service.uploadPendingOps(mockProvider);

      // Should NOT show dialog
      expect(
        syncImportConflictDialogServiceSpy.showConflictDialog,
      ).not.toHaveBeenCalled();
      // Should process normally
      expect(remoteOpsProcessingServiceSpy.processRemoteOps).toHaveBeenCalledWith(
        [piggybackedOp],
        jasmine.objectContaining({
          beforeFullStateApply: jasmine.any(Function),
        }),
      );
      expect(opLogStoreSpy.markSynced).toHaveBeenCalledOnceWith([1]);
      expect(events).toEqual(['processRemoteOps', 'markSynced']);
      expect(result.kind).not.toBe('cancelled');
    });

    it('should call forceUploadLocalState when user chooses USE_LOCAL', async () => {
      const piggybackedSyncImport: Operation = {
        id: 'import-1',
        clientId: 'client-B',
        actionType: ActionType.LOAD_ALL_DATA,
        opType: OpType.SyncImport,
        entityType: 'ALL',
        payload: {},
        vectorClock: { clientB: 5 },
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      uploadServiceSpy.uploadPendingOps.and.resolveTo({
        uploadedCount: 1,
        piggybackedOps: [piggybackedSyncImport],
        rejectedCount: 0,
        rejectedOps: [],
      });

      opLogStoreSpy.getUnsynced.and.resolveTo([
        {
          seq: 1,
          op: {
            id: 'local-op-1',
            clientId: 'client-A',
            actionType: 'test' as ActionType,
            opType: OpType.Update,
            entityType: 'TASK',
            entityId: 'task-1',
            payload: { title: 'Local Title' },
            vectorClock: { clientA: 1 },
            timestamp: Date.now(),
            schemaVersion: 1,
          },
          appliedAt: Date.now(),
          source: 'local',
        },
      ]);
      stateSnapshotServiceSpy.getStateSnapshot.and.returnValue({
        task: { ids: ['task-1'] },
        project: { ids: [INBOX_PROJECT.id] },
        tag: { ids: [TODAY_TAG.id] },
        note: { ids: [] },
      } as any);

      syncImportConflictDialogServiceSpy.showConflictDialog.and.resolveTo('USE_LOCAL');

      const forceUploadSpy = spyOn(service, 'forceUploadLocalState').and.resolveTo({
        hasUnresolvedOps: false,
      });

      const mockProvider = {
        isReady: () => Promise.resolve(true),
      } as any;

      await service.uploadPendingOps(mockProvider);

      expect(forceUploadSpy).toHaveBeenCalledWith(mockProvider);

      forceUploadSpy.and.resolveTo({ hasUnresolvedOps: true });
      await expectAsync(service.uploadPendingOps(mockProvider)).toBeRejectedWithError(
        ForceUploadPendingOpsError,
      );
    });

    it('should call forceDownloadRemoteState when user chooses USE_REMOTE', async () => {
      const piggybackedSyncImport: Operation = {
        id: 'import-1',
        clientId: 'client-B',
        actionType: ActionType.LOAD_ALL_DATA,
        opType: OpType.SyncImport,
        entityType: 'ALL',
        payload: {},
        vectorClock: { clientB: 5 },
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      uploadServiceSpy.uploadPendingOps.and.resolveTo({
        uploadedCount: 1,
        piggybackedOps: [piggybackedSyncImport],
        rejectedCount: 0,
        rejectedOps: [],
      });

      opLogStoreSpy.getUnsynced.and.resolveTo([
        {
          seq: 1,
          op: {
            id: 'local-op-1',
            clientId: 'client-A',
            actionType: 'test' as ActionType,
            opType: OpType.Update,
            entityType: 'TASK',
            entityId: 'task-1',
            payload: { title: 'Local Title' },
            vectorClock: { clientA: 1 },
            timestamp: Date.now(),
            schemaVersion: 1,
          },
          appliedAt: Date.now(),
          source: 'local',
        },
      ]);
      stateSnapshotServiceSpy.getStateSnapshot.and.returnValue({
        task: { ids: ['task-1'] },
        project: { ids: [INBOX_PROJECT.id] },
        tag: { ids: [TODAY_TAG.id] },
        note: { ids: [] },
      } as any);

      syncImportConflictDialogServiceSpy.showConflictDialog.and.resolveTo('USE_REMOTE');

      const forceDownloadSpy = spyOn(service, 'forceDownloadRemoteState').and.resolveTo();

      const mockProvider = {
        isReady: () => Promise.resolve(true),
      } as any;

      await service.uploadPendingOps(mockProvider);

      expect(forceDownloadSpy).toHaveBeenCalledWith(mockProvider);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BUG CONFIRMATION TESTS (Issue #6571)
  // These tests confirm bugs where sync reports success despite errors.
  // Each test documents current (buggy) behavior and expected (fixed) behavior.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Bug #6571: sync reports IN_SYNC despite errors', () => {
    let uploadServiceSpy: jasmine.SpyObj<OperationLogUploadService>;
    let downloadServiceSpy: jasmine.SpyObj<OperationLogDownloadService>;

    beforeEach(() => {
      uploadServiceSpy = TestBed.inject(
        OperationLogUploadService,
      ) as jasmine.SpyObj<OperationLogUploadService>;
      downloadServiceSpy = TestBed.inject(
        OperationLogDownloadService,
      ) as jasmine.SpyObj<OperationLogDownloadService>;

      // Default: not a fresh client
      (opLogStoreSpy as any).loadStateCache = jasmine
        .createSpy('loadStateCache')
        .and.returnValue(Promise.resolve({ state: {} }));
      (opLogStoreSpy as any).getLastSeq = jasmine
        .createSpy('getLastSeq')
        .and.returnValue(Promise.resolve(1));
    });

    describe('Bug 1: download failure (success=false) treated as no_new_ops', () => {
      it('should NOT return no_new_ops when download failed (success=false)', async () => {
        downloadServiceSpy.downloadRemoteOps.and.returnValue(
          Promise.resolve({
            newOps: [],
            success: false,
            failedFileCount: 0,
          }),
        );

        const mockProvider = {
          isReady: () => Promise.resolve(true),
          setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
        } as any;

        // FIXED: Should throw when download failed, not silently return no_new_ops
        await expectAsync(service.downloadRemoteOps(mockProvider)).toBeRejectedWithError(
          /Download failed/,
        );
      });
    });

    describe('Bug 3: handleRejectedOps error is swallowed', () => {
      it('should propagate errors from handleRejectedOps', async () => {
        opLogStoreSpy.getUnsynced.and.returnValue(Promise.resolve([]));

        uploadServiceSpy.uploadPendingOps.and.returnValue(
          Promise.resolve({
            uploadedCount: 1,
            piggybackedOps: [],
            rejectedCount: 1,
            rejectedOps: [{ opId: 'op-1', error: 'conflict' }],
          }),
        );

        rejectedOpsHandlerServiceSpy.handleRejectedOps.and.rejectWith(
          new Error('Rejection handling failed'),
        );

        const mockProvider = {
          isReady: () => Promise.resolve(true),
        } as any;

        // FIXED: Should reject when rejection handler throws
        await expectAsync(service.uploadPendingOps(mockProvider)).toBeRejectedWithError(
          'Rejection handling failed',
        );
      });
    });

    describe('lastServerSeq preservation on error (prevents permanent divergence)', () => {
      it('should NOT persist lastServerSeq when download fails (success=false)', async () => {
        downloadServiceSpy.downloadRemoteOps.and.returnValue(
          Promise.resolve({
            newOps: [],
            success: false,
            failedFileCount: 0,
            latestServerSeq: 42,
          }),
        );

        const setLastServerSeqSpy = jasmine.createSpy('setLastServerSeq').and.resolveTo();

        const mockProvider = {
          isReady: () => Promise.resolve(true),
          setLastServerSeq: setLastServerSeqSpy,
        } as any;

        // Download fails — error thrown
        await expectAsync(service.downloadRemoteOps(mockProvider)).toBeRejected();

        // CRITICAL: lastServerSeq must NOT be persisted.
        // If it were, the client would never re-download the failed ops.
        expect(setLastServerSeqSpy).not.toHaveBeenCalled();
      });

      it('should NOT persist lastServerSeq when processRemoteOps throws', async () => {
        const remoteOp: Operation = {
          id: 'remote-1',
          clientId: 'client-B',
          actionType: 'test' as ActionType,
          opType: OpType.Update,
          entityType: 'TASK' as const,
          entityId: 'task-1',
          payload: {},
          vectorClock: { clientB: 1 },
          timestamp: Date.now(),
          schemaVersion: 1,
        };

        downloadServiceSpy.downloadRemoteOps.and.returnValue(
          Promise.resolve({
            newOps: [remoteOp],
            success: true,
            providerMode: 'superSyncOps',
            failedFileCount: 0,
            latestServerSeq: 42,
          }),
        );

        // processRemoteOps throws (e.g., LWW apply failure after Bug 2 fix)
        remoteOpsProcessingServiceSpy.processRemoteOps.and.rejectWith(
          new Error('Apply failed during conflict resolution'),
        );

        const setLastServerSeqSpy = jasmine.createSpy('setLastServerSeq').and.resolveTo();

        const mockProvider = {
          isReady: () => Promise.resolve(true),
          setLastServerSeq: setLastServerSeqSpy,
        } as any;

        await expectAsync(service.downloadRemoteOps(mockProvider)).toBeRejected();

        // CRITICAL: lastServerSeq must NOT be persisted.
        // Client will re-download from the old seq on next sync.
        expect(setLastServerSeqSpy).not.toHaveBeenCalled();
      });

      it('should persist lastServerSeq on successful download (control test)', async () => {
        downloadServiceSpy.downloadRemoteOps.and.returnValue(
          Promise.resolve({
            newOps: [],
            success: true,
            providerMode: 'superSyncOps',
            failedFileCount: 0,
            latestServerSeq: 42,
          }),
        );

        const setLastServerSeqSpy = jasmine.createSpy('setLastServerSeq').and.resolveTo();

        const mockProvider = {
          isReady: () => Promise.resolve(true),
          setLastServerSeq: setLastServerSeqSpy,
        } as any;

        await service.downloadRemoteOps(mockProvider);

        // On success, lastServerSeq IS persisted
        expect(setLastServerSeqSpy).toHaveBeenCalledWith(42);
      });
    });
  });
});
