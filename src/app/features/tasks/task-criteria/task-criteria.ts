import { TaskCopy, TaskPriority } from '../task.model';
import { getDbDateStr, isDBDateStr } from '../../../util/get-db-date-str';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';
import { getWeekStartDate } from '../../../util/get-week-start-date';
import { getTaskPriority } from '../task-priority.const';
import {
  getLogicalTodayStartMs,
  isTaskOverdueByThreshold,
} from '../util/is-task-overdue';
import { TODAY_TAG } from '../../tag/tag.const';
import {
  TaskCriteria,
  TaskCriteriaCtx,
  TaskDateRule,
  TaskMatchChanges,
} from './task-criteria.model';

/** Adds days on the local calendar, so DST changes don't shift the result. */
export const addDaysToDbDateStr = (dayStr: string, days: number): string => {
  const date = dateStrToUtcDate(dayStr);
  date.setDate(date.getDate() + days);
  return getDbDateStr(date);
};

export const createTaskCriteriaCtx = (opts: {
  todayStr: string;
  startOfNextDayDiffMs: number;
  /** `Date.getDay()` numbering, 0 = Sunday. */
  firstDayOfWeek: number;
  isDayBeforeTime?: boolean;
  isInBacklog?: (task: Readonly<TaskCopy>) => boolean;
  isBacklogEnabled?: (projectId: string) => boolean;
}): TaskCriteriaCtx => {
  const { todayStr } = opts;
  const today = dateStrToUtcDate(todayStr);
  // Week bounds from the logical day's date, not `getWeekRange`, which shifts
  // by the timezone offset.
  const weekStartStr = getDbDateStr(getWeekStartDate(today, opts.firstDayOfWeek));
  const y = today.getFullYear();
  const m = today.getMonth();
  return {
    todayStr,
    startOfNextDayDiffMs: opts.startOfNextDayDiffMs,
    todayStartMs: getLogicalTodayStartMs(todayStr, opts.startOfNextDayDiffMs),
    tomorrowStr: addDaysToDbDateStr(todayStr, 1),
    next7DaysEndStr: addDaysToDbDateStr(todayStr, 6),
    weekStartStr,
    weekEndStr: addDaysToDbDateStr(weekStartStr, 6),
    nextWeekStartStr: addDaysToDbDateStr(weekStartStr, 7),
    nextWeekEndStr: addDaysToDbDateStr(weekStartStr, 13),
    monthEndStr: getDbDateStr(new Date(y, m + 1, 0)),
    nextMonthStartStr: getDbDateStr(new Date(y, m + 1, 1)),
    nextMonthEndStr: getDbDateStr(new Date(y, m + 2, 0)),
    isDayBeforeTime: !!opts.isDayBeforeTime,
    isInBacklog: opts.isInBacklog ?? (() => false),
    isBacklogEnabled: opts.isBacklogEnabled ?? (() => false),
  };
};

/** The logical day of a day/timestamp pair, or null if neither is set. */
const getLogicalDay = (
  day: string | null | undefined,
  withTime: number | null | undefined,
  ctx: TaskCriteriaCtx,
): string | null => {
  const fromTime = withTime ? getDbDateStr(withTime - ctx.startOfNextDayDiffMs) : null;
  const fromDay = day && isDBDateStr(day) ? day : null;
  return ctx.isDayBeforeTime ? (fromDay ?? fromTime) : (fromTime ?? fromDay);
};

