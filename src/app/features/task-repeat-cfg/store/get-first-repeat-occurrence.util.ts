import { TaskRepeatCfg } from '../task-repeat-cfg.model';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';
import {
  findMonthlyNthWeekdayOccurrence,
  hasNthWeekdayAnchor,
} from './get-nth-weekday-of-month.util';
import { isAfterRepeatUntilDay } from './repeat-until-day.util';
import {
  getClampedDayOfMonth,
  getMonthlyRepeatDay,
  isRepeatWeekday,
} from './recurrence-date.util';

/**
 * Returns the first valid repeat occurrence on or after `cfg.startDate`.
 * Used when initially creating a repeat config to decide when the first
 * task instance should be scheduled.
 *
 * For DAILY/MONTHLY/YEARLY this returns `startDate` itself — by definition
 * the first occurrence of the pattern. For WEEKLY this scans up to 7 days
 * from `startDate` until a day matches the enabled weekday mask.
 *
 * Returns `null` if the config is invalid or lacks a `startDate`, or if the
 * first allowed occurrence already falls past `repeatUntilDay` (an empty
 * finite window). Callers are expected to fall back (typically to today or
 * to `task.dueDay`) — except for the empty window, which
 * {@link hasNoRepeatOccurrenceBeforeEnd} lets them detect separately.
 *
 * @param taskRepeatCfg The repeat configuration
 * @returns The first valid occurrence date at noon, or null if none found
 */
export const getFirstRepeatOccurrence = (taskRepeatCfg: TaskRepeatCfg): Date | null => {
  const first = getFirstRepeatOccurrenceIgnoringEnd(taskRepeatCfg);
  return first && isAfterRepeatUntilDay(taskRepeatCfg, first) ? null : first;
};

/**
 * True when the cfg's finite window ([startDate, repeatUntilDay]) contains no
 * allowed occurrence at all — e.g. a custom weekly cfg whose first enabled
 * weekday already falls past the end day. Distinct from an invalid config
 * (no/invalid startDate, unchecked weekdays), where falling back to today is
 * still the intended behavior. Creation effects use this to preserve the
 * task's existing day instead of anchoring it to today (#10091).
 */
export const hasNoRepeatOccurrenceBeforeEnd = (taskRepeatCfg: TaskRepeatCfg): boolean => {
  const first = getFirstRepeatOccurrenceIgnoringEnd(taskRepeatCfg);
  return !!first && isAfterRepeatUntilDay(taskRepeatCfg, first);
};

const getFirstRepeatOccurrenceIgnoringEnd = (
  taskRepeatCfg: TaskRepeatCfg,
): Date | null => {
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
      checkDate.setDate(
        getClampedDayOfMonth(checkDate, getMonthlyRepeatDay(taskRepeatCfg, checkDate)),
      );
      return checkDate;
    }

    case 'DAILY':
    case 'YEARLY':
      return checkDate;

    case 'WEEKLY': {
      for (let i = 0; i < 7; i++) {
        if (isRepeatWeekday(taskRepeatCfg, checkDate)) {
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
