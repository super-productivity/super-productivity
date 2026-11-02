import { TaskSharedActions } from '../../../../root-store/meta/task-shared.actions';
import { executeIntent, Intent, SETUP_INTENTS, viewOf } from './sync-fuzz-actions';
import { FuzzDevice, SyncFuzzHarness } from './sync-fuzz-harness';

describe('three trackers of an initially unscheduled task', () => {
  afterEach(() => SyncFuzzHarness.dispose());

  for (const isChild of [false, true]) {
    for (const first of ['A', 'B'] as const) {
      it(`${first}-first ${isChild ? 'child and parent' : 'task'} retains all three original deltas after restart and fresh join`, async () => {
        const harness = await SyncFuzzHarness.create();
        const [a, b, c] = await Promise.all(
          ['A', 'B', 'C'].map((id) => harness.addDevice(id)),
        );
        const act = (device: FuzzDevice, intent: Intent): Promise<unknown> =>
          harness.as(device, () => executeIntent(harness, intent));
        for (const intent of SETUP_INTENTS) await act(a, intent);
        if (isChild) {
          // A genuine unscheduled parent keeps the tracking auto-plan reachable.
          await act(a, ['addTask', 'parent', 'P']);
          await harness.as(a, () =>
            harness.dispatch(
              TaskSharedActions.convertToSubTask({
                taskId: 't3',
                targetParentId: 'parent',
                afterTaskId: null,
              }),
            ),
          );
        }
        for (const device of [a, b, c]) await harness.sync(device);
        await act(a, ['track', 't3', 3000]);
        await act(b, ['track', 't3', 1000]);
        // Original task3 ordering: C tracks only AFTER B's initial sync.
        await harness.sync(first === 'B' ? b : a);
        await act(c, ['track', 't3', 5000]);
        await harness.sync(c);
        const order = first === 'B' ? [b, c, a] : [a, b, c];
        for (let round = 0; round < 3; round++) {
          for (const device of order) await harness.sync(device);
        }
        const assertTime = async (device: FuzzDevice): Promise<void> => {
          const tasks = viewOf(await harness.as(device, () => harness.state())).tasks;
          const task = tasks.find((value) => value.id === 't3');
          expect(task?.timeSpent).withContext(device.name).toBe(9000);
          if (isChild) {
            const parent = tasks.find((value) => value.id === 'parent');
            expect(parent?.timeSpent)
              .withContext(`${device.name} parent total`)
              .toBe(9000);
            expect(parent?.timeSpentOnDay).toEqual(task?.timeSpentOnDay);
            expect(parent?.subTaskIds).toContain('t3');
            expect(task?.parentId).toBe('parent');
          }
        };
        for (const device of [a, b, c]) {
          await assertTime(device);
          await harness.restart(device);
          await assertTime(device);
        }
        const fresh = await harness.addDevice('D');
        await harness.sync(fresh);
        await assertTime(fresh);
        expect(harness.events).toEqual([]);
      }, 60_000);
    }
  }
});
