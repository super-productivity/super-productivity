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

    // Saturday-start week Jan 4–10, 2020: Mon 6 – Fri 10 are ISO week 2
    d = new Date(2020, 0, 8); // January 8, 2020 local time
    result = getWeekNumber(d, 6);
    expect(result).toBe(2);
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

  // #11855: a week not starting on Monday spans two ISO weeks; it must get the
  // ISO number of the week holding most of its days
  it('should number a Sunday-start week by its ISO week', () => {
    // Sun Nov 15 – Sat Nov 21, 2026; Mon 16 – Sat 21 are 2026-W47
    expect(getWeekNumber(new Date(2026, 10, 15), 0)).toBe(47);
    expect(getWeekNumber(new Date(2026, 10, 18), 0)).toBe(47);
    expect(getWeekNumber(new Date(2026, 10, 21), 0)).toBe(47);
    expect(getWeekNumber(new Date(2026, 10, 8), 0)).toBe(46);
  });

  it('should number a Saturday-start week by its ISO week', () => {
    // Sat Nov 14 – Fri Nov 20, 2026; Mon 16 – Fri 20 are 2026-W47
    expect(getWeekNumber(new Date(2026, 10, 14), 6)).toBe(47);
    expect(getWeekNumber(new Date(2026, 10, 20), 6)).toBe(47);
  });

  it('should handle a Sunday-start week crossing the year boundary', () => {
    // Sun Dec 27, 2026 – Sat Jan 2, 2027; Mon 28 – Thu 31 are 2026-W53
    expect(getWeekNumber(new Date(2027, 0, 2), 0)).toBe(53);
  });
});
