import { getProjectCompletionStats } from './project-completion-stats.util';
import { Task } from '../tasks/task.model';

const task = (p: Partial<Task>): Task => ({ ...p }) as Task;

// Computed keys avoid the object-literal naming-convention lint rule on date strings.
const DAY_1 = '2026-06-01';
const DAY_2 = '2026-06-02';
const DAY_3 = '2026-06-03';
const DAY_4 = '2026-06-04';
const DAY_5 = '2026-06-05';

describe('getProjectCompletionStats', () => {
  it('returns zeros for an empty project', () => {
    const stats = getProjectCompletionStats([], [], 1000);
    expect(stats.nrOfTasksTotal).toBe(0);
    expect(stats.nrOfTasksDone).toBe(0);
    expect(stats.timeSpent).toBe(0);
    expect(stats.nrOfDaysWorked).toBe(0);
    expect(stats.startedOn).toBeNull();
    expect(stats.durationDays).toBe(0);
  });

  it('counts done/total over top-level tasks only', () => {
    const top = [
      task({ isDone: true, timeSpent: 0, timeSpentOnDay: {} }),
      task({ isDone: false, timeSpent: 0, timeSpentOnDay: {} }),
      task({ isDone: true, timeSpent: 0, timeSpentOnDay: {} }),
    ];
    const stats = getProjectCompletionStats(top, top, 1000);
    expect(stats.nrOfTasksTotal).toBe(3);
    expect(stats.nrOfTasksDone).toBe(2);
  });

  it('sums time over top-level tasks only (no subtask double-count)', () => {
    const parent = task({ isDone: true, timeSpent: 5000, timeSpentOnDay: {} });
    const subTask = task({ isDone: true, timeSpent: 2000, timeSpentOnDay: {} });
    // allTasks includes the subtask, but timeSpent must come from top-level only.
    const stats = getProjectCompletionStats([parent], [parent, subTask], 1000);
    expect(stats.timeSpent).toBe(5000);
  });

  it('unions worked days across parents and subtasks, ignoring zero days', () => {
    const parent = task({
      isDone: true,
      timeSpent: 10,
      timeSpentOnDay: { [DAY_1]: 10, [DAY_2]: 0 },
    });
    const subTask = task({
      isDone: true,
      timeSpent: 5,
      timeSpentOnDay: { [DAY_3]: 5 },
    });
    const stats = getProjectCompletionStats([parent], [parent, subTask], Date.now());
    // DAY_1 and DAY_3 have time; DAY_2 is zero → excluded.
    expect(stats.nrOfDaysWorked).toBe(2);
  });

  it('computes calendar duration inclusive of first and last day', () => {
    const parent = task({
      isDone: true,
      timeSpent: 10,
      timeSpentOnDay: { [DAY_1]: 10, [DAY_4]: 10 },
    });
    const doneOn = new Date(2026, 5, 5, 14, 0, 0).getTime(); // 2026-06-05
    const stats = getProjectCompletionStats([parent], [parent], doneOn);
    // started 06-01 → done 06-05 inclusive = 5 days.
    expect(stats.durationDays).toBe(5);
  });

  it('reports a single-day project as duration 1', () => {
    const parent = task({
      isDone: true,
      timeSpent: 10,
      timeSpentOnDay: { [DAY_5]: 10 },
    });
    const doneOn = new Date(2026, 5, 5, 18, 0, 0).getTime();
    const stats = getProjectCompletionStats([parent], [parent], doneOn);
    expect(stats.durationDays).toBe(1);
  });
});
