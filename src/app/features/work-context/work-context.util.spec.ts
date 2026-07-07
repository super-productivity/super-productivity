import { sortDoneTasksByDoneDate } from './work-context.util';
import { TaskWithSubTasks } from '../tasks/task.model';

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
