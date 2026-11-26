import { TASK_REPEAT_WEEKDAY_MAP, TaskRepeatCfg } from '../task-repeat-cfg.model';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';
import { Log } from '../../../core/log';
import { getEffectiveLastTaskCreationDay } from './get-effective-last-task-creation-day.util';
import { getEffectiveRepeatStartDate } from './get-effective-repeat-start-date.util';

// Date math shared by getNewestPossibleDueDate (scans back) and
// getNextRepeatOccurrence (scans forward).

export const hasValidRepeatEvery = (cfg: TaskRepeatCfg): boolean => {
  if (Number.isInteger(cfg.repeatEvery) && cfg.repeatEvery >= 1) {
    return true;
  }
  Log.warn(
    `Invalid repeatEvery value "${cfg.repeatEvery}" for TaskRepeatCfg "${cfg.id}"`,
  );
  return false;
};

/**
 * Noon copies of `from`, the effective start day and the effective last
 * creation day (1970-01-01 when there is none). Noon is never affected by DST.
 */
export const getRepeatScanDates = (
  cfg: TaskRepeatCfg,
  from: Date,
): { checkDate: Date; startDate: Date; lastTaskCreation: Date } => {
  const checkDate = new Date(from);
  const startDate = dateStrToUtcDate(getEffectiveRepeatStartDate(cfg));
  const lastTaskCreation = dateStrToUtcDate(
    getEffectiveLastTaskCreationDay(cfg) || '1970-01-01',
  );
  checkDate.setHours(12, 0, 0, 0);
  startDate.setHours(12, 0, 0, 0);
  lastTaskCreation.setHours(12, 0, 0, 0);
  return { checkDate, startDate, lastTaskCreation };
};

export const isOnRepeatCycle = (diff: number, repeatEvery: number): boolean =>
  diff >= 0 && diff % repeatEvery === 0;

export const isRepeatWeekday = (cfg: TaskRepeatCfg, date: Date): boolean => {
  const dayKey = TASK_REPEAT_WEEKDAY_MAP[date.getDay()];
  return !!dayKey && cfg[dayKey] === true;
};

// `monthlyLastDay` anchors to month-end: day 31 is clamped to the true last
// day of every month.
export const getMonthlyRepeatDay = (cfg: TaskRepeatCfg, startDate: Date): number =>
  cfg.monthlyLastDay ? 31 : startDate.getDate();

export const getClampedDayOfMonth = (date: Date, day: number): number =>
  Math.min(day, new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate());

/**
 * Moves `date` in place by `monthDelta` months, to `day` clamped to that
 * month's last day. Steps from day 1, since setMonth on a day the target
 * month lacks overflows into the month after it (#10091, #10902).
 */
export const moveToMonthDay = (date: Date, monthDelta: number, day: number): void => {
  date.setDate(1);
  date.setMonth(date.getMonth() + monthDelta);
  date.setDate(getClampedDayOfMonth(date, day));
};

/**
 * Moves `date` in place by `yearDelta` years, to `month`/`day` clamped to that
 * month's last day, so Feb 29 falls on Feb 28 in non-leap years.
 */
export const moveToYearDay = (
  date: Date,
  yearDelta: number,
  month: number,
  day: number,
): void => {
  date.setFullYear(date.getFullYear() + yearDelta);
  date.setDate(1);
  date.setMonth(month);
  date.setDate(getClampedDayOfMonth(date, day));
};
