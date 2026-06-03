import { TaskRepeatCfg } from '../task-repeat-cfg.model';
import { getNextRepeatOccurrence } from './get-next-repeat-occurrence.util';
import { getEffectiveLastTaskCreationDay } from './get-effective-last-task-creation-day.util';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';

/**
 * Hard cap on the number of missed occurrences created in one catch-up pass for
 * a `createForEachMissed` config. Keeps a long absence (e.g. a daily task
 * untouched for months) from flooding the Today list and emitting hundreds of
 * sync ops in a single batch. Older-than-cap occurrences are dropped; the
 * config's last-creation pointer still advances past them so they are not
 * re-evaluated.
 */
export const MAX_CREATE_FOR_EACH_MISSED = 30;

/**
 * All occurrences strictly after the config's last-creation day and on/before
 * `today`, ordered oldest -> newest. Backs the "create a task for each missed
 * occurrence" option, which creates a task for every missed occurrence instead
 * of only the newest one (`getNewestPossibleDueDate`).
 *
 * Reuses `getNextRepeatOccurrence` for the forward walk so the per-cycle
 * occurrence logic stays single-sourced and DST-safe. The walk is bounded
 * twice: it stops once an occurrence passes `today`, and the returned list is
 * trimmed to the {@link MAX_CREATE_FOR_EACH_MISSED} most recent occurrences.
 */
export const getAllMissedDueDates = (
  taskRepeatCfg: TaskRepeatCfg,
  today: Date,
): Date[] => {
  const dates: Date[] = [];

  // Seed the forward walk at the last-created day. getNextRepeatOccurrence
  // already clamps to occurrences strictly after the last-created day, so the
  // first result is the oldest un-created occurrence.
  const lastCreationStr = getEffectiveLastTaskCreationDay(taskRepeatCfg) || '1970-01-01';
  let cursor = dateStrToUtcDate(lastCreationStr);
  cursor.setHours(12, 0, 0, 0);

  const ceiling = new Date(today);
  ceiling.setHours(12, 0, 0, 0);

  // Iteration backstop independent of the result cap, in case a degenerate
  // config never advances past the ceiling.
  const MAX_ITERATIONS = 1000;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const next = getNextRepeatOccurrence(taskRepeatCfg, cursor);
    if (!next) {
      break;
    }
    next.setHours(12, 0, 0, 0);
    if (next.getTime() > ceiling.getTime()) {
      break;
    }
    dates.push(next);
    cursor = next;
  }

  return dates.length > MAX_CREATE_FOR_EACH_MISSED
    ? dates.slice(dates.length - MAX_CREATE_FOR_EACH_MISSED)
    : dates;
};
