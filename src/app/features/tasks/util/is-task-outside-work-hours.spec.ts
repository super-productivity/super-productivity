import { ScheduleConfig } from '../../config/global-config.model';
import { Task } from '../task.model';
import { isTaskOutsideWorkHours } from './is-task-outside-work-hours';

const h = (hours: number): number => hours * 60 * 60 * 1000;
const createTask = (partial: Partial<Task>): Task =>
  ({
    id: 'task',
    projectId: 'INBOX',
    timeSpentOnDay: {},
    attachments: [],
    title: 'Task',
    tagIds: [],
    created: 0,
    timeSpent: 0,
    timeEstimate: 0,
    isDone: false,
    subTaskIds: [],
    ...partial,
  }) as Task;

const scheduleConfig = (partial: Partial<ScheduleConfig> = {}): ScheduleConfig =>
  ({
    isWorkStartEndEnabled: true,
    workStart: '09:00',
    workEnd: '17:00',
    isLunchBreakEnabled: false,
    lunchBreakStart: '12:00',
    lunchBreakEnd: '13:00',
    ...partial,
  }) as ScheduleConfig;

describe('isTaskOutsideWorkHours', () => {
  it('does not extend a sub-minute slot beyond the end of work hours', () => {
    const dueWithTime = new Date(2026, 3, 15, 16, 59, 30).getTime();
    const task = createTask({ dueWithTime, timeEstimate: 30_000 });

    expect(
      isTaskOutsideWorkHours(task, scheduleConfig(), task.id, dueWithTime - h(1)),
    ).toBe(false);
    expect(
      isTaskOutsideWorkHours(task, scheduleConfig(), task.id, dueWithTime + 5000),
    ).toBe(false);
  });

  it('uses the booked end once the tracked task reaches its scheduled slot', () => {
    const dueWithTime = new Date(2026, 3, 15, 16, 30).getTime();
    const task = createTask({ dueWithTime, timeEstimate: h(1), timeSpent: h(0.75) });

    expect(
      isTaskOutsideWorkHours(task, scheduleConfig(), task.id, dueWithTime - h(1)),
    ).toBe(false);
    expect(
      isTaskOutsideWorkHours(task, scheduleConfig(), task.id, dueWithTime + h(0.25)),
    ).toBe(true);
  });

  it('warns when the full estimate extends a previously worked task past work hours', () => {
    const start = new Date(2026, 3, 15, 16, 20).getTime();
    const task = createTask({
      dueWithTime: start,
      timeEstimate: h(1),
      timeSpent: h(1 / 3),
      timeSpentOnDay: { ['2026-04-14']: h(1 / 3) },
    });

    expect(isTaskOutsideWorkHours(task, scheduleConfig(), null, start)).toBe(false);
    expect(isTaskOutsideWorkHours(task, scheduleConfig(), task.id, start)).toBe(true);
  });

  it('should return false when work hours are disabled', () => {
    const task = createTask({
      dueWithTime: new Date(2026, 3, 15, 7, 0).getTime(),
      timeEstimate: h(1),
    });

    expect(
      isTaskOutsideWorkHours(task, scheduleConfig({ isWorkStartEndEnabled: false })),
    ).toBe(false);
  });

  it('should return false for a task inside work hours', () => {
    const task = createTask({
      dueWithTime: new Date(2026, 3, 15, 9, 0).getTime(),
      timeEstimate: h(1),
    });

    expect(isTaskOutsideWorkHours(task, scheduleConfig())).toBe(false);
  });

  it('should return true when the task starts before work hours', () => {
    const task = createTask({
      dueWithTime: new Date(2026, 3, 15, 8, 30).getTime(),
      timeEstimate: h(1),
    });

    expect(isTaskOutsideWorkHours(task, scheduleConfig())).toBe(true);
  });

  it('should return true when the task ends after work hours', () => {
    const task = createTask({
      dueWithTime: new Date(2026, 3, 15, 16, 30).getTime(),
      timeEstimate: h(1),
    });

    expect(isTaskOutsideWorkHours(task, scheduleConfig())).toBe(true);
  });

  it('should use a minimum duration for zero-estimate tasks', () => {
    const task = createTask({
      dueWithTime: new Date(2026, 3, 15, 16, 59, 30).getTime(),
      timeEstimate: 0,
      timeSpent: 0,
    });

    expect(isTaskOutsideWorkHours(task, scheduleConfig())).toBe(true);
  });
});
