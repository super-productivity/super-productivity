import { normalizeClockStr } from './normalize-clock-str';

/**
 * Convert a stored clock string to the zero-padded `HH:mm` that a native
 * `<input type="time">` requires in order to display it.
 *
 * Legacy configs store unpadded values like `9:00` (the app's own
 * `DEFAULT_DAY_START`), which the native control silently renders blank. Stray
 * seconds (`13:30:00`) are dropped via {@link normalizeClockStr} so the value
 * stays canonical `HH:mm`.
 *
 * Returns '' for empty or genuinely invalid input (`25:00`, `13:60`, `abc`), so
 * the field shows empty rather than a stale or browser-rejected value.
 *
 * @example
 * toPaddedClockStr('9:00');     // '09:00'
 * toPaddedClockStr('13:30:00'); // '13:30'
 * toPaddedClockStr('25:00');    // ''
 */
export const toPaddedClockStr = (value: string | null | undefined): string => {
  if (!value) {
    return '';
  }
  const [hStr, mStr] = normalizeClockStr(value).split(':');
  if (!hStr?.trim() || !mStr?.trim()) {
    return '';
  }
  const h = Number(hStr);
  const m = Number(mStr);
  // Deliberately stricter than isValidSplitTime (which accepts hour 24): a
  // native <input type="time"> caps at 23:59, so a stored `24:00` can only ever
  // render blank — returning '' here keeps display and validation in agreement.
  if (
    !Number.isInteger(h) ||
    !Number.isInteger(m) ||
    h < 0 ||
    h > 23 ||
    m < 0 ||
    m > 59
  ) {
    return '';
  }
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};
