import {
  BoardCfg,
  BoardPanelCfg,
  BoardPanelCfgScheduledState,
  BoardPanelCfgTaskDoneState,
  BoardPanelCfgTaskTypeFilter,
  BoardPanelDueState,
  BoardSortField,
} from './boards.model';
import { TaskCopy } from '../tasks/task.model';
import { dateStrToUtcDate } from '../../util/date-str-to-utc-date';
import { getDbDateStr, isDBDateStr } from '../../util/get-db-date-str';
import { TODAY_TAG } from '../tag/tag.const';
import {
  getLogicalTodayStartMs,
  isTaskOverdueByThreshold,
} from '../tasks/util/is-task-overdue';

const VALID_SORT_FIELDS: ReadonlySet<BoardSortField> = new Set([
  'dueDate',
  'created',
  'title',
  'timeEstimate',
]);

const VALID_DUE_STATES: ReadonlySet<string> = new Set<BoardPanelDueState>([
  'overdue',
  'today',
  'tomorrow',
  'next7Days',
]);

/**
 * The logical "today" a panel's due rule is evaluated against. Callers read
 * `todayStr` and `startOfNextDayDiffMs` from the store (`selectTodayStr`,
 * `selectStartOfNextDayDiffMs`) so day rollover and a changed day-start
 * setting refresh the panel. Build it with `createBoardDueCtx`: the other
 * fields are derived once per panel update instead of once per task.
 */
export interface BoardDueCtx {
  todayStr: string;
  startOfNextDayDiffMs: number;
  tomorrowStr: string;
  next7DaysEndStr: string;
  todayStartMs: number;
}

// Absent `projectIds` (legacy data that hasn't been sanitized yet) means
// "All Projects", same as an array containing the "" sentinel.
export const isAllProjects = (projectIds: string[] | undefined): boolean =>
  !projectIds || projectIds.includes('');

export const firstSpecificProjectId = (
  projectIds: string[] | undefined,
): string | undefined => projectIds?.find((id) => id !== '');

/**
 * Normalizes a panel cfg for persistence and hydration:
 * - Migrates legacy `sortByDue` → `sortBy`/`sortDir`.
 * - Coerces `null` values (from Formly) on optional string-union fields to absent.
 * - Drops unknown `sortBy` values (e.g. from a newer client synced down).
 * - Drops an empty `dueState`, but keeps unknown strings: a newer client's value
 *   must survive this client's next `updateBoard`, which replaces `panels`.
 * Idempotent.
 */
export const sanitizePanelCfg = (panel: BoardPanelCfg): BoardPanelCfg => {
  const out: BoardPanelCfg = { ...panel };

  // Migrate legacy `projectId` → `projectIds`.
  // Preference given to legacy `projectId` if present (even if `projectIds`
  // exists as [""] from overlaying DEFAULT_PANEL_CFG during migration).
  // NOTE: This preference is deliberate to ensure we don't lose the user's
  // choice if they had a specific project selected in an older version.
  const legacyPanel = out as BoardPanelCfg & { projectId?: string };
  if (legacyPanel.projectId !== undefined) {
    if (
      out.projectIds === undefined ||
      (Array.isArray(out.projectIds) &&
        out.projectIds.length === 1 &&
        out.projectIds[0] === '')
    ) {
      out.projectIds = [legacyPanel.projectId || ''];
    }
    delete legacyPanel.projectId;
  }

  // Ensure `projectIds` is always an array (e.g. if loaded from older client
  // that didn't run this migration yet).
  if (!Array.isArray(out.projectIds)) {
    out.projectIds = [''];
  }

  // Canonicalize any `projectIds` containing "" back to [""] (All Projects).
  // This is lossy: if "" (All Projects) co-occurs with specific IDs, the specific IDs
  // are dropped in favor of "All Projects".
  if (isAllProjects(out.projectIds)) {
    out.projectIds = [''];
  }

  if (out.sortByDue === 'asc' || out.sortByDue === 'desc') {
    out.sortBy = 'dueDate';
    out.sortDir = out.sortByDue;
  }
  delete (out as Partial<BoardPanelCfg>).sortByDue;

  // Drop `sortBy` if null/undefined OR unknown value — prevents buildComparator
  // from getting an unhandled field and returning undefined at runtime.
  if (out.sortBy == null || !VALID_SORT_FIELDS.has(out.sortBy)) {
    delete (out as Partial<BoardPanelCfg>).sortBy;
  }
  if (out.sortDir == null) {
    delete (out as Partial<BoardPanelCfg>).sortDir;
  }
  if (out.includedTagsMatch == null) {
    delete (out as Partial<BoardPanelCfg>).includedTagsMatch;
  }
  if (out.excludedTagsMatch == null) {
    delete (out as Partial<BoardPanelCfg>).excludedTagsMatch;
  }
  if (typeof out.dueState !== 'string' || out.dueState === '') {
    delete (out as Partial<BoardPanelCfg>).dueState;
  }

  return out;
};

