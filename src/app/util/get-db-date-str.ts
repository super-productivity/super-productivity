//  'YYYY-MM-DD';

/*
⚠️ **Caution**: When parsing UTC ISO strings or timestamps from other timezones, the
 function will return the date in the **local timezone**, which may differ from the
  original date in the source timezone.
 */

export const getDbDateStr = (date: Date | number | string = new Date()): string => {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Buckets a timestamp/Date into its *logical* day string by shifting it back
 * by the start-of-next-day offset before formatting (e.g. a 1 AM task with a
 * 4-hour offset still belongs to the previous day). Centralizes the
 * `getDbDateStr(new Date(ts - startOfNextDayDiffMs))` pattern repeated across
 * planner/schedule day-bucketing (tasks, calendar events, deadlines).
 */
export const getDbDateStrWithOffset = (
  date: number | Date,
  startOfNextDayDiffMs: number = 0,
): string => {
  const ts = typeof date === 'number' ? date : date.getTime();
  return getDbDateStr(new Date(ts - startOfNextDayDiffMs));
};

export const isDBDateStr = (str: string): boolean => {
  if (str.length !== 10 || str[4] !== '-' || str[7] !== '-') return false;
  for (let i = 0; i < 10; i++) {
    if (i === 4 || i === 7) continue;
    const c = str.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  return true;
};
