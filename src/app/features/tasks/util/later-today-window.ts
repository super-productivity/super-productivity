import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';
import { TaskWithSubTasks } from '../task.model';

/**
 * Last millisecond of `todayStr`, honoring the configurable start-of-next-day
 * offset (with a 4am start of day, 1am still belongs to the previous day).
 */
export const getEndOfTodayTime = (
  todayStr: string,
  startOfNextDayDiffMs: number,
): number => {
  const todayDate = dateStrToUtcDate(todayStr);
  todayDate.setHours(23, 59, 59, 999);
  return todayDate.getTime() + startOfNextDayDiffMs;
};

/**
 * "Later Today" only holds what is still ahead of us today. A start time that
 * has already passed makes the appointment current, not upcoming, so it belongs
 * in the main list instead.
 */
export const isInLaterTodayWindow = (
  startTime: number | null | undefined,
  now: number,
  endOfTodayTime: number,
): boolean => !!startTime && startTime >= now && startTime <= endOfTodayTime;

/**
 * Whether a "Later Today" entry is still upcoming. A parent is listed there for
 * its own start time OR for an undone scheduled subtask, so it stays as long as
 * either is ahead of `now`.
 */
export const isLaterTodayEntryUpcoming = (
  task: TaskWithSubTasks,
  now: number,
  endOfTodayTime: number,
): boolean =>
  isInLaterTodayWindow(task.dueWithTime, now, endOfTodayTime) ||
  task.subTasks.some(
    (subTask) =>
      !subTask.isDone && isInLaterTodayWindow(subTask.dueWithTime, now, endOfTodayTime),
  );