/**
 * A due rule implies "scheduled". The form hides the scheduled-state field
 * while a due rule is set, so this stores the matching value: released clients
 * that don't know `dueState` then still show only scheduled tasks there.
 */
export const withDueStateImpliesScheduled = (board: BoardCfg): BoardCfg => ({
  ...board,
  panels: board.panels.map((panel) =>
    getPanelDueState(panel) &&
    panel.scheduledState !== BoardPanelCfgScheduledState.Scheduled
      ? { ...panel, scheduledState: BoardPanelCfgScheduledState.Scheduled }
      : panel,
  ),
});

/** Narrows the persisted `dueState` string; unknown values mean "any". */
export const getPanelDueState = (
  panelCfg: Pick<BoardPanelCfg, 'dueState'>,
): BoardPanelDueState | undefined =>
  typeof panelCfg.dueState === 'string' && VALID_DUE_STATES.has(panelCfg.dueState)
    ? (panelCfg.dueState as BoardPanelDueState)
    : undefined;

/**
 * The logical day a task is due, or null if undated. `dueWithTime` wins over
 * `dueDay`, as in task.selectors.ts; a timestamp is shifted by the
 * start-of-next-day offset so 01:00 with a 4 h day start counts as yesterday.
 */
export const getLogicalDueDay = (
  task: Pick<TaskCopy, 'dueDay' | 'dueWithTime'>,
  startOfNextDayDiffMs: number,
): string | null => {
  if (task.dueWithTime) {
    return getDbDateStr(task.dueWithTime - startOfNextDayDiffMs);
  }
  if (task.dueDay && isDBDateStr(task.dueDay)) {
    return task.dueDay;
  }
  return null;
};

/** Adds days on the local calendar, so DST changes don't shift the result. */
export const addDaysToDbDateStr = (dayStr: string, days: number): string => {
  const date = dateStrToUtcDate(dayStr);
  date.setDate(date.getDate() + days);
  return getDbDateStr(date);
};

export const createBoardDueCtx = (
  todayStr: string,
  startOfNextDayDiffMs: number,
): BoardDueCtx => ({
  todayStr,
  startOfNextDayDiffMs,
  tomorrowStr: addDaysToDbDateStr(todayStr, 1),
  next7DaysEndStr: addDaysToDbDateStr(todayStr, 6),
  todayStartMs: getLogicalTodayStartMs(todayStr, startOfNextDayDiffMs),
});

/**
 * The calendar date to schedule a task for so that it lands on the logical
 * `day`. Scheduling keeps a timed task's time of day; if that time is before
 * the start of day (01:00 with a 04:00 start), it belongs to the previous
 * logical day, so the calendar date is the day after.
 */
export const getCalendarDateForDueDay = (
  task: Pick<TaskCopy, 'dueWithTime'>,
  day: string,
  startOfNextDayDiffMs: number,
): string => {
  if (!task.dueWithTime || startOfNextDayDiffMs <= 0) {
    return day;
  }
  const msIntoDay = task.dueWithTime - new Date(task.dueWithTime).setHours(0, 0, 0, 0);
  return msIntoDay < startOfNextDayDiffMs ? addDaysToDbDateStr(day, 1) : day;
};

const doesTaskMatchDueState = (
  task: Pick<TaskCopy, 'dueDay' | 'dueWithTime'>,
  dueState: BoardPanelDueState,
  ctx: BoardDueCtx,
): boolean => {
  if (dueState === 'overdue') {
    // Same predicate as the overdue section and the red date colour.
    return isTaskOverdueByThreshold(task, ctx.todayStr, ctx.todayStartMs);
  }
  const day = getLogicalDueDay(task, ctx.startOfNextDayDiffMs);
  if (!day) {
    return false;
  }
  switch (dueState) {
    case 'today':
      return day === ctx.todayStr;
    case 'tomorrow':
      return day === ctx.tomorrowStr;
    case 'next7Days':
      return day >= ctx.todayStr && day <= ctx.next7DaysEndStr;
  }
};

