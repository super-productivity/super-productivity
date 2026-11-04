import { Signal, untracked } from '@angular/core';
import { getDbDateStr, isValidDBDateStr } from '../../../util/get-db-date-str';
import { Task } from '../task.model';

export type ScheduledDateColor = 'overdue' | '';

/** Only overdue schedules get a color; uses the logical day for timed tasks. */
export const getScheduledDateColor = (
  task: Pick<Task, 'dueDay' | 'dueWithTime' | 'isDone'>,
  today: string,
  startOfNextDayDiffMs: number,
  now: number,
): ScheduledDateColor => {
  if (task.isDone) return '';
  const dueDate = task.dueWithTime
    ? getDbDateStr(new Date(task.dueWithTime - startOfNextDayDiffMs))
    : task.dueDay;
  if (!dueDate || !isValidDBDateStr(dueDate)) return '';
  if (dueDate < today || (task.dueWithTime && task.dueWithTime <= now)) {
    return 'overdue';
  }
  return '';
};

// The minute clock changes up to a second after each minute starts, so two
// minutes ahead the row still switches to the second clock before it's due.
const SECOND_CLOCK_LEAD_MS = 2 * 60 * 1000;

/**
 * Reads the display clock for a timed task's color, but depends on it only
 * as often as the color can change: once a minute while the task is due
 * later, every second in its last two minutes, and not at all once it is due,
 * since it then stays overdue. Every row that depends on the second clock
 * costs a change detection pass each second; thousands of rows otherwise do.
 */
export const readClockUntilDue = (
  clock: Signal<number>,
  clockMinute: Signal<number>,
  dueWithTime: number,
): number => {
  const now = untracked(clock);
  if (dueWithTime <= now) return now;
  if (dueWithTime - now > SECOND_CLOCK_LEAD_MS) {
    clockMinute();
    return now;
  }
  return clock();
};
