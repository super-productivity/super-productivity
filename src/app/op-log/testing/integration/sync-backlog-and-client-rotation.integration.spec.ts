import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { provideMockStore } from '@ngrx/store/testing';
import { MatDialog } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
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
  SyncOperation,
  SyncProviderBase,
} from '../../sync-providers/provider.interface';
import { SyncProviderId } from '../../sync-providers/provider.const';
import { ActionType, OpType, Operation } from '../../core/operation.types';
import { UserInputWaitStateService } from '../../../imex/sync/user-input-wait-state.service';
import { SnackService } from '../../../core/snack/snack.service';
import { LockService } from '../../sync/lock.service';
import { SchemaMigrationService } from '../../persistence/schema-migration.service';
import { SuperSyncStatusService } from '../../sync/super-sync-status.service';
import { ServerMigrationService } from '../../sync/server-migration.service';
import { OperationWriteFlushService } from '../../sync/operation-write-flush.service';
import { RemoteOpsProcessingService } from '../../sync/remote-ops-processing.service';
import { RejectedOpsHandlerService } from '../../sync/rejected-ops-handler.service';
import { SupersededOperationResolverService } from '../../sync/superseded-operation-resolver.service';
import { SyncHydrationService } from '../../persistence/sync-hydration.service';
import { OperationLogCompactionService } from '../../persistence/operation-log-compaction.service';
import { SyncImportFilterService } from '../../sync/sync-import-filter.service';
import { OperationLogEffects } from '../../capture/operation-log.effects';
import { MAX_DOWNLOAD_ITERATIONS } from '../../core/operation-log.const';
import { DEFAULT_GLOBAL_CONFIG } from '../../../features/config/default-global-config.const';
import { selectSyncConfig } from '../../../features/config/store/global-config.reducer';
import { MockSyncServer } from './helpers/mock-sync-server.helper';
import { resetTestUuidCounter, TestClient } from './helpers/test-client.helper';

/**
 * SuperSync provider backed by MockSyncServer, with the two server behaviours
 * these regressions depend on:
 * - the per-op clientId check of `ValidationService.validateOp` (an op authored
 *   under another id than the request's is rejected as INVALID_CLIENT_ID);
 * - a configurable page size, so a backlog longer than one download pass can
 *   be served without building tens of thousands of ops. It also caps upload
 *   piggybacks, as the server's PIGGYBACK_LIMIT does (`hasMorePiggyback`).
 */
class ServerBackedProvider
  implements SyncProviderBase<SyncProviderId>, OperationSyncCapable
{
  id = SyncProviderId.SuperSync;
  supportsOperationSync = true;
  providerMode = 'superSyncOps' as const;
  maxConcurrentRequests = 1;
  privateCfg = { load: async () => ({ isEncryptionEnabled: false }) } as never;
  pageSize = 500;
  readonly uploadRequests: { clientId: string; opIds: string[] }[] = [];
  private _lastServerSeq = 0;

  constructor(readonly server: MockSyncServer) {}

  async getEncryptKey(): Promise<string | undefined> {
    return undefined;
  }

  async getLastServerSeq(): Promise<number> {
    return this._lastServerSeq;
  }

  async setLastServerSeq(seq: number): Promise<void> {
    this._lastServerSeq = seq;
  }

  async uploadOps(
    ops: SyncOperation[],
    clientId: string,
    lastKnownServerSeq?: number,
  ): Promise<OpUploadResponse> {
    this.uploadRequests.push({ clientId, opIds: ops.map((op) => op.id) });
    const matching = ops.filter((op) => op.clientId === clientId);
    const response = this.server.uploadOps(matching, clientId, lastKnownServerSeq);
    const piggyback = response.newOps ?? [];
    if (piggyback.length > this.pageSize) {
      response.newOps = piggyback.slice(0, this.pageSize);
      response.hasMorePiggyback = true;
    }
    const rejected = ops
      .filter((op) => op.clientId !== clientId)
      .map((op) => ({
        opId: op.id,
        accepted: false,
        error: `Operation clientId "${op.clientId}" does not match request clientId "${clientId}"`,
        errorCode: 'INVALID_CLIENT_ID',
      }));
    return { ...response, results: [...response.results, ...rejected] };
  }

  async downloadOps(
    sinceSeq: number,
    excludeClient?: string,
  ): Promise<OpDownloadResponse> {
    return this.server.downloadOps(sinceSeq, excludeClient, this.pageSize);
  }

  async uploadSnapshot(): Promise<never> {
    throw new Error('not used by these scenarios');
  }

  async init(): Promise<void> {}
  async isReady(): Promise<boolean> {
    return true;
  }
  async setPrivateCfg(): Promise<void> {}
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
    return { success: true };
  }
}

