import { TaskWithSubTasks } from '../tasks/task.model';

const getEstimateRemainingForTask = (task: TaskWithSubTasks): number => {
  if (!task || task.isDone) {
    return 0;
  }
  if (task.subTasks?.length) {
    return task.subTasks.reduce(
      (acc: number, subTask: TaskWithSubTasks) =>
        acc + getEstimateRemainingForTask(subTask),
      0,
    );
  }
  const estimateRemaining = +task.timeEstimate - +task.timeSpent;
  return estimateRemaining > 0 ? estimateRemaining : 0;
};

export const mapEstimateRemainingFromTasks = (tasks: TaskWithSubTasks[]): number =>
  tasks &&
  tasks.length &&
  tasks.reduce((acc: number, task: TaskWithSubTasks): number => {
    return acc + getEstimateRemainingForTask(task);
  }, 0);

const hasOpenLeafTask = (task: TaskWithSubTasks): boolean =>
  !!task &&
  !task.isDone &&
  (!task.subTasks?.length || task.subTasks.some((subTask) => hasOpenLeafTask(subTask)));

export const hasTasksToWorkOn = (tasks: TaskWithSubTasks[]): boolean => {
  const _tasksToWorkOn = tasks.filter((t) => hasOpenLeafTask(t));
  return _tasksToWorkOn && _tasksToWorkOn.length > 0;
};
