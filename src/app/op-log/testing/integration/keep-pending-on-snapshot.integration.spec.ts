import { TestBed } from '@angular/core/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { OperationLogStoreService } from '../../persistence/operation-log-store.service';
import { SyncHydrationService } from '../../persistence/sync-hydration.service';
import { StateSnapshotService } from '../../backup/state-snapshot.service';
import { ClientIdService } from '../../../core/util/client-id.service';
import { VectorClockService } from '../../sync/vector-clock.service';
import { ValidateStateService } from '../../validation/validate-state.service';
import { SnackService } from '../../../core/snack/snack.service';
import { TaskTimeSyncService } from '../../../features/tasks/task-time-sync.service';
import { selectSyncConfig } from '../../../features/config/store/global-config.reducer';
import { DEFAULT_GLOBAL_CONFIG } from '../../../features/config/default-global-config.const';
import { Operation, OpType } from '../../core/operation.types';
import { reapplyKeptPendingOps } from '../../sync/keep-pending-on-snapshot.util';
import { TabSeqFrontierService } from '../../persistence/tab-seq-frontier.service';
import { TestClient, resetTestUuidCounter } from './helpers/test-client.helper';

/**
 * #10972 on the real store: a catch-up file snapshot keeps the pending edits
 * past its baseline, rejects the covered and discarded ones in the same
 * transaction, and a reload replays exactly the kept ones on top of it.
 */
describe('Keep pending ops on a catch-up file snapshot (#10972)', () => {
  let opLogStore: OperationLogStoreService;
  let hydration: SyncHydrationService;
  let local: TestClient;
  let remote: TestClient;

  const edit = (client: TestClient, id: string): Operation =>
    client.createOperation({
      actionType: '[Task Shared] updateTask',
      opType: OpType.Update,
      entityType: 'TASK',
      entityId: id,
      payload: { task: { id, changes: { title: `${client.clientId} edit` } } },
    });

  beforeEach(async () => {
    const clientId = jasmine.createSpyObj<ClientIdService>('ClientIdService', [
      'loadClientId',
      'getOrGenerateClientId',
      'clearCache',
    ]);
    clientId.loadClientId.and.resolveTo('clientLocal');
    clientId.getOrGenerateClientId.and.resolveTo('clientLocal');

    TestBed.configureTestingModule({
      providers: [
        provideMockStore({
          selectors: [{ selector: selectSyncConfig, value: DEFAULT_GLOBAL_CONFIG.sync }],
        }),
        OperationLogStoreService,
        SyncHydrationService,
        { provide: ClientIdService, useValue: clientId },
        {
          provide: StateSnapshotService,
          useValue: { getAllSyncModelDataFromStoreAsync: () => Promise.resolve({}) },
        },
        {
          provide: VectorClockService,
          useValue: {
            getCurrentVectorClock: () => Promise.resolve(local.getCurrentClock()),
          },
        },
        {
          provide: ValidateStateService,
          useValue: {
            validateAndRepair: () =>
              Promise.resolve({ isValid: true, wasRepaired: false }),
          },
        },
        { provide: SnackService, useValue: jasmine.createSpyObj('S', ['open']) },
        { provide: TaskTimeSyncService, useValue: { flush: () => undefined } },
      ],
    });
    opLogStore = TestBed.inject(OperationLogStoreService);
    hydration = TestBed.inject(SyncHydrationService);
    await opLogStore.init();
    await opLogStore._clearAllDataForTesting();
    resetTestUuidCounter();
    local = new TestClient('clientLocal');
    remote = new TestClient('clientRemote');
  });

  it('keeps only the uncovered edits and replays them after a reload', async () => {
    // Uploaded before a crash skipped markSynced: the snapshot already holds it.
    const covered = edit(local, 'task-1');
    const kept = edit(local, 'task-2');
    const discarded = edit(local, 'task-3');
    for (const op of [covered, kept, discarded]) {
      await opLogStore.append(op);
    }
    const included = edit(remote, 'task-remote');
    const snapshotClock = { ...included.vectorClock, clientLocal: 1 };

    await hydration.hydrateFromRemoteSync({ task: { ids: [] } }, snapshotClock, {
      snapshotIncludedOps: [included],
      keepPendingOps: { discardOpIds: [discarded.id] },
    });
    const tabSeqFrontier = TestBed.inject(TabSeqFrontierService);
    const lastSeq = await opLogStore.getLastSeq();
    // Live state is the bare snapshot until the kept rows are re-applied.
    expect(tabSeqFrontier.isSaveSafeAt(lastSeq)).toBe(false);
    const applyOperations = jasmine
      .createSpy('applyOperations')
      .and.callFake(async (ops: Operation[]) => ({ appliedOps: ops }));
    await reapplyKeptPendingOps({
      opLogStore,
      operationApplier: { applyOperations },
      snackService: { open: () => undefined },
      tabSeqFrontier,
    });
    expect(tabSeqFrontier.isSaveSafeAt(lastSeq)).toBe(true);

    expect(
      applyOperations.calls.mostRecent().args[0].map((op: Operation) => op.id),
    ).toEqual([kept.id]);
    expect((await opLogStore.getUnsynced()).map((e) => e.op.id)).toEqual([kept.id]);
    // What startup hydration replays on top of the state cache after a reload.
    const cache = await opLogStore.loadStateCache();
    const tail = await opLogStore.getOpsAfterSeq(cache!.lastAppliedOpSeq);
    expect(tail.map((e) => e.op.id)).toEqual([kept.id]);
    expect(tail[0].op.vectorClock).toEqual(kept.vectorClock);
  });
});
