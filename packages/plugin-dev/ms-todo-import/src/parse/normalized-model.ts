import { PluginTaskRepeatCfgSchedule } from '@super-productivity/plugin-api';

/**
 * Normalized intermediate shape between the Microsoft Graph To Do payload and
 * the Super Productivity import plan. Everything lossy is flagged per task so
 * the preview/summary UI can honestly report what will be / was dropped.
 */

export interface MsTodoList {
  extId: string;
  title: string;
  /** the built-in "Tasks" list */
  isDefault: boolean;
  /** the built-in "Flagged email" list — unchecked in the preview by default */
  isFlaggedEmails: boolean;
  /** number of imported values shortened to the parser's safe limits */
  truncatedFieldCount?: number;
}

export interface MsTodoTask {
  extId: string;
  projectExtId: string;
  created?: number;
  /** null = task; set = a step (checklist item) imported as sub-task */
  parentExtId: string | null;
  title: string;
  notes: string;
  /** checked steps are imported as done */
  isDone: boolean;
  categories: string[];
  /** importance `high` (the star) */
  isImportant: boolean;
  /** YYYY-MM-DD; MS To Do due dates have no time */
  dueDay: string | null;
  isRecurring: boolean;
  /**
   * The recurrence as a repeat schedule, when it maps exactly. `notes` then
   * leaves the rule out; `notesWithRule` keeps it for when the repeat cannot
   * be set up.
   */
  repeat: { schedule: PluginTaskRepeatCfgSchedule; notesWithRule: string } | null;
  hasReminder: boolean;
  hasAttachments: boolean;
  /** number of imported values shortened to the parser's safe limits */
  truncatedFieldCount?: number;
}

export interface MsTodoImportModel {
  projects: MsTodoList[];
  /**
   * In final creation order: per list, tasks each immediately followed by
   * their steps — a parent always precedes its children.
   */
  tasks: MsTodoTask[];
}

export const getTasksToImport = (
  tasks: MsTodoTask[],
  includeCompletedTasks: boolean,
): MsTodoTask[] => {
  if (includeCompletedTasks) {
    return tasks;
  }
  const completedTaskIds = new Set(
    tasks.filter((task) => !task.parentExtId && task.isDone).map((task) => task.extId),
  );
  return tasks.filter(
    (task) =>
      !completedTaskIds.has(task.extId) &&
      !(task.parentExtId && completedTaskIds.has(task.parentExtId)),
  );
};
