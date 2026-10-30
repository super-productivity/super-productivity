import { ScheduleDay, ScheduleEvent } from './schedule.model';
import { mapScheduleDaysToScheduleEvents } from './map-schedule-data/map-schedule-days-to-schedule-events';
import { FH, SVEType } from './schedule.const';
import { parseDbDateStr } from '../../util/parse-db-date-str';
import { getDbDateStr } from '../../util/get-db-date-str';

/** One day of the schedule, as rendered by a single-day page of a swipe pager. */
export interface ScheduleDayPage {
  day: string;
  daysToShow: string[];
  events: ScheduleEvent[];
  beyondBudget: ScheduleEvent[][];
  hasNoEvents: boolean;
}

export const scheduleDayPageKey = (page: ScheduleDayPage): string => page.day;

export const toScheduleDayPage = (
  day: string,
  scheduleDays: ScheduleDay[],
): ScheduleDayPage => {
  const { eventsFlat, beyondBudgetDays } = mapScheduleDaysToScheduleEvents(
    scheduleDays,
    FH,
  );
  const hasVisibleEvents = eventsFlat.some((ev) => ev.type !== SVEType.LunchBreak);
  const hasBeyondBudgetEvents = beyondBudgetDays.some((d) => d.length > 0);
  return {
    day,
    daysToShow: [day],
    events: eventsFlat,
    beyondBudget: beyondBudgetDays,
    hasNoEvents: !hasVisibleEvents && !hasBeyondBudgetEvents,
  };
};

/** Calendar-day step for a 'YYYY-MM-DD' string (DST-safe, no ms arithmetic). */
export const shiftDayStr = (day: string, deltaDays: number): string => {
  const date = parseDbDateStr(day);
  // Midday is never inside a DST gap (see ScheduleService.getDaysToShow).
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + deltaDays);
  return getDbDateStr(date);
};
