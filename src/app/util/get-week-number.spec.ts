import { getWeekNumber } from './get-week-number';

describe('getWeekNumber()', () => {
  it('should return valid value', () => {
    const d = new Date(2020, 6, 6); // July 6, 2020 local time (month is 0-indexed)
    const result = getWeekNumber(d);
    expect(result).toBe(28);
  });

  it('should return a valid value for first of the year', () => {
    const d = new Date(2020, 0, 1); // January 1, 2020 local time
    const result = getWeekNumber(d);
    expect(result).toBe(1);
  });

  it('should return a valid value for 2020-01-08 based on first day of week', () => {
    let d = new Date(2020, 0, 8); // January 8, 2020 local time
    let result = getWeekNumber(d);
    expect(result).toBe(2);

    d = new Date(2020, 0, 8); // January 8, 2020 local time
    result = getWeekNumber(d, 6);
    expect(result).toBe(1);
  });

  it('should return a valid value for last of the year', () => {
    const d = new Date(2020, 11, 31); // December 31, 2020 local time
    const result = getWeekNumber(d);
    expect(result).toBe(53);
  });

  it('should return a valid value for last of the year', () => {
    const d = new Date(2021, 11, 31); // December 31, 2021 local time
    const result = getWeekNumber(d);
    expect(result).toBe(52);
  });

  // ISO week tests
  describe('ISO week', () => {
    it('should return ISO week 1 for 2020-01-01 (Wednesday)', () => {
      const d = new Date(2020, 0, 1); // January 1, 2020 is a Wednesday
      const result = getWeekNumber(d, 1, 'iso'); // Monday first
      expect(result).toBe(1); // Week containing first Thursday
    });

    it('should return ISO week 53 for 2020-12-31 (Thursday)', () => {
      const d = new Date(2020, 11, 31); // December 31, 2020 is a Thursday
      const result = getWeekNumber(d, 1, 'iso'); // Monday first
      expect(result).toBe(53);
    });

    it('should return ISO week 52 for 2021-12-31 (Friday)', () => {
      const d = new Date(2021, 11, 31); // December 31, 2021 is a Friday (not in ISO week 1 of 2022)
      const result = getWeekNumber(d, 1, 'iso'); // Monday first
      expect(result).toBe(52);
    });
  });

  // US week tests
  describe('US week', () => {
    it('should return US week 1 for 2020-01-01 (Wednesday, week containing Jan 1)', () => {
      const d = new Date(2020, 0, 1); // January 1, 2020 is a Wednesday
      const result = getWeekNumber(d, 0, 'us'); // Sunday first
      expect(result).toBe(1); // Week containing Jan 1
    });

    it('should return US week 1 for 2021-01-01 (Friday, week containing Jan 1)', () => {
      const d = new Date(2021, 0, 1); // January 1, 2021 is a Friday
      const result = getWeekNumber(d, 0, 'us'); // Sunday first
      expect(result).toBe(1); // Week containing Jan 1
    });

    it('should return US week 1 for 2022-01-01 (Saturday, week containing Jan 1)', () => {
      const d = new Date(2022, 0, 1); // January 1, 2022 is a Saturday
      const result = getWeekNumber(d, 0, 'us'); // Sunday first
      expect(result).toBe(1); // Week containing Jan 1
    });

    it('should return US week 1 for 2021-01-02 (Saturday, belongs to week containing Jan 1)', () => {
      const d = new Date(2021, 0, 2); // January 2, 2021 (Saturday)
      // This Saturday is in the week starting Sunday Jan 3, which contains Jan 1
      // So it should be week 1, not week 52 of previous year
      const result = getWeekNumber(d, 0, 'us'); // Sunday first
      expect(result).toBe(1); // Week containing Jan 1
    });

    it('should handle edge case: week spanning year boundary', () => {
      // Week of Dec 27, 2026 - Jan 2, 2027
      // Jan 1, 2027 is Friday, so US week 1 starts Sunday Dec 27, 2026
      const d = new Date(2026, 11, 27); // December 27, 2026
      const result = getWeekNumber(d, 0, 'us'); // Sunday first
      expect(result).toBe(1); // This is US week 1 of 2027 (week containing Jan 1, 2027)
    });

    it('should return correct week for dates near year end in US system', () => {
      // December 2026: Week of Dec 27 is US week 1 of 2027
      // So Dec 27-31, 2026 should be week 1 of 2027
      const d = new Date(2026, 11, 30); // December 30, 2026
      const result = getWeekNumber(d, 0, 'us'); // Sunday first
      expect(result).toBe(1); // US week 1 of 2027
    });

    it('should return US week 1 for 2023-01-01 (Sunday, week containing Jan 1)', () => {
      const d = new Date(2023, 0, 1); // January 1, 2023 is a Sunday (starts week 1)
      const result = getWeekNumber(d, 0, 'us'); // Sunday first
      expect(result).toBe(1);
    });

    it('should handle week starting before Jan 1 but containing it', () => {
      // Week of Dec 31, 2023 - Jan 6, 2024
      // Jan 1, 2024 is Monday, so US week 1 starts Sunday Dec 31, 2023
      const d = new Date(2024, 0, 1); // January 1, 2024
      const result = getWeekNumber(d, 0, 'us'); // Sunday first
      expect(result).toBe(1); // Week containing Jan 1
    });
  });
});
