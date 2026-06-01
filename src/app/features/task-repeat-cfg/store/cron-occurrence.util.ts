import { CronExpressionParser } from 'cron-parser';
import { TaskRepeatCfg } from '../task-repeat-cfg.model';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';
import { getEffectiveLastTaskCreationDay } from './get-effective-last-task-creation-day.util';
import { getEffectiveRepeatStartDate } from './get-effective-repeat-start-date.util';
import { isSameDay } from '../../../util/is-same-day';
import { Log } from '../../../core/log';

const safeParse = (
  expr: string,
  currentDate: Date,
): ReturnType<typeof CronExpressionParser.parse> | null => {
  try {
    return CronExpressionParser.parse(expr, { currentDate });
  } catch (e) {
    Log.warn(`Invalid cron expression "${expr}"`, e);
    return null;
  }
};

const isCronValid = (expr: string | undefined): expr is string => {
  if (!expr) return false;
  try {
    CronExpressionParser.parse(expr);
    return true;
  } catch {
    return false;
  }
};

/**
 * Walks backward from `today` looking for the most recent fire time that
 * matches the cron expression and is on or after `startDate` and strictly
 * after `lastTaskCreation`. Returns the matching Date or null.
 *
 * Mirrors the contract of the non-cron `getNewestPossibleDueDate` branches:
 * the returned day is the day a task should be created for if not yet
 * created.
 */
export const getNewestPossibleCronDueDate = (
  taskRepeatCfg: TaskRepeatCfg,
  today: Date,
): Date | null => {
  if (!isCronValid(taskRepeatCfg.cronExpression)) return null;

  const startDateStr = getEffectiveRepeatStartDate(taskRepeatCfg);
  const startDateDate = dateStrToUtcDate(startDateStr);
  const lastTaskCreationDateStr =
    getEffectiveLastTaskCreationDay(taskRepeatCfg) || '1970-01-01';
  const lastTaskCreation = dateStrToUtcDate(lastTaskCreationDateStr);

  startDateDate.setHours(12, 0, 0, 0);
  lastTaskCreation.setHours(12, 0, 0, 0);

  if (startDateDate > today) return null;

  // Search from end of today downward — cron-parser's `prev()` returns the
  // fire time strictly before `currentDate`, so seed at tomorrow 00:00 to
  // include today's fires.
  const cursor = new Date(today);
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() + 1);

  const iter = safeParse(taskRepeatCfg.cronExpression, cursor);
  if (!iter) return null;

  // Walk back at most a year of fires to bound runtime on pathological
  // expressions; well-formed weekly/monthly crons converge in <60 hops.
  for (let i = 0; i < 366; i++) {
    let prev: Date;
    try {
      prev = iter.prev().toDate();
    } catch {
      return null;
    }
    prev.setHours(12, 0, 0, 0);
    if (prev < startDateDate) return null;
    if (prev <= lastTaskCreation) return null;
    if (prev <= today || isSameDay(prev, today)) {
      return prev;
    }
  }
  return null;
};

/**
 * Walks forward from `fromDate` (exclusive of any already-created instance)
 * looking for the next fire time, on or after `startDate` and strictly after
 * `lastTaskCreation`. Returns the matching Date or null.
 */
export const getNextCronOccurrence = (
  taskRepeatCfg: TaskRepeatCfg,
  fromDate: Date,
): Date | null => {
  if (!isCronValid(taskRepeatCfg.cronExpression)) return null;

  const startDateStr = getEffectiveRepeatStartDate(taskRepeatCfg);
  const startDateDate = dateStrToUtcDate(startDateStr);
  const lastTaskCreationDateStr =
    getEffectiveLastTaskCreationDay(taskRepeatCfg) || '1970-01-01';
  const lastTaskCreation = dateStrToUtcDate(lastTaskCreationDateStr);

  startDateDate.setHours(12, 0, 0, 0);
  lastTaskCreation.setHours(12, 0, 0, 0);

  // Earliest DAY (local midnight) the next occurrence may fall on. The engine
  // is day-granular, so we reason in whole days and match the non-cron
  // convention (get-next-repeat-occurrence.util): the next occurrence is
  // strictly after fromDate's day and the last-created day, and on/after the
  // start day.
  const startOfDay = (d: Date): Date => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  };
  const nextDay = (d: Date): Date => {
    const x = startOfDay(d);
    x.setDate(x.getDate() + 1);
    return x;
  };
  let lowerBound = nextDay(fromDate);
  const afterLastCreation = nextDay(lastTaskCreation);
  if (afterLastCreation > lowerBound) lowerBound = afterLastCreation;
  const startDay = startOfDay(startDateDate);
  if (startDay > lowerBound) lowerBound = startDay;

  // Seed 1 ms before the lower-bound midnight: cron-parser's next() is
  // exclusive of an exact-boundary currentDate, so seeding *at* midnight would
  // skip a fire scheduled for 00:00 on the lower-bound day (off-by-one for
  // midnight crons). Stepping back 1 ms keeps that fire eligible.
  const cursor = new Date(lowerBound.getTime() - 1);

  const iter = safeParse(taskRepeatCfg.cronExpression, cursor);
  if (!iter) return null;

  try {
    const next = iter.next().toDate();
    next.setHours(12, 0, 0, 0);
    return next;
  } catch {
    return null;
  }
};

export const isCronExpressionValid = isCronValid;
