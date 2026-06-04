import { LocaleDatePipe } from 'src/app/ui/pipes/locale-date.pipe';
import { Log } from '../core/log';
import { dateTimeFormatter } from './datetime-formatter';

/**
 * Formats a date to show only month and day in locale-aware format.
 * Uses LocaleDatePipe for consistent formatting with the rest of the app.
 *
 * Examples by locale:
 * - en-US: "12/25" (month/day)
 * - en-GB: "25/12" (day/month)
 * - de-DE: "25.12" (day.month)
 * - ja-JP: "12/25" (month/day, year removed from start)
 *
 * @param date The date to format
 * @param locale The locale string (e.g., 'en-US', 'de-DE')
 * @returns Formatted month/day string, or empty string if formatting fails
 */
export const formatMonthDay = (date: Date, locale: string): string => {
  try {
    // Validate the date first
    if (!date || isNaN(date.getTime())) return '';

    // Use the browser's native Intl.DateTimeFormat for proper locale support, use en-US as fallback
    // This is more reliable than LocaleDatePipe for getting locale-specific formatting
    try {
      const formatted = dateTimeFormatter(locale).format(date);

      // Remove zero-padding for consistency across all locales
      // This ensures "05/01" becomes "5/1", "05.01" becomes "5.1", etc.
      return formatted.replace(/\b0+(\d)/g, '$1');
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
