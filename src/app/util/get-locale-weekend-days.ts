// `Intl.Locale` week info is newer than the ES2022 lib typings
interface WeekInfo {
  weekend: number[];
}
type LocaleWithWeekInfo = Intl.Locale & {
  getWeekInfo?: () => WeekInfo;
  weekInfo?: WeekInfo;
};

const SAT_SUN = [6, 0];

/**
 * Weekend days of `locale` as `Date.getDay()` numbers (0 = Sunday). Falls back
 * to Saturday/Sunday where the platform has no week info (e.g. Firefox).
 */
export const getLocaleWeekendDays = (locale: string): number[] => {
  let intlLocale: LocaleWithWeekInfo;
  try {
    intlLocale = new Intl.Locale(locale);
  } catch (e) {
    // RangeError for a malformed tag; the weekend only steers where untimed
    // work flows, so the common default beats failing the schedule
    return [...SAT_SUN];
  }
  // getWeekInfo() is the current spec; older Chromium only has the getter
  const weekend = (intlLocale.getWeekInfo?.() ?? intlLocale.weekInfo)?.weekend;
  // week info uses ISO weekdays (7 = Sunday)
  return weekend ? weekend.map((isoDay) => isoDay % 7) : [...SAT_SUN];
};
