import * as fromSelectors from './planner.selectors';
import { PlannerState } from './planner.reducer';
import { Task, TaskWithDueTime } from '../../tasks/task.model';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';
import { getDateTimeFromClockString } from '../../../util/get-date-time-from-clock-string';
import {
  DEFAULT_TASK_REPEAT_CFG,
  TaskRepeatCfg,
} from '../../task-repeat-cfg/task-repeat-cfg.model';

// Regression for #8232: the dedup added in #8220/#8229 keyed only off
// `normalTasks`, but a recurring task with `startTime` is created with
// `dueWithTime` and therefore lives in `allPlannedTasks` -> `scheduledTaskItems`,
// never in `normalTasks` on the Today column. The projection was not dropped,
// and `getScheduledTaskItems` ignored `isDone`, so a done timed recurring
// instance contributed roughly 2x its estimate (full from scheduledTaskItems +
// full from the projection). Today only ever counts the real (done-aware) task,
// so the two views disagreed again — the original #8220 symptom for the timed
// subset.
describe('Planner Selectors - #8232 timed recurring done task double-count', () => {
  const today = getDbDateStr();
  const ONE_HOUR = 60 * 60 * 1000;

  const createMockTask = (overrides: Partial<Task> & { id: string }): Task => {
    const { id, ...rest } = overrides;
    return {
      id,
      title: `Task ${id}`,
      created: Date.now(),
      isDone: false,
      subTaskIds: [],
      tagIds: [],
      projectId: 'project1',
      timeSpentOnDay: {},
      timeEstimate: 0,
      timeSpent: 0,
      attachments: [],
      ...rest,
    };
  };

  const createTasksMapFromTasksArray = (tasks: Task[]): Map<string, Task> =>
    new Map(tasks.map((t) => [t.id, t]));

  const emptyPlannerState: PlannerState = {
    days: {},
    addPlannedTasksDialogLastShown: undefined,
  };

  const defaultScheduleConfig = {
    isWorkStartEndEnabled: false,
    workStart: '09:00',
    workEnd: '17:00',
    isLunchBreakEnabled: false,
    lunchBreakStart: '12:00',
    lunchBreakEnd: '13:00',
  };

  // A daily cfg with a fixed startTime — projects via `repeatProjectionsForDay`
  // (the timed list) and, when an instance exists, that instance has
  // `dueWithTime` set so it flows through `allPlannedTasks` /
  // `scheduledTaskItems`.
  const dailyTimedRepeatCfg = (
    id: string,
    defaultEstimate: number,
    startTime = '09:00',
  ): TaskRepeatCfg => ({
    ...DEFAULT_TASK_REPEAT_CFG,
    id,
    repeatCycle: 'DAILY',
    startDate: '2020-01-01',
    lastTaskCreationDay: '2020-01-01',
    startTime,
    defaultEstimate,
  });

  const todayAt = (clock: string): number =>
    getDateTimeFromClockString(clock, dateStrToUtcDate(today).getTime());

  it('done timed recurring instance contributes 0 remaining, not estimate x 2', () => {
    const cfg = dailyTimedRepeatCfg('R1', ONE_HOUR);
    const task = createMockTask({
      id: 't1',
      repeatCfgId: 'R1',
      isDone: true,
      timeEstimate: ONE_HOUR,
      timeSpent: 0,
      dueWithTime: todayAt('09:00'),
    }) as TaskWithDueTime;

    // The reporter's setup: instance is in today's list AND in allPlannedTasks
    // (because dueWithTime is set on the recurring instance).
    const selector = fromSelectors.selectPlannerDays(
      [today],
      [cfg],
      ['t1'],
      [],
      [task],
      today,
    );
    const result = selector.projector(
      createTasksMapFromTasksArray([task]),
      emptyPlannerState,
      defaultScheduleConfig,
      0,
    );

    expect(result[0].timeEstimate).toBe(0);
    // One real (done) instance, projection dropped.
    expect(result[0].itemsTotal).toBe(1);
    // Scheduled list still shows the instance (visible in the day), but as a
    // zero-length item — no double-booked projection alongside it.
    expect(result[0].scheduledIItems.length).toBe(1);
  });

  it('undone timed recurring instance contributes one estimate, not two', () => {
    const cfg = dailyTimedRepeatCfg('R1', ONE_HOUR);
    const task = createMockTask({
      id: 't1',
      repeatCfgId: 'R1',
      isDone: false,
      timeEstimate: ONE_HOUR,
      timeSpent: 0,
      dueWithTime: todayAt('09:00'),
    }) as TaskWithDueTime;

    const selector = fromSelectors.selectPlannerDays(
      [today],
      [cfg],
      ['t1'],
      [],
      [task],
      today,
    );
    const result = selector.projector(
      createTasksMapFromTasksArray([task]),
      emptyPlannerState,
      defaultScheduleConfig,
      0,
    );

    expect(result[0].timeEstimate).toBe(ONE_HOUR);
    expect(result[0].itemsTotal).toBe(1);
    expect(result[0].scheduledIItems.length).toBe(1);
  });

  it('done timed task with no recurring cfg also contributes 0 (getScheduledTaskItems is done-aware)', () => {
    // Independent of the dedup fix: a one-off done timed task used to contribute
    // its full estimate via scheduledTaskItems.
    const task = createMockTask({
      id: 't1',
      isDone: true,
      timeEstimate: ONE_HOUR,
      timeSpent: 0,
      dueWithTime: todayAt('10:00'),
    }) as TaskWithDueTime;

    const selector = fromSelectors.selectPlannerDays(
      [today],
      [],
      ['t1'],
      [],
      [task],
      today,
    );
    const result = selector.projector(
      createTasksMapFromTasksArray([task]),
      emptyPlannerState,
      defaultScheduleConfig,
      0,
    );

    expect(result[0].timeEstimate).toBe(0);
  });

  it('still projects a timed recurring cfg that has no instance in the day', () => {
    const cfg = dailyTimedRepeatCfg('R2', ONE_HOUR);

    const selector = fromSelectors.selectPlannerDays([today], [cfg], [], [], [], today);
    const result = selector.projector(
      createTasksMapFromTasksArray([]),
      emptyPlannerState,
      defaultScheduleConfig,
      0,
    );

    expect(result[0].timeEstimate).toBe(ONE_HOUR);
    expect(result[0].itemsTotal).toBe(1);
  });
});
