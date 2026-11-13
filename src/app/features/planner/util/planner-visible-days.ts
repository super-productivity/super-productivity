import { PlannerDay } from '../planner.model';

/** `Date.getDay()` of a `YYYY-MM-DD` string, read at noon so a DST gap cannot shift the date. */
const weekDayOf = (dayStr: string): number => {
  const [year, month, day] = dayStr.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0).getDay();
};

/** Is `dayStr` one of the locale's weekend days (0 = Sunday)? */
export const isWeekendDayStr = (
  dayStr: string,
  weekendDays: readonly number[],
): boolean => weekendDays.includes(weekDayOf(dayStr));

/** A day with nothing planned on it: hiding it loses no information. */
export const isEmptyPlannerDay = (day: PlannerDay): boolean =>
  day.tasks.length === 0 &&
  day.deadlineTasks.length === 0 &&
  day.noStartTimeRepeatProjections.length === 0 &&
  day.allDayEvents.length === 0 &&
  day.scheduledIItems.length === 0;

/**
 * Drops empty weekend columns when the user hid weekends (#7240).
 *
 * Two days always survive: a weekend day that holds work, so nothing planned
 * disappears from the view, and today, because the Today list and the overdue
 * items are only attached to the day whose date is today — dropping that column
 * would strand them.
 */
export const hideEmptyWeekendDays = (
  days: readonly PlannerDay[],
  weekendDays: readonly number[],
): PlannerDay[] =>
  days.filter(
    (day) =>
      !isWeekendDayStr(day.dayDate, weekendDays) ||
      !isEmptyPlannerDay(day) ||
      day.isToday === true,
  );
