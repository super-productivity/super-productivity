import * as fromSelectors from './planner.selectors';
import { PlannerState } from './planner.reducer';
import { Task } from '../../tasks/task.model';
import { getDbDateStr } from '../../../util/get-db-date-str';
import {
  DEFAULT_TASK_REPEAT_CFG,
  TaskRepeatCfg,
} from '../../task-repeat-cfg/task-repeat-cfg.model';

// Regression for #8220: a recurring task that already has an instance in a day
// (created, and possibly marked done) was counted twice in the Planner: once as
// the real task instance and again as a repeat projection. The "Today" view
// (work-context.util) only ever counted the real instance, so the two views
// disagreed on remaining time. The Planner must defer to the real instance and
// drop the now-redundant projection.
describe('Planner Selectors - #8220 recurring done task double-count', () => {
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

  // A daily cfg that still projects for today (startDate in the past,
  // lastTaskCreationDay not yet advanced to today) and has no startTime, so it
  // contributes its defaultEstimate via noStartTimeRepeatProjections.
  const dailyRepeatCfg = (id: string, defaultEstimate: number): TaskRepeatCfg => ({
    ...DEFAULT_TASK_REPEAT_CFG,
    id,
    repeatCycle: 'DAILY',
    startDate: '2020-01-01',
    lastTaskCreationDay: '2020-01-01',
    startTime: undefined,
    defaultEstimate,
  });

  it('counts a done recurring instance once (0 remaining), not also as a projection', () => {
    const cfg = dailyRepeatCfg('R1', ONE_HOUR);
    const task = createMockTask({
      id: 't1',
      repeatCfgId: 'R1',
      isDone: true,
      timeEstimate: ONE_HOUR,
      timeSpent: 0,
    });

    // Pass t1 as a today-list task id (the reporter sees this in the Today column).
    const selector = fromSelectors.selectPlannerDays(
      [today],
      [cfg],
      ['t1'],
      [],
      [],
      today,
    );
    const result = selector.projector(
      createTasksMapFromTasksArray([task]),
      emptyPlannerState,
      defaultScheduleConfig,
      0,
    );

    expect(result[0].timeEstimate).toBe(0);
    expect(result[0].itemsTotal).toBe(1);
  });

  it('counts an undone recurring instance once, not doubled', () => {
    const cfg = dailyRepeatCfg('R1', ONE_HOUR);
    const task = createMockTask({
      id: 't1',
      repeatCfgId: 'R1',
      isDone: false,
      timeEstimate: ONE_HOUR,
      timeSpent: 0,
    });

    const selector = fromSelectors.selectPlannerDays(
      [today],
      [cfg],
      ['t1'],
      [],
      [],
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
  });

  it('dedupes a timed (startTime) projection too, keeping it out of scheduledIItems', () => {
    // A cfg WITH a startTime flows through repeatProjectionsForDay (the timed
    // list) rather than noStartTimeRepeatProjections, so this exercises the other
    // filtered array and the scheduledIItems dedup.
    const cfg: TaskRepeatCfg = {
      ...dailyRepeatCfg('R1', ONE_HOUR),
      startTime: '09:00',
    };
    const task = createMockTask({
      id: 't1',
      repeatCfgId: 'R1',
      isDone: true,
      timeEstimate: ONE_HOUR,
      timeSpent: 0,
    });

    const selector = fromSelectors.selectPlannerDays(
      [today],
      [cfg],
      ['t1'],
      [],
      [],
      today,
    );
    const result = selector.projector(
      createTasksMapFromTasksArray([task]),
      emptyPlannerState,
      defaultScheduleConfig,
      0,
    );

    expect(result[0].timeEstimate).toBe(0);
    expect(result[0].itemsTotal).toBe(1);
    expect(result[0].scheduledIItems.length).toBe(0);
  });

  it('still projects a recurring cfg that has no task instance in the day', () => {
    const cfg = dailyRepeatCfg('R2', ONE_HOUR);

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
