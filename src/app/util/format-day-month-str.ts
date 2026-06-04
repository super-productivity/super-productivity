import { dateTimeFormatter } from './datetime-formatter';

/**
 * Formats a date as day string with short date in locale-aware format
 * @param dateStr - The date string in YYYY-MM-DD format
 * @param locale - The locale string (e.g., 'en-US', 'de-DE')
 * @returns The formatted day and date string in the specified locale
 */
export const formatDayMonthStr = (dateStr: string, locale: string): string => {
  // Parse the date string as local date parts to avoid timezone issues
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);

  const dayName = date.toLocaleDateString(locale, { weekday: 'short' });
  const monthDay = dateTimeFormatter(locale)
    .format(date)
    // Remove zero-padding for consistency across locales
    .replace(/\b0+(\d)/g, '$1');

  return `${dayName} ${monthDay}`;
};
