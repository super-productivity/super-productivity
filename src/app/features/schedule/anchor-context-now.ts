import { dateStrToUtcDate } from '../../util/date-str-to-utc-date';

/**
 * Clamp `now` into the day that `dayStr` names.
 *
 * The result anchors `dayDates[0]` (`startTime = i == 0 ? now` in
 * create-schedule-days), so it has to stay inside that day. Testing where the
 * wall clock sits within the day - rather than comparing day strings - lets a
 * view self-correct once it drifts under a midnight rollover (a day picked as
 * "tomorrow" becomes today while the view stays put), and can never hand the
 * mapper a now past day 0's end, which would push every entry out of the
 * column.
 */
export const anchorContextNow = (dayStr: string, now: number): number => {
  const dayStart = dateStrToUtcDate(dayStr);
  dayStart.setHours(0, 0, 0, 0);
  // setHours(24) rather than +24h: DST-safe day advancement, and exactly how
  // create-schedule-days derives nextDayStart for the same day string.
  const nextDayStart = dateStrToUtcDate(dayStr);
  nextDayStart.setHours(24, 0, 0, 0);

  return now >= dayStart.getTime() && now < nextDayStart.getTime()
    ? now
    : dayStart.getTime();
};
