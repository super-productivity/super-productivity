import { Task } from '../task.model';

export const calcSubTaskProgress = (subTasks: readonly Task[]): number => {
  if (subTasks.length === 0) {
    return 0;
  }

  const doneSubTasksCount = subTasks.filter((subTask) => subTask.isDone).length;
  return (doneSubTasksCount / subTasks.length) * 100;
};
