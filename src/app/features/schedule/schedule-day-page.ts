import { ScheduleDay, ScheduleDayTray, ScheduleEvent } from './schedule.model';
import { mapScheduleDaysToTrays } from './map-schedule-data/with-schedule-day-tray';
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
  trays: Record<string, ScheduleDayTray> | null;
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
  const hasTrayItems = scheduleDays.some(
    (d) => !!d.tray && d.tray.tasks.length + d.tray.repeatCfgs.length > 0,
  );
  return {
    day,
    daysToShow: [day],
    events: eventsFlat,
    beyondBudget: beyondBudgetDays,
    trays: mapScheduleDaysToTrays(scheduleDays),
    hasNoEvents: !hasVisibleEvents && !hasBeyondBudgetEvents && !hasTrayItems,
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
