import { TASK_REPEAT_WEEKDAY_MAP, TaskRepeatCfg } from '../task-repeat-cfg.model';
import { getDiffInDays } from '../../../util/get-diff-in-days';
import { getDiffInMonth } from '../../../util/get-diff-in-month';
import { getDiffInYears } from '../../../util/get-diff-in-years';
import { getDiffInWeeks } from '../../../util/get-diff-in-weeks';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';
import { getEffectiveLastTaskCreationDay } from './get-effective-last-task-creation-day.util';
import { getEffectiveRepeatStartDate } from './get-effective-repeat-start-date.util';

export const getNewestPossibleDueDate = (
  taskRepeatCfg: TaskRepeatCfg,
  today: Date,
): Date | null => {
  // FOR DEBUG
  // return new Date();

  if (!Number.isInteger(taskRepeatCfg.repeatEvery) || taskRepeatCfg.repeatEvery < 1) {
    throw new Error('Invalid repeatEvery value given');
  }

  const checkDate = new Date(today);
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

  if (startDateDate > checkDate) {
    return null;
  }

  switch (taskRepeatCfg.repeatCycle) {
    case 'DAILY': {
      const nrOfDaysToCheck = taskRepeatCfg.repeatEvery + 1;

      // TODO add unit test for today
      for (let i = 0; i < nrOfDaysToCheck; i++) {
        const diffInDays = getDiffInDays(startDateDate, checkDate);
        if (checkDate <= lastTaskCreation || diffInDays < 0) {
          break;
        }
        if (diffInDays % taskRepeatCfg.repeatEvery === 0) {
          return checkDate;
        }
        checkDate.setDate(checkDate.getDate() - 1);
      }
      return null;
    }

    case 'WEEKLY': {
      // eslint-disable-next-line no-mixed-operators
      const nrOfDaysToCheck = taskRepeatCfg.repeatEvery * 7 + 1;

      for (let i = 0; i < nrOfDaysToCheck; i++) {
        const diffInWeeks = getDiffInWeeks(startDateDate, checkDate);
        if (checkDate <= lastTaskCreation || diffInWeeks < 0) {
          break;
        }
        const todayDay = checkDate.getDay();
        const todayDayStr = TASK_REPEAT_WEEKDAY_MAP[
          todayDay
        ] as keyof typeof TASK_REPEAT_WEEKDAY_MAP;

        if (
          diffInWeeks % taskRepeatCfg.repeatEvery === 0 &&
          todayDayStr &&
          taskRepeatCfg[todayDayStr as keyof TaskRepeatCfg] === true
        ) {
          return checkDate;
        }
        checkDate.setDate(checkDate.getDate() - 1);
      }
      return null;
    }

    case 'MONTHLY': {
      const nrOfMonthsToCheck = taskRepeatCfg.repeatEvery;
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

      // Start by checking if the repeat day has passed this month
      const lastDayOfCurrentMonth = new Date(
        checkDate.getFullYear(),
        checkDate.getMonth() + 1,
        0,
      ).getDate();
      const adjustedDayForCurrentMonth = Math.min(
        dayOfMonthRepeat,
        lastDayOfCurrentMonth,
      );

      if (today.getDate() < adjustedDayForCurrentMonth) {
        // The repeat day hasn't occurred yet this month, so check previous month
        checkDate.setMonth(checkDate.getMonth() - 1);
      }
      setDateSafely(checkDate, dayOfMonthRepeat);

      for (let i = 0; i < nrOfMonthsToCheck; i++) {
        const diffInMonth = getDiffInMonth(startDateDate, checkDate);

        if (checkDate <= lastTaskCreation || diffInMonth < 0) {
          break;
        }
        if (diffInMonth % taskRepeatCfg.repeatEvery === 0) {
          return checkDate;
        }
        checkDate.setMonth(checkDate.getMonth() - 1);
        setDateSafely(checkDate, dayOfMonthRepeat);
      }
      return null;
    }

    case 'YEARLY': {
      const nrOfYearsToCheck = taskRepeatCfg.repeatEvery;
      const dayOfMonthRepeat = startDateDate.getDate();
      const monthOfMonthRepeat = startDateDate.getMonth();
      checkDate.setDate(dayOfMonthRepeat);
      checkDate.setMonth(monthOfMonthRepeat);

      if (today.getMonth() < monthOfMonthRepeat) {
        checkDate.setFullYear(checkDate.getFullYear() - 1);
      }
      if (today.getMonth() === monthOfMonthRepeat && today.getDate() < dayOfMonthRepeat) {
        checkDate.setFullYear(checkDate.getFullYear() - 1);
      }

      for (let i = 0; i < nrOfYearsToCheck; i++) {
        const diffInYears = getDiffInYears(startDateDate, checkDate);

        if (checkDate <= lastTaskCreation || diffInYears < 0) {
          break;
        }
        if (diffInYears % taskRepeatCfg.repeatEvery === 0) {
          return checkDate;
        }
        checkDate.setFullYear(checkDate.getFullYear() - 1);
      }
      return null;
    }

    default:
      return null;
  }
};
