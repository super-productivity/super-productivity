import {
  getNthWeekdayOfMonth,
  hasNthWeekdayAnchor,
} from './get-nth-weekday-of-month.util';

describe('getNthWeekdayOfMonth()', () => {
  it('returns the 1st Monday of January 2026', () => {
    // Jan 2026 starts Thursday → 1st Monday is Jan 5.
    const result = getNthWeekdayOfMonth(2026, 0, 1, 1);
    expect(result).toEqual(new Date(2026, 0, 5, 12, 0, 0, 0));
  });

  it('returns the 2nd Tuesday of February 2026', () => {
    // Feb 2026 starts Sunday → Tuesdays are 3, 10, 17, 24. 2nd = Feb 10.
    const result = getNthWeekdayOfMonth(2026, 1, 2, 2);
    expect(result).toEqual(new Date(2026, 1, 10, 12, 0, 0, 0));
  });

  it('returns the 4th Wednesday of December 2026', () => {
    // Dec 2026 Wednesdays: 2, 9, 16, 23, 30. 4th = Dec 23.
    const result = getNthWeekdayOfMonth(2026, 11, 3, 4);
    expect(result).toEqual(new Date(2026, 11, 23, 12, 0, 0, 0));
  });

  it('returns the last Tuesday of March 2026 (5 occurrences)', () => {
    // Mar 2026 Tuesdays: 3, 10, 17, 24, 31 (5). Last = Mar 31.
    const result = getNthWeekdayOfMonth(2026, 2, 2, -1);
    expect(result).toEqual(new Date(2026, 2, 31, 12, 0, 0, 0));
  });

  it('returns the last Sunday of February 2026 (4 occurrences)', () => {
    // Feb 2026 Sundays: 1, 8, 15, 22. Last = Feb 22.
    const result = getNthWeekdayOfMonth(2026, 1, 0, -1);
    expect(result).toEqual(new Date(2026, 1, 22, 12, 0, 0, 0));
  });

  it('returns the 4th occurrence in a 28-day month (always exists)', () => {
    // Every month has at least 4 occurrences of every weekday, so n<=4 always
    // resolves. Feb 2026 (28 days) Sundays: 1, 8, 15, 22 → 4th = Feb 22.
    const result = getNthWeekdayOfMonth(2026, 1, 0, 4);
    expect(result).toEqual(new Date(2026, 1, 22, 12, 0, 0, 0));
  });
});

describe('hasNthWeekdayAnchor()', () => {
  it('returns true when both anchor fields are set and in range', () => {
    expect(hasNthWeekdayAnchor({ monthlyWeekOfMonth: 2, monthlyWeekday: 1 })).toBe(true);
  });

  it('returns false when an anchor field is missing', () => {
    expect(hasNthWeekdayAnchor({ monthlyWeekOfMonth: 2 })).toBe(false);
    expect(hasNthWeekdayAnchor({ monthlyWeekday: 1 })).toBe(false);
    expect(hasNthWeekdayAnchor({})).toBe(false);
  });

  it('rejects out-of-range anchor values (defends against malformed sync payloads)', () => {
    const make = (w: number, d: number): Parameters<typeof hasNthWeekdayAnchor>[0] => ({
      monthlyWeekOfMonth: w as never,
      monthlyWeekday: d as never,
    });
    expect(hasNthWeekdayAnchor(make(0, 1))).toBe(false);
    expect(hasNthWeekdayAnchor(make(5, 1))).toBe(false);
    expect(hasNthWeekdayAnchor(make(-2, 1))).toBe(false);
    expect(hasNthWeekdayAnchor(make(1.5, 1))).toBe(false);
    expect(hasNthWeekdayAnchor(make(2, -1))).toBe(false);
    expect(hasNthWeekdayAnchor(make(2, 7))).toBe(false);
    expect(hasNthWeekdayAnchor(make(2, 1.5))).toBe(false);
    // Sanity: well-formed values still pass.
    expect(hasNthWeekdayAnchor(make(-1, 0))).toBe(true);
    expect(hasNthWeekdayAnchor(make(4, 6))).toBe(true);
  });
});
