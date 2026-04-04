/** Minimal task type matching the Super Productivity REST API responses. */
export interface Task {
  id: string;
  title: string;
  notes?: string;
  isDone: boolean;
  projectId: string | null;
  tagIds: string[];
  parentId?: string | null;
  created: number;
  updated?: number;
  subTaskIds: string[];
  timeEstimate: number;
  timeSpent: number;
  timeSpentOnDay?: { [key: string]: number };
  dueDay?: string | null;
  dueWithTime?: number | null;
  deadlineDay?: string | null;
  deadlineWithTime?: number | null;
  doneOn?: number | null;
  remindAt?: number | null;
  repeatCfgId?: string | null;
  issueId?: string | null;
  issueProviderId?: string | null;
  issueType?: string | null;
  issueLastUpdated?: number | null;
  issuePoints?: number | null;
}

export interface Project {
  id: string;
  title: string;
  isArchived?: boolean;
  isHiddenFromMenu?: boolean;
  isEnableBacklog?: boolean;
  taskIds: string[];
  backlogTaskIds: string[];
  noteIds: string[];
  folderId?: string | null;
  icon?: string | null;
}

export interface Tag {
  id: string;
  title: string;
  color?: string | null;
  icon?: string | null;
  created: number;
  updated?: number;
  taskIds: string[];
}

export interface StatusResponse {
  currentTask: Task | null;
  currentTaskId: string | null;
  taskCount: number;
}

export interface HealthResponse {
  server: string;
  rendererReady: boolean;
}

export type TaskSource = 'active' | 'archived' | 'all';

export interface ListTasksOptions {
  query?: string;
  projectId?: string;
  tagId?: string;
  source?: TaskSource;
  includeDone?: boolean;
}

/** Fields allowed when creating a task. */
export interface TaskCreateFields {
  notes?: string;
  projectId?: string | null;
  tagIds?: string[];
  timeEstimate?: number;
  dueDay?: string | null;
  dueWithTime?: number | null;
  isDone?: boolean;
}

/** Fields allowed when updating a task via the REST API. */
export interface TaskUpdateFields {
  title?: string;
  notes?: string;
  isDone?: boolean;
  timeEstimate?: number;
  timeSpent?: number;
  projectId?: string | null;
  tagIds?: string[];
  dueDay?: string | null;
  dueWithTime?: number | null;
  plannedAt?: number | null;
}
