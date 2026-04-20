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
  // projectId?: string;
  includedTagIds: string[];
  excludedTagIds: string[];
  // Absent = 'all' (today's behavior): all required tags must match.
  includedTagsMatch?: BoardMatchMode;
  // Absent = 'any' (today's behavior): exclude on any match.
  excludedTagsMatch?: BoardMatchMode;
  projectId?: string;
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
