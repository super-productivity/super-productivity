import {
  BoardCfg,
  BoardPanelCfg,
  BoardPanelCfgScheduledState,
  BoardPanelCfgTaskDoneState,
  BoardPanelCfgTaskTypeFilter,
  BoardSortField,
} from './boards.model';
import { TaskCopy, TaskPriority } from '../tasks/task.model';
import {
  TASK_DATE_RULES,
  TaskCriteria,
  TaskDateRule,
} from '../tasks/task-criteria/task-criteria.model';
import { addDaysToDbDateStr, TaskSortKey } from '../tasks/task-criteria/task-criteria';

const VALID_SORT_FIELDS: ReadonlySet<BoardSortField> = new Set([
  'dueDate',
  'created',
  'title',
  'timeEstimate',
]);

const SORT_BY_TO_KEY: Record<BoardSortField, TaskSortKey> = {
  dueDate: 'plannedDate',
  created: 'created',
  title: 'title',
  timeEstimate: 'estimate',
};
// Sort keys the persisted `sortBy` (a closed union on released clients) can't
// hold; they go into `sortKey` instead.
const NEW_SORT_KEYS: ReadonlySet<string> = new Set<TaskSortKey>([
  'deadline',
  'timeSpent',
  'priority',
  'tag',
]);

// Optional string fields Formly writes `null` into; unknown strings are kept,
// so a newer client's value survives this client's next `updateBoard`, which
// replaces `panels`.
const OPTIONAL_STRING_FIELDS = [
  'dueState',
  'deadlineState',
  'estimateRule',
  'timeSpentRule',
  'priorityRule',
  'sortKey',
] as const;

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
 * - Drops empty rule strings (`dueState`, `sortKey`, …), but keeps unknown
 *   ones: a newer client's value must survive this client's next
 *   `updateBoard`, which replaces `panels`.
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
  for (const field of OPTIONAL_STRING_FIELDS) {
    if (typeof out[field] !== 'string' || out[field] === '') {
      delete (out as Partial<BoardPanelCfg>)[field];
    }
  }
  if (typeof out.isUntagged !== 'boolean') {
    delete (out as Partial<BoardPanelCfg>).isUntagged;
  }

  return out;
};

/**
 * Turns the board editor's model into what is stored: the form's sort select
 * becomes `sortBy`/`sortKey`, an untagged column drops its (hidden) tag lists,
 * a date rule implies "scheduled", and Formly's nulls are dropped, so no op
 * carries them to released clients.
 */
export const normalizeBoardForSave = (board: BoardCfg): BoardCfg =>
  withDueStateImpliesScheduled({
    ...board,
    panels: board.panels.map((panel) => {
      let out = withPanelSortKey(panel, panel.sortKey as TaskSortKey | null | undefined);
      if (out.isUntagged) {
        out = { ...out, includedTagIds: [], excludedTagIds: [] };
        delete out.includedTagsMatch;
        delete out.excludedTagsMatch;
      } else {
        delete out.isUntagged;
      }
      return sanitizePanelCfg(out);
    }),
  });

/**
 * A due rule implies "scheduled". The form hides the scheduled-state field
 * while a due rule is set, so this stores the matching value: released clients
 * that don't know `dueState` then still show only scheduled tasks there.
 */
export const withDueStateImpliesScheduled = (board: BoardCfg): BoardCfg => ({
  ...board,
  panels: board.panels.map((panel) =>
    isScheduledDateRule(parseDateRule(panel.dueState)) &&
    panel.scheduledState !== BoardPanelCfgScheduledState.Scheduled
      ? { ...panel, scheduledState: BoardPanelCfgScheduledState.Scheduled }
      : panel,
  ),
});

const parseDateRule = (value: string | undefined): TaskDateRule | undefined =>
  value && (TASK_DATE_RULES as readonly string[]).includes(value)
    ? (value as TaskDateRule)
    : undefined;

const isScheduledDateRule = (rule: TaskDateRule | undefined): boolean =>
  !!rule && rule !== 'none';

/** `none` or a minimum in ms, stored as a string. Unknown values mean "any". */
const parseAmountRule = (value: string | undefined): 'none' | number | undefined => {
  if (value === 'none') return 'none';
  const ms = value ? Number(value) : NaN;
  return Number.isFinite(ms) && ms > 0 ? ms : undefined;
};

const parsePriorityRule = (
  value: string | undefined,
): 'none' | TaskPriority | undefined =>
  value === 'none'
    ? 'none'
    : value === '1' || value === '2' || value === '3'
      ? (Number(value) as TaskPriority)
      : undefined;

/**
 * A board panel's filters as task criteria. Unknown values (written by a newer
 * client) are left out, so they mean "any". A planned-date rule implies
 * "scheduled", so the scheduled state is only used without one.
 */
