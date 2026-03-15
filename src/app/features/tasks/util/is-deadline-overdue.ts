import { Task } from '../task.model';

export const isDeadlineOverdue = (task: Task, todayStr: string): boolean => {
  if (task.isDone) return false;
  if (task.deadlineWithTime) return task.deadlineWithTime < Date.now();
  if (task.deadlineDay) return task.deadlineDay < todayStr;
  return false;
};
