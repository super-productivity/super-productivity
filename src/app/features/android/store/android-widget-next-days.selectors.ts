import { createSelector } from '@ngrx/store';
import { computeOrderedTaskIdsForToday } from '../../work-context/store/work-context.selectors';
import { selectTaskSchedulingSnapshotRecord } from '../../tasks/store/task.selectors';
import {
  selectStartOfNextDayDiffMs,
  selectTodayStr,
} from '../../../root-store/app-state/app-state.selectors';
import { selectPlannerState } from '../../planner/store/planner.selectors';
import { selectActiveTaskRepeatCfgs } from '../../task-repeat-cfg/store/task-repeat-cfg.selectors';
import { getTaskRepeatCfgsForExactDayCached } from '../../task-repeat-cfg/store/get-task-repeat-cfgs-for-exact-day-cached.util';
import { TaskRepeatCfg } from '../../task-repeat-cfg/task-repeat-cfg.model';
import { getDbDateStr } from '../../../util/get-db-date-str';

/** How many days after today a Today widget can move on to by itself. */
const WIDGET_NEXT_DAY_COUNT = 7;

export interface WidgetNextDayPlan {
  dayStr: string;
  taskIds: string[];
  repeatCfgs: TaskRepeatCfg[];
}

/**
 * For each of the next days, what its Today list holds as far as the store knows
 * now (#11944): the tasks already due that day — Today's own membership rule, in
 * the planner's order for that day, then the timed ones by start time, which is
 * where the Today screen has them at the start of a day — and the recurring tasks
 * the app will create that day. Reads the scheduling snapshot rather than the task
 * entities, so a time-tracking tick does not repeat the per-day scans.
 *
 * shortcut: this mirrors a day's first run, not a catch-up. A recurring task missed
 * on a day the app did not run is created late by the app but not listed here, and
 * `waitForCompletion` ones are left out (whether one is due depends on the previous
 * instance). Both show once the app has run; listing them here needs the creation
 * rules of TaskRepeatCfgService.
 */
export const selectAndroidWidgetNextDayPlans = createSelector(
  selectTaskSchedulingSnapshotRecord,
  selectPlannerState,
  selectActiveTaskRepeatCfgs,
  selectTodayStr,
  selectStartOfNextDayDiffMs,
  (
    snapshots,
    plannerState,
    repeatCfgs,
    todayStr,
    startOfNextDayDiffMs,
  ): WidgetNextDayPlan[] => {
    const [year, month, day] = todayStr.split('-').map(Number);
    return Array.from({ length: WIDGET_NEXT_DAY_COUNT }, (_, i) => {
      // Noon: no DST shift can move it onto a neighbouring calendar day.
      const noon = new Date(year, month - 1, day + i + 1, 12);
      const dayStr = getDbDateStr(noon);
      const ids = computeOrderedTaskIdsForToday(
        { taskIds: plannerState.days[dayStr] ?? [] },
        snapshots,
        dayStr,
        startOfNextDayDiffMs,
      );
      const startOf = (id: string): number => snapshots[id]?.dueWithTime ?? 0;
      return {
        dayStr,
        taskIds: [
          ...ids.filter((id) => !startOf(id)),
          ...ids.filter((id) => startOf(id)).sort((a, b) => startOf(a) - startOf(b)),
        ],
        repeatCfgs: getTaskRepeatCfgsForExactDayCached(repeatCfgs, noon.getTime()).filter(
          (cfg) => !!cfg.title && !cfg.waitForCompletion,
        ),
      };
    });
  },
);
