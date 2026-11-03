import { DEFAULT_TASK, Task } from '../task.model';
import { countDueTasks, getDueTaskCounts } from './count-due-tasks';

describe('countDueTasks', () => {
  let nextId = 0;
  beforeEach(() => (nextId = 0));
  const task = (changes: Partial<Task>): Task => ({
    ...DEFAULT_TASK,
    id: 'task-' + nextId++,
    projectId: 'project',
    ...changes,
  });

  it('counts standalone due tasks, excluding done, undated and future tasks', () => {
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
    ).toBe(3);
  });

  it('matches 7 Today rows, 1 Later Today row and 7 overdue rows with independently scheduled subtasks', () => {
    const today = '2026-11-03';
    const tasks = [
      ...Array.from({ length: 6 }, () => task({ dueDay: today })),
      task({ dueDay: today, parentId: 'unscheduled-parent' }),
      task({ dueWithTime: new Date(2026, 10, 3, 14).getTime() }),
      ...Array.from({ length: 4 }, () => task({ dueDay: '2026-11-02' })),
      ...Array.from({ length: 3 }, () =>
        task({ dueDay: '2026-11-02', parentId: 'future-parent' }),
      ),
      task({ id: 'unscheduled-parent' }),
      task({ id: 'future-parent', dueDay: '2026-11-04' }),
    ];
    expect(countDueTasks(tasks, today, 0)).toBe(15);
    expect(getDueTaskCounts(tasks, today, 0)).toEqual({
      today: 8,
      overdue: 7,
      total: 15,
    });
  });

  it('counts a parent only once when its child is nested in the same day group', () => {
    expect(
      countDueTasks(
        [
          task({ id: 'today-parent', dueDay: '2026-11-03' }),
          task({ parentId: 'today-parent', dueDay: '2026-11-03' }),
          task({ id: 'overdue-parent', dueDay: '2026-11-01' }),
          task({ parentId: 'overdue-parent', dueDay: '2026-11-02' }),
        ],
        '2026-11-03',
        0,
      ),
    ).toBe(2);
  });

  it('counts separately displayed parent and child rows in different day groups', () => {
    expect(
      countDueTasks(
        [
          task({ id: 'today-parent', dueDay: '2026-11-03' }),
          task({ parentId: 'today-parent', dueDay: '2026-11-02' }),
          task({ id: 'overdue-parent', dueDay: '2026-11-01' }),
          task({ parentId: 'overdue-parent', dueDay: '2026-11-03' }),
        ],
        '2026-11-03',
        0,
      ),
    ).toBe(4);
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
