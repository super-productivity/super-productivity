import { toPaddedClockStr } from './to-padded-clock-str';
import { formatTimeHHmm } from './format-time-hhmm';

/**
 * Convert a canonical `HH:mm` clock string into a `Date`, which is the value
 * type Angular Material's `<mat-timepicker>` binds to (it has no string mode).
 *
 * Only the hours/minutes carry meaning for a time field, but the timepicker
 * needs a full `Date`, so the date portion is taken from `baseDate` (or today).
 * Input is normalized via {@link toPaddedClockStr}, so legacy unpadded values
 * (`9:00`) and stray seconds (`13:30:00`) are handled; invalid/empty input
 * yields `null` so the field renders empty.
 *
 * @example
 * clockStrToDate('14:30', new Date(2020, 0, 15)); // Date: 2020-01-15 14:30:00
 * clockStrToDate('25:00'); // null
 */
export const clockStrToDate = (
  clockStr: string | null | undefined,
  baseDate?: Date | null,
): Date | null => {
  const padded = toPaddedClockStr(clockStr);
  if (!padded) {
    return null;
  }
  const [h, m] = padded.split(':').map(Number);
  const date = baseDate ? new Date(baseDate) : new Date();
  date.setHours(h, m, 0, 0);
  return date;
};

/**
 * Convert a `Date` from the Material timepicker back into the app's canonical
 * `HH:mm` string contract (always 24h, regardless of how the picker displayed
 * it). Returns `null` for an empty or invalid `Date`.
 *
 * @example
 * dateToClockStr(new Date(2020, 0, 1, 14, 30)); // '14:30'
 * dateToClockStr(null); // null
 */
export const dateToClockStr = (date: Date | null | undefined): string | null => {
  if (!date || isNaN(date.getTime())) {
    return null;
  }
  // Reuse the canonical Date -> 'HH:mm' formatter; we only add the null/NaN guard.
  return formatTimeHHmm(date);
};
