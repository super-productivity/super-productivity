import { DEFAULT_TASK, Task, TaskState } from '../task.model';
import { initialTaskState } from '../store/task.reducer';
import { projectPendingTimeFromTaskState } from './project-pending-time-from-task-state';

const createTask = (id: string, overrides: Partial<Task> = {}): Task =>
  ({
    ...DEFAULT_TASK,
    id,
    title: id,
    created: 1,
    ...overrides,
  }) as Task;

describe('projectPendingTimeFromTaskState', () => {
  it('subtracts pending deltas without mutating live task state', () => {
    const task = createTask('task-1', {
      timeSpentOnDay: { ['2024-01-15']: 5000 },
      timeSpent: 5000,
    });
    const state: TaskState = {
      ...initialTaskState,
      ids: ['task-1'],
      entities: { ['task-1']: task },
      currentTaskId: 'task-1',
    };

    const projected = projectPendingTimeFromTaskState(state, [
      { id: 'task-1', date: '2024-01-15', duration: 5000 },
    ]);

    expect(projected.entities['task-1']!.timeSpentOnDay['2024-01-15']).toBeUndefined();
    expect(projected.entities['task-1']!.timeSpent).toBe(0);
    expect(state.entities['task-1']!.timeSpentOnDay['2024-01-15']).toBe(5000);
    expect(state.entities['task-1']!.timeSpent).toBe(5000);
  });

  it('subtracts a pending subtask delta from its parent total', () => {
    const parent = createTask('parent', {
      subTaskIds: ['subtask'],
      timeSpentOnDay: { ['2024-01-15']: 5000 },
      timeSpent: 5000,
    });
    const subtask = createTask('subtask', {
      parentId: 'parent',
      timeSpentOnDay: { ['2024-01-15']: 5000 },
      timeSpent: 5000,
    });
    const state: TaskState = {
      ...initialTaskState,
      ids: ['parent', 'subtask'],
      entities: { parent, subtask },
      currentTaskId: 'subtask',
    };

    const projected = projectPendingTimeFromTaskState(state, [
      { id: 'subtask', date: '2024-01-15', duration: 5000 },
    ]);

    expect(projected.entities['subtask']!.timeSpent).toBe(0);
    expect(projected.entities['parent']!.timeSpent).toBe(0);
  });

  it('leaves missing tasks unchanged', () => {
    expect(
      projectPendingTimeFromTaskState(initialTaskState, [
        { id: 'missing', date: '2024-01-15', duration: 5000 },
      ]),
    ).toBe(initialTaskState);
  });
});
