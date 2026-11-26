/**
 * Logical day D runs from D + day start to D+1 + day start. Given a date on
 * calendar day D, a clock time before the day start belongs to D only on the
 * next calendar date, so move it there.
 */
export const moveClockTimeIntoLogicalDay = (
  date: Date,
  startOfNextDayDiffMs: number,
): Date => {
  const msSinceMidnight = date.getTime() - new Date(date).setHours(0, 0, 0, 0);
  if (msSinceMidnight >= startOfNextDayDiffMs) {
    return date;
  }
  const next = new Date(date);
  next.setDate(next.getDate() + 1);
  return next;
};
