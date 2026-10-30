/**
 * Normalized intermediate shape between the TickTick CSV backup and the Super
 * Productivity import plan. Everything lossy is flagged per task so the
 * preview/summary UI can honestly report what will be / was dropped.
 */

export interface TickTickProject {
  /** TickTick has no list id in the CSV — `Folder Name` + `List Name` is the key */
  extId: string;
  title: string;
  folderTitle: string;
  isInbox: boolean;
  /** distinct kanban columns, which are dropped */
  columnCount: number;
  /** number of imported values shortened to the parser's safe limits */
  truncatedFieldCount?: number;
}

export interface TickTickTask {
  extId: string;
  projectExtId: string;
  /** null = root task; set = direct sub-task after depth-flattening (SP nests 2 levels) */
  parentExtId: string | null;
  title: string;
  notes: string;
  isDone: boolean;
  tags: string[];
  /** Raw TickTick value: 5 = high, 3 = medium, 1 = low, 0 = none */
  priority: number;
  /** YYYY-MM-DD — mutually exclusive with dueWithTime */
  dueDay: string | null;
  /** unix ms — mutually exclusive with dueDay */
  dueWithTime: number | null;
  isRecurring: boolean;
  hasReminder: boolean;
  /** original depth was ≥ 2 and the task was re-parented to its root ancestor */
  wasDemoted: boolean;
  /** number of imported values shortened to the parser's safe limits */
  truncatedFieldCount?: number;
}

export interface TickTickImportModel {
  projects: TickTickProject[];
  /** In final creation order: a parent always precedes its children. */
  tasks: TickTickTask[];
  /** rows skipped because they were completed, archived or won't-do */
  skippedClosedCount: number;
  /** lists skipped because all their tasks were closed — no empty projects */
  skippedListCount: number;
}
