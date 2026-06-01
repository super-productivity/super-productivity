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

  // Anchor search at the later of: day-after-lastTaskCreation, startDate,
  // fromDate+1 (matches the existing "start checking day after" convention).
  const cursor = new Date(fromDate);
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() + 1);
  const afterLastCreation = new Date(lastTaskCreation);
  afterLastCreation.setDate(afterLastCreation.getDate() + 1);
  if (afterLastCreation > cursor) cursor.setTime(afterLastCreation.getTime());
  if (startDateDate > cursor) cursor.setTime(startDateDate.getTime());

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
