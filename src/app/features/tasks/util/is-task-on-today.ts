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
 *
 * That disjunction makes this a DELIBERATE STRICT SUPERSET of canonical TODAY
 * membership, and the difference is worth knowing before reusing it. The
 * canonical readers — `computeOrderedTaskIdsForToday`
 * (work-context.selectors.ts), `planner.selectors.ts` and `isInToday`
 * (task.selectors.ts) — apply Decision #1 of ARCHITECTURE-DECISIONS.md: check
 * `dueWithTime` first, and consult `dueDay` ONLY if `dueWithTime` is unset. So a
 * legacy task carrying both, with `dueDay` today and `dueWithTime` tomorrow, is
 * NOT on Today for them and IS on Today for this predicate. That is intended:
 * both call sites use it only to suppress a `planTasksForToday` dispatch, so the
 * superset can only ever suppress more, never plan something it should not — and
 * in that one divergent shape the dispatch was a no-op anyway. Do not reuse this
 * anywhere the answer decides what to SHOW; use the selectors for that.
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