/**
 * The day a task has to be scheduled for to satisfy the panel's due rule:
 * - `undefined`: no change needed (no rule, or the task already matches);
 * - a `YYYY-MM-DD` string: schedule the task for that day;
 * - `null`: no date can satisfy the rule (moving a task into "overdue").
 */
export const getDueDayForPanel = (
  task: Pick<TaskCopy, 'dueDay' | 'dueWithTime'>,
  panelCfg: Pick<BoardPanelCfg, 'dueState'>,
  ctx: BoardDueCtx,
): string | null | undefined => {
  const dueState = getPanelDueState(panelCfg);
  if (!dueState || doesTaskMatchDueState(task, dueState, ctx)) {
    return undefined;
  }
  switch (dueState) {
    case 'overdue':
      return null;
    case 'tomorrow':
      return ctx.tomorrowStr;
    case 'today':
    case 'next7Days':
      return ctx.todayStr;
  }
};

/**
 * Normalize a task's due moment to a comparable millisecond timestamp, or null
 * if undated. Timezone-safe: uses `dateStrToUtcDate` for YYYY-MM-DD strings,
 * matching task.selectors.ts.
 */
const getDueTs = (task: TaskCopy): number | null => {
  if (task.dueWithTime) return task.dueWithTime;
  if (task.dueDay) {
    return dateStrToUtcDate(task.dueDay).getTime();
  }
  return null;
};

const NO_OP_COMPARATOR = (): number => 0;

/**
 * Rewrite a task's tagIds so it will match the given panel's include/exclude
 * filter after a cross-panel drop. Pure function — never mutates inputs.
 *
 * Semantics (matches the panel-filter rules):
 * - Included tags:
 *   - Default ('all'): append every required tag (caller de-dupes if needed).
 *   - 'any': append the FIRST required tag only when the task has none of them.
 * - Excluded tags:
 *   - Default ('any'): strip ALL excluded tags the task carries.
 *   - 'all': strip only the FIRST excluded tag when the task has ALL excluded
 *     tags (breaks the AND-exclude condition without over-removing).
 *
 * TODAY_TAG is virtual: membership derives from dueDay/dueWithTime and it must
 * never be written to `task.tagIds` (ARCHITECTURE-DECISIONS #2), so the result
 * never contains it. Only the INCLUDE side ignores it — dropping it from the
 * EXCLUDE side would let an AND-exclude fire here that `doesTaskMatchPanel` can
 * never hit (it only ever sees real tags), stripping a real user tag to satisfy
 * a filter that was already inert.
 *
 * Duplicates are not de-duplicated here; callers that care should pass the
 * result through `unique()`.
 */
export const rewriteTagIdsForPanel = (
  currentTagIds: readonly string[],
  panelCfg: Pick<
    BoardPanelCfg,
    'includedTagIds' | 'includedTagsMatch' | 'excludedTagIds' | 'excludedTagsMatch'
  >,
): string[] => {
  const includedTagIds = panelCfg.includedTagIds?.filter((id) => id !== TODAY_TAG.id);
  // Also heals a legacy TODAY_TAG that an older build wrote into the task.
  let next: string[] = currentTagIds.filter((id) => id !== TODAY_TAG.id);

  if (includedTagIds?.length) {
    if (panelCfg.includedTagsMatch === 'any') {
      const hasAny = includedTagIds.some((id) => next.includes(id));
      if (!hasAny) {
        next = next.concat(includedTagIds[0]);
      }
    } else {
      next = next.concat(includedTagIds);
    }
  }

  if (panelCfg.excludedTagIds?.length) {
    if (panelCfg.excludedTagsMatch === 'all') {
      const hasAll = panelCfg.excludedTagIds.every((id) => next.includes(id));
      if (hasAll) {
        const firstExcluded = panelCfg.excludedTagIds[0];
        next = next.filter((id) => id !== firstExcluded);
      }
    } else {
      const excluded = panelCfg.excludedTagIds;
      next = next.filter((id) => !excluded.includes(id));
    }
  }

  return next;
};

/**
 * Pure membership predicate: does `task` belong in a panel/column with the
 * given criteria? Companion to `rewriteTagIdsForPanel` (which rewrites a task's
 * tags TO match) — the two encode the same tag rules and must stay in sync.
 *
 * `isInBacklog` is supplied by the caller because backlog membership derives
 * from project state, not from the task itself. It is only consulted when
 * `panelCfg.backlogState` requests backlog filtering. `dueCtx` is the logical
 * today, consulted only when the panel has a due rule.
 */
