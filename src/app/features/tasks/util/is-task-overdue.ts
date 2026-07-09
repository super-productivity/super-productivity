import { Task } from '../task.model';
import { isDBDateStr } from '../../../util/get-db-date-str';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';

/**
 * Pure predicate for "is this task overdue" — its due date is before the logical
 * "today". Mirrors the definition used by `selectOverdueTasks` (which is now
 * implemented in terms of this util) so the two never drift.
 *
 * Kept clock-free/deterministic: the caller threads in `todayStr` (a DB date
 * string, e.g. from `DateService.getLogicalTodayDate()`/`todayStr()`) and the
 * start-of-next-day offset so custom start-of-day settings are respected.
 *
 * Priority follows the dueWithTime/dueDay mutual-exclusivity pattern.
 */
export const isTaskOverdue = (
  task: Pick<Task, 'dueDay' | 'dueWithTime'>,
  todayStr: string,
  startOfNextDayDiffMs: number,
): boolean => {
  const today = dateStrToUtcDate(todayStr);
  today.setHours(0, 0, 0, 0);
  // The logical start of "today" is shifted by the offset.
  const todayStartMs = today.getTime() + startOfNextDayDiffMs;
  return !!(
    // String comparison works because dueDay is YYYY-MM-DD (lexicographically
    // sortable), avoiding timezone conversion issues.
    (
      (task.dueDay && isDBDateStr(task.dueDay) && task.dueDay < todayStr) ||
      (task.dueWithTime && task.dueWithTime < todayStartMs)
    )
  );
};
