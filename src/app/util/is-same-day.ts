import { isValidDate } from './is-valid-date';
import { Log } from '../core/log';

export const isSameDay = (
  date1: number | Date,
  date2: number | Date,
  offsetMs: number = 0,
): boolean => {
  const d1 = new Date(
    typeof date1 === 'number' ? date1 - offsetMs : date1.getTime() - offsetMs,
  );
  const d2 = new Date(
    typeof date2 === 'number' ? date2 - offsetMs : date2.getTime() - offsetMs,
  );
  const isValid = isValidDate(d1) && isValidDate(d2);
  if (!isValid) {
    Log.log(date1, date2);
    throw new Error('Invalid dates passed');
  }
  return (
    d1.getDate() === d2.getDate() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getFullYear() === d2.getFullYear()
  );
};
