import { Task } from '../task.model';

/**
 * Whether a task was finished as "won't do" rather than completed. Checks
 * `isDone` too, so a stale `isWontDo` left on a reopened task is ignored.
 */
export const isWontDoTask = (task: Pick<Task, 'isDone' | 'isWontDo'>): boolean =>
  !!task.isDone && !!task.isWontDo;

/**
 * The `isWontDo` value a task should have after `changes` are applied to it.
 * Un-doing a task clears it. Otherwise an `isWontDo` in `changes` wins. Without
 * one, marking an already done task as done again keeps it, and finishing a
 * task leaves it unset. An `undefined` value counts as absent, since it doesn't
 * survive the op's JSON round-trip.
 */
export const getNextIsWontDo = (
  task: Pick<Task, 'isDone' | 'isWontDo'>,
  changes: Partial<Pick<Task, 'isDone' | 'isWontDo'>>,
): boolean => {
  const isDone = changes.isDone ?? task.isDone;
  if (!isDone) {
    return false;
  }
  if (changes.isWontDo !== undefined) {
    return changes.isWontDo;
  }
  return task.isDone ? !!task.isWontDo : false;
};

/** Whether a task was actually completed: done, and not finished as "won't do". */
export const isCompletedTask = (task: Pick<Task, 'isDone' | 'isWontDo'>): boolean =>
  !!task.isDone && !task.isWontDo;
