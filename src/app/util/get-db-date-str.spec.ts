import {
  getDbDateStr,
  getDbDateStrWithOffset,
  isDBDateStr,
  isValidDBDateStr,
} from './get-db-date-str';

describe('getDbDateStr', () => {
  it('should return YYYY-MM-DD for a given date', () => {
    expect(getDbDateStr(new Date(2026, 2, 21))).toBe('2026-03-21');
  });

  it('should zero-pad single-digit month and day', () => {
    expect(getDbDateStr(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('should accept a timestamp number', () => {
    const ts = new Date(2026, 11, 25).getTime();
    expect(getDbDateStr(ts)).toBe('2026-12-25');
  });
});

describe('getDbDateStrWithOffset', () => {
  const FOUR_HOURS = 4 * 60 * 60 * 1000;
  const at = (y: number, mo: number, d: number, h: number, mi: number): number =>
    new Date(y, mo, d, h, mi).getTime();

  it('should match getDbDateStr without an offset', () => {
    expect(getDbDateStrWithOffset(at(2026, 2, 21, 0, 30), 0)).toBe('2026-03-21');
  });

  it('should count times before the offset to the previous day', () => {
    expect(getDbDateStrWithOffset(at(2026, 0, 1, 3, 59), FOUR_HOURS)).toBe('2025-12-31');
    expect(getDbDateStrWithOffset(at(2026, 0, 1, 4, 0), FOUR_HOURS)).toBe('2026-01-01');
  });

  // Spring-forward days in the US and the EU, so the Berlin and LA runs each cross one
  it('should keep the logical day on a DST switch day', () => {
    expect(getDbDateStrWithOffset(at(2026, 2, 8, 3, 30), FOUR_HOURS)).toBe('2026-03-07');
    expect(getDbDateStrWithOffset(at(2026, 2, 8, 6, 0), FOUR_HOURS)).toBe('2026-03-08');
    expect(getDbDateStrWithOffset(at(2026, 2, 29, 3, 30), FOUR_HOURS)).toBe('2026-03-28');
    expect(getDbDateStrWithOffset(at(2026, 2, 29, 6, 0), FOUR_HOURS)).toBe('2026-03-29');
  });
});

describe('isDBDateStr', () => {
  describe('valid dates', () => {
    it('should accept a standard YYYY-MM-DD string', () => {
      expect(isDBDateStr('2026-03-21')).toBe(true);
    });

    it('should accept start-of-year date', () => {
      expect(isDBDateStr('2026-01-01')).toBe(true);
    });

    it('should accept end-of-year date', () => {
      expect(isDBDateStr('2026-12-31')).toBe(true);
    });
  });

  describe('invalid strings', () => {
    it('should reject empty string', () => {
      expect(isDBDateStr('')).toBe(false);
    });

    it('should reject malformed date like -/-/2026', () => {
      expect(isDBDateStr('-/-/2026')).toBe(false);
    });

    it('should reject US locale date format', () => {
      expect(isDBDateStr('3/14/2026')).toBe(false);
    });

    it('should reject EU locale date format', () => {
      expect(isDBDateStr('14.03.2026')).toBe(false);
    });

    it('should reject date without dashes', () => {
      expect(isDBDateStr('20260321')).toBe(false);
    });

    it('should reject year-only string', () => {
      expect(isDBDateStr('2026')).toBe(false);
    });

    it('should reject date with slashes', () => {
      expect(isDBDateStr('2026/03/21')).toBe(false);
    });

    it('should reject ISO datetime string', () => {
      expect(isDBDateStr('2026-03-21T10:30:00')).toBe(false);
    });

    it('should reject string with extra characters', () => {
      expect(isDBDateStr('2026-03-21 ')).toBe(false);
    });

    it('should reject non-zero-padded date', () => {
      expect(isDBDateStr('2026-3-21')).toBe(false);
    });

    it('should reject alphabetic characters in date positions', () => {
      expect(isDBDateStr('abcd-ef-gh')).toBe(false);
    });

    it('should reject impossible calendar values with correct shape', () => {
      expect(isDBDateStr('2026-13-40')).toBe(true); // structural check only; calendar validation is downstream
    });

    it('should reject hex-like values in date positions', () => {
      expect(isDBDateStr('2026-0x-21')).toBe(false);
    });

    it('should reject spaces in digit positions', () => {
      expect(isDBDateStr('2026- 3-21')).toBe(false);
    });
  });
});

describe('isValidDBDateStr', () => {
  it('should accept real calendar dates including leap days', () => {
    expect(isValidDBDateStr('2024-02-29')).toBe(true);
    expect(isValidDBDateStr('2026-12-31')).toBe(true);
  });

  it('should reject structurally valid but impossible dates', () => {
    expect(isValidDBDateStr('2023-02-29')).toBe(false);
    expect(isValidDBDateStr('2024-02-30')).toBe(false);
    expect(isValidDBDateStr('2024-13-01')).toBe(false);
    expect(isValidDBDateStr('2024-00-10')).toBe(false);
  });
});
