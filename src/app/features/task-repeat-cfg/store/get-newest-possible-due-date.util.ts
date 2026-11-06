import { TaskRepeatCfg } from '../task-repeat-cfg.model';
import { getDiffInDays } from '../../../util/get-diff-in-days';
import { getDiffInMonth } from '../../../util/get-diff-in-month';
import { getDiffInWeeks } from '../../../util/get-diff-in-weeks';
import {
  findMonthlyNthWeekdayOccurrence,
  hasNthWeekdayAnchor,
} from './get-nth-weekday-of-month.util';
import { capDateAtRepeatUntilDay } from './repeat-until-day.util';
import {
  getClampedDayOfMonth,
  getMonthlyRepeatDay,
  getRepeatScanDates,
  hasValidRepeatEvery,
  isOnRepeatCycle,
  isRepeatWeekday,
  moveToMonthDay,
  moveToYearDay,
} from './recurrence-date.util';

export const getNewestPossibleDueDate = (
  taskRepeatCfg: TaskRepeatCfg,
  todayIn: Date,
): Date | null => {
  // FOR DEBUG
  // return new Date();

  if (!hasValidRepeatEvery(taskRepeatCfg)) {
    return null;
  }

  // Past the end date, look back from the end date instead: an occurrence on
  // or before it that was never created is still due, anything later is not.
  const today = capDateAtRepeatUntilDay(taskRepeatCfg, todayIn);
  const {
    checkDate,
    startDate: startDateDate,
    lastTaskCreation,
  } = getRepeatScanDates(taskRepeatCfg, today);

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
        if (isOnRepeatCycle(diffInDays, taskRepeatCfg.repeatEvery)) {
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
        if (
          isOnRepeatCycle(diffInWeeks, taskRepeatCfg.repeatEvery) &&
          isRepeatWeekday(taskRepeatCfg, checkDate)
        ) {
          return checkDate;
        }
        checkDate.setDate(checkDate.getDate() - 1);
      }
      return null;
    }

    case 'MONTHLY': {
      const nrOfMonthsToCheck = taskRepeatCfg.repeatEvery;

      if (hasNthWeekdayAnchor(taskRepeatCfg)) {
        return findMonthlyNthWeekdayOccurrence(taskRepeatCfg, checkDate, {
          direction: -1,
          maxMonths: nrOfMonthsToCheck + 1,
          accept: (candidate, cursor) =>
            candidate <= checkDate &&
            candidate > lastTaskCreation &&
            isOnRepeatCycle(
              getDiffInMonth(startDateDate, cursor),
              taskRepeatCfg.repeatEvery,
            ),
        });
      }

      const dayOfMonthRepeat = getMonthlyRepeatDay(taskRepeatCfg, startDateDate);

      // Start in the previous month if the repeat day hasn't occurred yet this month
      moveToMonthDay(
        checkDate,
        today.getDate() < getClampedDayOfMonth(checkDate, dayOfMonthRepeat) ? -1 : 0,
        dayOfMonthRepeat,
      );

      for (let i = 0; i < nrOfMonthsToCheck; i++) {
        const diffInMonth = getDiffInMonth(startDateDate, checkDate);

        if (checkDate <= lastTaskCreation || diffInMonth < 0) {
          break;
        }
        if (isOnRepeatCycle(diffInMonth, taskRepeatCfg.repeatEvery)) {
          return checkDate;
        }
        moveToMonthDay(checkDate, -1, dayOfMonthRepeat);
      }
      return null;
    }

    case 'YEARLY': {
      const nrOfYearsToCheck = taskRepeatCfg.repeatEvery;
      const dayOfMonthRepeat = startDateDate.getDate();
      const monthOfMonthRepeat = startDateDate.getMonth();
      const todayAtNoon = new Date(checkDate);

      moveToYearDay(checkDate, 0, monthOfMonthRepeat, dayOfMonthRepeat);
      if (checkDate > todayAtNoon) {
        moveToYearDay(checkDate, -1, monthOfMonthRepeat, dayOfMonthRepeat);
      }

      for (let i = 0; i < nrOfYearsToCheck; i++) {
        const diffInYears = checkDate.getFullYear() - startDateDate.getFullYear();

        if (checkDate <= lastTaskCreation || diffInYears < 0) {
          break;
        }
        if (isOnRepeatCycle(diffInYears, taskRepeatCfg.repeatEvery)) {
          return checkDate;
        }
        moveToYearDay(checkDate, -1, monthOfMonthRepeat, dayOfMonthRepeat);
      }
      return null;
    }

    default:
      return null;
  }
};
