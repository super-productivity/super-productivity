import { TaskCopy, TaskPriority } from '../task.model';

/**
 * Date rules for a task's planned date (`dueDay`/`dueWithTime`) or deadline.
 * Every rule is evaluated on the logical day (start-of-next-day offset).
 */
export type TaskDateRule =
  | 'overdue'
  | 'todayOrOverdue'
  | 'today'
  | 'tomorrow'
  | 'next7Days'
  | 'thisWeek'
  | 'nextWeek'
  | 'thisMonth'
  | 'nextMonth'
  | 'none';

export const TASK_DATE_RULES: readonly TaskDateRule[] = [
  'overdue',
  'todayOrOverdue',
  'today',
  'tomorrow',
  'next7Days',
  'thisWeek',
  'nextWeek',
  'thisMonth',
  'nextMonth',
  'none',
];

export type TaskMatchMode = 'all' | 'any';

/**
 * The rules a task has to meet to belong to a list: a board column (view) or
 * the task list filter menu. In memory only — each caller keeps its own
 * persisted shape and converts it (`panelToCriteria`, `filterToCriteria`).
 * Absent fields don't filter.
 */
export interface TaskCriteria {
  /** Matches no task at all (e.g. a filter-menu project search without hits). */
  isNoMatch?: boolean;
  includedTagIds?: string[];
  /** Default `all`. */
  includedTagsMatch?: TaskMatchMode;
  excludedTagIds?: string[];
  /** Default `any`. */
  excludedTagsMatch?: TaskMatchMode;
  isUntagged?: boolean;
  /** Absent = every project. */
  projectIds?: string[];
  done?: 'done' | 'undone';
  isParentOnly?: boolean;
  scheduled?: 'scheduled' | 'unscheduled';
  backlog?: 'only' | 'exclude';
  plannedDate?: TaskDateRule;
  deadline?: TaskDateRule;
  /** `none`: no estimate; a number: at least that many ms. */
  estimate?: 'none' | number;
  /** `none`: nothing tracked; a number: at least that many ms tracked. */
  timeSpent?: 'none' | number;
  priority?: 'none' | TaskPriority;
}

/**
 * The logical "today" and lookups a match needs. Build it with
 * `createTaskCriteriaCtx`: the date bounds are derived once per list update,
 * not once per task.
 */
export interface TaskCriteriaCtx {
  todayStr: string;
  startOfNextDayDiffMs: number;
  todayStartMs: number;
  tomorrowStr: string;
  next7DaysEndStr: string;
  weekStartStr: string;
  weekEndStr: string;
  nextWeekStartStr: string;
  nextWeekEndStr: string;
  monthEndStr: string;
  nextMonthStartStr: string;
  nextMonthEndStr: string;
  /**
   * The filter menu reads a plain `dueDay` before `dueWithTime`; board columns
   * read `dueWithTime` first (like task.selectors.ts). Kept per caller so
   * neither changes behaviour silently.
   */
  isDayBeforeTime: boolean;
  isInBacklog: (task: Readonly<TaskCopy>) => boolean;
  /** Whether a project has a backlog to move a task into. */
  isBacklogEnabled: (projectId: string) => boolean;
}

/**
 * What has to change so a task meets a `TaskCriteria`. A description only:
 * callers dispatch the existing actions, in this order: project → backlog →
 * one `updateTask` (tags, done, priority) → schedule/unschedule → deadline.
 */
export interface TaskMatchChanges {
  projectId?: string;
  backlog?: 'moveIn' | 'moveOut';
  tagIds?: string[];
  isDone?: boolean;
  priority?: TaskPriority | null;
  /** Logical day to plan the task for. */
  scheduleDay?: string;
  /** The rule only needs "some date"; the caller asks the user for one. */
  isAskForSchedule?: boolean;
  isUnschedule?: boolean;
  deadlineDay?: string;
  isRemoveDeadline?: boolean;
}
