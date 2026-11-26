import {
  getNextWorkWeekDays,
  getWorkWeekStart,
  isFinishWeekDay,
  isFinishWeekScope,
} from './finish-week.util';
import { getDbDateStr } from '../../util/get-db-date-str';

describe('finish-week util', () => {
  describe('isFinishWeekDay', () => {
    it('is true on a Friday', () => {
      expect(isFinishWeekDay(new Date(2026, 9, 30, 18))).toBe(true);
    });

    it('is false on other days', () => {
      expect(isFinishWeekDay(new Date(2026, 9, 29, 18))).toBe(false);
      expect(isFinishWeekDay(new Date(2026, 9, 31, 18))).toBe(false);
    });
  });

  describe('getNextWorkWeekDays', () => {
    const next = (d: Date): string[] => getNextWorkWeekDays(d).map(getDbDateStr);
    const NEXT_WEEK = [
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
    ];

    it('returns next Monday to Friday on a Friday', () => {
      expect(next(new Date(2026, 9, 30, 18))).toEqual(NEXT_WEEK);
    });

    it('returns next Monday to Friday on a weekend', () => {
      expect(next(new Date(2026, 9, 31, 10))).toEqual(NEXT_WEEK);
      expect(next(new Date(2026, 10, 1, 10))).toEqual(NEXT_WEEK);
    });

    it('skips the current Monday', () => {
      expect(next(new Date(2026, 9, 26, 10))).toEqual(NEXT_WEEK);
    });

    it('keeps calendar days across a DST change', () => {
      // Europe/Berlin leaves DST on 2026-10-25
      expect(next(new Date(2026, 9, 23, 23, 30))).toEqual([
        '2026-10-26',
        '2026-10-27',
        '2026-10-28',
        '2026-10-29',
        '2026-10-30',
      ]);
    });
  });

  describe('isFinishWeekScope', () => {
    it('is on for Fridays and for ?scope=week on other days', () => {
      expect(isFinishWeekScope(new Date(2026, 9, 30, 18), null)).toBe(true);
      expect(isFinishWeekScope(new Date(2026, 9, 29, 18), 'week')).toBe(true);
    });

    it('is off on other days without the param', () => {
      expect(isFinishWeekScope(new Date(2026, 9, 29, 18), null)).toBe(false);
      expect(isFinishWeekScope(new Date(2026, 9, 29, 18), 'day')).toBe(false);
    });
  });

  describe('getWorkWeekStart', () => {
    const start = (d: Date): string => getDbDateStr(getWorkWeekStart(d));

    it('returns the Monday of the same week on work days', () => {
      expect(start(new Date(2026, 9, 26, 9))).toBe('2026-10-26');
      expect(start(new Date(2026, 9, 30, 18))).toBe('2026-10-26');
    });

    it('returns the Monday before on a weekend', () => {
      expect(start(new Date(2026, 9, 31, 12))).toBe('2026-10-26');
      expect(start(new Date(2026, 10, 1, 12))).toBe('2026-10-26');
    });
  });
});
