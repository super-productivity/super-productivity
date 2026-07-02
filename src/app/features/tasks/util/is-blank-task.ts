import { Task, TaskWithSubTasks } from '../task.model';

/**
 * Returns true when a task carries no user data worth undoing: an empty title
 * plus no notes, time tracking, estimate, attachments, issue link, scheduling,
 * deadline, repeat config or non-blank sub tasks.
 *
 * Used to suppress the undo-delete snack when an accidentally created blank
 * task (or sub task) is deleted right away. Context-derived fields like
 * `tagIds` and `projectId` are intentionally ignored — they are not data the
 * user would lose.
 */
export const isBlankTask = (task: Task | TaskWithSubTasks): boolean => {
  const subTasks = (task as TaskWithSubTasks).subTasks;
  return (
    // Corrupted/legacy tasks can lack a title entirely; treat that as blank
    // instead of crashing the callers (e.g. the delete-undo snack effect).
    !task.title?.trim() &&
    !task.notes?.trim() &&
    !task.timeSpent &&
    !task.timeEstimate &&
    !task.attachments?.length &&
    !task.issueId &&
    !task.reminderId &&
    !task.repeatCfgId &&
    !task.dueWithTime &&
    !task.dueDay &&
    !task.deadlineDay &&
    !task.deadlineWithTime &&
    (!subTasks?.length || subTasks.every(isBlankTask))
  );
};
