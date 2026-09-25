/** `count` day strings starting at `start`, stepping by calendar day and keeping only `includedWeekDays` (0 = Sunday). */
export const buildDayWindow = (
  start: Date,
  count: number,
  includedWeekDays: readonly number[],
  toDayStr: (d: Date) => string,
): string[] => {
  // Guard against empty includedWeekDays to prevent infinite loop
  if (includedWeekDays.length === 0) {
    return [];
  }

  // Only date parts are read below, so pin the cursor to midday first (on a
  // copy — the caller's date must not be mutated). setDate() preserves the
  // wall time, and a late-evening one is normalised past midnight in zones
  // whose spring-forward gap ends at 00:00 (America/Godthab and
  // America/Scoresbysund skip 23:00-23:59), which would drop a whole day from
  // the window. Midday is never in a gap.
  const cursor = new Date(start);
  cursor.setHours(12, 0, 0, 0);
  const daysToShow: string[] = [];

  // Loop until we have the required count of days (not just iterate N
  // times, which produces fewer days when weekends are excluded), stepping
  // by calendar day: a DST transition day is 23h/25h long, so +24h ms
  // arithmetic from a late-evening anchor skips or duplicates a date.
  let daysAdded = 0;
  while (daysAdded < count) {
    if (includedWeekDays.includes(cursor.getDay())) {
      daysToShow.push(toDayStr(cursor));
      daysAdded++;
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return daysToShow;
};
