import { Task, TaskWithSubTasks } from '../tasks/task.model';
import { isTodayWithOffset } from '../../util/is-today.util';

/**
 * Order completed tasks by when they were completed, newest first, so the most
 * recently finished task is at the top of the Done list. Copies the input since
 * it usually comes from a memoized selector that must not be mutated. Tasks
 * without a `doneOn` timestamp sort last.
 */
export const sortDoneTasksByDoneDate = <T extends Pick<Task, 'doneOn'>>(
  tasks: T[],
): T[] => [...tasks].sort((a, b) => (b.doneOn ?? 0) - (a.doneOn ?? 0));

// Range-guarded: `isTodayWithOffset` throws on an invalid timestamp, and one
// corrupt task would otherwise error the whole Today Done list stream.
const isValidTsToday = (
  ts: number | null | undefined,
  todayStr: string,
  startOfNextDayDiffMs: number,
): boolean =>
  !!ts &&
  new Date(ts).getTime() > 0 &&
  isTodayWithOffset(ts, todayStr, startOfNextDayDiffMs);

/**
 * Whether a done task belongs to Today's Done list: due today (by day or time)
 * or completed today. Done tasks from earlier days stay in their project's Done
 * list until archived, so Today's list doesn't grow with every unarchived one.
 */
export const isDoneTaskForToday = (
  task: Pick<Task, 'dueDay' | 'dueWithTime' | 'doneOn'>,
  todayStr: string,
  startOfNextDayDiffMs: number,
): boolean =>
  task.dueDay === todayStr ||
  isValidTsToday(task.dueWithTime, todayStr, startOfNextDayDiffMs) ||
  isValidTsToday(task.doneOn, todayStr, startOfNextDayDiffMs);

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
