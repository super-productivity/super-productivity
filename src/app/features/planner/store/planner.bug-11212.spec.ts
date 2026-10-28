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

// Regression for #11212: making a timed task repeatable with a future first
// occurrence left it with BOTH `dueWithTime` and `dueDay` on that day, and
// listed in `planner.days[day]`. The planner then rendered it once as a
// scheduled item and once as a normal task (estimate counted twice), and the
// schedule view placed it at 17:15 and again at the start of the work day.
describe('Planner Selectors - #11212 timed task also listed in planner day', () => {
  const THIRTY_MIN = 30 * 60 * 1000;
  const today = getDbDateStr();
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 3);
  const futureDay = getDbDateStr(futureDate);
  const futureDueWithTime = getDateTimeFromClockString(
    '17:15',
    dateStrToUtcDate(futureDay).getTime(),
  );

  const weekday = futureDate.getDay();
  const weeklyCfg: TaskRepeatCfg = {
    ...DEFAULT_TASK_REPEAT_CFG,
    id: 'R1',
    repeatCycle: 'WEEKLY',
    repeatEvery: 1,
    startDate: futureDay,
    lastTaskCreationDay: futureDay,
    startTime: '17:15',
    defaultEstimate: THIRTY_MIN,
    sunday: weekday === 0,
    monday: weekday === 1,
    tuesday: weekday === 2,
    wednesday: weekday === 3,
    thursday: weekday === 4,
    friday: weekday === 5,
    saturday: weekday === 6,
  };

  const task = {
    id: 't1',
    title: 'Task t1',
    created: futureDate.getTime(),
    isDone: false,
    subTaskIds: [],
    tagIds: [],
    projectId: 'project1',
    timeSpentOnDay: {},
    timeEstimate: THIRTY_MIN,
    timeSpent: 0,
    attachments: [],
    repeatCfgId: 'R1',
    dueWithTime: futureDueWithTime,
    // the inconsistent state produced by the bug
    dueDay: futureDay,
  } as Task as TaskWithDueTime;

  const plannerState: PlannerState = {
    days: { [futureDay]: ['t1'] },
    addPlannedTasksDialogLastShown: undefined,
  };

  it('selectPlannerDays shows the timed task once with a single estimate', () => {
    const selector = fromSelectors.selectPlannerDays(
      [futureDay],
      [weeklyCfg],
      [],
      [],
      [task],
      today,
    );
    const [day] = selector.projector(
      new Map([[task.id, task]]),
      plannerState,
      { isWorkStartEndEnabled: false } as never,
      0,
    );

    expect(day.tasks.length).toBe(0);
    expect(day.scheduledIItems.length).toBe(1);
    expect(day.itemsTotal).toBe(1);
    expect(day.timeEstimate).toBe(THIRTY_MIN);
  });

  it('selectPlannerDayMap does not list a task that has dueWithTime', () => {
    const map = fromSelectors.selectPlannerDayMap.projector(
      new Map([[task.id, task]]),
      plannerState,
    );

    expect(map[futureDay]).toEqual([]);
  });
});
