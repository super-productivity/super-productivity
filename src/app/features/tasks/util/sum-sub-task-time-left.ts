import { Task } from '../task.model';

/**
 * The work still outstanding across sub tasks: a done sub task contributes nothing,
 * and one that has run over its estimate is clamped at 0 rather than going negative.
 *
 * This is the value a parent task's `timeEstimate` holds. It is shared with the task
 * row so what is rendered cannot drift from what the reducer writes.
 */
export const sumSubTaskTimeLeft = (subTasks: Task[]): number =>
  subTasks?.length
    ? subTasks.reduce(
        (acc, subTask) =>
          acc +
          (subTask.isDone ? 0 : Math.max(0, subTask.timeEstimate - subTask.timeSpent)),
        0,
      )
    : 0;
