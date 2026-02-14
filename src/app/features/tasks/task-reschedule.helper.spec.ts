import { calculateRescheduleDate, getRescheduleLabel, RescheduleType } from './task-reschedule.helper';

describe('TaskRescheduleHelper', () => {
  let baseDate: Date;

  beforeEach(() => {
    // Set base date to a known date for consistent testing
    baseDate = new Date('2026-02-14T08:00:00Z');
  });

  describe('calculateRescheduleDate', () => {
    it('should reschedule to tomorrow at 9 AM', () => {
      const result = calculateRescheduleDate('tomorrow', baseDate);
      const resultDate = new Date(result);

      expect(resultDate.getHours()).toBe(9);
      expect(resultDate.getMinutes()).toBe(0);
      expect(resultDate.getSeconds()).toBe(0);
      expect(resultDate.getDate()).toBe(baseDate.getDate() + 1);
    });

    it('should reschedule to end of this week (Sunday) at 9 AM', () => {
      // Saturday, Feb 14, 2026 (day 6)
      const saturday = new Date('2026-02-14T08:00:00Z');
      const result = calculateRescheduleDate('thisWeek', saturday);
      const resultDate = new Date(result);

      expect(resultDate.getDay()).toBe(0); // Sunday
      expect(resultDate.getHours()).toBe(9);
    });

    it('should reschedule to start of next week (Monday) at 9 AM', () => {
      // Sunday, Feb 15, 2026 (day 0)
      const sunday = new Date('2026-02-15T08:00:00Z');
      const result = calculateRescheduleDate('nextWeek', sunday);
      const resultDate = new Date(result);

      expect(resultDate.getDay()).toBe(1); // Monday
      expect(resultDate.getHours()).toBe(9);
    });

    it('should reschedule to end of this month at 9 AM', () => {
      const result = calculateRescheduleDate('thisMonth', baseDate);
      const resultDate = new Date(result);

      expect(resultDate.getMonth()).toBe(1); // February
      expect(resultDate.getDate()).toBe(28); // Last day of Feb 2026
      expect(resultDate.getHours()).toBe(9);
    });

    it('should reschedule to start of next month at 9 AM', () => {
      const result = calculateRescheduleDate('nextMonth', baseDate);
      const resultDate = new Date(result);

      expect(resultDate.getMonth()).toBe(2); // March
      expect(resultDate.getDate()).toBe(1); // First day of March
      expect(resultDate.getHours()).toBe(9);
    });
  });

  describe('getRescheduleLabel', () => {
    it('should return correct labels for all reschedule types', () => {
      expect(getRescheduleLabel('tomorrow')).toBe('Tomorrow');
      expect(getRescheduleLabel('thisWeek')).toBe('End of This Week');
      expect(getRescheduleLabel('nextWeek')).toBe('Start of Next Week');
      expect(getRescheduleLabel('thisMonth')).toBe('End of This Month');
      expect(getRescheduleLabel('nextMonth')).toBe('Start of Next Month');
    });
  });
});
