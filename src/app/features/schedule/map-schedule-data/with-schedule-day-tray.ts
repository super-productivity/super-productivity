import { TaskCopy } from '../../tasks/task.model';
import { TaskRepeatCfg } from '../../task-repeat-cfg/task-repeat-cfg.model';
import { ScheduleDay, ScheduleDayTray } from '../schedule.model';
import { getTimeLeftForTask } from '../../../util/get-time-left-for-task';
import { getTaskRepeatCfgsForExactDayCached } from '../../task-repeat-cfg/store/get-task-repeat-cfgs-for-exact-day-cached.util';
import { getTasksWithinAndBeyondBudget } from './get-tasks-within-and-beyond-budget';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';

export interface ScheduleTrayCfg {
  // false while work hours are off: the day has no capacity to run over
  isCapacityLimited: boolean;
}

export interface ScheduleDayTrayParams extends ScheduleTrayCfg {
  // every task without a time, in Today list order
  tasks: TaskCopy[];
  // the planner's tasks for this day, in planner order
  plannerTasks: TaskCopy[];
  // every untimed repeat cfg; the ones due on this day are picked here
  repeatCfgs: TaskRepeatCfg[];
  // work time left on this day after timed tasks, events and breaks
  budgetMs: number;
}

/**
 * Adds the tray to a day built without flow tasks: the tasks planned for that
 * day without a time, and how they compare to the time that is left.
 */
export const withScheduleDayTray = (
  day: ScheduleDay,
  params: ScheduleDayTrayParams,
): ScheduleDay => {
  const tasks = uniqueById([
    ...params.tasks.filter((task) => task.dueDay === day.dayDate),
    ...params.plannerTasks,
  ]);
  const repeatCfgs = getRepeatCfgsWithoutInstance(day.dayDate, params.repeatCfgs, tasks);
  // No minimum length for tasks without an estimate: they count as 0, so the
  // line never claims time the user did not plan.
  const plannedMs =
    tasks.reduce((acc, task) => acc + getTimeLeftForTask(task), 0) +
    repeatCfgs.reduce((acc, cfg) => acc + (cfg.defaultEstimate || 0), 0);

  if (!params.isCapacityLimited) {
    return { ...day, tray: { tasks, repeatCfgs, plannedMs } };
  }
  return {
    ...day,
    // feeds the existing "does not fit" badge in the day header
    beyondBudgetTasks: getTasksWithinAndBeyondBudget(tasks, params.budgetMs).beyond,
    tray: { tasks, repeatCfgs, plannedMs, freeMs: params.budgetMs - plannedMs },
  };
};

/** The trays by day, or null while tasks are placed automatically (no day has one). */
export const mapScheduleDaysToTrays = (
  days: ScheduleDay[],
): Record<string, ScheduleDayTray> | null => {
  const entries = days.flatMap((day): [string, ScheduleDayTray][] =>
    day.tray ? [[day.dayDate, day.tray]] : [],
  );
  return entries.length ? Object.fromEntries(entries) : null;
};

// A projection stands in for "an instance will exist", so it is dropped once
// the day holds one (same rule as the grid, #7853).
const getRepeatCfgsWithoutInstance = (
  dayDate: string,
  repeatCfgs: TaskRepeatCfg[],
  tasks: TaskCopy[],
): TaskRepeatCfg[] => {
  const dayStart = dateStrToUtcDate(dayDate);
  dayStart.setHours(0, 0, 0, 0);
  const instanceCfgIds = new Set(tasks.map((task) => task.repeatCfgId));
  return getTaskRepeatCfgsForExactDayCached(repeatCfgs, dayStart.getTime()).filter(
    (cfg) => !instanceCfgIds.has(cfg.id),
  );
};

const uniqueById = (tasks: TaskCopy[]): TaskCopy[] => {
  const ids = new Set<string>();
  return tasks.filter((task) => !ids.has(task.id) && !!ids.add(task.id));
};
