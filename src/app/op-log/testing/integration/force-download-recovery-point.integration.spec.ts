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
import { ActionType, Operation, OpType } from '../../core/operation.types';
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
import { OperationLogEffects } from '../../capture/operation-log.effects';
import { clearDeferredActions } from '../../capture/operation-capture.meta-reducer';
import { createValidAppData } from '../../validation/state-validity-test-utils';
import { DEFAULT_GLOBAL_CONFIG } from '../../../features/config/default-global-config.const';
import { selectSyncConfig } from '../../../features/config/store/global-config.reducer';
import { CLIENT_ID_PROVIDER } from '../../util/client-id.provider';

import { BackupService } from '../../backup/backup.service';
import { T } from '../../../t.const';

/**
 * "Use server data" captures a FORCE_DOWNLOAD recovery point, replaces the
 * local baseline, replays the server history and then verifies that the undo
 * pointer still names that capture before offering Undo. The replay goes
 * through the same full-state path that captures a REMOTE_IMPORT recovery
 * point during normal sync; without `skipRecoveryPoint` a REPAIR in the
 * history would move the pointer and silently drop the Undo offer
 * (local-recovery-points.md). This spec drives the REAL store, backup service,
 * remote-ops processing and sync service (only state application and UI are
 * mocked) through that history.
 */

const IMPORTER = 'importer-client';

class RebuildSyncProvider
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

describe('Force download rebuild keeps its own recovery point (integration)', () => {
  let syncService: OperationLogSyncService;
  let opLogStore: OperationLogStoreService;
  let backupService: BackupService;
  let provider: RebuildSyncProvider;
  let applierSpy: jasmine.SpyObj<OperationApplierService>;
  let snackSpy: jasmine.SpyObj<SnackService>;
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

  const remoteRepair = (): SyncOperation => ({
    id: 'remote-repair',
    clientId: IMPORTER,
    actionType: ActionType.LOAD_ALL_DATA,
    opType: OpType.Repair,
    entityType: 'ALL',
    payload: {
      appDataComplete: structuredClone(createValidAppData()),
      repairSummary: {},
    },
    vectorClock: { [IMPORTER]: 2 },
    timestamp: Date.now(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
  });

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
    snackSpy = jasmine.createSpyObj('SnackService', [
      'open',
      'hasPendingPersistentAction',
    ]);
    snackSpy.hasPendingPersistentAction.and.returnValue(false);
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
      'hasPendingWrites',
    ]);
    writeFlushSpy.flushPendingWrites.and.resolveTo();
    writeFlushSpy.hasPendingWrites.and.returnValue(false);
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
        { provide: SnackService, useValue: snackSpy },
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
    provider = new RebuildSyncProvider();

    await opLogStore.init();
    await opLogStore._clearAllDataForTesting();
    resetTestUuidCounter();
    clearDeferredActions();
    ownClientId = await TestBed.inject(CLIENT_ID_PROVIDER).getOrGenerateClientId();
    backupService = TestBed.inject(BackupService);
    provider.serverOps = [serverOp(1, remoteSyncImport()), serverOp(2, remoteRepair())];
  });

  it('offers Undo for the FORCE_DOWNLOAD capture although the replayed history holds a REPAIR', async () => {
    expect(ownClientId).toBeTruthy();

    await syncService.forceDownloadRemoteState(provider);

    const ring = await opLogStore.listImportBackups();
    expect(ring.map((entry) => entry.reason)).toEqual(['FORCE_DOWNLOAD']);
    expect((await opLogStore.loadImportBackup())?.backupId).toBe(ring[0].backupId);
    expect(await opLogStore.loadRawRebuildIncomplete()).toBeNull();
    expect(snackSpy.open).toHaveBeenCalledWith(
      jasmine.objectContaining({ msg: T.F.SYNC.S.LOCAL_DATA_REPLACE_UNDO }),
    );
    expect(applierSpy.applyOperations).toHaveBeenCalled();
  });

  it('captures once when the same full-state op is delivered three times', async () => {
    // A forced download from seq 0 re-delivers an already-applied import
    // (#9975). The store skips it by id; the ring must not rotate for it.
    const remoteOps = TestBed.inject(RemoteOpsProcessingService);

    for (let i = 0; i < 3; i++) {
      await remoteOps.processRemoteOps([remoteSyncImport() as unknown as Operation]);
    }

    const ring = await opLogStore.listImportBackups();
    expect(ring.map((entry) => entry.reason)).toEqual(['REMOTE_IMPORT']);
  });

  it('keeps the newest snapshot and still applies when the ring write hits the storage quota', async () => {
    // Two prior captures so pruning has something to evict.
    await backupService.captureImportBackup('LOCAL_IMPORT');
    const newest = await backupService.captureImportBackup('LOCAL_IMPORT');
    // Real adapter, real DOMException: the name must survive the store layer
    // untranslated (unlike append errors) for the fallback to trigger.
    const adapter = opLogStore['_adapter'];
    const realTransaction = adapter.transaction.bind(adapter);
    let didReject = false;
    spyOn(adapter, 'transaction').and.callFake((stores, mode, fn) => {
      if (!didReject && mode === 'readwrite' && stores.includes('import_backup')) {
        didReject = true;
        return Promise.reject(new DOMException('full', 'QuotaExceededError'));
      }
      return realTransaction(stores, mode, fn);
    });
    const remoteOps = TestBed.inject(RemoteOpsProcessingService);

    await remoteOps.processRemoteOps([remoteSyncImport() as unknown as Operation]);

    expect(didReject).toBeTrue();
    const ring = await opLogStore.listImportBackups();
    expect(ring.map((entry) => entry.reason)).toEqual(['REMOTE_IMPORT', 'LOCAL_IMPORT']);
    expect(ring[1].backupId).toBe(newest.backupId);
    expect(await opLogStore.hasOp('remote-sync-import')).toBeTrue();
  });

  it('would lose the Undo offer if the replay captured its own recovery point', async () => {
    // Documents the failure the option prevents: a second capture during the
    // replay moves the pointer, so the rebuild no longer recognises its backup.
    const capture = backupService.captureRecoveryPointIfMeaningful.bind(backupService);
    spyOn(backupService, 'captureRecoveryPointIfMeaningful').and.callFake(capture);
    const remoteOps = TestBed.inject(RemoteOpsProcessingService);
    const originalProcess = remoteOps.processRemoteOps.bind(remoteOps);
    spyOn(remoteOps, 'processRemoteOps').and.callFake((ops, options) =>
      originalProcess(ops, { ...options, skipRecoveryPoint: false }),
    );

    await syncService.forceDownloadRemoteState(provider);

    expect(backupService.captureRecoveryPointIfMeaningful).toHaveBeenCalled();
    const ring = await opLogStore.listImportBackups();
    expect(ring.map((entry) => entry.reason)).toEqual([
      'REMOTE_IMPORT',
      'FORCE_DOWNLOAD',
    ]);
    expect(snackSpy.open).not.toHaveBeenCalledWith(
      jasmine.objectContaining({ msg: T.F.SYNC.S.LOCAL_DATA_REPLACE_UNDO }),
    );
  });
});