export const panelToCriteria = (panel: BoardPanelCfg): TaskCriteria => {
  const plannedDate = parseDateRule(panel.dueState);
  const criteria: TaskCriteria = {
    includedTagIds: panel.includedTagIds,
    includedTagsMatch: panel.includedTagsMatch === 'any' ? 'any' : 'all',
    excludedTagIds: panel.excludedTagIds,
    excludedTagsMatch: panel.excludedTagsMatch === 'all' ? 'all' : 'any',
  };
  if (panel.isUntagged === true) criteria.isUntagged = true;
  // An empty list means all projects, as it always has (and on released
  // clients); only a list of ids restricts.
  const projectIds = isAllProjects(panel.projectIds)
    ? []
    : (panel.projectIds ?? []).filter((id) => id !== '');
  if (projectIds.length) {
    criteria.projectIds = projectIds;
  }
  if (panel.taskDoneState === BoardPanelCfgTaskDoneState.Done) criteria.done = 'done';
  if (panel.taskDoneState === BoardPanelCfgTaskDoneState.UnDone) {
    criteria.done = 'undone';
  }
  if (panel.isParentTasksOnly) criteria.isParentOnly = true;
  if (plannedDate) {
    criteria.plannedDate = plannedDate;
  } else if (panel.scheduledState === BoardPanelCfgScheduledState.Scheduled) {
    criteria.scheduled = 'scheduled';
  } else if (panel.scheduledState === BoardPanelCfgScheduledState.NotScheduled) {
    criteria.scheduled = 'unscheduled';
  }
  if (panel.backlogState === BoardPanelCfgTaskTypeFilter.OnlyBacklog) {
    criteria.backlog = 'only';
  }
  if (panel.backlogState === BoardPanelCfgTaskTypeFilter.NoBacklog) {
    criteria.backlog = 'exclude';
  }
  const deadline = parseDateRule(panel.deadlineState);
  if (deadline) criteria.deadline = deadline;
  const estimate = parseAmountRule(panel.estimateRule);
  if (estimate !== undefined) criteria.estimate = estimate;
  const timeSpent = parseAmountRule(panel.timeSpentRule);
  if (timeSpent !== undefined) criteria.timeSpent = timeSpent;
  const priority = parsePriorityRule(panel.priorityRule);
  if (priority !== undefined) criteria.priority = priority;
  return criteria;
};

/** A view's icon: a list for one column, a board for several. */
export const getViewIcon = (board: Pick<BoardCfg, 'panels'>): string =>
  board.panels.length > 1 ? 'view_kanban' : 'filter_list';

/**
 * Column fields for task criteria: the counterpart of `panelToCriteria` for the
 * rules a column can hold. A column can't say "matches nothing" (`isNoMatch`):
 * callers check for it first.
 */
export const criteriaToPanelFields = (criteria: TaskCriteria): Partial<BoardPanelCfg> => {
  const fields: Partial<BoardPanelCfg> = {};
  if (criteria.includedTagIds?.length) {
    fields.includedTagIds = criteria.includedTagIds;
    fields.includedTagsMatch = criteria.includedTagsMatch ?? 'all';
  }
  if (criteria.excludedTagIds?.length) {
    fields.excludedTagIds = criteria.excludedTagIds;
    fields.excludedTagsMatch = criteria.excludedTagsMatch ?? 'any';
  }
  if (criteria.isUntagged) fields.isUntagged = true;
  if (criteria.projectIds?.length) fields.projectIds = criteria.projectIds;
  if (criteria.plannedDate === 'none') {
    fields.scheduledState = BoardPanelCfgScheduledState.NotScheduled;
  } else if (criteria.plannedDate) {
    fields.dueState = criteria.plannedDate;
  }
  if (criteria.deadline) fields.deadlineState = criteria.deadline;
  if (criteria.estimate !== undefined) fields.estimateRule = String(criteria.estimate);
  if (criteria.timeSpent !== undefined) fields.timeSpentRule = String(criteria.timeSpent);
  if (criteria.priority !== undefined) fields.priorityRule = String(criteria.priority);
  return fields;
};

/**
 * The panel's sort key, or undefined for manual order. `sortBy` wins, so a
 * sort a released client picks later (it only knows `sortBy`) takes effect;
 * `sortKey` holds the keys `sortBy` can't.
 */
export const getPanelSortKey = (
  panel: Pick<BoardPanelCfg, 'sortBy' | 'sortKey'>,
): TaskSortKey | undefined => {
  if (panel.sortBy && panel.sortBy in SORT_BY_TO_KEY) {
    return SORT_BY_TO_KEY[panel.sortBy];
  }
  return panel.sortKey && NEW_SORT_KEYS.has(panel.sortKey)
    ? (panel.sortKey as TaskSortKey)
    : undefined;
};

/**
 * Stores a sort key: in `sortBy` when it can hold it (released clients keep
 * sorting), else in `sortKey`, deleting the other field. Gap: a released
 * client clearing the sort can't clear a `sortKey`.
 */
export const withPanelSortKey = (
  panel: BoardPanelCfg,
  key: TaskSortKey | null | undefined,
): BoardPanelCfg => {
  const out: BoardPanelCfg = { ...panel };
  delete out.sortBy;
  delete out.sortKey;
  const sortBy = (Object.keys(SORT_BY_TO_KEY) as BoardSortField[]).find(
    (field) => SORT_BY_TO_KEY[field] === key,
  );
  if (sortBy) {
    out.sortBy = sortBy;
  } else if (key) {
    // A key this client doesn't know (from a newer one) is kept as is.
    out.sortKey = key;
  }
  return out;
};

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
