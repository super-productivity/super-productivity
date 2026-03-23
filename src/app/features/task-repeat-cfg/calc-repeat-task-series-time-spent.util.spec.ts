import { calcRepeatTaskSeriesTimeSpent } from './calc-repeat-task-series-time-spent.util';
import { Task } from '../tasks/task.model';

const createTask = (timeSpentOnDay: Record<string, number>): Task =>
  ({
    id: 'task-' + Math.random().toString(36).slice(2),
    timeSpentOnDay,
  }) as Partial<Task> as Task;

// Fixed reference date: Wednesday 2025-01-15
// ISO week starts Monday 2025-01-13
// Month starts 2025-01-01
const NOW = new Date(2025, 0, 15);

const d1 = '2025-01-10';
const d2 = '2025-01-11';
const d3 = '2025-01-12';
const dMonday = '2025-01-13';
const dToday = '2025-01-15';
const dFirstOfMonth = '2025-01-01';
const dOld = '2020-03-15';

describe('calcRepeatTaskSeriesTimeSpent', () => {
  it('should return zeros for empty task list', () => {
    const result = calcRepeatTaskSeriesTimeSpent([], NOW);
    expect(result.total).toBe(0);
    expect(result.thisWeek).toBe(0);
    expect(result.thisMonth).toBe(0);
  });

  it('should sum total time across all tasks', () => {
    const tasks = [
      createTask({ [d1]: 3600000, [d2]: 1800000 }),
      createTask({ [d3]: 900000 }),
    ];
    const result = calcRepeatTaskSeriesTimeSpent(tasks, NOW);
    expect(result.total).toBe(3600000 + 1800000 + 900000);
  });

  it('should sum time for current week only in thisWeek', () => {
    const tasks = [
      createTask({ [dToday]: 1000, [dOld]: 5000 }),
      createTask({ [dMonday]: 2000 }),
    ];
    const result = calcRepeatTaskSeriesTimeSpent(tasks, NOW);
    expect(result.thisWeek).toBe(3000);
    expect(result.total).toBe(8000);
  });

  it('should sum time for current month only in thisMonth', () => {
    const tasks = [
      createTask({ [dFirstOfMonth]: 4000, [dOld]: 7000 }),
      createTask({ [dToday]: 3000 }),
    ];
    const result = calcRepeatTaskSeriesTimeSpent(tasks, NOW);
    expect(result.thisMonth).toBe(7000);
    expect(result.total).toBe(14000);
  });

  it('should handle tasks with empty timeSpentOnDay', () => {
    const tasks = [createTask({})];
    const result = calcRepeatTaskSeriesTimeSpent(tasks, NOW);
    expect(result.total).toBe(0);
    expect(result.thisWeek).toBe(0);
    expect(result.thisMonth).toBe(0);
  });

  it('should handle tasks with zero time entries', () => {
    const tasks = [createTask({ [d1]: 0 })];
    const result = calcRepeatTaskSeriesTimeSpent(tasks, NOW);
    expect(result.total).toBe(0);
  });

  it('should aggregate time from same date across multiple tasks', () => {
    const tasks = [createTask({ [d1]: 1000 }), createTask({ [d1]: 2000 })];
    const result = calcRepeatTaskSeriesTimeSpent(tasks, NOW);
    expect(result.total).toBe(3000);
  });
});
