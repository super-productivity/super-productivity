import type { DateService } from '../../../core/date/date.service';
import type { Task } from '../task.model';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { isTodayWithOffset } from '../../../util/is-today.util';

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
};

const NO_AUTO_PLAN: DeadlineAutoPlanDecision = {
  shouldAutoPlan: false,
  shouldUpdateDueDay: false,
  shouldClearDueWithTime: false,
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
): boolean => {
  if (isPositiveFiniteTimestamp(deadlineWithTime)) {
    return isTodayWithOffset(
      deadlineWithTime,
      context.today,
      context.startOfNextDayDiffMs,
    );
  }

  return deadlineDay === context.today;
};

const getDueScheduleDay = (
  task: Pick<Task, 'dueDay' | 'dueWithTime'>,
  context: DeadlineAutoPlanContext,
): string | undefined => {
  if (isPositiveFiniteTimestamp(task.dueWithTime)) {
    return getDateStrWithOffset(task.dueWithTime, context);
  }

  return task.dueDay ?? undefined;
};

export const isTaskDueTodayBySchedule = (
  task: Pick<Task, 'dueDay' | 'dueWithTime'>,
  context: DeadlineAutoPlanContext,
): boolean => getDueScheduleDay(task, context) === context.today;

export const getDeadlineAutoPlanDecision = (
  task: Task,
  context: DeadlineAutoPlanContext,
  todayTaskIds: readonly string[],
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
    (todayTaskIds.includes(task.parentId) ||
      (parentTask && isTaskDueTodayBySchedule(parentTask, context)))
  ) {
    return NO_AUTO_PLAN;
  }

  const isInTodayOrder = todayTaskIds.includes(task.id);

  if (isTaskDueTodayBySchedule(task, context)) {
    return isInTodayOrder
      ? NO_AUTO_PLAN
      : {
          shouldAutoPlan: true,
          shouldUpdateDueDay: false,
          shouldClearDueWithTime: false,
        };
  }

  const dueScheduleDay = getDueScheduleDay(task, context);

  if (!dueScheduleDay) {
    return {
      shouldAutoPlan: true,
      shouldUpdateDueDay: true,
      shouldClearDueWithTime: false,
    };
  }

  if (dueScheduleDay < context.today) {
    return {
      shouldAutoPlan: true,
      shouldUpdateDueDay: true,
      shouldClearDueWithTime: isPositiveFiniteTimestamp(task.dueWithTime),
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
