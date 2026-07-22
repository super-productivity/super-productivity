import { Task } from '../task.model';
import { getSubTasksTotalTimeSpent } from '../pipes/sub-task-total-time-spent.pipe';
import { sumSubTaskTimeLeft } from './sum-sub-task-time-left';

const MINUTE = 60000;

const floorToFullMinute = (ms: number): number => Math.floor(ms / MINUTE) * MINUTE;

/**
 * The time left to show next to a parent task's summed time spent.
 *
 * While the two cells are two halves of one total, the right one is derived from the
 * floored pair: both floor to minutes, so rounding them apart drops the partial
 * minute they share twice and the pair reads a minute short (#9190). Rounding up
 * instead would read a minute long as soon as they stop being two halves.
 *
 * They stop being that once a sub task is done or over its estimate, because the
 * spent sum keeps counting it while the time left does not. Borrowing the partial
 * minute there would make the cell flip up and down twice per tracked minute, so it
 * falls back to the plain floored remainder — which is what it always showed.
 */
export const getSubTaskTimeLeftForDisplay = (subTasks: Task[]): number => {
  const timeLeft = sumSubTaskTimeLeft(subTasks);
  const isOneTotal = subTasks?.every(
    (subTask) => !subTask.isDone && subTask.timeSpent <= subTask.timeEstimate,
  );
  if (!isOneTotal) {
    return floorToFullMinute(timeLeft);
  }
  const timeSpent = getSubTasksTotalTimeSpent(subTasks);
  return floorToFullMinute(timeSpent + timeLeft) - floorToFullMinute(timeSpent);
};
