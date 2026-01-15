import { createFeatureSelector, createSelector } from '@ngrx/store';
import { TaskRepeatCfg, TaskRepeatCfgState } from '../task-repeat-cfg.model';
import { createEntityAdapter, EntityAdapter } from '@ngrx/entity';
import { isSameDay } from '../../../util/is-same-day';
import { getNewestPossibleDueDate } from './get-newest-possible-due-date.util';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { getEffectiveLastTaskCreationDay } from './get-effective-last-task-creation-day.util';

export const adapter: EntityAdapter<TaskRepeatCfg> = createEntityAdapter<TaskRepeatCfg>();
export const TASK_REPEAT_CFG_FEATURE_NAME = 'taskRepeatCfg';
const { selectAll } = adapter.getSelectors();
export const selectTaskRepeatCfgFeatureState = createFeatureSelector<TaskRepeatCfgState>(
  TASK_REPEAT_CFG_FEATURE_NAME,
);
export const selectAllTaskRepeatCfgs = createSelector(
  selectTaskRepeatCfgFeatureState,
  selectAll,
);
export const selectTaskRepeatCfgById = createSelector(
  selectTaskRepeatCfgFeatureState,
  (state: TaskRepeatCfgState, props: { id: string }): TaskRepeatCfg => {
    const cfg = state.entities[props.id];
    if (!cfg) {
      throw new Error('Missing taskRepeatCfg');
    }
    return cfg;
  },
);
export const selectTaskRepeatCfgsWithStartTime = createSelector(
  selectAllTaskRepeatCfgs,
  (taskRepeatCfgs: TaskRepeatCfg[]): TaskRepeatCfg[] => {
    return taskRepeatCfgs.filter((cfg) => !!cfg.startTime);
  },
);
export const selectTaskRepeatCfgsWithAndWithoutStartTime = createSelector(
  selectAllTaskRepeatCfgs,
  (
    taskRepeatCfgs: TaskRepeatCfg[],
  ): {
    withStartTime: TaskRepeatCfg[];
    withoutStartTime: TaskRepeatCfg[];
  } => {
    const withStartTime: TaskRepeatCfg[] = [];
    const withoutStartTime: TaskRepeatCfg[] = [];
    taskRepeatCfgs.forEach((cfg) => {
      if (cfg.startTime) {
        withStartTime.push(cfg);
      } else {
        withoutStartTime.push(cfg);
      }
    });
    return { withStartTime, withoutStartTime };
  },
);
export const selectTaskRepeatCfgsSortedByTitleAndProject = createSelector(
  selectAllTaskRepeatCfgs,
  (taskRepeatCfgs: TaskRepeatCfg[]): TaskRepeatCfg[] => {
    return [...taskRepeatCfgs].sort((a, b) => {
      if (a.projectId !== b.projectId) {
        if (a.projectId === null) {
          return -1;
        }
        if (b.projectId === null) {
          return 1;
        }
        if (a.projectId < b.projectId) {
          return -1;
        }
        if (a.projectId > b.projectId) {
          return 1;
        }
      }
      return (a.title || '').localeCompare(b.title || '');
    });
  },
);
// Returns task repeat configs where the calculated due date matches the specified day
// Note: This includes overdue tasks if their calculated due date happens to be the specified day
export const selectTaskRepeatCfgsForExactDay = createSelector(
  selectAllTaskRepeatCfgs,
  (
    taskRepeatCfgs: TaskRepeatCfg[],
    { dayDate }: { dayDate: number },
  ): TaskRepeatCfg[] => {
    const dateToCheckTimestamp = dayDate;
    const dateToCheckDate = new Date(dateToCheckTimestamp);
    const dateStr = getDbDateStr(dateToCheckTimestamp);

    return (
      taskRepeatCfgs &&
      taskRepeatCfgs.filter((taskRepeatCfg: TaskRepeatCfg) => {
        // Skip paused repeat configs - they should not generate task instances
        if (taskRepeatCfg.isPaused) {
          return false;
        }

        const effectiveLastDay = getEffectiveLastTaskCreationDay(taskRepeatCfg);
        if (
          effectiveLastDay === dateStr ||
          // also check for if future instance was already created via the work-view button
          (effectiveLastDay && effectiveLastDay > dateStr)
        ) {
          return false;
        }

        // Check if this date is in the deleted instances list
        if (taskRepeatCfg.deletedInstanceDates?.includes(dateStr)) {
          return false;
        }

        const rd = getNewestPossibleDueDate(taskRepeatCfg, dateToCheckDate);
        return !!rd && isSameDay(rd, dateToCheckDate);
      })
    );
  },
);
// Returns all task repeat configs that need task creation up to the specified day
// This includes all overdue tasks regardless of their specific due date
export const selectAllUnprocessedTaskRepeatCfgs = createSelector(
  selectAllTaskRepeatCfgs,
  (
    taskRepeatCfgs: TaskRepeatCfg[],
    { dayDate }: { dayDate: number },
  ): TaskRepeatCfg[] => {
    const dateToCheckTimestamp = dayDate;
    const dateToCheckDate = new Date(dateToCheckTimestamp);
    const dateStr = getDbDateStr(dateToCheckTimestamp);

    return (
      taskRepeatCfgs &&
      taskRepeatCfgs.filter((taskRepeatCfg: TaskRepeatCfg) => {
        // Skip paused repeat configs - they should not generate task instances
        if (taskRepeatCfg.isPaused) {
          return false;
        }

        const effectiveLastDay = getEffectiveLastTaskCreationDay(taskRepeatCfg);
        if (
          effectiveLastDay === dateStr ||
          // also check for if future instance was already created via the work-view button
          (effectiveLastDay && effectiveLastDay > dateStr)
        ) {
          return false;
        }

        // Check if this date is in the deleted instances list
        if (taskRepeatCfg.deletedInstanceDates?.includes(dateStr)) {
          return false;
        }

        const rd = getNewestPossibleDueDate(taskRepeatCfg, dateToCheckDate);
        return !!rd;
      })
    );
  },
);
export const selectTaskRepeatCfgByIdAllowUndefined = createSelector(
  selectTaskRepeatCfgFeatureState,
  (state: TaskRepeatCfgState, props: { id: string }): TaskRepeatCfg | undefined =>
    state.entities[props.id],
);

// FOR DEBUG
// export const selectTaskRepeatCfgsForExactDay = createSelector(
//   selectAllTaskRepeatCfgs,
//   (
//     taskRepeatCfgs: TaskRepeatCfg[],
//     { dayDate }: { dayDate: number },
//   ): TaskRepeatCfg[] => {
//     return taskRepeatCfgs;
//   },
// );
// export const selectAllUnprocessedTaskRepeatCfgs = createSelector(
//   selectAllTaskRepeatCfgs,
//   (
//     taskRepeatCfgs: TaskRepeatCfg[],
//     { dayDate }: { dayDate: number },
//   ): TaskRepeatCfg[] => {
//     return taskRepeatCfgs;
//   },
// );