const createTaskUpdate = (author: TestClient, n: number): Operation =>
  author.createOperation({
    actionType: '[Task] Update Task' as ActionType,
    opType: OpType.Update,
    entityType: 'TASK',
    entityId: `task-${n}`,
    payload: { task: { id: `task-${n}`, changes: { title: `t${n}` } } },
  });

describe('Sync backlog and clientId rotation (integration)', () => {
  let syncService: OperationLogSyncService;
  let opLogStore: OperationLogStoreService;
  let server: MockSyncServer;
  let provider: ServerBackedProvider;
  let applierSpy: jasmine.SpyObj<OperationApplierService>;

  beforeEach(async () => {
    const conflictServiceSpy = jasmine.createSpyObj('ConflictResolutionService', [
      'autoResolveConflictsLWW',
      'checkOpForConflicts',
    ]);
    conflictServiceSpy.autoResolveConflictsLWW.and.resolveTo({ localWinOpsCreated: 0 });
    conflictServiceSpy.checkOpForConflicts.and.resolveTo({
      isSupersededOrDuplicate: false,
      conflicts: [],
    });
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
    const writeFlushSpy = jasmine.createSpyObj('OperationWriteFlushService', [
      'flushPendingWrites',
      'flushThenRunExclusive',
    ]);
    writeFlushSpy.flushPendingWrites.and.resolveTo();
    writeFlushSpy.flushThenRunExclusive.and.callFake(
      async <T>(fn: () => Promise<T>): Promise<T> => fn(),
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
        // Real handler: a server rejection must reach the op log exactly as in
        // the app, including the permanent `rejectedAt` mark.
        RejectedOpsHandlerService,
        SyncImportFilterService,
        provideMockStore({
          selectors: [{ selector: selectSyncConfig, value: DEFAULT_GLOBAL_CONFIG.sync }],
        }),
        { provide: ConflictResolutionService, useValue: conflictServiceSpy },
        { provide: OperationApplierService, useValue: applierSpy },
        {
          provide: SuperSyncStatusService,
          useValue: jasmine.createSpyObj('SuperSyncStatusService', [
            'markRemoteChecked',
            'updatePendingOpsStatus',
            'clearScope',
          ]),
        },
        {
          provide: ServerMigrationService,
          useValue: jasmine.createSpyObj('ServerMigrationService', [
            'checkAndHandleMigration',
            'handleServerMigration',
          ]),
        },
        { provide: OperationWriteFlushService, useValue: writeFlushSpy },
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
        {
          provide: OperationLogCompactionService,
          useValue: { compact: () => Promise.resolve(true) },
        },
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
          provide: StateSnapshotService,
          useValue: {
            ...jasmine.createSpyObj('StateSnapshotService', ['getStateSnapshot']),
            getStateSnapshotAsync: async () => ({}),
          },
        },
        {
          provide: SnackService,
          useValue: jasmine.createSpyObj('SnackService', ['open']),
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
    await opLogStore.init();
    await opLogStore._clearAllDataForTesting();
    resetTestUuidCounter();

    // The first download into an empty store asks the fresh-client confirm.
    // test.ts shares one confirm spy across specs, so re-arm it to accept or a
    // spec that left it returning false cancels the download.
    if (jasmine.isSpy(window.confirm)) {
      (window.confirm as jasmine.Spy).and.returnValue(true);
    } else {
      spyOn(window, 'confirm').and.returnValue(true);
    }
    server = new MockSyncServer();
    provider = new ServerBackedProvider(server);
  });

  describe('backlog longer than one download pass (#8763)', () => {
    const remoteOpIdsInLog = async (): Promise<string[]> =>
      (await opLogStore.getOpsAfterSeq(0))
        .filter((entry) => entry.source === 'remote')
        .map((entry) => entry.op.id);

    it('applies and checkpoints each pass so repeated syncs converge', async () => {
      const peer = new TestClient('peer-client');
      const backlog = Array.from({ length: MAX_DOWNLOAD_ITERATIONS + 100 }, (_, i) =>
        createTaskUpdate(peer, i),
      );
      server.receiveUpload(backlog as SyncOperation[]);
      // One op per page: the pass hits the page cap after MAX_DOWNLOAD_ITERATIONS.
      provider.pageSize = 1;

      await syncService.downloadRemoteOps(provider);

      expect(await provider.getLastServerSeq()).toBe(MAX_DOWNLOAD_ITERATIONS);
      expect(await remoteOpIdsInLog()).toEqual(
        backlog.slice(0, MAX_DOWNLOAD_ITERATIONS).map((op) => op.id),
      );

      await syncService.downloadRemoteOps(provider);

      expect(await provider.getLastServerSeq()).toBe(backlog.length);
      // Every op exactly once, in server order: nothing skipped at the pass
      // boundary and nothing re-applied.
      expect(await remoteOpIdsInLog()).toEqual(backlog.map((op) => op.id));
      // A thousand page requests plus real IndexedDB writes exceed the default.
    }, 30000);

    it('uploads after a truncated pass without skipping the unseen tail', async () => {
      const peer = new TestClient('peer-client');
      const me = new TestClient('my-client');
      const backlog = Array.from({ length: MAX_DOWNLOAD_ITERATIONS + 100 }, (_, i) =>
        createTaskUpdate(peer, i),
      );
      server.receiveUpload(backlog as SyncOperation[]);
      const localOp = createTaskUpdate(me, 9999);
      await opLogStore.append(localOp, 'local');
      provider.pageSize = 1;

      // One sync cycle: the download stops at the pass cap, then the upload
      // piggybacks only part of the tail (hasMorePiggyback).
      await syncService.downloadRemoteOps(provider);
      await syncService.uploadPendingOps(provider);

      const cursorAfterUpload = await provider.getLastServerSeq();
      expect(cursorAfterUpload).toBeGreaterThanOrEqual(MAX_DOWNLOAD_ITERATIONS);
      expect(cursorAfterUpload).toBeLessThan(server.getLatestSeq());
      expect(await opLogStore.getUnsynced()).toEqual([]);

      await syncService.downloadRemoteOps(provider);

      expect(await provider.getLastServerSeq()).toBe(server.getLatestSeq());
      expect(await remoteOpIdsInLog()).toEqual(backlog.map((op) => op.id));
      expect(server.getAllOps().map((stored) => stored.op.id)).toContain(localOp.id);
    }, 30000);
  });

  describe('outbox spanning a clientId rotation (#9371)', () => {
    it('uploads every pending op, one author per request, and rejects none', async () => {
      const before = new TestClient('client-before');
      const after = new TestClient('client-after');
      // Pending ops from two identities, interleaved as they would be when the
      // id rotates while earlier edits are still waiting to upload.
      const outbox = [
        createTaskUpdate(before, 1),
        createTaskUpdate(before, 2),
        createTaskUpdate(after, 3),
        createTaskUpdate(before, 4),
      ];
      for (const op of outbox) {
        await opLogStore.append(op, 'local');
      }

      // One round per run of same-author ops: before×2, after, before.
      for (let round = 0; round < 3; round++) {
        await syncService.uploadPendingOps(provider);
      }

      for (const request of provider.uploadRequests) {
        const authors = new Set(
          request.opIds.map((id) => outbox.find((op) => op.id === id)?.clientId),
        );
        expect([...authors]).toEqual([request.clientId]);
      }
      // Log order survives the split, so the server never sees a later edit
      // before an earlier one.
      expect(server.getAllOps().map((stored) => stored.op.id)).toEqual(
        outbox.map((op) => op.id),
      );
      expect(await opLogStore.getUnsynced()).toEqual([]);
      for (const op of outbox) {
        expect((await opLogStore.getOpById(op.id))?.rejectedAt).toBeUndefined();
      }
    });
  });
});
