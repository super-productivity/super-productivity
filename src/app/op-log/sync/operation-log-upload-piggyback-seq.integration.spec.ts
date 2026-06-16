import { TestBed } from '@angular/core/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { OperationLogSyncService } from './operation-log-sync.service';
import { OperationLogUploadService } from './operation-log-upload.service';
import { OperationEncryptionService } from './operation-encryption.service';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { SchemaMigrationService } from '../persistence/schema-migration.service';
import { SnackService } from '../../core/snack/snack.service';
import { VectorClockService } from './vector-clock.service';
import { OperationApplierService } from '../apply/operation-applier.service';
import { ConflictResolutionService } from './conflict-resolution.service';
import { ValidateStateService } from '../validation/validate-state.service';
import { RepairOperationService } from '../validation/repair-operation.service';
import { OperationLogDownloadService } from './operation-log-download.service';
import { LockService } from './lock.service';
import { OperationLogCompactionService } from '../persistence/operation-log-compaction.service';
import { SyncImportFilterService } from './sync-import-filter.service';
import { ServerMigrationService } from './server-migration.service';
import { SupersededOperationResolverService } from './superseded-operation-resolver.service';
import { RemoteOpsProcessingService } from './remote-ops-processing.service';
import { RejectedOpsHandlerService } from './rejected-ops-handler.service';
import { OperationWriteFlushService } from './operation-write-flush.service';
import { SuperSyncStatusService } from './super-sync-status.service';
import { SyncHydrationService } from '../persistence/sync-hydration.service';
import { SyncImportConflictDialogService } from './sync-import-conflict-dialog.service';
import { StateSnapshotService } from '../backup/state-snapshot.service';
import { BackupService } from '../backup/backup.service';
import { TranslateService } from '@ngx-translate/core';
import { ActionType, OperationLogEntry, OpType } from '../core/operation.types';
import { INBOX_PROJECT } from '../../features/project/project.const';
import { TODAY_TAG } from '../../features/tag/tag.const';
import type {
  OperationSyncCapable,
  SyncOperation,
} from '../sync-providers/provider.interface';

/**
 * #8304 cross-service integration test.
 *
 * Unlike the unit specs (which mock OperationLogUploadService out of
 * OperationLogSyncService), this wires the REAL OperationLogUploadService and the
 * REAL OperationLogSyncService.uploadPendingOps together over a single fake provider
 * whose lastServerSeq lives in one in-memory variable. That round-trip is the part
 * the unit specs cannot exercise: the upload service must DEFER the seq persist and
 * the sync service must persist it ONLY after the piggybacked ops are applied.
 *
 * The invariant under test (the data-loss window #8304 closes): the persisted
 * lastServerSeq must NEVER advance past piggybacked ops that were not applied —
 * whether the user cancels the SYNC_IMPORT dialog or the apply step throws. On
 * success it must advance, but only after processRemoteOps completes.
 *
 * processRemoteOps and the conflict-gate's downstream apply are mocked (controllable
 * crash/cancel); everything between provider.uploadOps and provider.setLastServerSeq
 * is the real two-service code path.
 */
