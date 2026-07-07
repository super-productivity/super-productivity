import { TaskWithSubTasks } from '../tasks/task.model';

/**
 * Order completed tasks by when they were completed, newest first, so the most
 * recently finished task is at the top of the Done list. Copies the input since
 * it usually comes from a memoized selector that must not be mutated. Tasks
 * without a `doneOn` timestamp sort last.
 */
export const sortDoneTasksByDoneDate = (tasks: TaskWithSubTasks[]): TaskWithSubTasks[] =>
  [...tasks].sort((a, b) => (b.doneOn ?? 0) - (a.doneOn ?? 0));

export const mapEstimateRemainingFromTasks = (tasks: TaskWithSubTasks[]): number =>
  tasks &&
  tasks.length &&
  tasks.reduce((acc: number, task: TaskWithSubTasks): number => {
    if (!task) {
      return acc;
    }
    let estimateRemaining;
    if (task.subTasks && task.subTasks.length > 0) {
      estimateRemaining = task.subTasks.reduce((subAcc, subTask) => {
        if (!subTask) {
          return subAcc;
        }
        const estimateRemainingSub = +subTask.timeEstimate - +subTask.timeSpent;
        const isTrackValSub = estimateRemainingSub > 0 && !subTask.isDone;
        return subAcc + (isTrackValSub ? estimateRemainingSub : 0);
      }, 0);
    } else {
      estimateRemaining = +task.timeEstimate - +task.timeSpent;
    }
    const isTrackVal = estimateRemaining > 0 && !task.isDone;
    return acc + (isTrackVal ? estimateRemaining : 0);
  }, 0);

export const hasTasksToWorkOn = (tasks: TaskWithSubTasks[]): boolean => {
  const _tasksToWorkOn = tasks.filter((t) => {
    if (!t) {
      return false;
    }
    return (
      !t.isDone &&
      (!t.subTasks ||
        t.subTasks.length === 0 ||
        t.subTasks.filter((st) => st && !st.isDone).length > 0)
    );
  });
  return _tasksToWorkOn && _tasksToWorkOn.length > 0;
};
