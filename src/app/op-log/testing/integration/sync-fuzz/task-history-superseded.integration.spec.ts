import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { TaskSharedActions } from '../../../../root-store/meta/task-shared.actions';
import { getDeferredActions } from '../../../capture/operation-capture.meta-reducer';
import { PluginUserDataState } from '../../../../plugins/plugin-persistence.model';
import { TaskState } from '../../../../features/tasks/task.model';
import { TaskHistoryEnvelope } from '../../../../features/tasks/task-history/task-history.model';
import { extractActionPayload } from '../../../core/operation.types';
import { OperationLogStoreService } from '../../../persistence/operation-log-store.service';
import { SupersededOperationResolverService } from '../../../sync/superseded-operation-resolver.service';
import { executeIntent, SETUP_INTENTS } from './sync-fuzz-actions';
import { FuzzDevice, SyncFuzzHarness } from './sync-fuzz-harness';

describe('Task history during superseded-operation recovery', () => {
  afterEach(() => SyncFuzzHarness.dispose());

  it('retains every original author fact after replacement, restart and fresh-client sync', async () => {
    const harness = await SyncFuzzHarness.create();
    const author = await harness.addDevice('A');
    const deliveries = async (device: FuzzDevice): Promise<PluginUserDataState> =>
      (
        (await harness.syncedState(device)) as unknown as {
          pluginUserData: PluginUserDataState;
        }
      ).pluginUserData;
    const taskState = async (device: FuzzDevice): Promise<TaskState> =>
      ((await harness.syncedState(device)) as unknown as { task: TaskState }).task;
    await harness.as(author, async () => {
      for (const intent of SETUP_INTENTS) await executeIntent(harness, intent);
    });
    expect(await harness.sync(author)).toBeTrue();

    // The final Task is open again. Its LWW replacement alone cannot represent
    // either author event; the history lives alongside entities in TaskState.
    for (const isDone of [true, false]) {
      harness.tick();
      await harness.as(author, () => executeIntent(harness, ['doneTask', 't2', isDone]));
    }
    const expected = (await taskState(author)).taskHistory!.t2;
    const expectedEvents = Object.values(expected.events);
    expect(expectedEvents.map((event) => event.after)).toEqual([
      { kind: 'status', value: 'done' },
      { kind: 'status', value: 'open' },
    ]);

    await harness.as(author, async () => {
      const db = TestBed.inject(OperationLogStoreService);
      const originals = (await db.getUnsynced()).map(({ op }) => op);
      expect(originals).toHaveSize(2);
      const envelopes = originals.map(
        (op) => extractActionPayload(op.payload)['taskHistory'] as TaskHistoryEnvelope,
      );
      expect(envelopes.flatMap((envelope) => envelope.events)).toEqual(expectedEvents);

      // Enter the real recovery boundary used by RejectedOpsHandlerService
      // when downloaded clocks leave server-rejected local edits pending.
      // Capture, IndexedDB writes, replacement, retirement and hydration are
      // real; neither the recorder nor the resolver is mocked here.
      const replacementCount = await TestBed.inject(
        SupersededOperationResolverService,
      ).resolveSupersededLocalOps(originals.map((op) => ({ opId: op.id, op })));
      expect(replacementCount).toBe(1);
      for (const op of originals) {
        expect((await db.getOpById(op.id))?.rejectedAt).toBeDefined();
      }
    });
    expect((await taskState(author)).taskHistory!.t2).toEqual(expected);

    const expectedDeliveries = await deliveries(author);
    expect(expectedDeliveries.length).toBeGreaterThanOrEqual(2);

    // Local hydration can still replay rejected originals, but fresh clients
    // cannot download them. Delivery must preserve their exact author facts.
    await harness.restart(author);
    expect(await deliveries(author)).toEqual(expectedDeliveries);
    expect((await taskState(author)).taskHistory!.t2).toEqual(expected);
    expect(await harness.sync(author)).toBeTrue();
    const fresh = await harness.addDevice('F');
    expect(await harness.sync(fresh)).toBeTrue();
    expect((await taskState(fresh)).taskHistory!.t2).toEqual(expected);
    expect(await deliveries(fresh)).toEqual(expectedDeliveries);
    await harness.restart(fresh);
    expect(await deliveries(fresh)).toEqual(expectedDeliveries);
    expect((await taskState(fresh)).taskHistory!.t2).toEqual(expected);
    expect(await harness.pendingOpCount(author)).toBe(0);
    expect(await harness.pendingOpCount(fresh)).toBe(0);
    expect(harness.events).toEqual([]);
  }, 60_000);

  it('persists a user edit arriving during delivery replay before recovery returns', async () => {
    const harness = await SyncFuzzHarness.create();
    const author = await harness.addDevice('A');
    await harness.as(author, async () => {
      for (const intent of SETUP_INTENTS) await executeIntent(harness, intent);
    });
    expect(await harness.sync(author)).toBeTrue();
    await harness.as(author, () => executeIntent(harness, ['doneTask', 't2', true]));

    await harness.as(author, async () => {
      const db = TestBed.inject(OperationLogStoreService);
      const originals = (await db.getUnsynced()).map(({ op }) => op);
      const store = TestBed.inject(Store<{ pluginUserData: PluginUserDataState }>);
      const edit = TaskSharedActions.setDeadline({
        taskId: 't2',
        deadlineDay: '2026-11-20',
      });
      let editScheduled = false;
      let editWasDeferred = false;
      const subscription = store.subscribe((state) => {
        if (editScheduled || !state.pluginUserData.length) return;
        editScheduled = true;
        // Delivery dispatch schedules this before replayOperationBatch's own
        // event-loop yield. The real apply window must buffer this user edit.
        setTimeout(() => {
          store.dispatch(edit);
          editWasDeferred = getDeferredActions().includes(edit);
        }, 0);
      });
      try {
        await TestBed.inject(
          SupersededOperationResolverService,
        ).resolveSupersededLocalOps(originals.map((op) => ({ opId: op.id, op })));
        expect(editWasDeferred).toBeTrue();
        // Assert inside the device turn: harness.as() drains leftovers later,
        // which would otherwise hide the missing production drain.
        expect(getDeferredActions()).toEqual([]);
        const persistedEdit = (await db.getUnsynced()).find(
          ({ op }) => op.actionType === edit.type,
        );
        expect(persistedEdit).toBeDefined();
        if (!persistedEdit) return;
        const envelope = extractActionPayload(persistedEdit.op.payload)[
          'taskHistory'
        ] as TaskHistoryEnvelope;
        expect(envelope.events.map((event) => [event.field, event.after])).toEqual([
          ['deadline', { kind: 'day', value: '2026-11-20' }],
        ]);
      } finally {
        subscription.unsubscribe();
      }
    });
    expect(harness.events).toEqual([]);
  }, 60_000);
});
