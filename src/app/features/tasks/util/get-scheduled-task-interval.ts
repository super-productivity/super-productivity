import { getTimeLeftForTask } from '../../../util/get-time-left-for-task';
import { TaskWithDueTime } from '../task.model';

type TimedTask = Pick<
  TaskWithDueTime,
  'dueWithTime' | 'timeEstimate' | 'timeSpent' | 'subTaskIds'
> & { id?: string };

export const getScheduledTaskInterval = (
  task: TimedTask,
  currentTaskId: string | null,
  now: number,
  fallbackDuration = 0,
): { start: number; end: number } => {
  const bookedStart = task.dueWithTime;
  if (task.id === currentTaskId && bookedStart <= now) {
    const end = bookedStart + (Math.max(0, task.timeEstimate) || 0);
    return { start: Math.min(now, end), end };
  }

  const duration = Math.max(0, getTimeLeftForTask(task)) || fallbackDuration;
  return { start: bookedStart, end: bookedStart + duration };
};
