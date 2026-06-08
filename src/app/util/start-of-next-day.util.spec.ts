import {
  clampStartOfNextDayMinutes,
  getStartOfNextDayDiffMs,
  getStartOfNextDayHourFromTimeString,
  getValidStartOfNextDayHour,
  parseStartOfNextDayTimeToMinutes,
} from './start-of-next-day.util';

describe('start-of-next-day util', () => {
  describe('parseStartOfNextDayTimeToMinutes()', () => {
    it('parses a numeric hour as minutes', () => {
      expect(parseStartOfNextDayTimeToMinutes(2)).toBe(120);
    });

    it('parses HH:mm strings', () => {
      expect(parseStartOfNextDayTimeToMinutes('05:30')).toBe(330);
      expect(parseStartOfNextDayTimeToMinutes('5:30')).toBe(330);
    });

    it('returns 0 for strings that do not match HH:mm', () => {
      expect(parseStartOfNextDayTimeToMinutes('05')).toBe(0);
    });

    it('returns 0 for invalid inputs', () => {
      expect(parseStartOfNextDayTimeToMinutes('foo:bar')).toBe(0);
    });

    it('returns 0 for invalid minute values', () => {
      expect(parseStartOfNextDayTimeToMinutes('05:99')).toBe(0);
    });

    it('returns 0 for non-finite numeric inputs', () => {
      expect(parseStartOfNextDayTimeToMinutes(NaN)).toBe(0);
      expect(parseStartOfNextDayTimeToMinutes(Infinity)).toBe(0);
    });

    it('returns 0 for out-of-range numeric inputs', () => {
      expect(parseStartOfNextDayTimeToMinutes(-1)).toBe(0);
      expect(parseStartOfNextDayTimeToMinutes(24)).toBe(0);
      expect(parseStartOfNextDayTimeToMinutes(111)).toBe(0);
    });
  });

  describe('clampStartOfNextDayMinutes()', () => {
    it('clamps negative values to 0', () => {
      expect(clampStartOfNextDayMinutes(-10)).toBe(0);
    });

    it('clamps values above end of day to 1439', () => {
      expect(clampStartOfNextDayMinutes(24 * 60)).toBe(1439);
    });
  });

  describe('getStartOfNextDayHourFromTimeString()', () => {
    it('returns the hour from a valid HH:mm string', () => {
      expect(getStartOfNextDayHourFromTimeString('05:30')).toBe(5);
    });

    it('returns undefined for empty or invalid hours', () => {
      expect(getStartOfNextDayHourFromTimeString(':30')).toBeUndefined();
      expect(getStartOfNextDayHourFromTimeString('foo:00')).toBeUndefined();
    });

    it('returns undefined for minutes above 59', () => {
      expect(getStartOfNextDayHourFromTimeString('23:70')).toBeUndefined();
    });

    it('returns undefined for malformed numeric-looking strings', () => {
      expect(getStartOfNextDayHourFromTimeString('05')).toBeUndefined();
      expect(getStartOfNextDayHourFromTimeString('111')).toBeUndefined();
      expect(getStartOfNextDayHourFromTimeString('24:00')).toBeUndefined();
    });

    it('returns undefined for non-string runtime inputs', () => {
      expect(
        getStartOfNextDayHourFromTimeString(null as unknown as string),
      ).toBeUndefined();
      expect(
        getStartOfNextDayHourFromTimeString(undefined as unknown as string),
      ).toBeUndefined();
      expect(getStartOfNextDayHourFromTimeString(0 as unknown as string)).toBeUndefined();
    });
  });

  describe('getValidStartOfNextDayHour()', () => {
    it('returns the floored hour for finite values in range', () => {
      expect(getValidStartOfNextDayHour(0)).toBe(0);
      expect(getValidStartOfNextDayHour(2.5)).toBe(2);
      expect(getValidStartOfNextDayHour(23)).toBe(23);
    });

    it('returns undefined for values outside the supported hour range', () => {
      expect(getValidStartOfNextDayHour(undefined)).toBeUndefined();
      expect(getValidStartOfNextDayHour(-1)).toBeUndefined();
      expect(getValidStartOfNextDayHour(24)).toBeUndefined();
      expect(getValidStartOfNextDayHour(111)).toBeUndefined();
      expect(getValidStartOfNextDayHour(NaN)).toBeUndefined();
      expect(getValidStartOfNextDayHour(Infinity)).toBeUndefined();
    });
  });

  describe('getStartOfNextDayDiffMs()', () => {
    it('uses startOfNextDayTime when provided', () => {
      expect(getStartOfNextDayDiffMs('01:30', undefined)).toBe(90 * 60 * 1000);
    });

    it('uses startOfNextDay numeric hour when time is absent', () => {
      expect(getStartOfNextDayDiffMs(undefined, 2)).toBe(2 * 60 * 60 * 1000);
    });

    it('returns 0 for missing values', () => {
      expect(getStartOfNextDayDiffMs(undefined, undefined)).toBe(0);
    });
    it('returns 9,000,000 ms for 02:30', () => {
      expect(getStartOfNextDayDiffMs('02:30', undefined)).toBe(9_000_000);
    });

    it('returns 0 for malformed or empty time strings', () => {
      expect(getStartOfNextDayDiffMs('', undefined)).toBe(0);
      expect(getStartOfNextDayDiffMs('bad', undefined)).toBe(0);
      expect(getStartOfNextDayDiffMs('111', undefined)).toBe(0);
      expect(getStartOfNextDayDiffMs('24:00', undefined)).toBe(0);
    });

    it('falls back to the legacy numeric hour when the time string is invalid', () => {
      expect(getStartOfNextDayDiffMs('24:00', 2)).toBe(2 * 60 * 60 * 1000);
    });

    it('returns 0 for invalid legacy numeric values', () => {
      expect(getStartOfNextDayDiffMs(undefined, -1)).toBe(0);
      expect(getStartOfNextDayDiffMs(undefined, 24)).toBe(0);
      expect(getStartOfNextDayDiffMs(undefined, 111)).toBe(0);
    });

    it('returns 0 for non-finite legacy numeric values', () => {
      expect(getStartOfNextDayDiffMs(undefined, NaN)).toBe(0);
      expect(getStartOfNextDayDiffMs(undefined, Infinity)).toBe(0);
    });
  });
});
