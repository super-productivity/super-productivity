import { Task } from '../task.model';
import { ChecklistProgress } from '../../markdown-checklist/get-checklist-progress';

/**
 * Counts done vs. total sub tasks for the collapsed-sub-tasks badge (#7057).
 * Returns null without sub tasks, so callers can hide the badge on a falsy value.
 * Runs on the task hot path, so it counts in a single pass.
 */
export const getSubTaskProgress = (
  subTasks?: readonly Pick<Task, 'isDone'>[] | null,
): ChecklistProgress | null => {
  if (!subTasks?.length) {
    return null;
  }
  let done = 0;
  for (const subTask of subTasks) {
    if (subTask.isDone) {
      done++;
    }
  }
  return { done, total: subTasks.length };
};
