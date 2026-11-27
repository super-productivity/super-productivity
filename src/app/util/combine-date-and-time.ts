/**
 * Puts the clock time of `timePart` on the logical day `datePart`. A time
 * earlier than the "start of next day" offset is the late night of that
 * logical day, so it lands on the next calendar date (#12012), matching
 * `getRepeatDueWithTime` and how Today assigns timed tasks to days.
 */
export const combineDateAndTime = (
  datePart: Date,
  timePart: Date,
  startOfNextDayDiffMs: number,
): Date => {
  const hours = timePart.getHours();
  const minutes = timePart.getMinutes();
  const seconds = timePart.getSeconds();
  const hourMinutes = hours * 60;
  const minuteSeconds = (hourMinutes + minutes) * 60;
  const msOfDay = (minuteSeconds + seconds) * 1000;
  const dayShift = msOfDay < startOfNextDayDiffMs ? 1 : 0;

  // Date constructor instead of +24h so a DST night doesn't shift the calendar day
  return new Date(
    datePart.getFullYear(),
    datePart.getMonth(),
    datePart.getDate() + dayShift,
    hours,
    minutes,
    seconds,
  );
};
