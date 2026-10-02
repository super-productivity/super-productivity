import { DEFAULT_TASK, Task } from '../../../../features/tasks/task.model';
import { WorkContextType } from '../../../../features/work-context/work-context.model';
import { TaskSharedActions } from '../../../../root-store/meta/task-shared.actions';
import { FuzzDevice, SyncFuzzHarness } from './sync-fuzz-harness';

/**
 * A three-device shape the fuzz oracles report as `older-write-won` (#10422),
 * with the values on every device and after a restart. A writes notes, then
 * renames, offline. C writes newer notes, offline. B renames last.
 *
 * A field patch used to re-send the OTHER side's older fields at the newest
 * timestamp of both sides, so A's notes beat C's newer notes everywhere:
 * - remote win: A resolves its rename against B's newer one;
 * - local win: B resolves its newer rename against A's ops, which reached the
 *   server first.
 * Now each resolver applies the other side as itself and re-sends only its own
 * fields that won, each at its own write's time, so every field takes its
 * latest write: B's title and C's notes.
 */
describe('field patch timestamps (#10422)', () => {
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

  for (const direction of ['remote win', 'local win'] as const) {
    it(`a ${direction} keeps a third device’s newer notes`, async () => {
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
      if (direction === 'local win') {
        // A's ops reach the server first; B resolves against them and wins.
        expect(await harness.sync(a)).toBe(true);
      }
      harness.tick();
      await harness.as(c, () => updateTask({ notes: 'C notes (newest)' }));
      harness.tick();
      await harness.as(b, () => updateTask({ title: 'B title' }));

      expect(await harness.sync(b)).toBe(true);
      if (direction === 'remote win') {
        // A resolves against B's newer rename and loses it.
        expect(await harness.sync(a)).toBe(true);
      }
      expect(await harness.sync(c)).toBe(true);
      for (let round = 0; round < 2; round++) {
        for (const device of [a, b, c]) {
          expect(await harness.sync(device)).toBe(true);
        }
      }

      const expected = { title: 'B title', notes: 'C notes (newest)' };
      expect({ A: await taskOn(a), B: await taskOn(b), C: await taskOn(c) }).toEqual({
        A: expected,
        B: expected,
        C: expected,
      });
      await harness.restart(a);
      expect(await taskOn(a)).toEqual(expected);
    }, 60_000);
  }

  it('re-sends a won field at its own write’s time, not its side’s latest', async () => {
    // A writes notes, C writes newer notes, A renames: all offline. B renames
    // last and syncs; A resolves against B, wins its notes and re-sends them.
    // Stamped at A's rename (its side's latest) instead of the notes' own
    // time, that row would beat C's newer notes when C resolves against it.
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
    await harness.as(c, () => updateTask({ notes: 'C notes (newer)' }));
    harness.tick();
    await harness.as(a, () => updateTask({ title: 'A title' }));
    harness.tick();
    await harness.as(b, () => updateTask({ title: 'B title' }));
    for (const device of [b, a, c]) {
      expect(await harness.sync(device)).toBe(true);
    }
    for (let round = 0; round < 2; round++) {
      for (const device of [a, b, c]) {
        expect(await harness.sync(device)).toBe(true);
      }
    }

    const expected = { title: 'B title', notes: 'C notes (newer)' };
    expect({ A: await taskOn(a), B: await taskOn(b), C: await taskOn(c) }).toEqual({
      A: expected,
      B: expected,
      C: expected,
    });
    await harness.restart(a);
    expect(await taskOn(a)).toEqual(expected);
  }, 60_000);

  it('a side with a later rename keeps the other device’s newer notes', async () => {
    // Two devices: A writes notes and leaves them pending, C writes newer
    // notes and uploads, A renames and uploads after C. A's side has the
    // latest intent (the rename), but C's notes are the newer write of notes:
    // A resolves per field and re-sends only its title.
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
    for (const device of [a, c]) {
      expect(await harness.sync(device)).toBe(true);
    }

    harness.tick();
    await harness.as(a, () => updateTask({ notes: 'A notes' }));
    harness.tick();
    await harness.as(c, () => updateTask({ notes: 'C notes (newer)' }));
    expect(await harness.sync(c)).toBe(true);
    harness.tick();
    await harness.as(a, () => updateTask({ title: 'A title' }));
    expect(await harness.sync(a)).toBe(true);
    for (let round = 0; round < 2; round++) {
      for (const device of [a, c]) {
        expect(await harness.sync(device)).toBe(true);
      }
    }

    const expected = { title: 'A title', notes: 'C notes (newer)' };
    expect({ A: await taskOn(a), C: await taskOn(c) }).toEqual({
      A: expected,
      C: expected,
    });
    await harness.restart(a);
    expect(await taskOn(a)).toEqual(expected);
  }, 60_000);
});
