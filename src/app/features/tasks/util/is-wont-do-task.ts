import { Task } from '../task.model';

type DoneFields = Pick<Task, 'isDone' | 'doneOn' | 'wontDoOn'>;

/**
 * Whether a task was finished as "won't do" rather than completed: it is done
 * and its `wontDoOn` matches its `doneOn`. Every completion stamps a new
 * `doneOn` and reopening clears it, on released clients too, so a `wontDoOn`
 * left behind by a later reopen or completion does not count again (except
 * after the plugin batch update, which toggles `isDone` but keeps `doneOn`).
 */
export const isWontDoTask = (task: DoneFields): boolean =>
  !!task.isDone && task.wontDoOn != null && task.wontDoOn === task.doneOn;

/** Whether a task was actually completed: done, and not finished as "won't do". */
export const isCompletedTask = (task: DoneFields): boolean =>
  !!task.isDone && !isWontDoTask(task);

/** The changes that finish a task as "won't do" at `now`. */
export const getWontDoChanges = (
  now: number,
): Required<Pick<Task, 'isDone' | 'doneOn' | 'wontDoOn'>> => ({
  isDone: true,
  doneOn: now,
  wontDoOn: now,
});
