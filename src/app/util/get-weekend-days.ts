// ISO weekday numbers, 1 = Monday … 7 = Sunday, as used by Intl week info.
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

const DEFAULT_WEEKEND: IsoWeekday[] = [6, 7];
// Date#getDay() is 0 = Sunday … 6 = Saturday.
const JS_DAY_TO_ISO: readonly IsoWeekday[] = [7, 1, 2, 3, 4, 5, 6];

interface WeekInfo {
  weekend?: IsoWeekday[];
}

// Not in TS 5.9's lib yet: the method landed in Chrome 130 / Safari 17, older
// Chromium exposed the same data as a `weekInfo` accessor, Firefox has neither.
interface LocaleWithWeekInfo {
  getWeekInfo?: () => WeekInfo;
  weekInfo?: WeekInfo;
}

/**
 * Weekend days for a locale, derived from the platform's week info so locales
 * whose weekend is not Saturday/Sunday (e.g. ar-EG: Fri/Sat) are respected.
 * Falls back to Saturday/Sunday where the API is unavailable or the locale is
 * invalid.
 */
export const getWeekendDays = (locale: string = navigator.language): IsoWeekday[] => {
  try {
    const l = new Intl.Locale(locale) as unknown as LocaleWithWeekInfo;
    const weekend = (l.getWeekInfo?.() ?? l.weekInfo)?.weekend;
    if (weekend?.length) {
      return weekend;
    }
  } catch {
    // invalid locale tag: fall through to the default
  }
  return DEFAULT_WEEKEND;
};

export const isWeekendDay = (
  date: Date,
  weekendDays: IsoWeekday[] = getWeekendDays(),
): boolean => {
  return weekendDays.includes(JS_DAY_TO_ISO[date.getDay()]);
};
