import { getDbDateStr } from './get-db-date-str';

export const isTodayWithOffset = (
  date: number | Date,
  todayStr: string,
  startOfNextDayDiffMs: number,
): boolean => {
  const d = new Date(date);
  if (!(d.getTime() > 0)) {
    throw new Error('Invalid date passed');
  }
  return getDbDateStr(new Date(d.getTime() - startOfNextDayDiffMs)) === todayStr;
};

/** @deprecated Use `DateService.isToday()` or `isTodayWithOffset()` instead for offset-aware comparison. */
export const isToday = (date: number | Date): boolean => {
  const d = new Date(date);
  const isValid = d.getTime() > 0;
  if (!isValid) {
    throw new Error('Invalid date passed');
  }
  const today = new Date();
  // return (today.toDateString() === d.toDateString());
  // return  today.setHours(0, 0, 0, 0) === d.setHours(0, 0, 0, 0);
  return (
    d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear()
  );
};

export const isYesterday = (date: number): boolean => {
  const d = new Date(date);
  const isValid = d.getTime() > 0;
  if (!isValid) {
    throw new Error('Invalid date passed');
  }
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  // return (yesterday.toDateString() === d.toDateString());
  // return  yesterday.setHours(0, 0, 0, 0) === d.setHours(0, 0, 0, 0);
  return (
    d.getDate() === yesterday.getDate() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getFullYear() === yesterday.getFullYear()
  );
};
