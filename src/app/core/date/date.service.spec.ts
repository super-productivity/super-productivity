import { DateService } from './date.service';

describe('DateService', () => {
  let service: DateService;

  beforeEach(() => {
    service = new DateService();
  });

  describe('isToday', () => {
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;

    it('should return true for a date today (Date input)', () => {
      expect(service.isToday(new Date())).toBe(true);
    });

    it('should return true for a timestamp today (number input)', () => {
      expect(service.isToday(Date.now())).toBe(true);
    });

    it('should return false for yesterday', () => {
      const yesterday = Date.now() - ONE_DAY_MS;
      expect(service.isToday(yesterday)).toBe(false);
    });

    it('should return false for tomorrow', () => {
      const tomorrow = Date.now() + ONE_DAY_MS;
      expect(service.isToday(tomorrow)).toBe(false);
    });

    it('should treat post-midnight as previous day when offset is set', () => {
      // offset = 2 hours means the "day" doesn't change until 2 AM
      service.setStartOfNextDayDiff(2);

      const today = new Date();
      today.setHours(0, 30, 0, 0); // 00:30 today

      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(12, 0, 0, 0); // noon yesterday

      // 00:30 with a 2-hour offset should be treated as the previous day
      expect(service.isToday(today)).toBe(service.isToday(yesterday));
    });

    it('should treat late-night time as still today when offset is set', () => {
      service.setStartOfNextDayDiff(2);

      const lateNight = new Date();
      lateNight.setHours(23, 0, 0, 0);

      const afternoon = new Date();
      afternoon.setHours(14, 0, 0, 0);

      // 23:00 and 14:00 same calendar day with offset should both be "today"
      expect(service.isToday(lateNight)).toBe(service.isToday(afternoon));
    });

    it('should return true at start of day (midnight, no offset)', () => {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      expect(service.isToday(startOfDay)).toBe(true);
    });

    it('should return true at end of day (23:59:59, no offset)', () => {
      const endOfDay = new Date();
      endOfDay.setHours(23, 59, 59, 999);
      expect(service.isToday(endOfDay)).toBe(true);
    });
  });

  describe('todayStr', () => {
    afterEach(() => {
      jasmine.clock().uninstall();
    });

    it('without args should match the calendar day when offset is 0', () => {
      jasmine.clock().install();
      const fixed = new Date(2026, 2, 27, 2, 30, 0);
      jasmine.clock().mockDate(fixed);
      service.setStartOfNextDayDiff(0);
      expect(service.todayStr()).toBe('2026-03-27');
    });

    it('without args should keep the previous calendar day until start-of-next-day hour', () => {
      jasmine.clock().install();
      const fixed = new Date(2026, 2, 27, 2, 30, 0);
      jasmine.clock().mockDate(fixed);
      service.setStartOfNextDayDiff(3);
      expect(service.todayStr()).toBe('2026-03-26');
    });

    it('without args should use the new calendar day from start-of-next-day hour onward', () => {
      jasmine.clock().install();
      const fixed = new Date(2026, 2, 27, 3, 0, 0);
      jasmine.clock().mockDate(fixed);
      service.setStartOfNextDayDiff(3);
      expect(service.todayStr()).toBe('2026-03-27');
    });

    it('with explicit date should not apply start-of-next-day offset', () => {
      service.setStartOfNextDayDiff(3);
      const d = new Date(2026, 2, 27, 2, 30, 0);
      expect(service.todayStr(d)).toBe('2026-03-27');
    });
  });

  describe('setStartOfNextDayDiff', () => {
    it('should clamp negative values to 0', () => {
      service.setStartOfNextDayDiff(-5);
      expect(service.getStartOfNextDayDiffMs()).toBe(0);
    });

    it('should clamp values above 23 to 23 hours', () => {
      service.setStartOfNextDayDiff(99);
      expect(service.getStartOfNextDayDiffMs()).toBe(23 * 60 * 60 * 1000);
    });

    it('should treat undefined as 0', () => {
      service.setStartOfNextDayDiff(undefined as unknown as number);
      expect(service.getStartOfNextDayDiffMs()).toBe(0);
    });
  });
});
