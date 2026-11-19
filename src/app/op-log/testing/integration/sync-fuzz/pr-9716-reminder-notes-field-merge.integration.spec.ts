import { WorkContextType } from '../../../../features/work-context/work-context.model';
import { DEFAULT_TASK, Task } from '../../../../features/tasks/task.model';
import { TaskSharedActions } from '../../../../root-store/meta/task-shared.actions';
import { SyncFuzzHarness, FuzzDevice } from './sync-fuzz-harness';

describe('PR #9716 concurrent remindAt and notes sync', () => {
  afterEach(() => SyncFuzzHarness.dispose());

  const taskId = 'pr9716-task';
  const readTask = (h: SyncFuzzHarness, device: FuzzDevice): Promise<Task | undefined> =>
    h.as(device, async () => {
      const root = await h.state();
      const tasks = root['tasks'] as { entities: Record<string, Task> };
      return tasks.entities[taskId];
    });

  for (const firstUpload of ['reminder', 'notes'] as const) {
    it(`keeps both fields when ${firstUpload} uploads first`, async () => {
      const h = await SyncFuzzHarness.create();
      const a = await h.addDevice('A');
      const b = await h.addDevice('B');
      const originalRemindAt = Date.now() + 60_000;
      const explicitRemindAt = Date.now() + 3_600_000;

      await h.as(a, () =>
        h.dispatch(
          TaskSharedActions.addTask({
            task: {
              ...DEFAULT_TASK,
              id: taskId,
              title: 'Sync reminder',
              projectId: 'INBOX_PROJECT',
              created: Date.now(),
              remindAt: originalRemindAt,
            },
            workContextId: 'INBOX_PROJECT',
            workContextType: WorkContextType.PROJECT,
            isAddToBacklog: false,
            isAddToBottom: false,
          }),
        ),
      );

      expect(await h.sync(a)).toBeTrue();
      expect(await h.sync(b)).toBeTrue();

      await h.as(a, () =>
        h.dispatch(
          TaskSharedActions.updateTask({
            task: { id: taskId, changes: { remindAt: explicitRemindAt } },
          }),
        ),
      );
      await h.as(b, () =>
        h.dispatch(
          TaskSharedActions.updateTask({
            task: { id: taskId, changes: { notes: 'Concurrent note' } },
          }),
        ),
      );

      for (const device of firstUpload === 'reminder' ? [a, b] : [b, a]) {
        await h.sync(device);
      }
      for (let i = 0; i < 3; i++) {
        await h.sync(a);
        await h.sync(b);
      }

      expect(h.events).toEqual([]);
      for (const device of [a, b]) {
        const task = await readTask(h, device);
        expect(task?.remindAt).withContext(device.name).toBe(explicitRemindAt);
        expect(task?.notes).withContext(device.name).toBe('Concurrent note');
      }
      await h.restart(a);
      await h.restart(b);
      for (const device of [a, b]) {
        const task = await readTask(h, device);
        expect(task?.remindAt).withContext(device.name).toBe(explicitRemindAt);
        expect(task?.notes).withContext(device.name).toBe('Concurrent note');
      }
    }, 120_000);
  }
});
