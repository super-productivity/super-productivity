// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- grandfathered layer-boundary debt
import { Task } from '../features/tasks/task.model';

export const getTimeLeftForTask = (task: Task): number => {
  if (task.subTaskIds.length > 0) {
    return task.timeEstimate;
  }
  return Math.max(0, task.timeEstimate - task.timeSpent) || 0;
};

export const getTimeLeftForTasks = (tasks: Task[]): number => {
  return tasks.reduce((acc, task) => acc + getTimeLeftForTask(task), 0);
};

export const getTimeLeftForTaskWithMinVal = (task: Task, minVal: number): number => {
  if (task.subTaskIds.length > 0) {
    return Math.max(minVal, task.timeEstimate);
  }
  if (typeof task.timeSpent !== 'number') {
    throw new Error('timeSpent is not a number');
  }
  return Math.max(minVal, task.timeEstimate - task.timeSpent) || 0;
};

export const getTimeLeftForTasksWithMinVal = (tasks: Task[], minVal: number): number => {
  return tasks.reduce((acc, task) => acc + Math.max(getTimeLeftForTask(task), minVal), 0);
};
