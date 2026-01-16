/**
 * Format dates for plugins using locale-aware Intl.DateTimeFormat
 * Supports predefined formats and handles various date inputs
 */

type DateInput = Date | string | number;
type DateFormat = 'short' | 'medium' | 'long' | 'time' | 'datetime';

/**
 * Format a date according to predefined format and locale
 */
export const formatDateForPlugin = (
  dateInput: DateInput,
  format: DateFormat,
  locale: string,
): string => {
  // Parse input to Date object
  const date = parseDate(dateInput);
  if (!date) {
    return '';
  }

  // Get format options
  const options = getFormatOptions(format);
  if (!options) {
    return '';
  }

  // Format using Intl.DateTimeFormat
  try {
    return new Intl.DateTimeFormat(locale, options).format(date);
  } catch (error) {
    // Fallback to English if locale is invalid
    return new Intl.DateTimeFormat('en', options).format(date);
  }
};

/**
 * Parse various date inputs into Date object
 */
const parseDate = (input: DateInput): Date | null => {
  if (input instanceof Date) {
    return isNaN(input.getTime()) ? null : input;
  }

  if (typeof input === 'number') {
    const date = new Date(input);
    return isNaN(date.getTime()) ? null : date;
  }

  if (typeof input === 'string') {
    const date = new Date(input);
    return isNaN(date.getTime()) ? null : date;
  }

  return null;
};

/**
 * Get Intl.DateTimeFormat options for predefined formats
 */
const getFormatOptions = (format: DateFormat): Intl.DateTimeFormatOptions | null => {
  switch (format) {
    case 'short':
      return {
        year: '2-digit',
        month: 'numeric',
        day: 'numeric',
      };

    case 'medium':
      return {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      };

    case 'long':
      return {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      };

    case 'time':
      return {
        hour: 'numeric',
        minute: '2-digit',
      };

    case 'datetime':
      return {
        year: '2-digit',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      };

    default:
      return null;
  }
};
