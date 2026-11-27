const DAY_MS = 86400000;

/**
 * ISO 8601 week number of the week that starts on `firstDayOfWeek` (0 = Sunday)
 * and contains `d`. A week not starting on Monday spans two ISO weeks; its middle
 * day (start + 3) always lies in the ISO week holding at least 4 of its 7 days,
 * so that ISO week names it (#11855).
 */
export const getWeekNumber = (d: Date, firstDayOfWeek: number = 1): number => {
  // UTC copy of the local calendar day, so DST shifts can't skew the day count
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const daysSinceWeekStart = (((date.getUTCDay() - firstDayOfWeek) % 7) + 7) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceWeekStart + 3);
  // ISO weeks are named by their Thursday's year
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() + 3 - daysSinceMonday);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.floor((+date - yearStart) / DAY_MS / 7) + 1;
};
