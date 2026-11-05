import * as fromSelectors from './planner.selectors';
import { PlannerState } from './planner.reducer';
import { Task, TaskWithDueTime } from '../../tasks/task.model';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';
import { getDateTimeFromClockString } from '../../../util/get-date-time-from-clock-string';

/**
 * Regression for #11263: creating a (non-repeating) task with both dueDay and
 * dueWithTime for a future planner day used to list it in planner.days and as
 * a scheduled item — one timed block and one untimed block packed into free
 * space. Write-side exclusivity now clears dueDay on add; this keeps the
 * render-side guard (#11212) for already-affected data.
 */
describe('Planner Selectors - #11263 dual dueDay+dueWithTime on future day', () => {
  const NINETY_MIN = 90 * 60 * 1000;
  const today = getDbDateStr();
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 3);
  const futureDay = getDbDateStr(futureDate);
  const futureDueWithTime = getDateTimeFromClockString(
    '16:15',
    dateStrToUtcDate(futureDay).getTime(),
  );

  const task = {
    id: 't-dual',
    title: '组会',
    created: futureDate.getTime(),
    isDone: false,
    subTaskIds: [],
    tagIds: [],
    projectId: 'project1',
    timeSpentOnDay: {},
    timeEstimate: NINETY_MIN,
    timeSpent: 0,
    attachments: [],
    dueWithTime: futureDueWithTime,
    // inconsistent state as produced by the pre-fix REST create path
    dueDay: futureDay,
  } as Task as TaskWithDueTime;

  const plannerState: PlannerState = {
    days: { [futureDay]: ['t-dual'] },
    addPlannedTasksDialogLastShown: undefined,
  };

  it('shows the timed task once (not also as an untimed day task)', () => {
    const selector = fromSelectors.selectPlannerDays(
      [futureDay],
      [],
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

    expect(day.tasks).toHaveSize(0);
    expect(day.scheduledIItems).toHaveSize(1);
    expect(day.itemsTotal).toBe(1);
    expect(day.timeEstimate).toBe(NINETY_MIN);
  });

  it('selectPlannerDayMap drops the timed task from the day list', () => {
    const map = fromSelectors.selectPlannerDayMap.projector(
      new Map([[task.id, task]]),
      plannerState,
    );

    expect(map[futureDay]).toEqual([]);
  });
});
