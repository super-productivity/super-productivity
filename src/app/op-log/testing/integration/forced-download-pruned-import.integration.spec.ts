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
  OpDownloadResponse,
  OperationSyncCapable,
  OpUploadResponse,
  ServerSyncOperation,
  SyncOperation,
  SyncProviderBase,
} from '../../sync-providers/provider.interface';
import { SyncProviderId } from '../../sync-providers/provider.const';
import type { SuperSyncPrivateCfg } from '@sp/sync-providers/super-sync';
import { ActionType, Operation, OpType, VectorClock } from '../../core/operation.types';
import { UserInputWaitStateService } from '../../../imex/sync/user-input-wait-state.service';
import { SnackService } from '../../../core/snack/snack.service';
import { resetTestUuidCounter } from './helpers/test-client.helper';
import { LockService } from '../../sync/lock.service';
import { SchemaMigrationService } from '../../persistence/schema-migration.service';
import { SuperSyncStatusService } from '../../sync/super-sync-status.service';
import { ServerMigrationService } from '../../sync/server-migration.service';
import { OperationWriteFlushService } from '../../sync/operation-write-flush.service';
import { RemoteOpsProcessingService } from '../../sync/remote-ops-processing.service';
import { RejectedOpsHandlerService } from '../../sync/rejected-ops-handler.service';
import { SyncHydrationService } from '../../persistence/sync-hydration.service';
import { SyncImportFilterService } from '../../sync/sync-import-filter.service';
import { SyncImportConflictDialogService } from '../../sync/sync-import-conflict-dialog.service';
import { OperationLogEffects } from '../../capture/operation-log.effects';
import { clearDeferredActions } from '../../capture/operation-capture.meta-reducer';
import { createValidAppData } from '../../validation/state-validity-test-utils';
import { DEFAULT_GLOBAL_CONFIG } from '../../../features/config/default-global-config.const';
import { selectSyncConfig } from '../../../features/config/store/global-config.reducer';
import { CLIENT_ID_PROVIDER } from '../../util/client-id.provider';

/**
 * A forced seq-0 download re-delivers ops that compaction already pruned from
 * the local log. This spec drives the REAL store, compaction, download service,
 * conflict gate and sync service (only state application and UI are mocked)
 * through the scenario the unit specs can only stub:
 *
 * 1. An installed client applies another device's SYNC_IMPORT plus follow-up ops.
 * 2. The 7-day retention window elapses; real compaction prunes them, so the
 *    applied-id filter no longer knows the import.
 * 3. A forced seq-0 download (concurrent-rejection retry, provider switch)
 *    re-delivers the import. It must NOT resurface as a new incoming import
 *    while local work is pending — that is the sync-import conflict dialog
 *    from the field report, whose every answer destroys data.
 *
 * The second case guards the filter's false-positive edge: an op the local
 * clock covers only because the rejection resolver merged its clock, but
 * that was never applied because it is schema-blocked, sits ABOVE the cursor
 * and must still be delivered (and stay blocked).
 */

const IMPORTER = 'importer-client';
const OTHER = 'other-client';
const SHARED_TASK_ID = 'shared-task';

/**
 * In-memory SuperSync stand-in with the two server behaviours that matter here:
 * real per-op `serverSeq`, and the seq-0 fast-forward to the latest full-state
 * op (super-sync-server `operation-download.service.ts`). Own ops are excluded
 * like the real endpoint does.
 */
