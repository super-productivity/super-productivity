import type { DateService } from '../../../core/date/date.service';
import type { Task } from '../task.model';
import { getDbDateStr } from '../../../util/get-db-date-str';

export type DeadlineAutoPlanFields = {
  autoPlanToday?: string;
  autoPlanStartOfNextDayDiffMs?: number;
};

export type DeadlineAutoPlanContext = {
  today: string;
  startOfNextDayDiffMs: number;
};

export type DeadlineAutoPlanDecision = {
  shouldAutoPlan: boolean;
  shouldUpdateDueDay: boolean;
  shouldClearDueWithTime: boolean;
  /**
   * Always mirrors `shouldClearDueWithTime`: a `remindAt` is anchored to
   * `dueWithTime`, so clearing the scheduled time must also clear its reminder
   * to avoid an orphaned notification firing for a time the task no longer has.
   */
  shouldClearRemindAt: boolean;
};

const NO_AUTO_PLAN: DeadlineAutoPlanDecision = {
  shouldAutoPlan: false,
  shouldUpdateDueDay: false,
  shouldClearDueWithTime: false,
  shouldClearRemindAt: false,
};

const isPositiveFiniteTimestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const getDateStrWithOffset = (
  timestamp: number,
  context: DeadlineAutoPlanContext,
): string => getDbDateStr(new Date(timestamp - context.startOfNextDayDiffMs));

const isDeadlineTodayForAutoPlan = (
  deadlineDay: string | null | undefined,
  deadlineWithTime: number | null | undefined,
  context: DeadlineAutoPlanContext,
): boolean =>
  isPositiveFiniteTimestamp(deadlineWithTime)
    ? getDateStrWithOffset(deadlineWithTime, context) === context.today
    : deadlineDay === context.today;

const getDueScheduleDay = (
  task: Pick<Task, 'dueDay' | 'dueWithTime'>,
  context: DeadlineAutoPlanContext,
): string | undefined => {
  if (isPositiveFiniteTimestamp(task.dueWithTime)) {
    return getDateStrWithOffset(task.dueWithTime, context);
  }

  return task.dueDay ?? undefined;
};

const isTaskDueTodayBySchedule = (
  task: Pick<Task, 'dueDay' | 'dueWithTime'>,
  context: DeadlineAutoPlanContext,
): boolean => getDueScheduleDay(task, context) === context.today;

/**
 * Decides whether a task with a deadline today should be auto-planned into
 * Today, and how. Single source of truth shared by the immediate (meta-reducer)
 * and defensive (date-rollover effect) paths so both behave identically.
 *
 * Policy (deliberate, see issue #7488 / PR #7650 review):
 * - Done task, or deadline not today → skip.
 * - Subtask whose parent is already in Today / due today → skip (parent carries it).
 * - Already due today by schedule → add to Today order only; never touch
 *   `dueDay` / `dueWithTime` / `remindAt`.
 * - No due date/time → set `dueDay = today`, add to Today.
 * - Overdue (scheduled before today) → move to `dueDay = today`; clear a stale
 *   `dueWithTime` and its now-orphaned `remindAt`.
 * - Scheduled for a FUTURE day/time → skip. Honoring the user's explicit
 *   forward plan is intentionally preferred over the today deadline.
 */
export const getDeadlineAutoPlanDecision = (
  task: Task,
  context: DeadlineAutoPlanContext,
  todayTaskIds: ReadonlySet<string>,
  parentTask?: Task,
): DeadlineAutoPlanDecision => {
  if (
    task.isDone ||
    !isDeadlineTodayForAutoPlan(task.deadlineDay, task.deadlineWithTime, context)
  ) {
    return NO_AUTO_PLAN;
  }

  if (
    task.parentId &&
    (todayTaskIds.has(task.parentId) ||
      (parentTask && isTaskDueTodayBySchedule(parentTask, context)))
  ) {
    return NO_AUTO_PLAN;
  }

  const isInTodayOrder = todayTaskIds.has(task.id);

  if (isTaskDueTodayBySchedule(task, context)) {
    return isInTodayOrder
      ? NO_AUTO_PLAN
      : {
          shouldAutoPlan: true,
          shouldUpdateDueDay: false,
          shouldClearDueWithTime: false,
          shouldClearRemindAt: false,
        };
  }

  const dueScheduleDay = getDueScheduleDay(task, context);

  if (!dueScheduleDay) {
    return {
      shouldAutoPlan: true,
      shouldUpdateDueDay: true,
      shouldClearDueWithTime: false,
      shouldClearRemindAt: false,
    };
  }

  if (dueScheduleDay < context.today) {
    const shouldClearDueWithTime = isPositiveFiniteTimestamp(task.dueWithTime);
    return {
      shouldAutoPlan: true,
      shouldUpdateDueDay: true,
      shouldClearDueWithTime,
      shouldClearRemindAt: shouldClearDueWithTime,
    };
  }

  return NO_AUTO_PLAN;
};

export const getDeadlineAutoPlanFields = (
  dateService: Pick<DateService, 'todayStr' | 'getStartOfNextDayDiffMs'>,
  deadlineDay?: string | null,
  deadlineWithTime?: number | null,
): DeadlineAutoPlanFields => {
  const context: DeadlineAutoPlanContext = {
    today: dateService.todayStr(),
    startOfNextDayDiffMs: dateService.getStartOfNextDayDiffMs(),
  };

  return isDeadlineTodayForAutoPlan(deadlineDay, deadlineWithTime, context)
    ? {
        autoPlanToday: context.today,
        autoPlanStartOfNextDayDiffMs: context.startOfNextDayDiffMs,
      }
    : {};
};