describe('OperationLogSyncService + OperationLogUploadService — piggyback seq persistence (#8304)', () => {
  let service: OperationLogSyncService;
  let opLogStoreSpy: jasmine.SpyObj<OperationLogStoreService>;
  let remoteOpsProcessingServiceSpy: jasmine.SpyObj<RemoteOpsProcessingService>;
  let dialogServiceSpy: jasmine.SpyObj<SyncImportConflictDialogService>;

  // The single source of truth for the server cursor, shared by both real services
  // through the fake provider. Assertions read this directly.
  let persistedServerSeq: number;
  let setLastServerSeqSpy: jasmine.Spy;
  let uploadOpsSpy: jasmine.Spy;

  const INITIAL_SEQ = 40;
  const SERVER_LATEST_SEQ = 50;

  // A meaningful local pending op so the conflict gate produces dialog data when a
  // SYNC_IMPORT is piggybacked (mirrors the existing unit spec's gate setup).
  const localPendingEntry: OperationLogEntry = {
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
      timestamp: 1700000000000,
      schemaVersion: 1,
    },
    appliedAt: 1700000000000,
    source: 'local',
  };

  const makePiggybackSyncImport = (): SyncOperation => ({
    id: 'remote-sync-import',
    clientId: 'client-B',
    actionType: ActionType.LOAD_ALL_DATA,
    opType: OpType.SyncImport,
    entityType: 'ALL',
    payload: {},
    vectorClock: { clientB: 5 },
    timestamp: 1700000000001,
    schemaVersion: 1,
  });

  const makePiggybackRegularUpdate = (): SyncOperation => ({
    id: 'remote-update',
    clientId: 'client-B',
    actionType: '[Task] Update',
    opType: OpType.Update,
    entityType: 'TASK',
    entityId: 'task-9',
    payload: { changes: { title: 'Remote update' } },
    vectorClock: { clientB: 5 },
    timestamp: 1700000000001,
    schemaVersion: 1,
  });

  /**
   * Builds a fake OperationSyncCapable provider whose uploadOps piggybacks the given
   * ops and whose lastServerSeq is backed by `persistedServerSeq`.
   */
  const makeProvider = (piggybackOps: SyncOperation[]): OperationSyncCapable => {
    uploadOpsSpy = jasmine.createSpy('uploadOps').and.callFake(async () => ({
      results: [{ opId: localPendingEntry.op.id, accepted: true }],
      latestSeq: SERVER_LATEST_SEQ,
      newOps: piggybackOps.map((op, i) => ({
        serverSeq: SERVER_LATEST_SEQ - (piggybackOps.length - 1 - i),
        receivedAt: 1700000000002,
        op,
      })),
    }));
    setLastServerSeqSpy = jasmine
      .createSpy('setLastServerSeq')
      .and.callFake(async (n: number) => {
        persistedServerSeq = n;
      });
    return {
      isReady: () => Promise.resolve(true),
      supportsOperationSync: true,
      getLastServerSeq: () => Promise.resolve(persistedServerSeq),
      setLastServerSeq: setLastServerSeqSpy,
      uploadOps: uploadOpsSpy,
      // No getEncryptKey → encryption disabled → no decrypt/encrypt plumbing needed.
    } as unknown as OperationSyncCapable;
  };

  beforeEach(() => {
    persistedServerSeq = INITIAL_SEQ;

    opLogStoreSpy = jasmine.createSpyObj('OperationLogStoreService', [
      'getUnsynced',
      'markSynced',
      'markRejected',
      'loadStateCache',
      'getLastSeq',
      'getOpById',
      'setVectorClock',
      'clearFullStateOps',
      'getVectorClock',
      'appendBatchSkipDuplicates',
      'hasSyncedOps',
      'deleteOpsWhere',
    ]);
    opLogStoreSpy.getUnsynced.and.resolveTo([localPendingEntry]);
    opLogStoreSpy.markSynced.and.resolveTo(undefined);
    opLogStoreSpy.markRejected.and.resolveTo(undefined);
    opLogStoreSpy.setVectorClock.and.resolveTo();
    opLogStoreSpy.clearFullStateOps.and.resolveTo();
    opLogStoreSpy.getVectorClock.and.resolveTo(null);
    opLogStoreSpy.deleteOpsWhere.and.resolveTo();
    opLogStoreSpy.appendBatchSkipDuplicates.and.resolveTo({
      seqs: [],
      writtenOps: [],
      skippedCount: 0,
    });
    // Never-synced snapshot is captured before upload; false ⇒ gate treats a USE_LOCAL
    // choice as potentially overwriting remote, so it produces dialog data.
    opLogStoreSpy.hasSyncedOps.and.resolveTo(false);
    // Not a wholly fresh client (so upload is not blocked).
    opLogStoreSpy.loadStateCache.and.resolveTo({
      state: {},
      lastAppliedOpSeq: 1,
      vectorClock: {},
      compactedAt: 1700000000000,
    });
    opLogStoreSpy.getLastSeq.and.resolveTo(1);

    remoteOpsProcessingServiceSpy = jasmine.createSpyObj('RemoteOpsProcessingService', [
      'processRemoteOps',
    ]);
    remoteOpsProcessingServiceSpy.processRemoteOps.and.resolveTo({
      localWinOpsCreated: 0,
      allOpsFilteredBySyncImport: false,
      filteredOpCount: 0,
      isLocalUnsyncedImport: false,
    });

    dialogServiceSpy = jasmine.createSpyObj('SyncImportConflictDialogService', [
      'showConflictDialog',
    ]);
    dialogServiceSpy.showConflictDialog.and.resolveTo('CANCEL');

    const lockServiceSpy = jasmine.createSpyObj('LockService', ['request']);
    // The real upload service runs its body inside lockService.request(name, cb).
    lockServiceSpy.request.and.callFake((_name: string, cb: () => Promise<unknown>) =>
      cb(),
    );

    const serverMigrationServiceSpy = jasmine.createSpyObj('ServerMigrationService', [
      'checkAndHandleMigration',
      'handleServerMigration',
    ]);
    serverMigrationServiceSpy.checkAndHandleMigration.and.resolveTo();
    serverMigrationServiceSpy.handleServerMigration.and.resolveTo();

    const stateSnapshotServiceSpy = jasmine.createSpyObj('StateSnapshotService', [
      'getStateSnapshot',
    ]);
    stateSnapshotServiceSpy.getStateSnapshot.and.returnValue({
      task: { ids: [] },
      project: { ids: [INBOX_PROJECT.id] },
      tag: { ids: [TODAY_TAG.id] },
      note: { ids: [] },
    } as any);

    const rejectedOpsHandlerServiceSpy = jasmine.createSpyObj(
      'RejectedOpsHandlerService',
      ['handleRejectedOps'],
    );
    rejectedOpsHandlerServiceSpy.handleRejectedOps.and.resolveTo({
      mergedOpsCreated: 0,
      permanentRejectionCount: 0,
    });

    const writeFlushServiceSpy = jasmine.createSpyObj('OperationWriteFlushService', [
      'flushPendingWrites',
    ]);
    writeFlushServiceSpy.flushPendingWrites.and.resolveTo();

    const superSyncStatusServiceSpy = jasmine.createSpyObj('SuperSyncStatusService', [
      'updatePendingOpsStatus',
    ]);

    const encryptionServiceSpy = jasmine.createSpyObj('OperationEncryptionService', [
      'encryptOperations',
      'decryptOperations',
      'encryptPayload',
    ]);

    TestBed.configureTestingModule({
      providers: [
        OperationLogSyncService,
        // REAL upload service — this is the point of the integration test.
        OperationLogUploadService,
        provideMockStore(),
        { provide: OperationEncryptionService, useValue: encryptionServiceSpy },
        { provide: OperationLogStoreService, useValue: opLogStoreSpy },
        { provide: LockService, useValue: lockServiceSpy },
        { provide: RemoteOpsProcessingService, useValue: remoteOpsProcessingServiceSpy },
        { provide: SyncImportConflictDialogService, useValue: dialogServiceSpy },
        { provide: ServerMigrationService, useValue: serverMigrationServiceSpy },
        { provide: StateSnapshotService, useValue: stateSnapshotServiceSpy },
        { provide: RejectedOpsHandlerService, useValue: rejectedOpsHandlerServiceSpy },
        { provide: OperationWriteFlushService, useValue: writeFlushServiceSpy },
        { provide: SuperSyncStatusService, useValue: superSyncStatusServiceSpy },
        {
          provide: SnackService,
          useValue: jasmine.createSpyObj('SnackService', ['open']),
        },
        {
          provide: BackupService,
          useValue: jasmine.createSpyObj('BackupService', [
            'captureImportBackup',
            'restoreImportBackup',
          ]),
        },
        {
          provide: SchemaMigrationService,
          useValue: jasmine.createSpyObj('SchemaMigrationService', [
            'getCurrentVersion',
            'migrateOperation',
          ]),
        },
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
          useValue: jasmine.createSpyObj('OperationApplierService', ['applyOperations']),
        },
        {
          provide: ConflictResolutionService,
          useValue: jasmine.createSpyObj('ConflictResolutionService', [
            'autoResolveConflictsLWW',
            'checkOpForConflicts',
          ]),
        },
        {
          provide: ValidateStateService,
          useValue: jasmine.createSpyObj('ValidateStateService', [
            'validateAndRepair',
            'validateAndRepairCurrentState',
          ]),
        },
        {
          provide: RepairOperationService,
          useValue: jasmine.createSpyObj('RepairOperationService', [
            'createRepairOperation',
          ]),
        },
        {
          provide: OperationLogDownloadService,
          useValue: jasmine.createSpyObj('OperationLogDownloadService', [
            'downloadRemoteOps',
          ]),
        },
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
        {
          provide: SupersededOperationResolverService,
          useValue: jasmine.createSpyObj('SupersededOperationResolverService', [
            'resolveSupersededLocalOps',
          ]),
        },
        {
          provide: SyncHydrationService,
          useValue: jasmine.createSpyObj('SyncHydrationService', [
            'hydrateFromRemoteSync',
          ]),
        },
      ],
    });

    service = TestBed.inject(OperationLogSyncService);
  });

  it('does NOT advance the persisted server seq when the piggybacked SYNC_IMPORT dialog is cancelled', async () => {
    const provider = makeProvider([makePiggybackSyncImport()]);

    const result = await service.uploadPendingOps(provider);

    expect(result.kind).toBe('cancelled');
    // Upload actually piggybacked ops back (the real upload service ran).
    expect(uploadOpsSpy).toHaveBeenCalled();
    // CRITICAL (#8304): the cursor stayed at its pre-sync value, so the next download
    // re-fetches the SYNC_IMPORT (and siblings) instead of skipping them forever.
    expect(persistedServerSeq).toBe(INITIAL_SEQ);
    expect(setLastServerSeqSpy).not.toHaveBeenCalled();
    // The dialog was cancelled before any apply happened.
    expect(remoteOpsProcessingServiceSpy.processRemoteOps).not.toHaveBeenCalled();
  });

  it('does NOT advance the persisted server seq when applying piggybacked ops throws (crash window)', async () => {
    // Regular piggybacked update (no SYNC_IMPORT ⇒ no dialog), then the apply throws.
    const provider = makeProvider([makePiggybackRegularUpdate()]);
    remoteOpsProcessingServiceSpy.processRemoteOps.and.rejectWith(
      new Error('apply failed mid-flight'),
    );

    await expectAsync(service.uploadPendingOps(provider)).toBeRejected();

    // CRITICAL (#8304): a crash between upload-return and apply must leave the cursor
    // untouched so the ops are re-downloaded, not skipped.
    expect(persistedServerSeq).toBe(INITIAL_SEQ);
    expect(setLastServerSeqSpy).not.toHaveBeenCalled();
  });

  it('advances the persisted server seq AFTER piggybacked ops are applied (success)', async () => {
    const provider = makeProvider([makePiggybackRegularUpdate()]);

    // Record ordering to prove the persist happens strictly after the apply.
    const callOrder: string[] = [];
    remoteOpsProcessingServiceSpy.processRemoteOps.and.callFake(async () => {
      callOrder.push('processRemoteOps');
      return {
        localWinOpsCreated: 0,
        allOpsFilteredBySyncImport: false,
        filteredOpCount: 0,
        isLocalUnsyncedImport: false,
      };
    });
    setLastServerSeqSpy.and.callFake(async (n: number) => {
      callOrder.push('setLastServerSeq');
      persistedServerSeq = n;
    });

    const result = await service.uploadPendingOps(provider);

    expect(result.kind).toBe('completed');
    // Cursor advanced to the server's latest only after the apply completed.
    expect(persistedServerSeq).toBe(SERVER_LATEST_SEQ);
    expect(callOrder).toEqual(['processRemoteOps', 'setLastServerSeq']);
  });
});
