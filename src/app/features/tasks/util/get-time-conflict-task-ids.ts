import { TaskWithDueTime } from '../task.model';
import { getTimeLeftForTask } from '../../../util/get-time-left-for-task';

const MIN_TASK_DURATION = 60 * 1000;

export const getTimeConflictTaskIds = (tasks: TaskWithDueTime[]): Set<string> => {
  const relevantTasks = tasks
    .filter((task) => !task.isDone)
    .sort((a, b) => a.dueWithTime - b.dueWithTime);

  const conflictingIds = new Set<string>();
  let latestEndingTask: TaskWithDueTime | undefined;
  let latestEnd = -Infinity;

  for (const task of relevantTasks) {
    // Sorted starts mean only the furthest previous end is needed. Any other
    // overlapping previous task was already marked when it entered this scan.
    if (latestEndingTask && task.dueWithTime < latestEnd) {
      conflictingIds.add(latestEndingTask.id);
      conflictingIds.add(task.id);
    }
    const taskEnd = _getTaskEnd(task);
    if (taskEnd > latestEnd) {
      latestEnd = taskEnd;
      latestEndingTask = task;
    }
  }

  return conflictingIds;
};

const _getTaskEnd = (task: TaskWithDueTime): number =>
  task.dueWithTime + Math.max(getTimeLeftForTask(task), MIN_TASK_DURATION);