const matchesDateRule = (
  day: string | null | undefined,
  withTime: number | null | undefined,
  rule: TaskDateRule,
  ctx: TaskCriteriaCtx,
): boolean => {
  if (rule === 'none') {
    return !day && !withTime;
  }
  // Same threshold as the overdue section and the red date colour.
  const isBeforeToday = isTaskOverdueByThreshold(
    { dueDay: day ?? undefined, dueWithTime: withTime ?? undefined },
    ctx.todayStr,
    ctx.todayStartMs,
  );
  if (rule === 'overdue') {
    return isBeforeToday;
  }
  const logicalDay = getLogicalDay(day, withTime, ctx);
  if (rule === 'todayOrOverdue') {
    return isBeforeToday || logicalDay === ctx.todayStr;
  }
  if (!logicalDay) {
    return false;
  }
  const isIn = (from: string, to: string): boolean =>
    logicalDay >= from && logicalDay <= to;
  switch (rule) {
    case 'today':
      return logicalDay === ctx.todayStr;
    case 'tomorrow':
      return logicalDay === ctx.tomorrowStr;
    case 'next7Days':
      return isIn(ctx.todayStr, ctx.next7DaysEndStr);
    case 'thisWeek':
      return isIn(ctx.weekStartStr, ctx.weekEndStr);
    case 'nextWeek':
      return isIn(ctx.nextWeekStartStr, ctx.nextWeekEndStr);
    case 'thisMonth':
      return isIn(`${ctx.todayStr.slice(0, 8)}01`, ctx.monthEndStr);
    case 'nextMonth':
      return isIn(ctx.nextMonthStartStr, ctx.nextMonthEndStr);
  }
};

const getTimeSpent = (task: Readonly<TaskCopy>): number =>
  task.timeSpentOnDay
    ? Object.values(task.timeSpentOnDay).reduce((sum, ms) => sum + ms, 0)
    : 0;

const matchesTags = (tagIds: readonly string[], criteria: TaskCriteria): boolean => {
  if (criteria.isUntagged && tagIds.length) {
    return false;
  }
  const included = criteria.includedTagIds;
  if (included?.length) {
    const isMatch =
      criteria.includedTagsMatch === 'any'
        ? included.some((id) => tagIds.includes(id))
        : included.every((id) => tagIds.includes(id));
    if (!isMatch) return false;
  }
  const excluded = criteria.excludedTagIds;
  if (excluded?.length) {
    const isHit =
      criteria.excludedTagsMatch === 'all'
        ? excluded.every((id) => tagIds.includes(id))
        : excluded.some((id) => tagIds.includes(id));
    if (isHit) return false;
  }
  return true;
};

export const matchesTaskCriteria = (
  task: Readonly<TaskCopy>,
  criteria: TaskCriteria,
  ctx: TaskCriteriaCtx,
): boolean => {
  if (criteria.isNoMatch) return false;
  if (!matchesTags(task.tagIds ?? [], criteria)) return false;
  if (criteria.projectIds && !criteria.projectIds.includes(task.projectId)) {
    return false;
  }
  if (criteria.done === 'done' && !task.isDone) return false;
  if (criteria.done === 'undone' && task.isDone) return false;
  if (criteria.isParentOnly && task.parentId) return false;

  const hasPlannedDate = !!(task.dueWithTime || task.dueDay);
  if (criteria.scheduled === 'scheduled' && !hasPlannedDate) return false;
  if (criteria.scheduled === 'unscheduled' && hasPlannedDate) return false;

  if (criteria.backlog === 'only' && !ctx.isInBacklog(task)) return false;
  if (criteria.backlog === 'exclude' && ctx.isInBacklog(task)) return false;

  if (
    criteria.plannedDate &&
    !matchesDateRule(task.dueDay, task.dueWithTime, criteria.plannedDate, ctx)
  ) {
    return false;
  }
  if (
    criteria.deadline &&
    !matchesDateRule(task.deadlineDay, task.deadlineWithTime, criteria.deadline, ctx)
  ) {
    return false;
  }

  if (criteria.estimate === 'none' && task.timeEstimate) return false;
  if (
    typeof criteria.estimate === 'number' &&
    !((task.timeEstimate || 0) >= criteria.estimate)
  ) {
    return false;
  }
  if (criteria.timeSpent === 'none' && task.timeSpent) return false;
  if (
    typeof criteria.timeSpent === 'number' &&
    !(getTimeSpent(task) >= criteria.timeSpent)
  ) {
    return false;
  }

  if (criteria.priority !== undefined) {
    const priority = getTaskPriority(task.priority);
    if (criteria.priority === 'none' ? !!priority : priority !== criteria.priority) {
      return false;
    }
  }
  return true;
};

