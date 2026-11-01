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

interface ShortDateShape {
  parts: Intl.DateTimeFormatPart[];
  // Year-first short dates: ja "2000/01/05", sv ISO "2000-01-05"
  isYearFirst: boolean;
}
const shortDateShapes = new Map<DateTimeLocale, ShortDateShape>();

/** The locale's own short date for the probe date, shared by the formatters below. */
const getShortDateShape = (locale: DateTimeLocale): ShortDateShape => {
  const cached = shortDateShapes.get(locale);
  if (cached) return cached;

  const parts = new Intl.DateTimeFormat([locale, DEFAULT_LOCALE], {
    dateStyle: 'short',
  }).formatToParts(PADDING_PROBE_DATE);
  const shape: ShortDateShape = {
    parts,
    isYearFirst: parts.find((part) => part.type !== 'literal')?.type === 'year',
  };
  shortDateShapes.set(locale, shape);
  return shape;
};

/**
 * Month/day formatter that pads exactly where the locale's own short date does
 * ("05.01." for de, "1/5" for en-US). Intl's numeric month/day skeleton alone
 * drops the zeros some locales use (#11081). Cached per locale: formatting
 * runs once per task row, the probe only once per locale.
 */
const getMonthDayFormatter = (locale: DateTimeLocale): Intl.DateTimeFormat => {
  const cached = monthDayFormatters.get(locale);
  if (cached) return cached;

  const { parts: shortDateParts, isYearFirst } = getShortDateShape(locale);
  // Compare against unpadded output: in non-Gregorian calendars (fa) the probe
  // date has two-digit parts anyway, which says nothing about padding
  const numericParts = dateTimeFormatter(locale).formatToParts(PADDING_PROBE_DATE);
  const lengthOf = (parts: Intl.DateTimeFormatPart[], type: 'day' | 'month'): number =>
    parts.find((part) => part.type === type)?.value.length ?? 0;
  // Year-first short dates pad for fixed-width sorting, not because month/day
  // is written that way
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

const monthDayWithYearFormatters = new Map<DateTimeLocale, Intl.DateTimeFormat>();

/**
 * Month/day plus year. Day and month ask for the padding of
 * {@link getMonthDayFormatter}; order, separators and sometimes padding come
 * from the browser's own format with a year, which in a few locales differs
 * from its month/day format (tr "5/01" vs "5.01.27", ISO "5/1" vs
 * "2027-01-05"). The year has 2 digits, except in year-first formats that
 * write a full year themselves (ISO, ja, zh), where a leading "27" would read
 * like a day.
 */
const getMonthDayWithYearFormatter = (locale: DateTimeLocale): Intl.DateTimeFormat => {
  const cached = monthDayWithYearFormatters.get(locale);
  if (cached) return cached;

  const { parts, isYearFirst } = getShortDateShape(locale);
  const shortDateYearLength =
    parts.find((part) => part.type === 'year')?.value.length ?? 0;
  const { month, day } = getMonthDayFormatter(locale).resolvedOptions();
  const formatter = dateTimeFormatter(locale, {
    month: month as '2-digit' | 'numeric',
    day: day as '2-digit' | 'numeric',
    year: isYearFirst && shortDateYearLength >= 4 ? 'numeric' : '2-digit',
  });
  monthDayWithYearFormatters.set(locale, formatter);
  return formatter;
};

/**
 * Formats a date as month, day and year in locale-aware order, for compact
 * badges that need to tell this year's dates from other years' (#10804).
 *
 * Examples: en-US "6/1/27", en-GB "01/06/27", de-DE "01.06.27",
 * ISO "2027-06-01", ja-JP "2027/6/1", ko-KR "27. 6. 1.".
 * If the locale can't be formatted it falls back to {@link formatMonthDay},
 * which drops the year: a badge without year beats no badge.
 */
export const formatMonthDayWithYear = (date: Date, locale: DateTimeLocale): string => {
  if (!date || isNaN(date.getTime())) return '';
  try {
    return getMonthDayWithYearFormatter(locale).format(date);
  } catch (error) {
    Log.warn(`formatMonthDayWithYear failed for locale ${locale}`, error);
    return formatMonthDay(date, locale);
  }
};

const yearFormatters = new Map<DateTimeLocale, Intl.DateTimeFormat>();

/**
 * The year as the locale displays it, so the comparison below follows the
 * locale's calendar (the Persian year changes in March, not on 1 January).
 */
const displayedYear = (date: Date, locale: DateTimeLocale): string => {
  let formatter = yearFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat([locale, DEFAULT_LOCALE], { year: 'numeric' });
    yearFormatters.set(locale, formatter);
  }
  return formatter.formatToParts(date).find((part) => part.type === 'year')?.value ?? '';
};

/**
 * Whether a badge for `date` shows a year: the badge rule from #10804. True for
 * dates outside the year of `today`, which callers take from DateService
 * (start-of-next-day setting), not the wall clock.
 */
export const isOutsideDisplayedYear = (
  date: Date,
  locale: DateTimeLocale,
  today: Date,
): boolean => {
  if (!date || isNaN(date.getTime())) return false;
  return !isSameDisplayedYear(date, today, locale);
};

const isSameDisplayedYear = (
  date: Date,
  today: Date,
  locale: DateTimeLocale,
): boolean => {
  try {
    const year = displayedYear(date, locale);
    // Calendars without a plain year part (zh-u-ca-chinese: relatedYear) compare
    // by the Gregorian year instead of always matching
    if (year) return year === displayedYear(today, locale);
  } catch (error) {
    Log.warn(`Comparing years failed for locale ${locale}`, error);
  }
  return date.getFullYear() === today.getFullYear();
};

/**
 * Badge text: month/day plus year when {@link isOutsideDisplayedYear}, otherwise
 * month/day only.
 */
export const formatMonthDayWithYearIfNeeded = (
  date: Date,
  locale: DateTimeLocale,
  today: Date,
): string => {
  if (!date || isNaN(date.getTime())) return '';
  return isOutsideDisplayedYear(date, locale, today)
    ? formatMonthDayWithYear(date, locale)
    : formatMonthDay(date, locale);
};
