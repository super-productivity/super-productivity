import {
  clampStartOfNextDayMinutes,
  getStartOfNextDayDiffMs,
  getStartOfNextDayHourFromTimeString,
  parseStartOfNextDayTimeToMinutes,
} from './start-of-next-day.util';

describe('start-of-next-day util', () => {
  describe('parseStartOfNextDayTimeToMinutes()', () => {
    it('parses a numeric hour as minutes', () => {
      expect(parseStartOfNextDayTimeToMinutes(2)).toBe(120);
    });

    it('parses HH:mm strings', () => {
      expect(parseStartOfNextDayTimeToMinutes('05:30')).toBe(330);
    });

    it('defaults missing minutes to zero', () => {
      expect(parseStartOfNextDayTimeToMinutes('05')).toBe(300);
    });

    it('returns 0 for invalid inputs', () => {
      expect(parseStartOfNextDayTimeToMinutes('foo:bar')).toBe(0);
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

    it('returns 0 for empty or invalid hours', () => {
      expect(getStartOfNextDayHourFromTimeString(':30')).toBe(0);
      expect(getStartOfNextDayHourFromTimeString('foo:00')).toBeUndefined();
    });

    it('clamps minutes above 59 and returns the hour', () => {
      expect(getStartOfNextDayHourFromTimeString('23:70')).toBe(23);
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
    });
  });
});
