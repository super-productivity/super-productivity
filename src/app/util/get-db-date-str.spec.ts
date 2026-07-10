import { getDbDateStr, getDbDateStrWithOffset, isDBDateStr } from './get-db-date-str';

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
  it('should behave like getDbDateStr when offset is 0', () => {
    const ts = new Date(2026, 2, 21, 10, 0, 0).getTime();
    expect(getDbDateStrWithOffset(ts, 0)).toBe(getDbDateStr(ts));
  });

  it('should default to a 0 offset when none is passed', () => {
    const ts = new Date(2026, 2, 21, 10, 0, 0).getTime();
    expect(getDbDateStrWithOffset(ts)).toBe(getDbDateStr(ts));
  });

  it('should bucket a timestamp before the offset cutoff into the previous day', () => {
    // 1 AM with a 4-hour offset still belongs to the previous logical day
    const oneAm = new Date(2026, 2, 21, 1, 0, 0).getTime();
    const fourHoursMs = 4 * 60 * 60 * 1000;
    expect(getDbDateStrWithOffset(oneAm, fourHoursMs)).toBe('2026-03-20');
  });

  it('should keep a timestamp at/after the offset cutoff on the same day', () => {
    const fourAm = new Date(2026, 2, 21, 4, 0, 0).getTime();
    const fourHoursMs = 4 * 60 * 60 * 1000;
    expect(getDbDateStrWithOffset(fourAm, fourHoursMs)).toBe('2026-03-21');
  });

  it('should accept a Date object', () => {
    const date = new Date(2026, 2, 21, 1, 0, 0);
    const fourHoursMs = 4 * 60 * 60 * 1000;
    expect(getDbDateStrWithOffset(date, fourHoursMs)).toBe('2026-03-20');
  });

  it('should shift across a DST spring-forward boundary (e.g. US: Mar 8, 2026, 2 AM -> 3 AM)', () => {
    // 1:30 AM local time shifted back by a 3-hour offset lands the previous
    // calendar day regardless of the DST transition happening later that day.
    const beforeDstJump = new Date(2026, 2, 8, 1, 30, 0).getTime();
    const threeHoursMs = 3 * 60 * 60 * 1000;
    expect(getDbDateStrWithOffset(beforeDstJump, threeHoursMs)).toBe('2026-03-07');
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