class PrunedImportSyncProvider
  implements SyncProviderBase<SyncProviderId>, OperationSyncCapable
{
  id = SyncProviderId.SuperSync;
  supportsOperationSync = true;
  providerMode = 'superSyncOps' as const;
  maxConcurrentRequests = 1;
  isEncryptionMandatory = false;

  serverOps: ServerSyncOperation[] = [];
  private _lastServerSeq = 0;
  private _privateCfg: SuperSyncPrivateCfg = {
    accessToken: 'test-token',
    baseUrl: 'https://test.supersync.example',
    isEncryptionEnabled: false,
    encryptKey: undefined,
  };
  privateCfg = {
    load: async () => this._privateCfg,
  } as unknown as SyncProviderBase<SyncProviderId>['privateCfg'];

  async getEncryptKey(): Promise<string | undefined> {
    return undefined;
  }

  async isEncryptionEnabled(): Promise<boolean> {
    return false;
  }

  async getLastServerSeq(): Promise<number> {
    return this._lastServerSeq;
  }

  async setLastServerSeq(seq: number): Promise<void> {
    this._lastServerSeq = seq;
  }

  async uploadOps(ops: SyncOperation[]): Promise<OpUploadResponse> {
    throw new Error(`Unexpected upload of ${ops.length} op(s) in this spec`);
  }

  async downloadOps(
    sinceSeq: number,
    excludeClient: string,
    limit: number,
  ): Promise<OpDownloadResponse> {
    const latestFullStateSeq = this.serverOps
      .filter((stored) => stored.op.opType === OpType.SyncImport)
      .reduce((max, stored) => Math.max(max, stored.serverSeq), 0);
    const effectiveSince =
      latestFullStateSeq > 0 && sinceSeq < latestFullStateSeq
        ? latestFullStateSeq - 1
        : sinceSeq;
    const ops = this.serverOps
      .filter(
        (stored) =>
          stored.serverSeq > effectiveSince && stored.op.clientId !== excludeClient,
      )
      .slice(0, limit);
    return {
      ops,
      hasMore: false,
      latestSeq: this.serverOps.reduce((max, s) => Math.max(max, s.serverSeq), 0),
      gapDetected: false,
    };
  }

  async uploadSnapshot(): Promise<{ accepted: boolean; serverSeq: number }> {
    throw new Error('Unexpected snapshot upload in this spec');
  }

  async init(): Promise<void> {}
  async isReady(): Promise<boolean> {
    return true;
  }
  async setPrivateCfg(cfg: SuperSyncPrivateCfg): Promise<void> {
    this._privateCfg = cfg;
  }
  async getFileRev(): Promise<{ rev: string }> {
    return { rev: 'rev' };
  }
  async downloadFile(): Promise<{ rev: string; dataStr: string }> {
    return { rev: 'rev', dataStr: '{}' };
  }
  async uploadFile(): Promise<{ rev: string }> {
    return { rev: 'rev' };
  }
  async removeFile(): Promise<void> {}
  async deleteAllData(): Promise<{ success: boolean }> {
    this.serverOps = [];
    this._lastServerSeq = 0;
    return { success: true };
  }
}

