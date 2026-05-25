import { TASK_REPEAT_WEEKDAY_MAP, TaskRepeatCfg } from '../task-repeat-cfg.model';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';
import {
  findMonthlyNthWeekdayOccurrence,
  hasNthWeekdayAnchor,
} from './get-nth-weekday-of-month.util';

/**
 * Returns the first valid repeat occurrence on or after `cfg.startDate`.
 * Used when initially creating a repeat config to decide when the first
 * task instance should be scheduled.
 *
 * For DAILY/MONTHLY/YEARLY this returns `startDate` itself — by definition
 * the first occurrence of the pattern. For WEEKLY this scans up to 7 days
 * from `startDate` until a day matches the enabled weekday mask.
 *
 * Returns `null` if the config is invalid or lacks a `startDate`; callers
 * are expected to fall back (typically to today or to `task.dueDay`).
 *
 * @param taskRepeatCfg The repeat configuration
 * @returns The first valid occurrence date at noon, or null if none found
 */
export const getFirstRepeatOccurrence = (taskRepeatCfg: TaskRepeatCfg): Date | null => {
  if (!Number.isInteger(taskRepeatCfg.repeatEvery) || taskRepeatCfg.repeatEvery < 1) {
    return null;
  }

  if (!taskRepeatCfg.startDate) {
    return null;
  }

  // Noon avoids DST transitions
  const checkDate = dateStrToUtcDate(taskRepeatCfg.startDate);
  checkDate.setHours(12, 0, 0, 0);

  switch (taskRepeatCfg.repeatCycle) {
    case 'MONTHLY': {
      if (hasNthWeekdayAnchor(taskRepeatCfg)) {
        // Try start month first; if the Nth weekday is before startDate,
        // advance one month.
        return findMonthlyNthWeekdayOccurrence(taskRepeatCfg, checkDate, {
          direction: 1,
          maxMonths: 2,
          accept: (candidate) => candidate >= checkDate,
        });
      }
      return checkDate;
    }

    case 'DAILY':
    case 'YEARLY':
      return checkDate;

    case 'WEEKLY': {
      for (let i = 0; i < 7; i++) {
        const dayKey = TASK_REPEAT_WEEKDAY_MAP[checkDate.getDay()];
        if (dayKey && taskRepeatCfg[dayKey] === true) {
          return checkDate;
        }
        checkDate.setDate(checkDate.getDate() + 1);
      }
      return null;
    }

    default:
      return null;
  }
};
