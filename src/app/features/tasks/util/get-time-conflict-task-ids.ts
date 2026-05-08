import { TaskWithDueTime } from '../task.model';
import { getTimeLeftForTask } from '../../../util/get-time-left-for-task';

const MIN_TASK_DURATION = 60 * 1000;

export const getTimeConflictTaskIds = (
  tasks: TaskWithDueTime[],
  isSameDay: (timestamp: number) => boolean,
): Set<string> => {
  const relevantTasks = tasks
    .filter((task) => !task.isDone && isSameDay(task.dueWithTime))
    .sort((a, b) => a.dueWithTime - b.dueWithTime);

  const conflictingIds = new Set<string>();

  for (let i = 0; i < relevantTasks.length; i++) {
    const task = relevantTasks[i];
    const taskEnd = _getTaskEnd(task);

    for (let j = i + 1; j < relevantTasks.length; j++) {
      const nextTask = relevantTasks[j];
      if (nextTask.dueWithTime >= taskEnd) {
        break;
      }

      conflictingIds.add(task.id);
      conflictingIds.add(nextTask.id);
    }
  }

  return conflictingIds;
};

const _getTaskEnd = (task: TaskWithDueTime): number =>
  task.dueWithTime + Math.max(getTimeLeftForTask(task), MIN_TASK_DURATION);
