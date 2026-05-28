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

describe('getTimeConflictTaskIds', () => {
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