export const doesTaskMatchPanel = (
  task: Readonly<TaskCopy>,
  panelCfg: Pick<
    BoardPanelCfg,
    | 'includedTagIds'
    | 'includedTagsMatch'
    | 'excludedTagIds'
    | 'excludedTagsMatch'
    | 'isParentTasksOnly'
    | 'taskDoneState'
    | 'projectIds'
    | 'scheduledState'
    | 'backlogState'
    | 'dueState'
  >,
  isInBacklog: (task: Readonly<TaskCopy>) => boolean,
  dueCtx: BoardDueCtx,
): boolean => {
  const taskTagIds = task.tagIds ?? [];

  if (panelCfg.includedTagIds?.length) {
    const matches =
      panelCfg.includedTagsMatch === 'any'
        ? panelCfg.includedTagIds.some((tagId) => taskTagIds.includes(tagId))
        : panelCfg.includedTagIds.every((tagId) => taskTagIds.includes(tagId));
    if (!matches) return false;
  }

  if (panelCfg.excludedTagIds?.length) {
    const hit =
      panelCfg.excludedTagsMatch === 'all'
        ? panelCfg.excludedTagIds.every((tagId) => taskTagIds.includes(tagId))
        : panelCfg.excludedTagIds.some((tagId) => taskTagIds.includes(tagId));
    if (hit) return false;
  }

  if (panelCfg.isParentTasksOnly && task.parentId) {
    return false;
  }

  if (panelCfg.taskDoneState === BoardPanelCfgTaskDoneState.Done && !task.isDone) {
    return false;
  }
  if (panelCfg.taskDoneState === BoardPanelCfgTaskDoneState.UnDone && task.isDone) {
    return false;
  }

  if (
    panelCfg.projectIds &&
    panelCfg.projectIds.length > 0 &&
    !isAllProjects(panelCfg.projectIds) &&
    !panelCfg.projectIds.includes(task.projectId)
  ) {
    return false;
  }

  if (
    panelCfg.scheduledState === BoardPanelCfgScheduledState.Scheduled &&
    !(task.dueWithTime || task.dueDay)
  ) {
    return false;
  }
  if (
    panelCfg.scheduledState === BoardPanelCfgScheduledState.NotScheduled &&
    (task.dueWithTime || task.dueDay)
  ) {
    return false;
  }

  if (
    panelCfg.backlogState === BoardPanelCfgTaskTypeFilter.OnlyBacklog &&
    !isInBacklog(task)
  ) {
    return false;
  }
  if (
    panelCfg.backlogState === BoardPanelCfgTaskTypeFilter.NoBacklog &&
    isInBacklog(task)
  ) {
    return false;
  }

  const dueState = getPanelDueState(panelCfg);
  if (dueState && !doesTaskMatchDueState(task, dueState, dueCtx)) {
    return false;
  }

  return true;
};

/**
 * Returns an ascending comparator for the given field. Callers multiply by -1
 * for descending. Returns a no-op comparator for unknown fields, so an invalid
 * persisted `sortBy` degrades to manual order instead of crashing the panel.
 */
export const buildComparator = (
  field: BoardSortField,
): ((a: TaskCopy, b: TaskCopy) => number) => {
  switch (field) {
    case 'title':
      return (a, b) => (a.title || '').localeCompare(b.title || '');
    case 'created':
      return (a, b) => (a.created || 0) - (b.created || 0);
    case 'timeEstimate':
      return (a, b) => (a.timeEstimate || 0) - (b.timeEstimate || 0);
    case 'dueDate':
      return (a, b) => {
        // Fast path: both have only dueDay (string) → lex compare (YYYY-MM-DD
        // is fixed-width, so < / > work and are faster than localeCompare).
        if (!a.dueWithTime && !b.dueWithTime && a.dueDay && b.dueDay) {
          return a.dueDay < b.dueDay ? -1 : a.dueDay > b.dueDay ? 1 : 0;
        }
        const aTs = getDueTs(a);
        const bTs = getDueTs(b);
        if (aTs === null && bTs === null) return 0;
        // Nulls last in ascending order — caller reverses for descending.
        if (aTs === null) return 1;
        if (bTs === null) return -1;
        return aTs - bTs;
      };
    default:
      return NO_OP_COMPARATOR;
  }
};
