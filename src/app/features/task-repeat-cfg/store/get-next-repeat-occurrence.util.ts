import { TASK_REPEAT_WEEKDAY_MAP, TaskRepeatCfg } from '../task-repeat-cfg.model';
import { getDiffInDays } from '../../../util/get-diff-in-days';
import { getDiffInMonth } from '../../../util/get-diff-in-month';
import { getDiffInYears } from '../../../util/get-diff-in-years';
import { getDiffInWeeks } from '../../../util/get-diff-in-weeks';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';
import { getEffectiveLastTaskCreationDay } from './get-effective-last-task-creation-day.util';
import { getEffectiveRepeatStartDate } from './get-effective-repeat-start-date.util';

export const getNextRepeatOccurrence = (
  taskRepeatCfg: TaskRepeatCfg,
  fromDate: Date = new Date(),
): Date | null => {
  if (!Number.isInteger(taskRepeatCfg.repeatEvery) || taskRepeatCfg.repeatEvery < 1) {
    throw new Error('Invalid repeatEvery value given');
  }

  const checkDate = new Date(fromDate);
  // Get the effective last task creation day with fallback logic
  const startDateStr = getEffectiveRepeatStartDate(taskRepeatCfg);
  const startDateDate = dateStrToUtcDate(startDateStr);

  // Get the effective last task creation day with fallback logic
  const lastTaskCreationDateStr =
    getEffectiveLastTaskCreationDay(taskRepeatCfg) || '1970-01-01';
  const lastTaskCreation = dateStrToUtcDate(lastTaskCreationDateStr);
  // Use noon (12:00) to avoid DST issues - noon is never affected by DST transitions
  checkDate.setHours(12, 0, 0, 0);
  lastTaskCreation.setHours(12, 0, 0, 0);
  startDateDate.setHours(12, 0, 0, 0);

  // Start checking from the day after last task creation
  if (lastTaskCreation >= checkDate) {
    checkDate.setTime(lastTaskCreation.getTime());
  }
  checkDate.setDate(checkDate.getDate() + 1);

  switch (taskRepeatCfg.repeatCycle) {
    case 'DAILY': {
      const maxDaysToCheck = 365 * 2; // reasonable limit

      for (let i = 0; i < maxDaysToCheck; i++) {
        const diffInDays = getDiffInDays(startDateDate, checkDate);
        if (diffInDays >= 0 && diffInDays % taskRepeatCfg.repeatEvery === 0) {
          return checkDate;
        }
        checkDate.setDate(checkDate.getDate() + 1);
      }
      return null;
    }

    case 'WEEKLY': {
      const maxDaysToCheck = 365 * 2; // reasonable limit

      for (let i = 0; i < maxDaysToCheck; i++) {
        const diffInWeeks = getDiffInWeeks(startDateDate, checkDate);
        const todayDay = checkDate.getDay();
        const todayDayStr = TASK_REPEAT_WEEKDAY_MAP[
          todayDay
        ] as keyof typeof TASK_REPEAT_WEEKDAY_MAP;

        if (
          diffInWeeks >= 0 &&
          diffInWeeks % taskRepeatCfg.repeatEvery === 0 &&
          todayDayStr &&
          taskRepeatCfg[todayDayStr as keyof TaskRepeatCfg] === true
        ) {
          return checkDate;
        }
        checkDate.setDate(checkDate.getDate() + 1);
      }
      return null;
    }

    case 'MONTHLY': {
      const maxMonthsToCheck = 24; // 2 years
      const dayOfMonthRepeat = startDateDate.getDate();

      // Handle month-end dates properly
      const setDateSafely = (date: Date, day: number): void => {
        date.setDate(1); // First set to 1st to avoid overflow
        const lastDayOfMonth = new Date(
          date.getFullYear(),
          date.getMonth() + 1,
          0,
        ).getDate();
        date.setDate(Math.min(day, lastDayOfMonth));
      };

      // Move to the next possible month occurrence
      checkDate.setDate(1);
      if (
        lastTaskCreation.getMonth() === checkDate.getMonth() &&
        lastTaskCreation.getFullYear() === checkDate.getFullYear()
      ) {
        checkDate.setMonth(checkDate.getMonth() + 1);
      }
      setDateSafely(checkDate, dayOfMonthRepeat);

      for (let i = 0; i < maxMonthsToCheck; i++) {
        const diffInMonth = getDiffInMonth(startDateDate, checkDate);

        if (diffInMonth >= 0 && diffInMonth % taskRepeatCfg.repeatEvery === 0) {
          return checkDate;
        }
        checkDate.setMonth(checkDate.getMonth() + 1);
        setDateSafely(checkDate, dayOfMonthRepeat);
      }
      return null;
    }

    case 'YEARLY': {
      const maxYearsToCheck = 10;
      const dayOfMonthRepeat = startDateDate.getDate();
      const monthOfMonthRepeat = startDateDate.getMonth();

      // Handle Feb 29 for non-leap years
      const setYearlyDate = (date: Date): void => {
        date.setMonth(monthOfMonthRepeat);
        if (monthOfMonthRepeat === 1 && dayOfMonthRepeat === 29) {
          // February 29 - check if leap year
          const isLeapYear = (year: number): boolean => {
            return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
          };
          if (!isLeapYear(date.getFullYear())) {
            date.setDate(28); // Set to Feb 28 for non-leap years
          } else {
            date.setDate(29);
          }
        } else {
          date.setDate(dayOfMonthRepeat);
        }
      };

      setYearlyDate(checkDate);

      // If we've already passed this year's occurrence, move to next year
      if (checkDate <= lastTaskCreation) {
        checkDate.setFullYear(checkDate.getFullYear() + 1);
        setYearlyDate(checkDate);
      }

      for (let i = 0; i < maxYearsToCheck; i++) {
        const diffInYears = getDiffInYears(startDateDate, checkDate);

        if (diffInYears >= 0 && diffInYears % taskRepeatCfg.repeatEvery === 0) {
          return checkDate;
        }
        checkDate.setFullYear(checkDate.getFullYear() + 1);
        setYearlyDate(checkDate);
      }
      return null;
    }

    default:
      return null;
  }
};