describe('Forced seq-0 download after compaction pruned an applied SYNC_IMPORT (integration)', () => {
  let syncService: OperationLogSyncService;
  let downloadService: OperationLogDownloadService;
  let compactionService: OperationLogCompactionService;
  let opLogStore: OperationLogStoreService;
  let provider: PrunedImportSyncProvider;
  let applierSpy: jasmine.SpyObj<OperationApplierService>;
  let showConflictDialogSpy: jasmine.Spy;
  let ownClientId: string;

  const serverOp = (serverSeq: number, op: SyncOperation): ServerSyncOperation => ({
    serverSeq,
    op,
    receivedAt: Date.now(),
  });

  const remoteSyncImport = (): SyncOperation => ({
    id: 'remote-sync-import',
    clientId: IMPORTER,
    actionType: ActionType.LOAD_ALL_DATA,
    opType: OpType.SyncImport,
    entityType: 'ALL',
    payload: { appDataComplete: structuredClone(createValidAppData()) },
    vectorClock: { [IMPORTER]: 1 },
    timestamp: Date.now(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    syncImportReason: 'PASSWORD_CHANGED',
  });

  const remoteTaskUpdate = (
    id: string,
    clientId: string,
    vectorClock: VectorClock,
    schemaVersion = CURRENT_SCHEMA_VERSION,
  ): SyncOperation => ({
    id,
    clientId,
    actionType: '[Task] Update Task' as ActionType,
    opType: OpType.Update,
    entityType: 'TASK',
    entityId: SHARED_TASK_ID,
    payload: { task: { id: SHARED_TASK_ID, changes: { title: id } } },
    vectorClock,
    timestamp: Date.now(),
    schemaVersion,
  });

  const localTaskUpdate = (id: string, vectorClock: VectorClock): Operation => ({
    id,
    clientId: ownClientId,
    actionType: '[Task] Update Task' as ActionType,
    opType: OpType.Update,
    entityType: 'TASK',
    entityId: SHARED_TASK_ID,
    payload: { task: { id: SHARED_TASK_ID, changes: { title: id } } },
    vectorClock,
    timestamp: Date.now(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
  });

  /** Appends a local op whose clock extends the durable clock by one own tick. */
  const appendPendingLocalOp = async (
    id: string,
    extraClock: VectorClock = {},
  ): Promise<Operation> => {
    const durable = (await opLogStore.getVectorClock()) ?? {};
    const clock: VectorClock = { ...durable, ...extraClock };
    clock[ownClientId] = (clock[ownClientId] ?? 0) + 1;
    const op = localTaskUpdate(id, clock);
    await opLogStore.appendWithVectorClockOverwrite(op, 'local');
    return op;
  };

  const forcedDownloadNewOpIds = async (): Promise<string[]> => {
    const result = await downloadSpy.calls.mostRecent().returnValue;
    return result.newOps.map((op) => op.id);
  };
  let downloadSpy: jasmine.Spy<OperationLogDownloadService['downloadRemoteOps']>;

  /**
   * Seeds the log the way real history does: the import and two follow-up ops
   * arrive through the normal download path more than a retention window ago;
   * one more follow-up arrives recently, so the client still counts as synced
   * after compaction (exactly the state of a device that syncs daily).
   */
  const seedAppliedImportAndCompact = async (): Promise<void> => {
    const oneHourMs = 60 * 60 * 1000;
    const nowSpy = spyOn(Date, 'now').and.returnValue(
      new Date().getTime() - COMPACTION_RETENTION_MS - oneHourMs,
    );
    // An installed client always carries a state cache from an earlier
    // compaction. Without one, the first ordinary remote batch fires a
    // background compaction (old snapshot format path) that would race the
    // assertions below.
    expect(await compactionService.compact()).toBeTrue();
    provider.serverOps = [
      serverOp(1, remoteSyncImport()),
      serverOp(2, remoteTaskUpdate('importer-update-1', IMPORTER, { [IMPORTER]: 2 })),
      serverOp(3, remoteTaskUpdate('importer-update-2', IMPORTER, { [IMPORTER]: 3 })),
    ];
    const oldOutcome = await syncService.downloadRemoteOps(provider);
    expect(oldOutcome.kind).toBe('ops_processed');
    nowSpy.and.callThrough();

    provider.serverOps.push(
      serverOp(4, remoteTaskUpdate('importer-update-3', IMPORTER, { [IMPORTER]: 4 })),
    );
    const recentOutcome = await syncService.downloadRemoteOps(provider);
    expect(recentOutcome.kind).toBe('ops_processed');

    // Precondition guards: everything applied, cursor advanced, clock covers it.
    expect(await opLogStore.hasOp('remote-sync-import')).toBeTrue();
    expect(await provider.getLastServerSeq()).toBe(4);
    expect((await opLogStore.getVectorClock())?.[IMPORTER]).toBe(4);

    // Real compaction with the production retention window.
    expect(await compactionService.compact()).toBeTrue();
    expect(await opLogStore.hasOp('remote-sync-import')).toBeFalse();
    expect(await opLogStore.hasOp('importer-update-2')).toBeFalse();
    expect(await opLogStore.hasOp('importer-update-3')).toBeTrue();
    expect(await opLogStore.getLatestFullStateOpEntry()).toBeUndefined();
    expect(await opLogStore.hasSyncedOps()).toBeTrue();
    // Compaction keeps the durable clock, which is what the fix relies on.
    expect((await opLogStore.getVectorClock())?.[IMPORTER]).toBe(4);
  };

  beforeEach(async () => {
    if (!(window.confirm as jasmine.Spy).and) {
      spyOn(window, 'confirm').and.returnValue(true);
    } else {
      (window.confirm as jasmine.Spy).and.returnValue(true);
    }

    const conflictServiceSpy = jasmine.createSpyObj('ConflictResolutionService', [
      'autoResolveConflictsLWW',
      'checkOpForConflicts',
    ]);
    conflictServiceSpy.autoResolveConflictsLWW.and.resolveTo({ localWinOpsCreated: 0 });
    conflictServiceSpy.checkOpForConflicts.and.resolveTo({
      isSupersededOrDuplicate: false,
      conflicts: [],
    });

    // State application is mocked; the store-side persistence and clock merge
    // still run through the real reducer-commit callback.
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
    const stateSnapshotSpy = jasmine.createSpyObj('StateSnapshotService', [
      'getStateSnapshot',
      'getStateSnapshotAsync',
      'getStateSnapshotForOperationLog',
    ]);
    // Read by the pre-apply recovery point (local-recovery-points.md).
    stateSnapshotSpy.getStateSnapshotAsync.and.callFake(async () => createValidAppData());
    // Never consulted: the seeded client carries a state cache, so the
    // fresh-client guard does not run. Compaction snapshots this fixture; its
    // INBOX project counts as meaningful data, which the guard there requires.
    stateSnapshotSpy.getStateSnapshot.and.returnValue(undefined);
    stateSnapshotSpy.getStateSnapshotForOperationLog.and.callFake(() =>
      createValidAppData(),
    );

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
        provideMockStore({
          selectors: [{ selector: selectSyncConfig, value: DEFAULT_GLOBAL_CONFIG.sync }],
        }),
        { provide: ConflictResolutionService, useValue: conflictServiceSpy },
        { provide: OperationApplierService, useValue: applierSpy },
        { provide: SuperSyncStatusService, useValue: superSyncStatusSpy },
        { provide: ServerMigrationService, useValue: serverMigrationSpy },
        { provide: OperationWriteFlushService, useValue: writeFlushSpy },
        { provide: RejectedOpsHandlerService, useValue: rejectedOpsHandlerSpy },
        { provide: SyncHydrationService, useValue: syncHydrationSpy },
        { provide: StateSnapshotService, useValue: stateSnapshotSpy },
        {
          provide: ValidateStateService,
          useValue: jasmine.createSpyObj('ValidateStateService', [
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
    downloadService = TestBed.inject(OperationLogDownloadService);
    compactionService = TestBed.inject(OperationLogCompactionService);
    opLogStore = TestBed.inject(OperationLogStoreService);
    // CANCEL keeps a regression on the assertions below instead of turning it
    // into a state replacement that fails somewhere deeper.
    showConflictDialogSpy = spyOn(
      TestBed.inject(SyncImportConflictDialogService),
      'showConflictDialog',
    ).and.resolveTo('CANCEL');
    downloadSpy = spyOn(downloadService, 'downloadRemoteOps').and.callThrough();
    provider = new PrunedImportSyncProvider();

    await opLogStore.init();
    await opLogStore._clearAllDataForTesting();
    resetTestUuidCounter();
    clearDeferredActions();
    ownClientId = await TestBed.inject(CLIENT_ID_PROVIDER).getOrGenerateClientId();
  });

  it('does not treat the re-delivered, already-applied import as a new incoming import while local work is pending', async () => {
    await seedAppliedImportAndCompact();
    const pendingOp = await appendPendingLocalOp('local-concurrent-edit');
    applierSpy.applyOperations.calls.reset();

    const outcome = await syncService.downloadRemoteOps(provider, {
      forceFromSeq0: true,
    });

    // Server re-delivered 1..4 (fast-forwarded to the import); 1..3 are behind
    // the cursor and covered by the clock, 4 is still in the applied-id set.
    expect(await forcedDownloadNewOpIds()).toEqual([]);
    expect(showConflictDialogSpy).not.toHaveBeenCalled();
    expect(outcome.kind).toBe('no_new_ops');
    expect(applierSpy.applyOperations).not.toHaveBeenCalled();
    expect(await opLogStore.hasOp('remote-sync-import')).toBeFalse();
    // The pending local work survives untouched (neither discarded nor rejected).
    const pendingIds = (await opLogStore.getUnsynced()).map((entry) => entry.op.id);
    expect(pendingIds).toEqual([pendingOp.id]);
    expect(await provider.getLastServerSeq()).toBe(4);
  });

  it('still delivers a schema-blocked op above the cursor even though the local clock already covers it', async () => {
    await seedAppliedImportAndCompact();
    // A device on a newer app version uploads an op this client cannot apply.
    const newerSchemaOp = remoteTaskUpdate(
      'newer-schema-op',
      OTHER,
      { [IMPORTER]: 4, [OTHER]: 1 },
      CURRENT_SCHEMA_VERSION + 1,
    );
    provider.serverOps.push(serverOp(5, newerSchemaOp));
    // The rejection resolver merges every clock of a forced download into the
    // new local ops it creates, so the durable clock can cover the blocked op
    // before it was ever applied. Reproduce that over-claim through the store.
    await appendPendingLocalOp('local-resolved-edit', { [OTHER]: 1 });
    expect((await opLogStore.getVectorClock())?.[OTHER]).toBe(1);

    const outcome = await syncService.downloadRemoteOps(provider, {
      forceFromSeq0: true,
    });

    // Behind-cursor ops are skipped; the blocked op is above the cursor and delivered.
    expect(await forcedDownloadNewOpIds()).toEqual(['newer-schema-op']);
    expect(outcome.kind).toBe('blocked_incompatible');
    expect(showConflictDialogSpy).not.toHaveBeenCalled();
    expect(await opLogStore.hasOp('newer-schema-op')).toBeFalse();
    // Cursor stays behind the blocked op so it is retried after an app update.
    expect(await provider.getLastServerSeq()).toBe(4);
  });
});
