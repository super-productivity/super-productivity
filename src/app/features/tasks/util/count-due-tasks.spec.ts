import { DEFAULT_TASK, Task } from '../task.model';
import { countDueTasks } from './count-due-tasks';

describe('countDueTasks', () => {
  const task = (changes: Partial<Task>): Task => ({
    ...DEFAULT_TASK,
    id: 'task',
    projectId: 'project',
    ...changes,
  });

  it('counts today and overdue main tasks, excluding done, undated and future tasks', () => {
    expect(
      countDueTasks(
        [
          task({ dueDay: '2026-10-03' }),
          task({ dueDay: '2026-10-02' }),
          task({ dueDay: '2026-10-04' }),
          task({ dueDay: '2026-10-03', isDone: true }),
          task({ dueDay: '2026-10-03', parentId: 'parent' }),
          task({}),
        ],
        '2026-10-03',
        0,
      ),
    ).toBe(2);
  });

  it('counts timed tasks later today and respects the logical-day boundary', () => {
    const tasks = [
      task({ dueWithTime: new Date(2026, 9, 3, 23).getTime() }),
      task({ dueWithTime: new Date(2026, 9, 4, 2).getTime() }),
      task({ dueWithTime: new Date(2026, 9, 4, 5).getTime() }),
    ];
    expect(countDueTasks(tasks, '2026-10-03', 4 * 3600000)).toBe(2);
    expect(countDueTasks(tasks, '2026-10-03', 0)).toBe(1);
    expect(countDueTasks([], '2026-10-03', 0)).toBe(0);
  });
});
