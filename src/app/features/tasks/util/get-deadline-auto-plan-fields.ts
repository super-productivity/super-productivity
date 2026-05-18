import { DateService } from '../../../core/date/date.service';

export type DeadlineAutoPlanFields = {
  autoPlanToday?: string;
  autoPlanStartOfNextDayDiffMs?: number;
};

export const getDeadlineAutoPlanFields = (
  dateService: Pick<DateService, 'todayStr' | 'isToday' | 'getStartOfNextDayDiffMs'>,
  deadlineDay?: string | null,
  deadlineWithTime?: number | null,
): DeadlineAutoPlanFields => {
  const today = dateService.todayStr();
  const isDeadlineToday =
    deadlineDay === today ||
    (typeof deadlineWithTime === 'number' && dateService.isToday(deadlineWithTime));

  return isDeadlineToday
    ? {
        autoPlanToday: today,
        autoPlanStartOfNextDayDiffMs: dateService.getStartOfNextDayDiffMs(),
      }
    : {};
};
