export enum BoardPanelCfgTaskDoneState {
  All = 1,
  Done = 2,
  UnDone = 3,
}

export enum BoardPanelCfgScheduledState {
  All = 1,
  Scheduled = 2,
  NotScheduled = 3,
}

export enum BoardPanelCfgTaskTypeFilter {
  All = 1,
  NoBacklog = 2,
  OnlyBacklog = 3,
}

export type BoardSortField = 'dueDate' | 'created' | 'title' | 'timeEstimate';
export type BoardMatchMode = 'all' | 'any';

export interface BoardSrcCfg {
  includedTagIds: string[];
  excludedTagIds: string[];
  // Absent = 'all' (today's behavior): all required tags must match.
  includedTagsMatch?: BoardMatchMode;
  // Absent = 'any' (today's behavior): exclude on any match.
  excludedTagsMatch?: BoardMatchMode;
  // Absent/[''] = "All Projects". Optional so the typia validator tolerates
  // legacy data (panels that still carry `projectId` and no `projectIds`) on
  // raw-data paths that validate before the reducer's `sanitizePanelCfg` runs
  // (e.g. the legacy PFAPI → op-log migration). `sanitizePanelCfg` always
  // normalizes this to a defined array before it reaches any component.
  projectIds?: string[];
  taskDoneState: BoardPanelCfgTaskDoneState;
  scheduledState: BoardPanelCfgScheduledState;
  isParentTasksOnly: boolean;
  // Absent = manual order (user-controlled taskIds).
  sortBy?: BoardSortField;
  sortDir?: 'asc' | 'desc';
  /** @deprecated Migrated to sortBy/sortDir on load and scrubbed on save. */
  sortByDue?: 'off' | 'asc' | 'desc';
  // optional since newly added
  backlogState?: BoardPanelCfgTaskTypeFilter;
  // The rule fields below are optional and stored as plain strings/booleans:
  // a closed union would make typia reject a value a newer client adds (see
  // validation-fn.ts). Read them through `panelToCriteria`; unknown values
  // mean "any". Absent = no rule.
  // Planned date: a `TaskDateRule` ('today', 'thisWeek', …).
  dueState?: string;
  // Deadline: a `TaskDateRule`.
  deadlineState?: string;
  // 'none' or a minimum in ms, e.g. '1800000'.
  estimateRule?: string;
  timeSpentRule?: string;
  // 'none', '1' (low), '2', '3' (high).
  priorityRule?: string;
  isUntagged?: boolean;
  // Sort keys `sortBy` can't hold ('deadline', 'timeSpent', 'priority',
  // 'tag'); `sortBy` wins when both are set. See `getPanelSortKey`.
  sortKey?: string;
}

export interface BoarFieldsToRemove {
  tagIds?: string[];
}

export interface BoardPanelCfg extends BoardSrcCfg {
  id: string;
  title: string;
  taskIds: string[];
}

export interface BoardCfg {
  id: string;
  title: string;
  // 1 (or less) = a list: sections stacked; more = a board with that many
  // columns.
  cols: number;
  panels: BoardPanelCfg[];
  // Optional since newly added: the column count a list (`cols <= 1`) gets
  // back when it becomes a board again. Read only while a list and only as an
  // integer >= 2 (see `getLayoutChanges`); stale and unread while a board.
  boardCols?: number;
}
