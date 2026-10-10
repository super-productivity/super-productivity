import { getWeekdaysMin } from './get-weekdays-min';

describe('getWeekdaysMin', () => {
  it('should return minimal weekday names for en-US locale', () => {
    const weekdays = getWeekdaysMin('en-US');
    expect(weekdays).toEqual(['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']);
  });

  it('should return 7 weekday names', () => {
    const weekdays = getWeekdaysMin('en-US');
    expect(weekdays.length).toBe(7);
  });

  it('should start with Sunday', () => {
    const weekdays = getWeekdaysMin('en-US');
    expect(weekdays[0]).toBe('Su');
    expect(weekdays[6]).toBe('Sa');
  });

  // Two-letter prefixes of the short names collide in these locales, e.g.
  // pt-BR "seg."/"sex." both became "se" and every Arabic day became "ال".
  ['pt-BR', 'vi', 'ar', 'he', 'hu', 'id'].forEach((locale) => {
    it(`should return 7 distinct names for ${locale}`, () => {
      const weekdays = getWeekdaysMin(locale);
      expect(new Set(weekdays).size).toBe(7);
    });
  });

  ['vi', 'ar', 'he'].forEach((locale) => {
    it(`should keep the names short for ${locale}`, () => {
      const weekdays = getWeekdaysMin(locale);
      expect(weekdays.every((name) => name.length <= 2)).toBe(true);
    });
  });
});
