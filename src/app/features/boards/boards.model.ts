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

export enum BoardPanelCfgDeadlineState {
  All = 1,
  HasDeadline = 2,
  NoDeadline = 3,
}

export type BoardSortField = 'dueDate' | 'created' | 'title' | 'timeEstimate';
export type BoardMatchMode = 'all' | 'any';
export type BoardDateTimeframeType =
  | 'all'
  | 'today'
  | 'tomorrow'
  | 'next7Days'
  | 'nextNDays'
  | 'atLeastNDaysFuture'
  | 'nextWeek'
  | 'nextMonth'
  | 'customDate'
  | 'customRange';

export interface BoardDateTimeframeCfg {
  type: BoardDateTimeframeType;
  days?: number;
  customDate?: string;
  customStart?: string;
  customEnd?: string;
}

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
  scheduledTimeframe?: BoardDateTimeframeCfg;
  deadlineState?: BoardPanelCfgDeadlineState;
  deadlineTimeframe?: BoardDateTimeframeCfg;
  isParentTasksOnly: boolean;
  // Absent = manual order (user-controlled taskIds).
  sortBy?: BoardSortField;
  sortDir?: 'asc' | 'desc';
  /** @deprecated Migrated to sortBy/sortDir on load and scrubbed on save. */
  sortByDue?: 'off' | 'asc' | 'desc';
  // optional since newly added
  backlogState?: BoardPanelCfgTaskTypeFilter;
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
  cols: number;
  panels: BoardPanelCfg[];
}
