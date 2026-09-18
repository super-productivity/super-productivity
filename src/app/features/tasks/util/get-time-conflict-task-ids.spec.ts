import { TaskWithDueTime } from '../task.model';
import { getTimeConflictTaskIds } from './get-time-conflict-task-ids';

const h = (hours: number): number => hours * 60 * 60 * 1000;
const m = (minutes: number): number => minutes * 60 * 1000;
const createTask = (
  partial: Partial<TaskWithDueTime> & Pick<TaskWithDueTime, 'id' | 'dueWithTime'>,
): TaskWithDueTime => {
  const { id, dueWithTime, ...rest } = partial;

  return {
    id,
    dueWithTime,
    projectId: 'INBOX',
    timeSpentOnDay: {},
    attachments: [],
    title: id,
    tagIds: [],
    created: 0,
    timeSpent: 0,
    timeEstimate: 0,
    isDone: false,
    subTaskIds: [],
    ...rest,
  } as TaskWithDueTime;
};

// Consumers only call .has() on the result, so assert membership, not the Set's
// incidental insertion order — that would pin the scan's internals.
const conflictIds = (tasks: TaskWithDueTime[]): string[] =>
  [...getTimeConflictTaskIds(tasks)].sort();

describe('getTimeConflictTaskIds', () => {
  it('should handle empty and single-task schedules', () => {
    expect(conflictIds([])).toEqual([]);
    expect(conflictIds([createTask({ id: 'only', dueWithTime: h(9) })])).toEqual([]);
  });

  it('should find nested overlaps even after the immediately previous task ends', () => {
    const tasks = [
      createTask({ id: 'late', dueWithTime: h(12), timeEstimate: m(15) }),
      createTask({ id: 'long', dueWithTime: h(9), timeEstimate: h(4) }),
      createTask({ id: 'short', dueWithTime: h(10), timeEstimate: m(15) }),
      createTask({ id: 'touching', dueWithTime: h(13), timeEstimate: h(1) }),
    ];
    tasks.forEach(Object.freeze);
    Object.freeze(tasks);

    expect(conflictIds(tasks)).toEqual(['late', 'long', 'short']);
    expect(tasks.map((task) => task.id)).toEqual(['late', 'long', 'short', 'touching']);
  });

  it('should extend overlap chains and keep separate groups separate', () => {
    expect(
      conflictIds([
        createTask({ id: 'a', dueWithTime: h(9), timeEstimate: h(2) }),
        createTask({ id: 'b', dueWithTime: h(10), timeEstimate: h(2) }),
        createTask({ id: 'c', dueWithTime: h(11), timeEstimate: h(2) }),
        createTask({ id: 'isolated', dueWithTime: h(13), timeEstimate: h(1) }),
        createTask({ id: 'd', dueWithTime: h(15), timeEstimate: h(1) }),
        createTask({ id: 'e', dueWithTime: h(15), timeEstimate: h(1) }),
      ]),
    ).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('should use remaining time with a one-minute minimum', () => {
    const tracked = createTask({
      id: 'tracked',
      dueWithTime: h(9),
      timeEstimate: h(2),
      timeSpent: h(1),
    });
    const next = createTask({ id: 'next', dueWithTime: h(10), timeEstimate: h(1) });
    expect(conflictIds([tracked, next])).toEqual([]);
    expect(conflictIds([{ ...tracked, timeSpent: m(59) }, next])).toEqual([
      'next',
      'tracked',
    ]);
    expect(
      conflictIds([
        { ...tracked, timeSpent: h(3) },
        { ...next, dueWithTime: h(9) + m(0.5) },
      ]),
    ).toEqual(['next', 'tracked']);
    expect(
      conflictIds([
        { ...tracked, timeSpent: h(3) },
        { ...next, dueWithTime: h(9) + m(1) },
      ]),
    ).toEqual([]);
  });

  it('should use the full remaining estimate for parents with subtasks', () => {
    expect(
      conflictIds([
        createTask({
          id: 'parent',
          dueWithTime: h(9),
          timeEstimate: h(2),
          timeSpent: h(2),
          subTaskIds: ['child'],
        }),
        createTask({ id: 'next', dueWithTime: h(10), timeEstimate: h(1) }),
      ]),
    ).toEqual(['next', 'parent']);
  });

  it('should mark tasks with overlapping planned time', () => {
    const result = getTimeConflictTaskIds([
      createTask({
        id: 'a',
        dueWithTime: new Date('2026-04-15T10:00:00').getTime(),
        timeEstimate: h(2),
      }),
      createTask({
        id: 'b',
        dueWithTime: new Date('2026-04-15T11:00:00').getTime(),
        timeEstimate: h(1),
      }),
      createTask({
        id: 'c',
        dueWithTime: new Date('2026-04-15T14:00:00').getTime(),
        timeEstimate: h(1),
      }),
    ]);

    expect([...result].sort()).toEqual(['a', 'b']);
  });

  it('should ignore done tasks', () => {
    const result = getTimeConflictTaskIds([
      createTask({
        id: 'a',
        dueWithTime: new Date('2026-04-15T10:00:00').getTime(),
        timeEstimate: h(2),
      }),
      createTask({
        id: 'b',
        dueWithTime: new Date('2026-04-15T10:30:00').getTime(),
        timeEstimate: h(1),
        isDone: true,
      }),
    ]);

    expect([...result]).toEqual([]);
  });

  it('should detect overlaps across midnight', () => {
    const result = getTimeConflictTaskIds([
      createTask({
        id: 'late',
        dueWithTime: new Date('2026-04-15T23:30:00').getTime(),
        timeEstimate: h(2),
      }),
      createTask({
        id: 'early',
        dueWithTime: new Date('2026-04-16T00:30:00').getTime(),
        timeEstimate: m(30),
      }),
    ]);

    expect([...result].sort()).toEqual(['early', 'late']);
  });
});
