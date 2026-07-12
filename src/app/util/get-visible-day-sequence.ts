import { getDbDateStr } from './get-db-date-str';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Generates a sequence of `count` day-date strings (YYYY-MM-DD), starting at
 * `startMs` and stepping forward one day (24h) at a time. When
 * `includedWeekDays` is given, candidate days whose `Date#getDay()` is not in
 * the list are skipped so the returned sequence still contains exactly
 * `count` matching days (e.g. planner's "included week days" filter) rather
 * than fewer days for the same iteration count. Passing an empty
 * `includedWeekDays` array returns an empty sequence instead of looping
 * forever.
 *
 * Centralizes the day-millisecond arithmetic that planner.service.ts
 * (`daysToShow$`) and schedule.service.ts (`getDaysToShow`) previously
 * duplicated for visible-day generation.
 */
export const getVisibleDaySequence = (
  startMs: number,
  count: number,
  includedWeekDays?: number[],
): string[] => {
  const daysToShow: string[] = [];
  if (includedWeekDays && includedWeekDays.length === 0) {
    return daysToShow;
  }

  let daysAdded = 0;
  let offset = 0;
  while (daysAdded < count) {
    // eslint-disable-next-line no-mixed-operators
    const candidateMs = startMs + offset * MS_PER_DAY;
    if (!includedWeekDays || includedWeekDays.includes(new Date(candidateMs).getDay())) {
      daysToShow.push(getDbDateStr(candidateMs));
      daysAdded++;
    }
    offset++;
  }

  return daysToShow;
};
