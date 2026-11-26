import { LocaleDatePipe } from 'src/app/ui/pipes/locale-date.pipe';
import { Log } from '../core/log';
import { DEFAULT_LOCALE, DateTimeLocale } from '../core/locale.constants';
import { dateTimeFormatter } from './datetime-formatter';

// Jan 5: single-digit day and month reveal whether a locale pads them
const PADDING_PROBE_DATE = new Date(2000, 0, 5);
// shortcut: formatters keep the time zone they were built in, so after an OS
// time zone change dates use the old zone until reload — key the cache by
// time zone if that matters
const monthDayFormatters = new Map<DateTimeLocale, Intl.DateTimeFormat>();

/**
 * Month/day formatter that pads exactly where the locale's own short date does
 * ("05.01." for de, "1/5" for en-US). Intl's numeric month/day skeleton alone
 * drops the zeros some locales use (#11081). Cached per locale: formatting
 * runs once per task row, the probe only once per locale.
 */
const getMonthDayFormatter = (locale: DateTimeLocale): Intl.DateTimeFormat => {
  const cached = monthDayFormatters.get(locale);
  if (cached) return cached;

  const shortDateParts = new Intl.DateTimeFormat([locale, DEFAULT_LOCALE], {
    dateStyle: 'short',
  }).formatToParts(PADDING_PROBE_DATE);
  // Compare against unpadded output: in non-Gregorian calendars (fa) the probe
  // date has two-digit parts anyway, which says nothing about padding
  const numericParts = dateTimeFormatter(locale).formatToParts(PADDING_PROBE_DATE);
  const lengthOf = (parts: Intl.DateTimeFormatPart[], type: 'day' | 'month'): number =>
    parts.find((part) => part.type === type)?.value.length ?? 0;
  // Year-first short dates (ja "2000/01/05", sv ISO "2000-01-05") pad for
  // fixed-width sorting, not because month/day is written that way
  const isYearFirst =
    shortDateParts.find((part) => part.type !== 'literal')?.type === 'year';
  const widthOf = (type: 'day' | 'month'): '2-digit' | 'numeric' =>
    !isYearFirst && lengthOf(shortDateParts, type) > lengthOf(numericParts, type)
      ? '2-digit'
      : 'numeric';

  const formatter = dateTimeFormatter(locale, {
    month: widthOf('month'),
    day: widthOf('day'),
  });
  monthDayFormatters.set(locale, formatter);
  return formatter;
};

/**
 * Formats a date to show only month and day in locale-aware format.
 * Uses LocaleDatePipe for consistent formatting with the rest of the app.
 *
 * Examples by locale:
 * - en-US: "12/25" (month/day)
 * - en-GB: "25/12" (day/month), "05/01" (padded like its short date)
 * - de-DE: "25.12." (day.month.), "05.01."
 * - ja-JP: "12/25" (month/day)
 *
 * @param date The date to format
 * @param locale The locale string (e.g., 'en-US', 'de-DE')
 * @returns Formatted month/day string, or empty string if formatting fails
 */
export const formatMonthDay = (date: Date, locale: DateTimeLocale): string => {
  try {
    // Validate the date first
    if (!date || isNaN(date.getTime())) return '';

    // Use the browser's native Intl.DateTimeFormat for proper locale support, use en-US as fallback
    // This is more reliable than LocaleDatePipe for getting locale-specific formatting
    try {
      return getMonthDayFormatter(locale).format(date);
    } catch (intlError) {
      // If Intl.DateTimeFormat fails, fall back to LocaleDatePipe approach
      Log.warn(
        `Intl.DateTimeFormat failed for locale ${locale}, falling back to LocaleDatePipe`,
      );

      const shortDate = new LocaleDatePipe().transform(date, 'shortDate', locale);
      if (!shortDate) {
        throw new Error('LocaleDatePipe.transform returned null or empty string');
      }

      // Remove year from various locale formats
      let result = shortDate;

      // Handle year at the end: separator followed by 2-4 digits
      result = result.replace(/[/.\-\s]\d{2,4}\.?$/, '');

      // Handle year at the beginning: 4 digits followed by separator
      result = result.replace(/^\d{4}[/.\-\s]/, '');

      // Clean up any remaining separators at start/end
      result = result.replace(/^[/.\-\s]+|[/.\-\s]+$/g, '');

      return result;
    }
  } catch (error) {
    // Final fallback to basic formatting
    Log.err(`formatMonthDay failed for locale ${locale}:`, error);
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${month}/${day}`;
  }
};
