import { DateTimeLocale } from '../../core/locale.constants';
import { formatMonthDay } from '../../util/format-month-day.util';
import { dateStrToUtcDate } from '../../util/date-str-to-utc-date';

/**
 * Builds the "Next <date>, Last <date>" tooltip text for an "Every x days"
 * repeat entry on the scheduled/upcoming list.
 *
 * Pure so it can be unit-tested without a component TestBed. The caller passes
 * the already-computed next-occurrence timestamp, the effective last-creation
 * day string, the locale, and the two already-translated labels.
 *
 * @param nextOccurrenceTimestamp Epoch ms of the next occurrence, or null/0 when
 *   there is none. Rendered from a real timestamp, so it needs no tz handling.
 * @param effectiveLastDay The effective last-creation day as a `YYYY-MM-DD`
 *   string, or undefined when the repeat has never produced a task.
 * @param locale The active date-time locale.
 * @param nextLabel Translated label for the next occurrence (e.g. "Next").
 * @param lastLabel Translated label for the last occurrence (e.g. "Last").
 */
export const getRepeatCfgTooltipText = (
  nextOccurrenceTimestamp: number | null,
  effectiveLastDay: string | undefined,
  locale: DateTimeLocale,
  nextLabel: string,
  lastLabel: string,
): string => {
  const nextFormatted = nextOccurrenceTimestamp
    ? formatMonthDay(new Date(nextOccurrenceTimestamp), locale)
    : '';

  // Parse the `YYYY-MM-DD` day string as a LOCAL start-of-day date.
  // `new Date('2025-08-01')` parses a date-only string as UTC midnight, which
  // formatMonthDay then renders in the system timezone — for any user west of
  // UTC that instant falls on the previous local day, so "8/1" renders as
  // "7/31" (the reported, persistent off-by-one). dateStrToUtcDate builds a
  // local-midnight Date, matching how the rest of the app reads date strings.
  // The 'Next' value is unaffected because it comes from a real epoch
  // timestamp, not a date string. (#9127)
  const lastFormatted = effectiveLastDay
    ? formatMonthDay(dateStrToUtcDate(effectiveLastDay), locale)
    : '';

  return `${nextLabel} ${nextFormatted}, ${lastLabel} ${lastFormatted}`;
};
