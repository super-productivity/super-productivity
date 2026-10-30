/**
 * Get minimum weekday names for a locale
 * @param locale - The locale to use (e.g., 'en-US', 'de-DE')
 * @returns Array of minimal weekday names starting from Sunday
 */
export const getWeekdaysMin = (locale?: string): string[] => {
  const short = getWeekdayNames(locale, 'short');
  // Take first 2 characters to match moment's weekdaysMin behavior, unless that
  // makes two days look the same (pt-BR "seg."/"sex." would both become "se").
  const candidates = [
    short.map((name) => name.substring(0, 2)),
    getWeekdayNames(locale, 'narrow'),
  ];
  return candidates.find((names) => new Set(names).size === names.length) ?? short;
};

const getWeekdayNames = (
  locale: string | undefined,
  weekday: 'short' | 'narrow',
): string[] => {
  const weekdays: string[] = [];
  const baseDate = new Date(2023, 0, 1); // January 1, 2023 is a Sunday

  for (let i = 0; i < 7; i++) {
    const date = new Date(baseDate);
    date.setDate(date.getDate() + i);
    weekdays.push(date.toLocaleDateString(locale, { weekday }));
  }

  return weekdays;
};
