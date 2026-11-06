import { TestBed } from '@angular/core/testing';
import { readTaskHistoryDelivery } from '../../../../features/tasks/task-history/task-history-delivery';
import { TaskHistoryState } from '../../../../features/tasks/task-history/task-history.model';
import { PluginUserDataState } from '../../../../plugins/plugin-persistence.model';
import { ActionType, extractActionPayload } from '../../../core/operation.types';
import { OperationLogStoreService } from '../../../persistence/operation-log-store.service';
import { FuzzStep } from './sync-fuzz-actions';
import { SyncFuzzHarness } from './sync-fuzz-harness';
import pinnedTraces from './sync-fuzz-pinned-traces.json';
import { runFuzz } from './sync-fuzz-runner';

describe('Task history delivery rejections on the pinned recreate trace', () => {
  afterEach(() => SyncFuzzHarness.dispose());

  it('retries identical immutable facts without adding state failures or a delivery loop', async () => {
    const pin = pinnedTraces.find(
      (trace) =>
        trace.class === 'restart-changes-state' &&
        trace.name ===
          'after a delete, a recreate and concurrent renames, a restart moves the task in Today; title and time stay',
    )!;
    expect(pin).toBeDefined();

    // Observe the real harness instance; runFuzz still owns every action,
    // transport verdict, settle round, restart and whole-state oracle.
    const instances: SyncFuzzHarness[] = [];
    const create = SyncFuzzHarness.create.bind(SyncFuzzHarness);
    spyOn(SyncFuzzHarness, 'create').and.callFake(async () => {
      const harness = await create();
      instances.push(harness);
      return harness;
    });
    const result = await runFuzz({ steps: pin.steps as FuzzStep[] });
    expect(instances).toHaveSize(1);
    expect(result.steps).toEqual(pin.steps as FuzzStep[]);
    expect(result.failures.map((failure) => failure.signature).sort()).toEqual(
      pin.signatures,
    );
    expect(result.rejections).toEqual([
      'CONFLICT_CONCURRENT [Plugin] Upsert User Data',
      'CONFLICT_CONCURRENT [TASK] LWW Update',
    ]);

    const harness = instances[0];
    const rejectedDeliveries = harness.server.rejections.filter(
      (rejection) => rejection.actionType === ActionType.PLUGIN_UPSERT_USER_DATA,
    );
    expect(rejectedDeliveries.length).toBeGreaterThan(0);
    for (const rejection of rejectedDeliveries) {
      const author = harness.devices.find(
        (device) => device.clientId === rejection.clientId,
      )!;
      expect(author).toBeDefined();
      const entry = await harness.as(author, () =>
        TestBed.inject(OperationLogStoreService).getOpById(rejection.opId),
      );
      expect(entry).toBeDefined();
      if (!entry) throw new Error('Rejected delivery missing from its author log');
      const envelope = readTaskHistoryDelivery(extractActionPayload(entry.op.payload));
      expect(envelope).toBeDefined();
      if (!envelope) throw new Error('Rejected row is not an immutable delivery');

      const accepted = harness.server.rows.filter(
        ({ op }) => op.entityId === entry.op.entityId,
      );
      expect(accepted.length).toBeGreaterThan(0);
      // The rejected write and every accepted version of this key carry the
      // same author envelope; only transport IDs and clocks may differ.
      for (const { op } of accepted) {
        expect(readTaskHistoryDelivery(extractActionPayload(op.payload))).toEqual(
          envelope,
        );
      }
      for (const device of harness.devices) {
        const snapshot = (await harness.syncedState(device)) as unknown as {
          task: { taskHistory: TaskHistoryState };
          pluginUserData: PluginUserDataState;
        };
        const delivered = snapshot.pluginUserData.find(
          (row) => row.id === entry.op.entityId,
        );
        expect(delivered).toBeDefined();
        expect(readTaskHistoryDelivery(delivered)).toEqual(envelope);
        for (const event of envelope.events) {
          expect(snapshot.task.taskHistory[event.taskId]?.events[event.id]).toEqual(
            event,
          );
        }
      }
    }

    // A further complete sync round must not manufacture another delivery or
    // repeat the same rejection indefinitely after all original facts arrived.
    const settledSeq = harness.server.latestSeq;
    const settledRejections = harness.server.rejections.length;
    for (const device of harness.devices) {
      expect(await harness.sync(device)).toBeTrue();
      expect(await harness.pendingOpCount(device)).toBe(0);
    }
    expect(harness.server.latestSeq).toBe(settledSeq);
    expect(harness.server.rejections).toHaveSize(settledRejections);
  }, 60_000);
});