/**
 * The task's tags rewritten to meet the tag rules. Pure; the result may hold
 * duplicates (callers de-dupe). TODAY_TAG is virtual (ARCHITECTURE-DECISIONS
 * #2): it is never added, and a legacy one is dropped.
 * - included `all`: add every required tag; `any`: add the first one only when
 *   the task has none of them;
 * - excluded `any`: strip every excluded tag; `all`: strip only the first one
 *   when the task has all of them (breaks the AND without over-removing).
 */
export const getTagIdsToMatch = (
  currentTagIds: readonly string[],
  criteria: Pick<
    TaskCriteria,
    | 'includedTagIds'
    | 'includedTagsMatch'
    | 'excludedTagIds'
    | 'excludedTagsMatch'
    | 'isUntagged'
  >,
): string[] => {
  if (criteria.isUntagged) {
    return [];
  }
  const includedTagIds = criteria.includedTagIds?.filter((id) => id !== TODAY_TAG.id);
  let next: string[] = currentTagIds.filter((id) => id !== TODAY_TAG.id);

  if (includedTagIds?.length) {
    if (criteria.includedTagsMatch === 'any') {
      if (!includedTagIds.some((id) => next.includes(id))) {
        next = next.concat(includedTagIds[0]);
      }
    } else {
      next = next.concat(includedTagIds);
    }
  }

  const excluded = criteria.excludedTagIds;
  if (excluded?.length) {
    if (criteria.excludedTagsMatch === 'all') {
      if (excluded.every((id) => next.includes(id))) {
        next = next.filter((id) => id !== excluded[0]);
      }
    } else {
      next = next.filter((id) => !excluded.includes(id));
    }
  }
  return next;
};

/** The day a date rule asks a task to be planned for (planned date). */
const getPlannedDayForRule = (rule: TaskDateRule, ctx: TaskCriteriaCtx): string => {
  switch (rule) {
    case 'tomorrow':
      return ctx.tomorrowStr;
    case 'nextWeek':
      return ctx.nextWeekStartStr;
    case 'nextMonth':
      return ctx.nextMonthStartStr;
    default:
      // today, todayOrOverdue, next7Days, thisWeek, thisMonth all include today
      return ctx.todayStr;
  }
};

/**
 * The deadline day a date rule asks for: the LAST day of a range ("due by").
 * A deadline of today auto-plans the task into Today (see the simulation in
 * `getChangesToMatch`), so only `today`/`todayOrOverdue` write today.
 */
const getDeadlineDayForRule = (rule: TaskDateRule, ctx: TaskCriteriaCtx): string => {
  switch (rule) {
    case 'tomorrow':
      return ctx.tomorrowStr;
    case 'next7Days':
      return ctx.next7DaysEndStr;
    case 'thisWeek':
      return ctx.weekEndStr;
    case 'nextWeek':
      return ctx.nextWeekEndStr;
    case 'thisMonth':
      return ctx.monthEndStr;
    case 'nextMonth':
      return ctx.nextMonthEndStr;
    default:
      return ctx.todayStr;
  }
};

/**
 * What has to change so `task` meets `criteria`, or `null` when no change can
 * (e.g. "overdue", a minimum estimate the task doesn't have, contradictory
 * rules). The result is checked by applying it to a copy of the task —
 * including the deadline auto-plan into Today — and matching that copy.
 */
