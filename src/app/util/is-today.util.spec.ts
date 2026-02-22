import { isTodayWithOffset } from './is-today.util';
import { getDbDateStr } from './get-db-date-str';

describe('isTodayWithOffset', () => {
  describe('zero offset (baseline)', () => {
    it('should return true for a timestamp from today', () => {
      const now = new Date();
      const todayStr = getDbDateStr(now);

      expect(isTodayWithOffset(now.getTime(), todayStr, 0)).toBe(true);
    });

    it('should return false for a timestamp from yesterday', () => {
      const now = new Date();
      const todayStr = getDbDateStr(now);
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);

      expect(isTodayWithOffset(yesterday.getTime(), todayStr, 0)).toBe(false);
    });

    it('should return false for a timestamp from tomorrow', () => {
      const now = new Date();
      const todayStr = getDbDateStr(now);
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);

      expect(isTodayWithOffset(tomorrow.getTime(), todayStr, 0)).toBe(false);
    });
  });

  describe('positive offset (4 hours = day starts at 4 AM)', () => {
    const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
    const todayStr = '2026-02-15';

    it('should return true for 2 AM Feb 16 (2AM - 4h = 10PM Feb 15 = today)', () => {
      // 2 AM on Feb 16
      const timestamp = new Date(2026, 1, 16, 2, 0, 0).getTime();

      expect(isTodayWithOffset(timestamp, todayStr, FOUR_HOURS_MS)).toBe(true);
    });

    it('should return false for 5 AM Feb 16 (5AM - 4h = 1AM Feb 16 != Feb 15)', () => {
      // 5 AM on Feb 16
      const timestamp = new Date(2026, 1, 16, 5, 0, 0).getTime();

      expect(isTodayWithOffset(timestamp, todayStr, FOUR_HOURS_MS)).toBe(false);
    });

    it('should return false for 11 PM Feb 14 (11PM - 4h = 7PM Feb 14 != Feb 15)', () => {
      // 11 PM on Feb 14
      const timestamp = new Date(2026, 1, 14, 23, 0, 0).getTime();

      expect(isTodayWithOffset(timestamp, todayStr, FOUR_HOURS_MS)).toBe(false);
    });

    it('should return true for 3:59 AM Feb 16 (boundary, just before cutoff)', () => {
      // 3:59 AM on Feb 16
      const timestamp = new Date(2026, 1, 16, 3, 59, 0).getTime();

      expect(isTodayWithOffset(timestamp, todayStr, FOUR_HOURS_MS)).toBe(true);
    });

    it('should return false for 4:00 AM Feb 16 (boundary, exactly at cutoff)', () => {
      // 4:00 AM on Feb 16
      const timestamp = new Date(2026, 1, 16, 4, 0, 0).getTime();

      expect(isTodayWithOffset(timestamp, todayStr, FOUR_HOURS_MS)).toBe(false);
    });

    it('should return true for 4:00 AM Feb 15 (start of offset-adjusted day)', () => {
      // 4:00 AM on Feb 15
      const timestamp = new Date(2026, 1, 15, 4, 0, 0).getTime();

      expect(isTodayWithOffset(timestamp, todayStr, FOUR_HOURS_MS)).toBe(true);
    });

    it('should return false for 3:59 AM Feb 15 (belongs to Feb 14)', () => {
      // 3:59 AM on Feb 15
      const timestamp = new Date(2026, 1, 15, 3, 59, 0).getTime();

      expect(isTodayWithOffset(timestamp, todayStr, FOUR_HOURS_MS)).toBe(false);
    });
  });

  describe('Date object input', () => {
    it('should work with a Date object the same as with a timestamp', () => {
      const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
      const todayStr = '2026-02-15';
      const dateObj = new Date(2026, 1, 15, 12, 0, 0);

      expect(isTodayWithOffset(dateObj, todayStr, FOUR_HOURS_MS)).toBe(true);
    });

    it('should return the same result for Date object and its timestamp', () => {
      const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
      const todayStr = '2026-02-15';
      const dateObj = new Date(2026, 1, 16, 2, 0, 0);
      const timestamp = dateObj.getTime();

      expect(isTodayWithOffset(dateObj, todayStr, FOUR_HOURS_MS)).toBe(
        isTodayWithOffset(timestamp, todayStr, FOUR_HOURS_MS),
      );
    });
  });

  describe('invalid date', () => {
    it('should throw for NaN timestamp', () => {
      expect(() => isTodayWithOffset(NaN, '2026-02-15', 0)).toThrowError(
        'Invalid date passed',
      );
    });

    it('should throw for an invalid Date object', () => {
      expect(() => isTodayWithOffset(new Date('invalid'), '2026-02-15', 0)).toThrowError(
        'Invalid date passed',
      );
    });
  });
});
