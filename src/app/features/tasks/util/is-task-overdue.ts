import { Task } from '../task.model';
import { isDBDateStr } from '../../../util/get-db-date-str';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';

/**
 * Compute the logical start-of-today (ms) — local midnight of `todayStr` shifted
 * by the start-of-next-day offset. Extracted so the overdue predicate and its
 * callers agree on one boundary definition.
 */
export const getLogicalTodayStartMs = (
  todayStr: string,
  startOfNextDayDiffMs: number,
): number => {
  const today = dateStrToUtcDate(todayStr);
  today.setHours(0, 0, 0, 0);
  // The logical start of "today" is shifted by the offset.
  return today.getTime() + startOfNextDayDiffMs;
};

/**
 * Overdue comparison against a *precomputed* logical start-of-today threshold.
 * This is the single source of truth for "what counts as overdue"; both
 * `isTaskOverdue` and `selectOverdueTaskIds` route through it so the two overdue
 * definitions can never drift. (`isTaskOverdue` currently has no production
 * caller — it is the tested, readable form of this pair and the entry point any
 * new caller should use.) Callers that iterate many tasks (the selector) compute
 * the threshold once and pass it in, instead of per task.
 *
 * Priority follows the dueWithTime/dueDay mutual-exclusivity pattern.
 */
export const isTaskOverdueByThreshold = (
  task: Pick<Task, 'dueDay' | 'dueWithTime'>,
  todayStr: string,
  todayStartMs: number,
): boolean =>
  !!(
    // String comparison works because dueDay is YYYY-MM-DD (lexicographically
    // sortable), avoiding timezone conversion issues.
    (
      (task.dueDay && isDBDateStr(task.dueDay) && task.dueDay < todayStr) ||
      (task.dueWithTime && task.dueWithTime < todayStartMs)
    )
  );

/**
 * Pure predicate for "is this task overdue" — its due date is before the logical
 * "today".
 *
 * Kept clock-free/deterministic: the caller threads in `todayStr` (a DB date
 * string, e.g. from `DateService.getLogicalTodayDate()`/`todayStr()`) and the
 * start-of-next-day offset so custom start-of-day settings are respected.
 */
export const isTaskOverdue = (
  task: Pick<Task, 'dueDay' | 'dueWithTime'>,
  todayStr: string,
  startOfNextDayDiffMs: number,
): boolean =>
  isTaskOverdueByThreshold(
    task,
    todayStr,
    getLogicalTodayStartMs(todayStr, startOfNextDayDiffMs),
  );

/**
 * A task with no plan date whose deadline has passed (#9589). Kept separate from
 * the plan-date overdue rule: only Today's overdue panel uses it, so the Planner
 * (which lists missed deadlines on their own) does not show such tasks twice.
 * A plan date always wins — the user already decided when to do the task.
 */
export const isTaskDeadlineMissedUnplanned = (
  task: Pick<Task, 'dueDay' | 'dueWithTime' | 'deadlineDay' | 'deadlineWithTime'>,
  todayStr: string,
  todayStartMs: number,
): boolean =>
  !task.dueDay &&
  !task.dueWithTime &&
  !!(
    (task.deadlineDay && isDBDateStr(task.deadlineDay) && task.deadlineDay < todayStr) ||
    (task.deadlineWithTime && task.deadlineWithTime < todayStartMs)
  );
