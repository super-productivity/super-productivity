import { DEFAULT_LOCALE } from '../core/locale.constants';

/**
 * Core datetime formatter
 * This function is used to format date and times in the app.
 * You should use it everywhere for date and time formatting
 *
 * TODO LocaleDatePipe should use this function too
 * If we go further, perhaps we could improve this func to remove the current DatePipe (imported from @angular/common) in LocaleDatePipe.
 */
export const dateTimeFormatter = (
  locale: string,
  overrides?: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat => {
  return new Intl.DateTimeFormat([locale, DEFAULT_LOCALE], {
    month: 'numeric',
    day: 'numeric',
    ...overrides,
  });
};
