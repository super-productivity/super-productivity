import {
  isWithinYesterdayMargin,
  YESTERDAY_MARGIN_MS,
} from './is-include-yesterday.util';

const atLocal = (y: number, m: number, d: number, h: number, min = 0): number =>
  new Date(y, m, d, h, min, 0).getTime();

describe('isWithinYesterdayMargin', () => {
  describe('startOfNextDay = 0 (midnight boundary)', () => {
    const startOfNextDayMs = 0;

    it('returns true at 00:30 (30 min after boundary)', () => {
      const now = atLocal(2026, 3, 6, 0, 30);
      expect(isWithinYesterdayMargin(now, startOfNextDayMs)).toBe(true);
    });

    it('returns true at 03:59 (just before margin expires)', () => {
      const now = atLocal(2026, 3, 6, 3, 59);
      expect(isWithinYesterdayMargin(now, startOfNextDayMs)).toBe(true);
    });

    it('returns false at 05:00 (margin expired)', () => {
      const now = atLocal(2026, 3, 6, 5, 0);
      expect(isWithinYesterdayMargin(now, startOfNextDayMs)).toBe(false);
    });

    it('returns true exactly at boundary', () => {
      const now = atLocal(2026, 3, 6, 0, 0);
      expect(isWithinYesterdayMargin(now, startOfNextDayMs)).toBe(true);
    });
  });

  describe('startOfNextDay = 1h (boundary = 01:00)', () => {
    const startOfNextDayMs = 1 * 60 * 60 * 1000;

    it('returns false at 00:30 (still previous logical day)', () => {
      // This is the core bug case from issue #7157.
      // Calendar = Apr 6 00:30, but logically still Apr 5 because boundary is 01:00.
      // Old code used calendar midnight and returned true here, incorrectly pulling
      // yesterday's tasks into today's summary while we were still viewing yesterday.
      const now = atLocal(2026, 3, 6, 0, 30);
      expect(isWithinYesterdayMargin(now, startOfNextDayMs)).toBe(false);
    });

    it('returns true at 01:00 (exactly at boundary)', () => {
      const now = atLocal(2026, 3, 6, 1, 0);
      expect(isWithinYesterdayMargin(now, startOfNextDayMs)).toBe(true);
    });

    it('returns true at 04:59 (just before margin expires)', () => {
      const now = atLocal(2026, 3, 6, 4, 59);
      expect(isWithinYesterdayMargin(now, startOfNextDayMs)).toBe(true);
    });

    it('returns false at 05:01 (margin expired)', () => {
      const now = atLocal(2026, 3, 6, 5, 1);
      expect(isWithinYesterdayMargin(now, startOfNextDayMs)).toBe(false);
    });
  });

  describe('startOfNextDay = 4h (boundary = 04:00)', () => {
    const startOfNextDayMs = 4 * 60 * 60 * 1000;

    it('returns false at 02:00 (before boundary, still previous logical day)', () => {
      const now = atLocal(2026, 3, 6, 2, 0);
      expect(isWithinYesterdayMargin(now, startOfNextDayMs)).toBe(false);
    });

    it('returns true at 06:30 (2.5h into new logical day, within margin)', () => {
      // Old buggy code returned false here because calendar midnight was 6.5h ago,
      // exceeding the 4h hardcoded margin. But logically the day just started 2.5h ago.
      const now = atLocal(2026, 3, 6, 6, 30);
      expect(isWithinYesterdayMargin(now, startOfNextDayMs)).toBe(true);
    });

    it('returns false at 08:01 (more than margin past boundary)', () => {
      const now = atLocal(2026, 3, 6, 8, 1);
      expect(isWithinYesterdayMargin(now, startOfNextDayMs)).toBe(false);
    });

    it('returns true at 04:00 exactly', () => {
      const now = atLocal(2026, 3, 6, 4, 0);
      expect(isWithinYesterdayMargin(now, startOfNextDayMs)).toBe(true);
    });
  });

  describe('custom margin', () => {
    it('respects a shorter custom margin', () => {
      const oneHour = 60 * 60 * 1000;
      const now = atLocal(2026, 3, 6, 2, 0);
      expect(isWithinYesterdayMargin(now, 0, oneHour)).toBe(false);
      expect(isWithinYesterdayMargin(now, 0, YESTERDAY_MARGIN_MS)).toBe(true);
    });
  });
});
