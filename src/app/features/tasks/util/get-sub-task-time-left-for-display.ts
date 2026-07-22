import { Task } from '../task.model';

const MINUTE = 60000;

const floorToFullMinute = (ms: number): number => Math.floor(ms / MINUTE) * MINUTE;

/**
 * The time left to show next to a parent task's summed time spent.
 *
 * Both cells are rendered rounded down to full minutes. Rounding them separately
 * loses the partial minute they share, so the pair reads a minute short of the work
 * it represents (#9190). Deriving the left cell from the floored pair keeps
 * `spent + left` on screen equal to the rounded down real total instead.
 *
 * The time left is summed here rather than read from the parent's stored
 * `timeEstimate`, which holds the same sum but is only refreshed on estimate edits,
 * done toggles and structural changes — a tracking tick updates the parent's time
 * spent alone. Reading it would leave the time left standing still while time is
 * tracked, and make the pair jump by a minute as the time spent crosses one. The
 * spec pins this sum against the reducer's own output.
 *
 * The pair adds up to the original estimate only while no sub task is done or over
 * it: a done sub task's unspent estimate is dropped and an over-run is clamped to 0,
 * while the spent sum keeps counting both. After that it adds up to time spent plus
 * what is genuinely left, which no rounding rule could recover anyway.
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
