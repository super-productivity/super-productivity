import { CronExpressionParser } from 'cron-parser';
import { TaskRepeatCfg } from '../task-repeat-cfg.model';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';
import { getEffectiveLastTaskCreationDay } from './get-effective-last-task-creation-day.util';
import { getEffectiveRepeatStartDate } from './get-effective-repeat-start-date.util';
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

const startOfLocalDay = (d: Date): Date => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

/**
 * Does the cron fire at some point during the local calendar day of `day`?
 *
 * Uses cron-parser's `next()` (monotonic across DST transitions) rather than
 * `prev()`, which skips the spring-forward midnight in DST zones and would
 * make a daily cron appear not to fire on that day.
 */
const cronFiresOnDay = (expr: string, day: Date): boolean => {
  const dayStart = startOfLocalDay(day);
  const dayEnd = startOfLocalDay(day);
  dayEnd.setDate(dayEnd.getDate() + 1);
  // Seed 1 ms before midnight so a fire exactly at 00:00 is included.
  const iter = safeParse(expr, new Date(dayStart.getTime() - 1));
  if (!iter) return false;
  try {
    const next = iter.next().toDate().getTime();
    return next >= dayStart.getTime() && next < dayEnd.getTime();
  } catch {
    return false;
  }
};

/**
 * Walks backward day-by-day from `today` for the most recent day the cron
 * fires, on or after `startDate` and strictly after `lastTaskCreation`.
 * Returns that day at noon, or null.
 *
 * Mirrors the contract of the non-cron `getNewestPossibleDueDate` branches:
 * the returned day is the day a task should be created for if not yet created.
 * The day-by-day `next()` probe is DST-safe (see cronFiresOnDay).
 */
export const getNewestPossibleCronDueDate = (
  taskRepeatCfg: TaskRepeatCfg,
  today: Date,
): Date | null => {
  if (!isCronValid(taskRepeatCfg.cronExpression)) return null;

  const startDateDate = dateStrToUtcDate(getEffectiveRepeatStartDate(taskRepeatCfg));
  const lastTaskCreation = dateStrToUtcDate(
    getEffectiveLastTaskCreationDay(taskRepeatCfg) || '1970-01-01',
  );
  startDateDate.setHours(12, 0, 0, 0);
  lastTaskCreation.setHours(12, 0, 0, 0);

  if (startDateDate > today) return null;

  const expr = taskRepeatCfg.cronExpression as string;
  const startDay = startOfLocalDay(startDateDate).getTime();

  // Walk back at most a year. The first firing day on/before today is the
  // newest candidate; bail once we cross before startDate.
  const cursor = new Date(today);
  for (let i = 0; i < 366; i++) {
    if (startOfLocalDay(cursor).getTime() < startDay) return null;
    if (cronFiresOnDay(expr, cursor)) {
      const due = new Date(cursor);
      due.setHours(12, 0, 0, 0);
      // Strictly after the last created day — otherwise it was already created.
      return due <= lastTaskCreation ? null : due;
    }
    cursor.setDate(cursor.getDate() - 1);
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

/**
 * First fire time on or after `startDate` (ignoring lastTaskCreation) — used to
 * decide when a CRON task's first instance should be scheduled. Returns the
 * matching Date at noon, or null.
 */
export const getFirstCronOccurrence = (taskRepeatCfg: TaskRepeatCfg): Date | null => {
  if (!isCronValid(taskRepeatCfg.cronExpression)) return null;

  const startDateDate = dateStrToUtcDate(getEffectiveRepeatStartDate(taskRepeatCfg));
  startDateDate.setHours(0, 0, 0, 0);

  // Seed 1 ms before startDate's midnight so a fire scheduled exactly at
  // startDate 00:00 stays eligible (cron-parser next() excludes the boundary).
  const cursor = new Date(startDateDate.getTime() - 1);
  const iter = safeParse(taskRepeatCfg.cronExpression as string, cursor);
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
