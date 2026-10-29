import { isDoneTaskForToday, sortDoneTasksByDoneDate } from './work-context.util';
import { Task, TaskWithSubTasks } from '../tasks/task.model';

describe('sortDoneTasksByDoneDate', () => {
  const task = (id: string, doneOn?: number): TaskWithSubTasks =>
    ({ id, isDone: true, doneOn }) as TaskWithSubTasks;

  it('orders completed tasks by completion date, newest first', () => {
    const sorted = sortDoneTasksByDoneDate([
      task('OLD', 1000),
      task('NEW', 3000),
      task('MID', 2000),
    ]);
    expect(sorted.map((t) => t.id)).toEqual(['NEW', 'MID', 'OLD']);
  });

  it('treats a missing completion timestamp as oldest', () => {
    const sorted = sortDoneTasksByDoneDate([task('NO_DATE'), task('HAS_DATE', 5000)]);
    expect(sorted.map((t) => t.id)).toEqual(['HAS_DATE', 'NO_DATE']);
  });

  it('does not mutate the input array', () => {
    const input = [task('A', 1000), task('B', 2000)];
    sortDoneTasksByDoneDate(input);
    expect(input.map((t) => t.id)).toEqual(['A', 'B']);
  });

  it('preserves input order for equal completion timestamps (stable sort)', () => {
    const sorted = sortDoneTasksByDoneDate([
      task('A', 1000),
      task('B', 1000),
      task('C', 1000),
    ]);
    expect(sorted.map((t) => t.id)).toEqual(['A', 'B', 'C']);
  });

  it('returns an empty array unchanged', () => {
    expect(sortDoneTasksByDoneDate([])).toEqual([]);
  });
});

describe('isDoneTaskForToday', () => {
  const TODAY = '2023-06-13';
  const task = (overrides: Partial<Task>): Task =>
    ({ id: 'T', isDone: true, dueDay: null, ...overrides }) as Task;

  it('includes a task due today', () => {
    expect(isDoneTaskForToday(task({ dueDay: TODAY }), TODAY, 0)).toBe(true);
  });

  it('includes a task with a due time today', () => {
    const dueWithTime = new Date(2023, 5, 13, 15, 0).getTime();
    expect(isDoneTaskForToday(task({ dueWithTime }), TODAY, 0)).toBe(true);
  });

  it('includes a task completed today that was due on an earlier day', () => {
    const doneOn = new Date(2023, 5, 13, 9, 0).getTime();
    expect(isDoneTaskForToday(task({ dueDay: '2024-01-01', doneOn }), TODAY, 0)).toBe(
      true,
    );
  });

  it('includes an unscheduled task completed today', () => {
    const doneOn = new Date(2023, 5, 13, 9, 0).getTime();
    expect(isDoneTaskForToday(task({ doneOn }), TODAY, 0)).toBe(true);
  });

  it('excludes a task due and completed on an earlier day', () => {
    const doneOn = new Date(2023, 5, 10, 9, 0).getTime();
    const dueWithTime = new Date(2023, 5, 10, 8, 0).getTime();
    expect(
      isDoneTaskForToday(task({ dueDay: '2023-06-10', dueWithTime, doneOn }), TODAY, 0),
    ).toBe(false);
  });

  it('excludes a done task without any date', () => {
    expect(isDoneTaskForToday(task({}), TODAY, 0)).toBe(false);
  });

  it('respects the start-of-next-day offset', () => {
    // 01:00 on the 14th still belongs to the 13th when the day starts at 04:00
    const doneOn = new Date(2023, 5, 14, 1, 0).getTime();
    const fourHours = 4 * 60 * 60 * 1000;
    expect(isDoneTaskForToday(task({ doneOn }), TODAY, fourHours)).toBe(true);
    expect(isDoneTaskForToday(task({ doneOn }), TODAY, 0)).toBe(false);
  });
});
