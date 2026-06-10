export const YESTERDAY_MARGIN_MS = 4 * 60 * 60 * 1000;

/**
 * Returns true when we are within `marginMs` after the configured logical day
 * boundary (calendar midnight + startOfNextDayMs). Used by the daily summary to
 * decide whether to also surface the previous calendar day's tasks.
 */
export const isWithinYesterdayMargin = (
  now: number,
  startOfNextDayMs: number,
  marginMs: number = YESTERDAY_MARGIN_MS,
): boolean => {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const boundary = midnight.getTime() + startOfNextDayMs;
  const timeSinceBoundary = now - boundary;
  return timeSinceBoundary >= 0 && timeSinceBoundary <= marginMs;
};
