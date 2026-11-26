import { selectOpenWeekTasks } from './open-week-tasks.selector';
import { DEFAULT_TASK, Task } from '../../../features/tasks/task.model';

const TODAY = '2026-10-30';
const task = (id: string, extra: Partial<Task> = {}): Task => ({
  ...DEFAULT_TASK,
  id,
  title: id,
  projectId: 'P',
  ...extra,
});
const entities = (...tasks: Task[]): Record<string, Task> =>
  Object.fromEntries(tasks.map((t) => [t.id, t]));
const ids = (tasks: Task[]): string[] => tasks.map((t) => t.id);

describe('selectOpenWeekTasks', () => {
  it('returns undone tasks from today and overdue ones', () => {
    const result = selectOpenWeekTasks.projector(
      ['today'],
      ['overdue'],
      entities(
        task('today', { dueDay: TODAY }),
        task('overdue', { dueDay: '2026-10-27' }),
      ),
      TODAY,
    );
    expect(ids(result)).toEqual(['today', 'overdue']);
  });

  it('leaves out done tasks and repeating-task instances', () => {
    const result = selectOpenWeekTasks.projector(
      ['repeat'],
      ['doneOverdue', 'open'],
      entities(
        task('repeat', { dueDay: TODAY, repeatCfgId: 'R' }),
        task('doneOverdue', { dueDay: '2026-10-27', isDone: true }),
        task('open', { dueDay: '2026-10-28' }),
      ),
      TODAY,
    );
    expect(ids(result)).toEqual(['open']);
  });

  it('adds open subtasks due today or overdue before their parent, once', () => {
    const result = selectOpenWeekTasks.projector(
      ['parent'],
      ['subOverdue'],
      entities(
        task('parent', { subTaskIds: ['subToday', 'subOverdue', 'subLater', 'subDone'] }),
        task('subToday', { parentId: 'parent', dueDay: TODAY }),
        task('subOverdue', { parentId: 'parent', dueDay: '2026-10-28' }),
        task('subLater', { parentId: 'parent', dueDay: '2026-11-03' }),
        task('subDone', { parentId: 'parent', dueDay: TODAY, isDone: true }),
      ),
      TODAY,
    );
    expect(ids(result)).toEqual(['subToday', 'subOverdue', 'parent']);
  });

  it('keeps a subtask before its parent when the parent comes from the overdue list', () => {
    const result = selectOpenWeekTasks.projector(
      ['sub'],
      ['parent'],
      entities(
        task('parent', { dueDay: '2026-10-28', subTaskIds: ['sub'] }),
        task('sub', { parentId: 'parent', dueDay: TODAY }),
      ),
      TODAY,
    );
    expect(ids(result)).toEqual(['sub', 'parent']);
  });

  it('carries an open subtask of a done parent only when it is due itself', () => {
    const result = selectOpenWeekTasks.projector(
      [],
      ['subOverdue'],
      entities(
        task('parent', { isDone: true, subTaskIds: ['subOverdue', 'subOpen'] }),
        task('subOverdue', { parentId: 'parent', dueDay: '2026-10-28' }),
        task('subOpen', { parentId: 'parent' }),
      ),
      TODAY,
    );
    expect(ids(result)).toEqual(['subOverdue']);
  });

  it('leaves out tasks with a time, so their time and reminder are kept', () => {
    const result = selectOpenWeekTasks.projector(
      ['timed', 'parent'],
      ['timedOverdue'],
      entities(
        task('timed', { dueWithTime: 1, remindAt: 1 }),
        task('timedOverdue', { dueWithTime: 1 }),
        task('parent', { dueDay: TODAY, subTaskIds: ['timedSub'] }),
        task('timedSub', { parentId: 'parent', dueDay: TODAY, dueWithTime: 1 }),
      ),
      TODAY,
    );
    expect(ids(result)).toEqual(['parent']);
  });

  it('leaves out tasks overdue from before this week', () => {
    const result = selectOpenWeekTasks.projector(
      [],
      ['lastWeek', 'monday'],
      entities(
        task('lastWeek', { dueDay: '2026-10-25' }),
        task('monday', { dueDay: '2026-10-26' }),
      ),
      TODAY,
    );
    expect(ids(result)).toEqual(['monday']);
  });

  it('leaves out overdue subtasks of a repeating-task instance', () => {
    const result = selectOpenWeekTasks.projector(
      [],
      ['sub'],
      entities(
        task('repeat', { repeatCfgId: 'R', subTaskIds: ['sub'] }),
        task('sub', { parentId: 'repeat', dueDay: '2026-10-28' }),
      ),
      TODAY,
    );
    expect(ids(result)).toEqual([]);
  });
});
