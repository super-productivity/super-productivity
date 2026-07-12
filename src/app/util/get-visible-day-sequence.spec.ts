import { getDbDateStr } from './get-db-date-str';
import { getVisibleDaySequence } from './get-visible-day-sequence';

describe('getVisibleDaySequence', () => {
  describe('multi-day sequences', () => {
    it('should return the requested number of consecutive day strings', () => {
      const start = new Date(2026, 0, 20, 10, 0, 0).getTime();
      const result = getVisibleDaySequence(start, 5);

      expect(result).toEqual([
        '2026-01-20',
        '2026-01-21',
        '2026-01-22',
        '2026-01-23',
        '2026-01-24',
      ]);
    });

    it('should start on the day of startMs', () => {
      const start = new Date(2026, 0, 20, 10, 0, 0).getTime();
      const result = getVisibleDaySequence(start, 1);

      expect(result).toEqual([getDbDateStr(start)]);
    });

    it('should return an empty array for count 0', () => {
      const start = new Date(2026, 0, 20).getTime();
      expect(getVisibleDaySequence(start, 0)).toEqual([]);
    });

    it('should roll over month and year boundaries', () => {
      const start = new Date(2025, 11, 30).getTime(); // Dec 30, 2025
      const result = getVisibleDaySequence(start, 4);

      expect(result).toEqual(['2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02']);
    });
  });

  describe('DST boundary (US spring-forward, Mar 8 2026)', () => {
    it('should produce exactly one entry per calendar day with no skip or repeat', () => {
      const start = new Date(2026, 2, 7, 0, 0, 0).getTime(); // day before the jump
      const result = getVisibleDaySequence(start, 4);

      expect(result).toEqual(['2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10']);
    });
  });

  describe('includedWeekDays filter', () => {
    it('should skip days not in includedWeekDays and still return `count` matches', () => {
      // 2026-01-19 is a Monday
      const monday = new Date(2026, 0, 19).getTime();
      // Weekdays only (Mon-Fri)
      const result = getVisibleDaySequence(monday, 5, [1, 2, 3, 4, 5]);

      expect(result).toEqual([
        '2026-01-19', // Mon
        '2026-01-20', // Tue
        '2026-01-21', // Wed
        '2026-01-22', // Thu
        '2026-01-23', // Fri
      ]);
    });

    it('should skip weekend days when the range spans one', () => {
      // 2026-01-23 is a Friday
      const friday = new Date(2026, 0, 23).getTime();
      const result = getVisibleDaySequence(friday, 2, [1, 2, 3, 4, 5]);

      // Sat 24th and Sun 25th are skipped
      expect(result).toEqual(['2026-01-23', '2026-01-26']);
    });

    it('should return an empty array when includedWeekDays is empty', () => {
      const start = new Date(2026, 0, 19).getTime();
      expect(getVisibleDaySequence(start, 5, [])).toEqual([]);
    });

    it('should behave the same as no filter when all week days are included', () => {
      const start = new Date(2026, 0, 19).getTime();
      const withAllDays = getVisibleDaySequence(start, 7, [0, 1, 2, 3, 4, 5, 6]);
      const withoutFilter = getVisibleDaySequence(start, 7);

      expect(withAllDays).toEqual(withoutFilter);
    });
  });
});
