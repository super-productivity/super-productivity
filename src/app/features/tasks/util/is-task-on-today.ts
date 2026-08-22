import { Task } from '../task.model';
import { getDbDateStr } from '../../../util/get-db-date-str';

/**
 * Pure predicate for "is this task already on Today" — the read side of
 * `planTasksForToday`.
 *
 * Extracted because the same question was being asked in two places that
 * disagreed: `TaskComponent.isScheduledToday()` (a computed, which also drives
 * the "Add to Today" button) and, by omission, `TaskService.scheduleForTodayById()`,
 * which asked it nowhere and re-planned regardless. See #9577.
 *
 * Kept clock-free/deterministic in the same shape as `isTaskOverdue`: the caller
 * threads in `todayStr` (a DB date string, e.g. from `DateService.todayStr()`)
 * and the start-of-next-day offset, so custom start-of-day settings are
 * respected and the predicate stays testable without mocking the clock.
 *
 * `dueWithTime` is checked first, following the dueWithTime/dueDay
 * mutual-exclusivity pattern; because this is a disjunction the order is not
 * load-bearing, but it matches the definition this replaces.
 */
export const isTaskOnToday = (
  task: Pick<Task, 'dueDay' | 'dueWithTime'>,
  todayStr: string,
  startOfNextDayDiffMs: number,
): boolean =>
  !!(
    (task.dueWithTime &&
      getDbDateStr(new Date(task.dueWithTime - startOfNextDayDiffMs)) === todayStr) ||
    (task.dueDay && task.dueDay === todayStr)
  );
