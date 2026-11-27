import { DEFAULT_PROJECT } from '../../../../features/project/project.const';
import { addProject } from '../../../../features/project/store/project.actions';
import { Project } from '../../../../features/project/project.model';
import { DEFAULT_TASK, Task } from '../../../../features/tasks/task.model';
import { WorkContextType } from '../../../../features/work-context/work-context.model';
import { TaskSharedActions } from '../../../../root-store/meta/task-shared.actions';
import { FuzzDevice, SyncFuzzHarness } from './sync-fuzz-harness';

/**
 * #11685 follow-up: a move that wins a field conflict travels as an LWW patch
 * row `{ projectId }`. B edits the task's notes, A moves it later and resolves
 * (the row), B applies the row and deletes the task; its delete carries the
 * new project.
 *
 * A bulk replay skips an LWW row of a task deleted later in the same batch
 * (`bulkOperationsMetaReducer`), so wherever the row and the delete replay
 * together the task was still listed in the project it left, and the delete
 * removed it from the payload's project only: a dead id in the old project's
 * list ("Missing task data for project", then an auto-repair) on a device
 * that downloads both at once, and on the deleting device after a restart.
 */
describe('a move re-sent as a projectId row, then a delete (#11685)', () => {
  let harness: SyncFuzzHarness;
  let a: FuzzDevice;
  let b: FuzzDevice;
  let c: FuzzDevice;

  interface Slices {
    tasks: { entities: Record<string, Task | undefined> };
    projects: { entities: Record<string, Project | undefined> };
  }
  const slices = async (): Promise<Slices> =>
    (await harness.state()) as unknown as Slices;
  const listsOn = (device: FuzzDevice): Promise<Record<string, unknown>> =>
    harness.as(device, async () => {
      const { tasks, projects } = await slices();
      return {
        hasTask: !!tasks.entities['t1'],
        p1: projects.entities['p1']?.taskIds,
        p2: projects.entities['p2']?.taskIds,
      };
    });
  const GONE = { hasTask: false, p1: [], p2: [] };

  beforeEach(async () => {
    harness = await SyncFuzzHarness.create();
    a = await harness.addDevice('A');
    b = await harness.addDevice('B');
    c = await harness.addDevice('C');
    await harness.as(a, async () => {
      for (const id of ['p1', 'p2']) {
        await harness.dispatch(
          addProject({ project: { ...DEFAULT_PROJECT, id, title: id } }),
        );
      }
      await harness.dispatch(
        TaskSharedActions.addTask({
          task: {
            ...DEFAULT_TASK,
            id: 't1',
            title: 'task',
            projectId: 'p1',
            created: Date.now(),
          },
          workContextId: 'p1',
          workContextType: WorkContextType.PROJECT,
          isAddToBacklog: false,
          isAddToBottom: false,
        }),
      );
    });
    for (const device of [a, b, c]) {
      expect(await harness.sync(device)).toBe(true);
    }

    harness.tick();
    await harness.as(b, () =>
      harness.dispatch(
        TaskSharedActions.updateTask({ task: { id: 't1', changes: { notes: 'B' } } }),
      ),
    );
    expect(await harness.sync(b)).toBe(true);
    harness.tick();
    await harness.as(a, async () => {
      const task = (await slices()).tasks.entities['t1'] as Task;
      await harness.dispatch(
        TaskSharedActions.moveToOtherProject({
          task: { ...task, subTasks: [] },
          targetProjectId: 'p2',
        }),
      );
    });
    // A resolves its move against B's edit and re-sends it as a row.
    expect(await harness.sync(a)).toBe(true);
    expect(
      harness.server.rows.map(({ op }) => op.actionType).filter((t) => /LWW/.test(t)),
    ).toEqual(['[TASK] LWW Update']);
    expect(await harness.sync(b)).toBe(true);
    harness.tick();
    await harness.as(b, async () => {
      const task = (await slices()).tasks.entities['t1'] as Task;
      expect(task.projectId).toBe('p2');
      await harness.dispatch(
        TaskSharedActions.deleteTask({ task: { ...task, subTasks: [] } }),
      );
    });
    expect(await harness.sync(b)).toBe(true);
  }, 60_000);

  afterEach(() => SyncFuzzHarness.dispose());

  it('leaves no dead id on a device that downloads the row and the delete at once', async () => {
    // true: no validation failure, repair or other event during the sync.
    expect(await harness.sync(c)).toBe(true);
    expect(await listsOn(c)).toEqual(GONE);
    expect(harness.server.rows.some(({ op }) => op.opType === 'REPAIR')).toBeFalse();
  }, 60_000);

  it('leaves no dead id on the deleting device after a restart', async () => {
    expect(await listsOn(b)).toEqual(GONE);
    await harness.restart(b);
    expect(await listsOn(b)).toEqual(GONE);
  }, 60_000);
});
