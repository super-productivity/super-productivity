/**
 * Best-effort normalization of a clock string toward the canonical `HH:MM`
 * that isValidSplitTime / getDateTimeFromClockString expect.
 *
 * Trims surrounding whitespace and drops a trailing seconds segment, so a value
 * like `13:30:00` (e.g. pasted into an `<input type="time">`) becomes `13:30`
 * and survives validation instead of being silently dropped or crashing the
 * "Invalid clock string" guard (#7802).
 *
 * Genuinely malformed input (`abc`, `25:00`, `13:60`, `12`) is returned trimmed
 * and still fails isValidSplitTime — normalization only recovers a stray
 * seconds component, it never invents a valid time.
 */
export const normalizeClockStr = (v: string): string => {
  const trimmed = v.trim();
  const parts = trimmed.split(':');
  const hasValidSeconds =
    parts.length === 3 && /^\d+$/.test(parts[2]) && +parts[2] >= 0 && +parts[2] <= 59;

  return hasValidSeconds ? parts.slice(0, 2).join(':') : trimmed;
};
