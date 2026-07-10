/**
 * Normalized intermediate shape between the Todoist sync payload and the
 * Super Productivity import plan. Everything lossy is flagged per task so the
 * preview/summary UI can honestly report what will be / was dropped.
 */

export interface TodoistProject {
  extId: string;
  title: string;
  parentExtId: string | null;
  isInbox: boolean;
  childOrder: number;
  /** number of imported values shortened to the parser's safe limits */
  truncatedFieldCount?: number;
}

export interface TodoistSection {
  extId: string;
  projectExtId: string;
  title: string;
}

export interface TodoistTask {
  extId: string;
  projectExtId: string;
  /** null = root task; set = direct sub-task after depth-flattening (SP nests 2 levels) */
  parentExtId: string | null;
  title: string;
  notes: string;
  labels: string[];
  /** Raw Todoist API value: 4 = UI p1 (highest) … 1 = default/none */
  apiPriority: number;
  /** YYYY-MM-DD — mutually exclusive with dueWithTime */
  dueDay: string | null;
  /** unix ms — mutually exclusive with dueDay */
  dueWithTime: number | null;
  /** ms, from minute-based durations only */
  timeEstimate: number | null;
  isRecurring: boolean;
  /** original depth was ≥ 2 and the task was re-parented to its root ancestor */
  wasDemoted: boolean;
  /** had a day-based duration that is deliberately not imported */
  isDayDurationSkipped: boolean;
  hasAssignee: boolean;
  /** comment file attachments (URLs kept in notes, files not imported) */
  attachmentCount: number;
  /** number of imported values shortened to the parser's safe limits */
  truncatedFieldCount?: number;
}

export interface TodoistImportModel {
  projects: TodoistProject[];
  sections: TodoistSection[];
  /**
   * In final creation order: per project, root tasks (sorted by section order,
   * then child order) each immediately followed by their sub-tasks in DFS
   * order — a parent always precedes its children.
   */
  tasks: TodoistTask[];
}
