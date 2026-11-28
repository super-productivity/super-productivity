import { TaskWithDueTime } from '../task.model';
import { getScheduledTaskInterval } from './get-scheduled-task-interval';

const MIN_TASK_DURATION = 60 * 1000;

export const getTimeConflictTaskIds = (
  tasks: TaskWithDueTime[],
  currentTaskId: string | null = null,
  now = Date.now(),
): Set<string> => {
  const relevantTasks = tasks
    .filter((task) => !task.isDone)
    .map((task) => ({
      id: task.id,
      ...getScheduledTaskInterval(task, currentTaskId, now, MIN_TASK_DURATION),
    }))
    .filter(({ start, end }) => start < end)
    .sort((a, b) => a.start - b.start);

  const conflictingIds = new Set<string>();
  let latestEndingTask: (typeof relevantTasks)[number] | undefined;

  for (const task of relevantTasks) {
    // Sorted starts mean only the furthest previous end is needed. Any other
    // overlapping previous task was already marked when it entered this scan.
    if (latestEndingTask && task.start < latestEndingTask.end) {
      conflictingIds.add(latestEndingTask.id);
      conflictingIds.add(task.id);
    }
    if (!latestEndingTask || task.end > latestEndingTask.end) {
      latestEndingTask = task;
    }
  }

  return conflictingIds;
};
