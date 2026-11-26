import { isDayFirstDateFormat } from './date-input-locale';

describe('isDayFirstDateFormat', () => {
  it('should be day-first when the day comes before the month', () => {
    expect(isDayFirstDateFormat('dd/MM/yyyy')).toBe(true);
    expect(isDayFirstDateFormat('dd.MM.yyyy')).toBe(true);
    expect(isDayFirstDateFormat('dd-MM-yyyy')).toBe(true);
  });

  it('should be month-first for US and year-first formats', () => {
    expect(isDayFirstDateFormat('MM/dd/yyyy')).toBe(false);
    expect(isDayFirstDateFormat('yyyy-MM-dd')).toBe(false);
    expect(isDayFirstDateFormat('yyyy. MM. dd.')).toBe(false);
  });

  it('should fall back to month-first when the format has no placeholders', () => {
    // e.g. a locale formatting with non-latin digits
    expect(isDayFirstDateFormat('۱۳۷۹/۱۰/۱۱')).toBe(false);
  });
});