export const getChangesToMatch = (
  task: Readonly<TaskCopy>,
  criteria: TaskCriteria,
  ctx: TaskCriteriaCtx,
): TaskMatchChanges | null => {
  if (criteria.isNoMatch) return null;
  if (criteria.isParentOnly && task.parentId) return null;
  const changes: TaskMatchChanges = {};

  if (criteria.projectIds && !criteria.projectIds.includes(task.projectId)) {
    if (!criteria.projectIds.length) return null;
    changes.projectId = criteria.projectIds[0];
  }
  const projectId = changes.projectId ?? task.projectId;
  // A project move lands the task in the target's regular list.
  let isInBacklog = changes.projectId ? false : ctx.isInBacklog(task);
  if (criteria.backlog === 'only' && !isInBacklog) {
    if (!projectId || !ctx.isBacklogEnabled(projectId)) return null;
    changes.backlog = 'moveIn';
    isInBacklog = true;
  } else if (criteria.backlog === 'exclude' && isInBacklog) {
    changes.backlog = 'moveOut';
    isInBacklog = false;
  }

  const tagIds = getTagIdsToMatch(task.tagIds ?? [], criteria);
  const currentTagIds = task.tagIds ?? [];
  if (
    tagIds.length !== currentTagIds.length ||
    tagIds.some((id, i) => id !== currentTagIds[i])
  ) {
    changes.tagIds = tagIds;
  }

  if (criteria.done === 'done' && !task.isDone) changes.isDone = true;
  if (criteria.done === 'undone' && task.isDone) changes.isDone = false;

  if (criteria.priority !== undefined) {
    const priority = getTaskPriority(task.priority);
    if (criteria.priority === 'none' && priority) changes.priority = null;
    if (criteria.priority !== 'none' && priority !== criteria.priority) {
      changes.priority = criteria.priority as TaskPriority;
    }
  }

  if (
    criteria.plannedDate &&
    !matchesDateRule(task.dueDay, task.dueWithTime, criteria.plannedDate, ctx)
  ) {
    if (criteria.plannedDate === 'overdue') return null;
    if (criteria.plannedDate === 'none') {
      changes.isUnschedule = true;
    } else {
      changes.scheduleDay = getPlannedDayForRule(criteria.plannedDate, ctx);
    }
  }
  const hasPlannedDate = !!(task.dueWithTime || task.dueDay);
  if (criteria.scheduled === 'scheduled' && !hasPlannedDate && !changes.scheduleDay) {
    changes.isAskForSchedule = true;
  }
  if (criteria.scheduled === 'unscheduled' && hasPlannedDate) {
    changes.isUnschedule = true;
  }

  if (
    criteria.deadline &&
    !matchesDateRule(task.deadlineDay, task.deadlineWithTime, criteria.deadline, ctx)
  ) {
    if (criteria.deadline === 'overdue') return null;
    if (criteria.deadline === 'none') {
      changes.isRemoveDeadline = true;
    } else {
      changes.deadlineDay = getDeadlineDayForRule(criteria.deadline, ctx);
    }
  }

  const simulated = simulateChanges(task, changes, ctx);
  return matchesTaskCriteria(simulated, criteria, {
    ...ctx,
    isInBacklog: () => isInBacklog,
  })
    ? changes
    : null;
};

/** The task as it will be after `changes`, including the deadline auto-plan. */
const simulateChanges = (
  task: Readonly<TaskCopy>,
  changes: TaskMatchChanges,
  ctx: TaskCriteriaCtx,
): TaskCopy => {
  const sim: TaskCopy = {
    ...task,
    projectId: changes.projectId ?? task.projectId,
    tagIds: changes.tagIds ?? task.tagIds,
    isDone: changes.isDone ?? task.isDone,
    priority:
      changes.priority === undefined ? task.priority : (changes.priority ?? undefined),
  };
  if (changes.isUnschedule) {
    sim.dueDay = undefined;
    sim.dueWithTime = undefined;
  }
  if (changes.scheduleDay || changes.isAskForSchedule) {
    // The asked-for date is unknown; any date satisfies "scheduled".
    sim.dueDay = changes.scheduleDay ?? ctx.todayStr;
    sim.dueWithTime = undefined;
  }
  if (changes.isRemoveDeadline) {
    sim.deadlineDay = undefined;
    sim.deadlineWithTime = undefined;
  }
  if (changes.deadlineDay) {
    sim.deadlineDay = changes.deadlineDay;
    sim.deadlineWithTime = undefined;
  }
  // An undone task whose deadline is today and that is unplanned or overdue
  // is planned for today (setDeadline's auto-plan, TaskDueEffects at day
  // change), so a rule that excludes today can't hold for it. Conservative for
  // subtasks: the real auto-plan skips one whose parent is in Today, so such a
  // move may be refused although it would hold — never accepted wrongly.
  const deadlineDay = getLogicalDay(sim.deadlineDay, sim.deadlineWithTime, {
    ...ctx,
    isDayBeforeTime: false,
  });
  if (
    !sim.isDone &&
    deadlineDay === ctx.todayStr &&
    (!(sim.dueDay || sim.dueWithTime) ||
      isTaskOverdueByThreshold(sim, ctx.todayStr, ctx.todayStartMs))
  ) {
    sim.dueDay = ctx.todayStr;
    sim.dueWithTime = undefined;
  }
  return sim;
};

