/**
 * How typed dates are read (`@` / `!` short syntax): which language's date
 * words to accept besides English, and whether an ambiguous numeric date like
 * `3/1` means 3 January (day-first) or March 1 (month-first).
 */
export interface DateInputLocale {
  /** UI translation language, e.g. `de`, `pt-br`, `zh-tw` */
  language: string;
  isDayFirst: boolean;
}

// English, month-first: how `@` dates were read before they followed the
// user's settings, and the default for callers that pass no locale.
export const DEFAULT_DATE_INPUT_LOCALE: DateInputLocale = {
  language: 'en',
  isDayFirst: false,
};

/**
 * Day-first when the day comes before the month in the user's date format
 * (`dd/MM/yyyy`, `dd.MM.yyyy`), month-first otherwise (`MM/dd/yyyy`, and the
 * year-first `yyyy-MM-dd` family, where `3/1` reads as March 1). A format
 * whose digits were not latin (so no `dd`/`MM` placeholders) keeps the
 * month-first default.
 */
export const isDayFirstDateFormat = (format: string): boolean => {
  const dayIndex = format.indexOf('dd');
  const monthIndex = format.indexOf('MM');
  return dayIndex !== -1 && monthIndex !== -1 && dayIndex < monthIndex;
};
