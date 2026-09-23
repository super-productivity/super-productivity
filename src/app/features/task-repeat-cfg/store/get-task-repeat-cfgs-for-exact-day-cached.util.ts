import { TaskRepeatCfg } from '../task-repeat-cfg.model';
import { selectTaskRepeatCfgsForExactDay } from './task-repeat-cfg.selectors';

// Planner and schedule rebuild all visible days on every time-tracking tick
// (the tracked task's timeSpent feeds day totals and block ends), yet which
// repeat cfgs fall on a day only depends on the cfg array and the day. Callers
// pass memoized selector outputs, which are never mutated, so caching by array
// identity is safe, and the WeakMap drops the entries once a cfg edit replaces
// the array. A freshly built array per call would only miss, never go stale.
const cache = new WeakMap<TaskRepeatCfg[], Map<string, TaskRepeatCfg[]>>();

/**
 * Memoized `selectTaskRepeatCfgsForExactDay.projector`. The returned array is
 * shared between calls — callers must not mutate it.
 */
export const getTaskRepeatCfgsForExactDayCached = (
  taskRepeatCfgs: TaskRepeatCfg[],
  dayDate: number,
): TaskRepeatCfg[] => {
  let byDay = cache.get(taskRepeatCfgs);
  if (!byDay) {
    byDay = new Map();
    cache.set(taskRepeatCfgs, byDay);
  }
  // The projector reads local date parts, so a timezone change must miss.
  const key = `${dayDate}_${new Date(dayDate).getTimezoneOffset()}`;
  let result = byDay.get(key);
  if (!result) {
    result = selectTaskRepeatCfgsForExactDay.projector(taskRepeatCfgs, { dayDate });
    byDay.set(key, result);
  }
  return result;
};
