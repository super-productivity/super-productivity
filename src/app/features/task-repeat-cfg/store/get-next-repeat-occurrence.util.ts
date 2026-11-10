import { TaskRepeatCfg } from '../task-repeat-cfg.model';
import { getDiffInDays } from '../../../util/get-diff-in-days';
import { getDiffInMonth } from '../../../util/get-diff-in-month';
import { getDiffInWeeks } from '../../../util/get-diff-in-weeks';
import {
  findMonthlyNthWeekdayOccurrence,
  hasNthWeekdayAnchor,
} from './get-nth-weekday-of-month.util';
import { isAfterRepeatUntilDay } from './repeat-until-day.util';
import {
  getMonthlyRepeatDay,
  getRepeatScanDates,
  hasValidRepeatEvery,
  isOnRepeatCycle,
  isRepeatWeekday,
  moveToMonthDay,
  moveToYearDay,
} from './recurrence-date.util';

export const getNextRepeatOccurrence = (
  taskRepeatCfg: TaskRepeatCfg,
  fromDate: Date = new Date(),
  opts: { inclusive?: boolean } = {},
): Date | null => {
  const next = getNextRepeatOccurrenceIgnoringEnd(taskRepeatCfg, fromDate, opts);
  return next && isAfterRepeatUntilDay(taskRepeatCfg, next) ? null : next;
};

const getNextRepeatOccurrenceIgnoringEnd = (
  taskRepeatCfg: TaskRepeatCfg,
  fromDate: Date = new Date(),
  // When `inclusive` is true the scan starts from `fromDate` itself instead of
  // the day after the last task creation. Used when relocating an existing live
  // instance on a schedule edit: `fromDate` (today) may still be a valid
  // occurrence and must not be skipped (#7951). The default (exclusive) keeps
  // the "strictly next future occurrence" semantics relied on by the preview,
  // scheduled-list and heatmap.
  { inclusive = false }: { inclusive?: boolean } = {},
): Date | null => {
  if (!hasValidRepeatEvery(taskRepeatCfg)) {
    return null;
  }

  const {
    checkDate,
    startDate: startDateDate,
    lastTaskCreation,
  } = getRepeatScanDates(taskRepeatCfg, fromDate);

  // In inclusive mode, never resolve to an occurrence before `fromDate` itself.
  // DAILY/WEEKLY only scan forward from `fromDate`, but the day-of-month
  // MONTHLY and YEARLY branches jump to this period's anchor day — which may
  // already have passed today — so they need an explicit floor (applied in
  // their loops below). The MONTHLY nth-weekday branch enforces the same floor
  // via its own `candidate >= checkDate` predicate (checkDate === fromDate in
  // inclusive mode), so it does not use `fromDateFloor`.
  const fromDateFloor = inclusive ? new Date(checkDate) : null;

  if (inclusive) {
    // Relocating an existing instance: ignore prior-creation gating entirely so
    // the scan starts at `fromDate` and today is considered. Neutralising
    // `lastTaskCreation` (epoch) also disarms the per-cycle "skip past last
    // creation" guards (MONTHLY/YEARLY below) for a uniform inclusive scan.
    lastTaskCreation.setTime(0);
  } else {
    // Start checking from the day after last task creation
    if (lastTaskCreation >= checkDate) {
      checkDate.setTime(lastTaskCreation.getTime());
    }
    checkDate.setDate(checkDate.getDate() + 1);
  }

  switch (taskRepeatCfg.repeatCycle) {
    case 'DAILY': {
      const maxDaysToCheck = 365 * 2; // reasonable limit

      for (let i = 0; i < maxDaysToCheck; i++) {
        const diffInDays = getDiffInDays(startDateDate, checkDate);
        if (isOnRepeatCycle(diffInDays, taskRepeatCfg.repeatEvery)) {
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
        if (
          isOnRepeatCycle(diffInWeeks, taskRepeatCfg.repeatEvery) &&
          isRepeatWeekday(taskRepeatCfg, checkDate)
        ) {
          return checkDate;
        }
        checkDate.setDate(checkDate.getDate() + 1);
      }
      return null;
    }

    case 'MONTHLY': {
      const maxMonthsToCheck = 24; // 2 years

      if (hasNthWeekdayAnchor(taskRepeatCfg)) {
        return findMonthlyNthWeekdayOccurrence(taskRepeatCfg, checkDate, {
          direction: 1,
          maxMonths: maxMonthsToCheck,
          accept: (candidate, cursor) =>
            candidate >= checkDate &&
            isOnRepeatCycle(
              getDiffInMonth(startDateDate, cursor),
              taskRepeatCfg.repeatEvery,
            ),
        });
      }

      const dayOfMonthRepeat = getMonthlyRepeatDay(taskRepeatCfg, startDateDate);

      // Move to the next possible month occurrence
      const isLastCreationMonth =
        lastTaskCreation.getMonth() === checkDate.getMonth() &&
        lastTaskCreation.getFullYear() === checkDate.getFullYear();
      moveToMonthDay(checkDate, isLastCreationMonth ? 1 : 0, dayOfMonthRepeat);

      for (let i = 0; i < maxMonthsToCheck; i++) {
        const diffInMonth = getDiffInMonth(startDateDate, checkDate);

        if (
          isOnRepeatCycle(diffInMonth, taskRepeatCfg.repeatEvery) &&
          (!fromDateFloor || checkDate >= fromDateFloor)
        ) {
          return checkDate;
        }
        moveToMonthDay(checkDate, 1, dayOfMonthRepeat);
      }
      return null;
    }

    case 'YEARLY': {
      const maxYearsToCheck = 10;
      const dayOfMonthRepeat = startDateDate.getDate();
      const monthOfMonthRepeat = startDateDate.getMonth();

      moveToYearDay(checkDate, 0, monthOfMonthRepeat, dayOfMonthRepeat);

      // If we've already passed this year's occurrence, move to next year
      if (checkDate <= lastTaskCreation) {
        moveToYearDay(checkDate, 1, monthOfMonthRepeat, dayOfMonthRepeat);
      }

      for (let i = 0; i < maxYearsToCheck; i++) {
        const diffInYears = checkDate.getFullYear() - startDateDate.getFullYear();

        if (
          isOnRepeatCycle(diffInYears, taskRepeatCfg.repeatEvery) &&
          (!fromDateFloor || checkDate >= fromDateFloor)
        ) {
          return checkDate;
        }
        moveToYearDay(checkDate, 1, monthOfMonthRepeat, dayOfMonthRepeat);
      }
      return null;
    }

    default:
      return null;
  }
};
