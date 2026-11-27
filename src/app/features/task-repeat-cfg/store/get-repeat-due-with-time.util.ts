import { getDateTimeFromClockString } from '../../../util/get-date-time-from-clock-string';
import { getDbDateStr } from '../../../util/get-db-date-str';

const MS_PER_MINUTE = 60 * 1000;

/**
 * Places a repeat cfg's `startTime` on the logical day an instance belongs to.
 * A clock time earlier than the "start of next day" offset is the late night
 * of that logical day, so it lands on the next calendar day (#3378). With an
 * offset of 0 this equals `getDateTimeFromClockString(startTime, logicalDay)`.
 *
 * Creation, rescheduling, the duplicate reaper and all projections must use
 * this, or they disagree on where an instance sits.
 */
export const getRepeatDueWithTime = (
  startTime: string,
  logicalDay: number | Date,
  startOfNextDayDiffMs: number,
): number => {
  const [h, m] = startTime.split(':');
  const day = new Date(logicalDay);
  const hourMinutes = Number(h) * 60;
  const startMinutes = hourMinutes + Number(m);
  if (startMinutes * MS_PER_MINUTE < startOfNextDayDiffMs) {
    // setDate instead of +24h so a DST night doesn't shift the calendar day
    day.setDate(day.getDate() + 1);
  }
  return getDateTimeFromClockString(startTime, day);
};

/**
 * Inverse of `getRepeatDueWithTime`: the logical day a clock time on
 * `calendarDay` belongs to. Compares the clock time rather than subtracting
 * the offset from a timestamp, so a time just after the day start on a DST
 * switch day stays on its own day.
 */
export const getLogicalDayForClockTime = (
  startTime: string,
  calendarDay: number | Date,
  startOfNextDayDiffMs: number,
): string => {
  const [h, m] = startTime.split(':');
  const day = new Date(calendarDay);
  const hourMinutes = Number(h) * 60;
  const startMinutes = hourMinutes + Number(m);
  if (startMinutes * MS_PER_MINUTE < startOfNextDayDiffMs) {
    day.setDate(day.getDate() - 1);
  }
  return getDbDateStr(day);
};

/** The logical day a timestamp's clock time belongs to (see above). */
export const getLogicalDayOfTimestamp = (
  timestamp: number,
  startOfNextDayDiffMs: number,
): string => {
  const d = new Date(timestamp);
  const clock = `${d.getHours()}:${d.getMinutes()}`;
  return getLogicalDayForClockTime(clock, d, startOfNextDayDiffMs);
};
