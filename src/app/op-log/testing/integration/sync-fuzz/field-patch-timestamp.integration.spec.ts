import { DEFAULT_TASK, Task } from '../../../../features/tasks/task.model';
import { WorkContextType } from '../../../../features/work-context/work-context.model';
import { TaskSharedActions } from '../../../../root-store/meta/task-shared.actions';
import { FuzzDevice, SyncFuzzHarness } from './sync-fuzz-harness';

/**
 * Pins TODAY's outcome of a three-device shape, like the failing traces in
 * sync-fuzz-pinned-traces.json, with the values on every device and after a
 * restart. Second review of #10415, finding 1; accepted as a residual on
 * #10393, follow-up #10422. The fuzz oracles report the same shape as
 * `older-write-won:task.notes` (the `remote-win-patch-timestamp` pins).
 *
 * A writes notes, then renames, offline. C writes newer notes, offline. B
 * renames last and syncs. A resolves its title conflict with B as a remote
 * win: its field patch carries A's notes with the winning side's timestamp,
 * which then beats C's newer notes on every device.
 * - master: C's newer notes win, but A's notes edit is lost (#10260 shape).
 * - stamping the patch with A's own time instead: C's notes beat the patch
 *   row, whose content C cannot read, so C wins whole-entity with a snapshot
 *   read before the batch (#10421): both renames are lost on A and B, and C
 *   diverges.
 *
 * The cause is the side-level winner plus opaque resolution rows; a fix needs
 * #10421, then a readable re-send with a per-field winner (#10422). Update
 * this pin when that lands.
 */
describe('field patch: a remote win’s timestamp (known current behavior)', () => {
  let harness: SyncFuzzHarness;
  let a: FuzzDevice;
  let b: FuzzDevice;
  let c: FuzzDevice;

  const updateTask = (changes: Partial<Task>): Promise<void> =>
    harness.dispatch(TaskSharedActions.updateTask({ task: { id: 't1', changes } }));

  const taskOn = (device: FuzzDevice): Promise<Pick<Task, 'title' | 'notes'>> =>
    harness.as(device, async () => {
      const tasks = (await harness.state())['tasks'] as {
        entities: Record<string, Task>;
      };
      const { title, notes } = tasks.entities['t1'];
      return { title, notes };
    });

  beforeEach(async () => {
    harness = await SyncFuzzHarness.create();
    a = await harness.addDevice('A');
    b = await harness.addDevice('B');
    c = await harness.addDevice('C');
  }, 60_000);

  afterEach(() => SyncFuzzHarness.dispose());

  it('promotes the loser’s older notes over a third device’s newer edit', async () => {
    await harness.as(a, () =>
      harness.dispatch(
        TaskSharedActions.addTask({
          task: {
            ...DEFAULT_TASK,
            id: 't1',
            title: 'task',
            projectId: 'INBOX_PROJECT',
            created: Date.now(),
          },
          workContextId: 'INBOX_PROJECT',
          workContextType: WorkContextType.PROJECT,
          isAddToBacklog: false,
          isAddToBottom: false,
        }),
      ),
    );
    for (const device of [a, b, c]) {
      expect(await harness.sync(device)).toBe(true);
    }

    harness.tick();
    await harness.as(a, () => updateTask({ notes: 'A notes' }));
    harness.tick();
    await harness.as(a, () => updateTask({ title: 'A title' }));
    harness.tick();
    await harness.as(c, () => updateTask({ notes: 'C notes (newest)' }));
    harness.tick();
    await harness.as(b, () => updateTask({ title: 'B title' }));

    expect(await harness.sync(b)).toBe(true);
    expect(await harness.sync(a)).toBe(true);
    expect(await harness.sync(c)).toBe(true);
    for (let round = 0; round < 2; round++) {
      for (const device of [a, b, c]) {
        expect(await harness.sync(device)).toBe(true);
      }
    }

    // Correct LWW would keep 'C notes (newest)'; see the comment above.
    const expected = { title: 'B title', notes: 'A notes' };
    expect({ A: await taskOn(a), B: await taskOn(b), C: await taskOn(c) }).toEqual({
      A: expected,
      B: expected,
      C: expected,
    });
    await harness.restart(a);
    expect(await taskOn(a)).toEqual(expected);
  }, 60_000);
});
