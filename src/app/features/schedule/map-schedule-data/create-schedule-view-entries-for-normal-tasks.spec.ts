import { SCHEDULE_TASK_MIN_DURATION_IN_MS } from '../schedule.const';
import { getDateTimeFromClockString } from '../../../util/get-date-time-from-clock-string';
import { TaskWithoutReminder } from '../../tasks/task.model';
import { createScheduleViewEntriesForNormalTasks } from './create-schedule-view-entries-for-normal-tasks';

const FID = 'FAKE_TASK_ID';
const FAKE_TASK = {
  id: FID,
  subTaskIds: [],
  timeSpent: 0,
  timeEstimate: 0,
  due: null,
  reminderId: null,
} as any;
const minutes = (n: number): number => n * 60 * 1000;
const hours = (n: number): number => 60 * minutes(n);

// Helper function to conditionally skip tests that are timezone-dependent
// These tests were written with hardcoded expectations for Europe/Berlin timezone
const TZ_OFFSET = new Date('1970-01-01').getTimezoneOffset() * 60000;
const isEuropeBerlinTimezone = (): boolean => TZ_OFFSET === -3600000; // UTC+1 = -1 hour offset
const maybeSkipTimezoneDependent = (testName: string): boolean => {
  if (!isEuropeBerlinTimezone()) {
    console.warn(
      `Skipping timezone-dependent test "${testName}" - only runs in Europe/Berlin timezone`,
    );
    return true;
  }
  return false;
};

describe('createScheduleViewEntriesForNormalTasks()', () => {
  it('should work', () => {
    if (maybeSkipTimezoneDependent('should work')) {
      pending('Skipping timezone-dependent test');
      return;
    }
    const now = getDateTimeFromClockString('9:20', 0);
    const fakeTasks = [
      { ...FAKE_TASK, timeEstimate: hours(1) },
      { ...FAKE_TASK, timeEstimate: hours(1), timeSpent: hours(0.5) },
      { ...FAKE_TASK },
      { ...FAKE_TASK, timeEstimate: hours(1.5), timeSpent: hours(0.25) },
      { ...FAKE_TASK },
    ] as TaskWithoutReminder[];
    const r = createScheduleViewEntriesForNormalTasks(now, fakeTasks);
    expect(r).toEqual([
      {
        data: {
          id: 'FAKE_TASK_ID',
          subTaskIds: [],
          due: null,
          reminderId: null,
          timeEstimate: 3600000,
          timeSpent: 0,
        },
        id: 'FAKE_TASK_ID',
        start: 30000000,
        type: 'Task',
        duration: 3600000,
      },
      {
        data: {
          id: 'FAKE_TASK_ID',
          subTaskIds: [],
          due: null,
          reminderId: null,
          timeEstimate: 3600000,
          timeSpent: 1800000,
        },
        id: 'FAKE_TASK_ID',
        start: 33600000,
        type: 'Task',
        duration: 1800000,
      },
      {
        data: {
          id: 'FAKE_TASK_ID',
          subTaskIds: [],
          due: null,
          reminderId: null,
          timeEstimate: 0,
          timeSpent: 0,
        },
        id: 'FAKE_TASK_ID',
        type: 'Task',
        start: 35400000,
        duration: 0,
      },
      {
        data: {
          id: 'FAKE_TASK_ID',
          subTaskIds: [],
          due: null,
          reminderId: null,
          timeEstimate: 5400000,
          timeSpent: 900000,
        },
        id: 'FAKE_TASK_ID',
        type: 'Task',
        start: 35400000,
        duration: 4500000,
      },
      {
        data: {
          id: 'FAKE_TASK_ID',
          subTaskIds: [],
          due: null,
          reminderId: null,
          timeEstimate: 0,
          timeSpent: 0,
        },
        id: 'FAKE_TASK_ID',
        type: 'Task',
        start: 39900000,
        duration: 0,
      },
    ] as any);
  });

  it('should work for non ordered scheduled tasks', () => {
    const now = getDateTimeFromClockString('9:30', 0);
    const fakeTasks = [
      { ...FAKE_TASK, timeEstimate: hours(1), id: 'OTHER_TASK_ID' },
    ] as TaskWithoutReminder[];
    const r = createScheduleViewEntriesForNormalTasks(now, fakeTasks);
    expect(r).toEqual([
      {
        data: {
          id: 'OTHER_TASK_ID',
          subTaskIds: [],
          due: null,
          reminderId: null,
          timeEstimate: hours(1),
          timeSpent: 0,
        },
        duration: hours(1),
        id: 'OTHER_TASK_ID',

        start: now,
        type: 'Task',
      },
    ] as any);
  });

  it('should not mess up when there is a scheduled task in between tasks', () => {
    const now = getDateTimeFromClockString('9:30', 0);

    const fakeTasks = [
      { ...FAKE_TASK, timeEstimate: hours(1), id: 'T1' },
      { ...FAKE_TASK, timeEstimate: hours(2), id: 'T2' },
    ] as TaskWithoutReminder[];
    const r = createScheduleViewEntriesForNormalTasks(now, fakeTasks);
    expect(r).toEqual([
      {
        data: {
          id: 'T1',
          subTaskIds: [],
          due: null,
          reminderId: null,
          timeEstimate: 3600000,
          timeSpent: 0,
        },
        duration: 3600000,
        id: 'T1',
        start: now,
        type: 'Task',
      },
      {
        data: {
          id: 'T2',
          subTaskIds: [],
          due: null,
          reminderId: null,
          timeEstimate: 7200000,
          timeSpent: 0,
        },
        duration: 7200000,
        id: 'T2',
        start: now + hours(1),
        type: 'Task',
      },
    ] as any);
  });

  it('should use timeEstimate for completed tasks even when timeSpent exceeds it, and fall back to SCHEDULE_TASK_MIN_DURATION_IN_MS when estimate is 0', () => {
    const now = getDateTimeFromClockString('9:30', 0);
    const fakeTasks = [
      {
        ...FAKE_TASK,
        id: 'T_DONE_1',
        timeEstimate: hours(1),
        timeSpent: hours(1),
        isDone: true,
      },
      {
        ...FAKE_TASK,
        id: 'T_DONE_2',
        timeEstimate: 0,
        timeSpent: hours(0.5),
        isDone: true,
      },
      {
        ...FAKE_TASK,
        id: 'T_ACTIVE',
        timeEstimate: hours(2),
        timeSpent: hours(0.5),
        isDone: false,
      },
    ] as TaskWithoutReminder[];
    const r = createScheduleViewEntriesForNormalTasks(now, fakeTasks);
    expect(r[0].duration).toBe(hours(1));
    expect(r[0].start).toBe(now);

    expect(r[1].duration).toBe(SCHEDULE_TASK_MIN_DURATION_IN_MS);
    expect(r[1].start).toBe(now + hours(1));

    expect(r[2].duration).toBe(hours(1.5));
    expect(r[2].start).toBe(now + hours(1) + SCHEDULE_TASK_MIN_DURATION_IN_MS);
  });
});
