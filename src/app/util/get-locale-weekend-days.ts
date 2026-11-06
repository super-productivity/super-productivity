// `Intl.Locale#getWeekInfo()` (ES2024) and its older `weekInfo` accessor are
// not in lib.es2022.
type LocaleWithWeekInfo = Intl.Locale & {
  getWeekInfo?: () => { weekend: number[] };
  weekInfo?: { weekend: number[] };
};

/**
 * Weekend days of `locale` as ISO weekdays (1 = Mon … 7 = Sun): Sat/Sun for
 * `en-US`, Fri/Sat for `ar-EG`. Saturday and Sunday when Intl cannot tell.
 */
export const getLocaleWeekendDays = (locale: string): number[] => {
  try {
    const l = new Intl.Locale(locale) as LocaleWithWeekInfo;
    return (l.getWeekInfo?.() ?? l.weekInfo)?.weekend ?? [6, 7];
  } catch {
    // bad locale tag (RangeError)
    return [6, 7];
  }
};
