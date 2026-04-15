import { TaskWithDueTime } from '../task.model';
import { getTimeConflictTaskIds } from './get-time-conflict-task-ids';

const h = (hours: number): number => hours * 60 * 60 * 1000;
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
  const isSameDay = (timestamp: number): boolean =>
    new Date(timestamp).toDateString() === new Date('2026-04-15T00:00:00').toDateString();

  it('should mark tasks with overlapping planned time', () => {
    const result = getTimeConflictTaskIds(
      [
        createTask({
          id: 'a',
          dueWithTime: new Date('2026-04-15T10:00:00').getTime(),
          timeEstimate: h(2),
          timeSpent: 0,
          isDone: false,
        }),
        createTask({
          id: 'b',
          dueWithTime: new Date('2026-04-15T11:00:00').getTime(),
          timeEstimate: h(1),
          timeSpent: 0,
          isDone: false,
        }),
        createTask({
          id: 'c',
          dueWithTime: new Date('2026-04-15T14:00:00').getTime(),
          timeEstimate: h(1),
          timeSpent: 0,
          isDone: false,
        }),
      ],
      isSameDay,
    );

    expect([...result].sort()).toEqual(['a', 'b']);
  });

  it('should ignore done tasks and tasks on other days', () => {
    const result = getTimeConflictTaskIds(
      [
        createTask({
          id: 'a',
          dueWithTime: new Date('2026-04-15T10:00:00').getTime(),
          timeEstimate: h(2),
          timeSpent: 0,
          isDone: false,
        }),
        createTask({
          id: 'b',
          dueWithTime: new Date('2026-04-15T10:30:00').getTime(),
          timeEstimate: h(1),
          timeSpent: 0,
          isDone: true,
        }),
        createTask({
          id: 'c',
          dueWithTime: new Date('2026-04-16T10:30:00').getTime(),
          timeEstimate: h(1),
          timeSpent: 0,
          isDone: false,
        }),
      ],
      isSameDay,
    );

    expect([...result]).toEqual([]);
  });
});
