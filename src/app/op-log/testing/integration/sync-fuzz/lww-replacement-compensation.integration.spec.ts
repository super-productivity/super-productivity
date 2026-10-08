import { TestBed } from '@angular/core/testing';
import { OperationLogStoreService } from '../../../persistence/operation-log-store.service';
import { ConflictResolutionService } from '../../../sync/conflict-resolution.service';
import { LockService } from '../../../sync/lock.service';
import { LOCK_NAMES } from '../../../core/operation-log.const';
import { TagState } from '../../../../features/tag/tag.model';
import { Task } from '../../../../features/tasks/task.model';
import { executeIntent, SETUP_INTENTS, viewOf } from './sync-fuzz-actions';
import { SyncFuzzHarness } from './sync-fuzz-harness';

// LWW replay intentionally stamps this client's display-only arrival time.
const withoutArrivalTime = (task: Task): Omit<Task, 'modified'> => {
  const copy = { ...task };
  delete copy.modified;
  return copy;
};

/** The replacement rows from frozen23, through the real resolver and hydration. */
describe('losing TASK replacement and its local compensation', () => {
  afterEach(() => SyncFuzzHarness.dispose());

  it('keeps Today ordering stable when a losing snapshot removes the winner from Today', async () => {
    const harness = await SyncFuzzHarness.create();
    const a = await harness.addDevice('A');
    const b = await harness.addDevice('B');
    for (const intent of SETUP_INTENTS) {
      await harness.as(a, () => executeIntent(harness, intent));
    }
    await harness.sync(a);
    await harness.sync(b);
    const remoteState = (await harness.as(a, () =>
      TestBed.inject(ConflictResolutionService).getCurrentEntityState('TASK', 't3'),
    )) as Task;
    await harness.as(b, () => executeIntent(harness, ['track', 't3', 3000]));
    const winner = await harness.as(b, () =>
      TestBed.inject(ConflictResolutionService).getCurrentEntityState('TASK', 't3'),
    );

    await harness.as(b, () =>
      TestBed.inject(LockService).request(LOCK_NAMES.OPERATION_LOG, async () => {
        const store = TestBed.inject(OperationLogStoreService);
        const resolver = TestBed.inject(ConflictResolutionService);
        const localOps = (await store.getUnsynced())
          .map(({ op }) => op)
          .filter((op) => op.entityId === 't3' || op.entityIds?.includes('t3'));
        const remoteOp = resolver.createLWWUpdateOp(
          'TASK',
          't3',
          remoteState,
          a.clientId,
          { [a.clientId]: 10 },
          Math.min(...localOps.map((op) => op.timestamp)) - 1,
          'replace',
        );
        const previousSeq = await store.getLastSeq();
        await resolver.autoResolveConflictsLWW(
          [
            {
              entityType: 'TASK',
              entityId: 't3',
              localOps,
              remoteOps: [remoteOp],
              suggestedResolution: 'local',
            },
          ],
          [],
          { callerHoldsOperationLogLock: true },
        );
        const taskRows = (await store.getOpsAfterSeq(previousSeq)).filter(
          ({ op }) => op.entityType === 'TASK',
        );
        expect(taskRows.length).toBe(2);
        expect(taskRows[0].op).toEqual(remoteOp);
        expect(taskRows[1].source).toBe('local');
        expect(
          withoutArrivalTime(
            (await resolver.getCurrentEntityState('TASK', 't3')) as Task,
          ),
        ).toEqual(withoutArrivalTime(winner as Task));
      }),
    );

    const beforeRoot = await harness.as(b, () => harness.state());
    const beforeRestart = viewOf(beforeRoot);
    await harness.restart(b);
    const afterRoot = await harness.as(b, () => harness.state());
    const afterRestart = viewOf(afterRoot);
    expect((afterRoot['tag'] as TagState).entities['TODAY']?.taskIds).toEqual(
      (beforeRoot['tag'] as TagState).entities['TODAY']?.taskIds,
    );
    expect(afterRestart.tasks.map(withoutArrivalTime)).toEqual(
      beforeRestart.tasks.map(withoutArrivalTime),
    );
    expect(harness.events).toEqual([]);
  }, 60_000);
});
