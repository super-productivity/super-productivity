import { Period } from './types';

const pad = (n: number): string => String(n).padStart(2, '0');

/** Local calendar day as `YYYY-MM-DD`, the format of `task.timeSpentOnDay` keys. */
export const toDayStr = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** The calendar month before `today` — what most people invoice. */
export const previousMonth = (today: Date): Period => ({
  from: toDayStr(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
  to: toDayStr(new Date(today.getFullYear(), today.getMonth(), 0)),
});

export const addDays = (dayStr: string, days: number): string => {
  const [y, m, d] = dayStr.split('-').map(Number);
  return toDayStr(new Date(y, m - 1, d + days));
};