/** Whether no change of a new, empty task can make it match (hide add rows). */
export const isCriteriaUnreachableForNewTasks = (criteria: TaskCriteria): boolean =>
  !!criteria.isNoMatch ||
  criteria.plannedDate === 'overdue' ||
  criteria.deadline === 'overdue' ||
  typeof criteria.estimate === 'number' ||
  typeof criteria.timeSpent === 'number';

// === SORT ===

export type TaskSortKey =
  | 'title'
  | 'created'
  | 'plannedDate'
  | 'deadline'
  | 'estimate'
  | 'timeSpent'
  | 'priority'
  | 'tag';

export interface TaskSortCtx {
  collator: Intl.Collator;
  /** Side-menu position per tag id (only needed for the `tag` key). */
  tagRankById?: ReadonlyMap<string, number>;
}

/** A date-only value means "by the end of that day" for sorting (#9828). */
const toSortTs = (
  day: string | null | undefined,
  withTime: number | null | undefined,
): number | null => {
  if (day && isDBDateStr(day)) {
    const date = dateStrToUtcDate(day);
    date.setHours(23, 59, 59, 999);
    return date.getTime();
  }
  return withTime || null;
};

const compareNullableTs = (a: number | null, b: number | null): number => {
  if (a === null && b === null) return 0;
  // Nulls last ascending; the caller's direction factor flips this.
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
};

/**
 * Ascending comparator for a sort key; callers multiply by -1 for descending.
 * Priority ascending lists high priority first; the tag key orders by the
 * task's first tag in side-menu order and keeps manual order within a tag
 * (descending flips only the group order, #8486).
 */
export const buildTaskComparator = (
  key: TaskSortKey,
  sortCtx: TaskSortCtx,
): ((a: TaskCopy, b: TaskCopy) => number) => {
  switch (key) {
    case 'title':
      return (a, b) => sortCtx.collator.compare(a.title || '', b.title || '');
    case 'created':
      return (a, b) => (a.created || 0) - (b.created || 0);
    case 'estimate':
      return (a, b) => (a.timeEstimate || 0) - (b.timeEstimate || 0);
    case 'timeSpent':
      return (a, b) => getTimeSpent(a) - getTimeSpent(b);
    case 'priority':
      return (a, b) =>
        (getTaskPriority(b.priority) ?? 0) - (getTaskPriority(a.priority) ?? 0);
    case 'plannedDate':
      return (a, b) =>
        compareNullableTs(
          toSortTs(a.dueDay, a.dueWithTime),
          toSortTs(b.dueDay, b.dueWithTime),
        );
    case 'deadline':
      return (a, b) =>
        compareNullableTs(
          toSortTs(a.deadlineDay, a.deadlineWithTime),
          toSortTs(b.deadlineDay, b.deadlineWithTime),
        );
    case 'tag': {
      const ranks = sortCtx.tagRankById ?? new Map<string, number>();
      const unknownRank = ranks.size;
      const rankOf = (task: TaskCopy): number => {
        if (!task.tagIds?.length) return unknownRank + 1;
        let min = unknownRank;
        for (const id of task.tagIds) {
          const rank = ranks.get(id) ?? unknownRank;
          if (rank < min) min = rank;
        }
        return min;
      };
      return (a, b) => rankOf(a) - rankOf(b);
    }
  }
};
