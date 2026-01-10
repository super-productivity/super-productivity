import { TASK_REPEAT_WEEKDAY_MAP, TaskRepeatCfg } from '../task-repeat-cfg.model';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';

/**
 * Gets the first valid repeat occurrence date based on the repeat configuration.
 * This is used when initially creating a repeat config to determine when the first
 * task instance should be scheduled.
 *
 * Unlike getNextRepeatOccurrence which finds the next occurrence AFTER lastTaskCreationDay,
 * this function finds the first occurrence ON OR AFTER the startDate.
 *
 * @param taskRepeatCfg The repeat configuration
 * @param today The current date to check against
 * @returns The first valid occurrence date, or null if none found
 */
export const getFirstRepeatOccurrence = (
  taskRepeatCfg: TaskRepeatCfg,
  today: Date = new Date(),
): Date | null => {
  if (!Number.isInteger(taskRepeatCfg.repeatEvery) || taskRepeatCfg.repeatEvery < 1) {
    return null;
  }

  const startDateStr = taskRepeatCfg.startDate || '1970-01-01';
  const startDateDate = dateStrToUtcDate(startDateStr);

  // Use noon (12:00) to avoid DST issues
  const checkDate = new Date(today);
  checkDate.setHours(12, 0, 0, 0);
  startDateDate.setHours(12, 0, 0, 0);

  // If start date is in the future, start checking from start date
  if (startDateDate > checkDate) {
    checkDate.setTime(startDateDate.getTime());
  }

  switch (taskRepeatCfg.repeatCycle) {
    case 'DAILY': {
      // For daily, the first occurrence is today (or startDate if in future)
      return checkDate;
    }

    case 'WEEKLY': {
      const maxDaysToCheck = 7; // Only need to check one week

      for (let i = 0; i < maxDaysToCheck; i++) {
        const dayOfWeek = checkDate.getDay();
        const dayStr = TASK_REPEAT_WEEKDAY_MAP[
          dayOfWeek
        ] as keyof typeof TASK_REPEAT_WEEKDAY_MAP;

        if (dayStr && taskRepeatCfg[dayStr as keyof TaskRepeatCfg] === true) {
          return checkDate;
        }
        checkDate.setDate(checkDate.getDate() + 1);
      }
      return null;
    }

    case 'MONTHLY': {
      const dayOfMonthRepeat = startDateDate.getDate();
      const currentDayOfMonth = checkDate.getDate();

      // If we haven't passed the repeat day this month, set to that day
      if (currentDayOfMonth <= dayOfMonthRepeat) {
        const lastDayOfMonth = new Date(
          checkDate.getFullYear(),
          checkDate.getMonth() + 1,
          0,
        ).getDate();
        checkDate.setDate(Math.min(dayOfMonthRepeat, lastDayOfMonth));
        return checkDate;
      }

      // Otherwise, move to next month
      checkDate.setMonth(checkDate.getMonth() + 1);
      checkDate.setDate(1);
      const lastDayOfMonth = new Date(
        checkDate.getFullYear(),
        checkDate.getMonth() + 1,
        0,
      ).getDate();
      checkDate.setDate(Math.min(dayOfMonthRepeat, lastDayOfMonth));
      return checkDate;
    }

    case 'YEARLY': {
      const dayOfMonthRepeat = startDateDate.getDate();
      const monthOfRepeat = startDateDate.getMonth();

      // Check if we can still hit this year's occurrence
      const thisYearOccurrence = new Date(checkDate.getFullYear(), monthOfRepeat, 1);
      thisYearOccurrence.setHours(12, 0, 0, 0);

      // Handle Feb 29 for non-leap years
      const isLeapYear = (year: number): boolean => {
        return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
      };

      const setYearlyDate = (date: Date): void => {
        date.setMonth(monthOfRepeat);
        if (monthOfRepeat === 1 && dayOfMonthRepeat === 29) {
          date.setDate(isLeapYear(date.getFullYear()) ? 29 : 28);
        } else {
          date.setDate(dayOfMonthRepeat);
        }
      };

      setYearlyDate(thisYearOccurrence);

      if (thisYearOccurrence >= checkDate) {
        return thisYearOccurrence;
      }

      // Otherwise next year
      const nextYearOccurrence = new Date(checkDate.getFullYear() + 1, monthOfRepeat, 1);
      nextYearOccurrence.setHours(12, 0, 0, 0);
      setYearlyDate(nextYearOccurrence);
      return nextYearOccurrence;
    }

    default:
      return null;
  }
};
