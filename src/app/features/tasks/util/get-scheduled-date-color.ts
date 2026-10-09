import { getDbDateStr, isValidDBDateStr } from '../../../util/get-db-date-str';
import { Task } from '../task.model';

export type ScheduledDateColor = 'overdue' | '';

/** Only overdue schedules get a color; uses the logical day for timed tasks. */
export const getScheduledDateColor = (
  task: Pick<Task, 'dueDay' | 'dueWithTime' | 'isDone'>,
  today: string,
  startOfNextDayDiffMs: number,
  now: number,
): ScheduledDateColor => {
  if (task.isDone) return '';
  const dueDate = task.dueWithTime
    ? getDbDateStr(new Date(task.dueWithTime - startOfNextDayDiffMs))
    : task.dueDay;
  if (!dueDate || !isValidDBDateStr(dueDate)) return '';
  if (dueDate < today || (task.dueWithTime && task.dueWithTime <= now)) {
    return 'overdue';
  }
  return '';
};
