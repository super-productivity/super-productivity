import { getLocaleWeekendDays } from './get-locale-weekend-days';

describe('getLocaleWeekendDays', () => {
  const hasWeekInfo = (): boolean => {
    const l = new Intl.Locale('en-US') as Intl.Locale & {
      getWeekInfo?: unknown;
      weekInfo?: unknown;
    };
    return !!(l.getWeekInfo || l.weekInfo);
  };

  it('returns Saturday and Sunday for en-US', () => {
    expect([...getLocaleWeekendDays('en-us')].sort()).toEqual([0, 6]);
  });

  it('returns Friday and Saturday for a Fri/Sat weekend locale', () => {
    if (!hasWeekInfo()) {
      pending('Intl week info unavailable in this browser');
    }
    expect([...getLocaleWeekendDays('he-IL')].sort()).toEqual([5, 6]);
  });

  it('falls back to Saturday and Sunday for an invalid locale', () => {
    expect(getLocaleWeekendDays('not a locale!')).toEqual([6, 0]);
  });
});
