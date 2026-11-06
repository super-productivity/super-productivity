import { getLocaleWeekendDays } from './get-locale-weekend-days';

describe('getLocaleWeekendDays', () => {
  it('reads the weekend of the locale from Intl week info', () => {
    expect(getLocaleWeekendDays('en-US')).toEqual([6, 7]);
    expect(getLocaleWeekendDays('ar-EG')).toEqual([5, 6]);
  });

  it('falls back to Saturday and Sunday for a locale tag Intl rejects', () => {
    expect(getLocaleWeekendDays('not a locale')).toEqual([6, 7]);
  });
});
