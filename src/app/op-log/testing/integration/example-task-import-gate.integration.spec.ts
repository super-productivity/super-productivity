import { TestBed } from '@angular/core/testing';
import { OperationLogStoreService } from '../../persistence/operation-log-store.service';
import { ActionType, OpType, Operation } from '../../core/operation.types';
import { SyncImportConflictGateService } from '../../sync/sync-import-conflict-gate.service';
import { OperationWriteFlushService } from '../../sync/operation-write-flush.service';
import { resetTestUuidCounter, TestClient } from './helpers/test-client.helper';

/**
 * Integration tests for the startup-example-task path of the SYNC_IMPORT conflict gate.
 *
 * Unlike the gate/sync unit specs (which mock OperationLogStoreService.getUnsynced and
 * markRejected), these run the REAL store against IndexedDB. They therefore verify the
 * seam the unit tests stub: that example-task ops persisted with their real
 * multi-entity payload shape are (a) recognized by the gate as non-meaningful, and
 * (b) actually excluded from getUnsynced() after markRejected — i.e. never uploaded.
 *
 * NOTE: This covers the op-log marker/gate/discard layer. It does NOT exercise the
 * ExampleTasksService -> afterInitialSyncDoneStrict$ timing — that is e2e-only.
 */
describe('Example-task SYNC_IMPORT gate (integration)', () => {
  let storeService: OperationLogStoreService;
  let gate: SyncImportConflictGateService;

  const local = new TestClient('client-local');
  const remote = new TestClient('client-remote');

  const exampleTaskOp = (id: string): Operation =>
    local.createOperation({
      actionType: ActionType.TASK_SHARED_ADD,
      opType: OpType.Create,
      entityType: 'TASK',
      entityId: id,
      payload: {
        actionPayload: { task: { id }, isExampleTask: true },
        entityChanges: [],
      },
    });

  const configOp = (): Operation =>
    local.createOperation({
      actionType: ActionType.GLOBAL_CONFIG_UPDATE_SECTION,
      opType: OpType.Update,
      entityType: 'GLOBAL_CONFIG',
      entityId: 'sync',
      payload: { sectionKey: 'sync' },
    });

  const incomingSyncImport = (): Operation =>
    remote.createOperation({
      actionType: '[SP_ALL] Load(import) all data' as ActionType,
      opType: OpType.SyncImport,
      entityType: 'ALL',
      entityId: 'incoming-import',
      payload: { appDataComplete: { task: { ids: [], entities: {} } } },
    });

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        OperationLogStoreService,
        SyncImportConflictGateService,
        {
          provide: OperationWriteFlushService,
          useValue: { flushPendingWrites: () => Promise.resolve() },
        },
      ],
    });
    storeService = TestBed.inject(OperationLogStoreService);
    gate = TestBed.inject(SyncImportConflictGateService);

    await storeService.init();
    await storeService._clearAllDataForTesting();
    resetTestUuidCounter();
  });

  it('treats pending example-task creates + config as non-meaningful and reports them as discardable', async () => {
    const example1 = exampleTaskOp('example-task-1');
    const example2 = exampleTaskOp('example-task-2');
    await storeService.append(configOp(), 'local');
    await storeService.append(example1, 'local');
    await storeService.append(example2, 'local');

    const result = await gate.checkIncomingFullStateConflict([incomingSyncImport()]);

    expect(result.fullStateOp).toBeDefined();
    expect(result.hasMeaningfulPending).toBeFalse();
    expect(result.dialogData).toBeUndefined();
    expect(result.discardablePendingOpIds.sort()).toEqual(
      [example1.id, example2.id].sort(),
    );
  });

  it('actually excludes example-task ops from getUnsynced after markRejected (so they are not uploaded)', async () => {
    const config = configOp();
    const example = exampleTaskOp('example-task-1');
    await storeService.append(config, 'local');
    await storeService.append(example, 'local');

    const result = await gate.checkIncomingFullStateConflict([incomingSyncImport()]);
    await storeService.markRejected(result.discardablePendingOpIds);

    const remaining = (await storeService.getUnsynced()).map((e) => e.op.id);
    expect(remaining).toContain(config.id);
    expect(remaining).not.toContain(example.id);
  });

  it('shows the dialog (and still lists the example id) when real user work is also pending', async () => {
    const example = exampleTaskOp('example-task-1');
    const realTaskUpdate = local.createOperation({
      actionType: '[Task] Update Task' as ActionType,
      opType: OpType.Update,
      entityType: 'TASK',
      entityId: 'real-task-1',
      payload: { actionPayload: { task: { id: 'real-task-1' } }, entityChanges: [] },
    });
    await storeService.append(example, 'local');
    await storeService.append(realTaskUpdate, 'local');

    const result = await gate.checkIncomingFullStateConflict([incomingSyncImport()]);

    expect(result.hasMeaningfulPending).toBeTrue();
    expect(result.dialogData).toBeDefined();
    // The example id is still reported; the sync service leaves it untouched on the
    // dialog path, so it rides along if the user keeps local state.
    expect(result.discardablePendingOpIds).toEqual([example.id]);
  });

  it('does not treat a remote example-task op as discardable (gate reads local pending only)', async () => {
    // A remote op carrying the same flag is stored with source='remote' (syncedAt set),
    // so getUnsynced() never returns it and it cannot bypass the dialog.
    const remoteExample = remote.createOperation({
      actionType: ActionType.TASK_SHARED_ADD,
      opType: OpType.Create,
      entityType: 'TASK',
      entityId: 'remote-example-1',
      payload: {
        actionPayload: { task: { id: 'remote-example-1' }, isExampleTask: true },
        entityChanges: [],
      },
    });
    await storeService.append(remoteExample, 'remote');

    const result = await gate.checkIncomingFullStateConflict([incomingSyncImport()]);

    expect(result.discardablePendingOpIds).toEqual([]);
  });
});
