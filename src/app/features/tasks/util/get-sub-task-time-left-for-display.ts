import { Task } from '../task.model';

const MINUTE = 60000;

const floorToFullMinute = (ms: number): number => Math.floor(ms / MINUTE) * MINUTE;

/**
 * The time left to show next to a parent task's summed time spent. Both cells are
 * rendered rounded down, so the left one is derived from the floored pair instead of
 * being rounded on its own — otherwise the partial minute they share is dropped twice
 * and the pair reads a minute short of the work it represents (#9190).
 *
 * Two things that look like simplifications but are not:
 * - the two values are NOT always complementary. `timeEstimate` drops done sub tasks
 *   and clamps over-runs to 0 while the spent sum counts both, so rounding the left
 *   cell up instead reads a minute long in those states.
 * - the time left is summed here rather than read from the parent's stored
 *   `timeEstimate`, which holds the same sum but is not refreshed by a tracking tick,
 *   so it would stand still while time is tracked.
 */
export const getSubTaskTimeLeftForDisplay = (subTasks: Task[]): number => {
  if (!subTasks?.length) {
    return 0;
  }
  // single pass: this runs per parent row on a hot path
  let timeSpent = 0;
  let timeLeft = 0;
  for (const subTask of subTasks) {
    timeSpent += subTask.timeSpent;
    timeLeft += subTask.isDone
      ? 0
      : Math.max(0, subTask.timeEstimate - subTask.timeSpent);
  }
  return floorToFullMinute(timeSpent + timeLeft) - floorToFullMinute(timeSpent);
};
