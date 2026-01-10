import { getFirstRepeatOccurrence } from './get-first-repeat-occurrence.util';
import { DEFAULT_TASK_REPEAT_CFG, TaskRepeatCfg } from '../task-repeat-cfg.model';

const createMockRepeatCfg = (overrides: Partial<TaskRepeatCfg> = {}): TaskRepeatCfg => ({
  ...DEFAULT_TASK_REPEAT_CFG,
  id: 'test-id',
  ...overrides,
});

describe('getFirstRepeatOccurrence', () => {
  describe('DAILY', () => {
    it('should return today for daily repeat', () => {
      const today = new Date('2025-01-15T12:00:00');
      const cfg = createMockRepeatCfg({
        repeatCycle: 'DAILY',
        repeatEvery: 1,
        startDate: '2025-01-01',
      });

      const result = getFirstRepeatOccurrence(cfg, today);

      expect(result).not.toBeNull();
      expect(result!.getFullYear()).toBe(2025);
      expect(result!.getMonth()).toBe(0); // January
      expect(result!.getDate()).toBe(15);
    });

    it('should return startDate if in future for daily repeat', () => {
      const today = new Date('2025-01-15T12:00:00');
      const cfg = createMockRepeatCfg({
        repeatCycle: 'DAILY',
        repeatEvery: 1,
        startDate: '2025-01-20',
      });

      const result = getFirstRepeatOccurrence(cfg, today);

      expect(result).not.toBeNull();
      expect(result!.getDate()).toBe(20);
    });
  });

  describe('WEEKLY', () => {
    it('should return today if today matches the weekly pattern', () => {
      // Wednesday, January 15, 2025
      const today = new Date('2025-01-15T12:00:00');
      const cfg = createMockRepeatCfg({
        repeatCycle: 'WEEKLY',
        repeatEvery: 1,
        startDate: '2025-01-01',
        monday: true,
        wednesday: true,
        friday: true,
        tuesday: false,
        thursday: false,
        saturday: false,
        sunday: false,
      });

      const result = getFirstRepeatOccurrence(cfg, today);

      expect(result).not.toBeNull();
      expect(result!.getDate()).toBe(15); // Wednesday
    });

    it('should return next matching day if today does not match pattern', () => {
      // Saturday, January 18, 2025
      const today = new Date('2025-01-18T12:00:00');
      const cfg = createMockRepeatCfg({
        repeatCycle: 'WEEKLY',
        repeatEvery: 1,
        startDate: '2025-01-01',
        monday: true,
        wednesday: true,
        friday: true,
        tuesday: false,
        thursday: false,
        saturday: false,
        sunday: false,
      });

      const result = getFirstRepeatOccurrence(cfg, today);

      expect(result).not.toBeNull();
      // Next matching day is Monday, January 20
      expect(result!.getDate()).toBe(20);
    });

    it('should handle Sunday as first day of week', () => {
      // Friday, January 17, 2025
      const today = new Date('2025-01-17T12:00:00');
      const cfg = createMockRepeatCfg({
        repeatCycle: 'WEEKLY',
        repeatEvery: 1,
        startDate: '2025-01-01',
        sunday: true,
        monday: false,
        tuesday: false,
        wednesday: false,
        thursday: false,
        friday: false,
        saturday: false,
      });

      const result = getFirstRepeatOccurrence(cfg, today);

      expect(result).not.toBeNull();
      // Next Sunday is January 19
      expect(result!.getDate()).toBe(19);
    });

    it('should return null if no days are selected', () => {
      const today = new Date('2025-01-15T12:00:00');
      const cfg = createMockRepeatCfg({
        repeatCycle: 'WEEKLY',
        repeatEvery: 1,
        startDate: '2025-01-01',
        monday: false,
        tuesday: false,
        wednesday: false,
        thursday: false,
        friday: false,
        saturday: false,
        sunday: false,
      });

      const result = getFirstRepeatOccurrence(cfg, today);

      expect(result).toBeNull();
    });
  });

  describe('MONTHLY', () => {
    it('should return this month if repeat day has not passed', () => {
      // January 10, 2025
      const today = new Date('2025-01-10T12:00:00');
      const cfg = createMockRepeatCfg({
        repeatCycle: 'MONTHLY',
        repeatEvery: 1,
        startDate: '2025-01-15', // 15th of month
      });

      const result = getFirstRepeatOccurrence(cfg, today);

      expect(result).not.toBeNull();
      expect(result!.getMonth()).toBe(0); // January
      expect(result!.getDate()).toBe(15);
    });

    it('should return today if today is the repeat day', () => {
      // January 15, 2025
      const today = new Date('2025-01-15T12:00:00');
      const cfg = createMockRepeatCfg({
        repeatCycle: 'MONTHLY',
        repeatEvery: 1,
        startDate: '2025-01-15', // 15th of month
      });

      const result = getFirstRepeatOccurrence(cfg, today);

      expect(result).not.toBeNull();
      expect(result!.getMonth()).toBe(0);
      expect(result!.getDate()).toBe(15);
    });

    it('should return next month if repeat day has passed', () => {
      // January 20, 2025
      const today = new Date('2025-01-20T12:00:00');
      const cfg = createMockRepeatCfg({
        repeatCycle: 'MONTHLY',
        repeatEvery: 1,
        startDate: '2025-01-15', // 15th of month
      });

      const result = getFirstRepeatOccurrence(cfg, today);

      expect(result).not.toBeNull();
      expect(result!.getMonth()).toBe(1); // February
      expect(result!.getDate()).toBe(15);
    });

    it('should handle month-end dates (31st)', () => {
      // February 1, 2025
      const today = new Date('2025-02-01T12:00:00');
      const cfg = createMockRepeatCfg({
        repeatCycle: 'MONTHLY',
        repeatEvery: 1,
        startDate: '2025-01-31', // 31st of month
      });

      const result = getFirstRepeatOccurrence(cfg, today);

      expect(result).not.toBeNull();
      // February only has 28 days in 2025
      expect(result!.getMonth()).toBe(1); // February
      expect(result!.getDate()).toBe(28);
    });
  });

  describe('YEARLY', () => {
    it('should return this year if date has not passed', () => {
      // March 1, 2025
      const today = new Date('2025-03-01T12:00:00');
      const cfg = createMockRepeatCfg({
        repeatCycle: 'YEARLY',
        repeatEvery: 1,
        startDate: '2024-06-15', // June 15
      });

      const result = getFirstRepeatOccurrence(cfg, today);

      expect(result).not.toBeNull();
      expect(result!.getFullYear()).toBe(2025);
      expect(result!.getMonth()).toBe(5); // June
      expect(result!.getDate()).toBe(15);
    });

    it('should return next year if date has passed', () => {
      // August 1, 2025
      const today = new Date('2025-08-01T12:00:00');
      const cfg = createMockRepeatCfg({
        repeatCycle: 'YEARLY',
        repeatEvery: 1,
        startDate: '2024-06-15', // June 15
      });

      const result = getFirstRepeatOccurrence(cfg, today);

      expect(result).not.toBeNull();
      expect(result!.getFullYear()).toBe(2026);
      expect(result!.getMonth()).toBe(5); // June
      expect(result!.getDate()).toBe(15);
    });

    it('should handle Feb 29 in non-leap year', () => {
      // January 1, 2025 (not a leap year)
      const today = new Date('2025-01-01T12:00:00');
      const cfg = createMockRepeatCfg({
        repeatCycle: 'YEARLY',
        repeatEvery: 1,
        startDate: '2024-02-29', // Feb 29 (2024 is leap year)
      });

      const result = getFirstRepeatOccurrence(cfg, today);

      expect(result).not.toBeNull();
      expect(result!.getFullYear()).toBe(2025);
      expect(result!.getMonth()).toBe(1); // February
      expect(result!.getDate()).toBe(28); // Falls back to 28
    });

    it('should handle Feb 29 in leap year', () => {
      // January 1, 2028 (leap year)
      const today = new Date('2028-01-01T12:00:00');
      const cfg = createMockRepeatCfg({
        repeatCycle: 'YEARLY',
        repeatEvery: 1,
        startDate: '2024-02-29', // Feb 29
      });

      const result = getFirstRepeatOccurrence(cfg, today);

      expect(result).not.toBeNull();
      expect(result!.getFullYear()).toBe(2028);
      expect(result!.getMonth()).toBe(1); // February
      expect(result!.getDate()).toBe(29); // Feb 29 exists
    });
  });

  describe('Edge cases', () => {
    it('should return null for invalid repeatEvery', () => {
      const today = new Date('2025-01-15T12:00:00');
      const cfg = createMockRepeatCfg({
        repeatCycle: 'DAILY',
        repeatEvery: 0,
      });

      const result = getFirstRepeatOccurrence(cfg, today);

      expect(result).toBeNull();
    });

    it('should return null for negative repeatEvery', () => {
      const today = new Date('2025-01-15T12:00:00');
      const cfg = createMockRepeatCfg({
        repeatCycle: 'DAILY',
        repeatEvery: -1,
      });

      const result = getFirstRepeatOccurrence(cfg, today);

      expect(result).toBeNull();
    });

    it('should handle missing startDate', () => {
      const today = new Date('2025-01-15T12:00:00');
      const cfg = createMockRepeatCfg({
        repeatCycle: 'DAILY',
        repeatEvery: 1,
        startDate: undefined,
      });

      const result = getFirstRepeatOccurrence(cfg, today);

      expect(result).not.toBeNull();
      expect(result!.getDate()).toBe(15);
    });

    it('should return null for unknown repeat cycle', () => {
      const today = new Date('2025-01-15T12:00:00');
      const cfg = createMockRepeatCfg({
        repeatCycle: 'UNKNOWN' as any,
        repeatEvery: 1,
      });

      const result = getFirstRepeatOccurrence(cfg, today);

      expect(result).toBeNull();
    });
  });

  describe('Real-world bug scenarios (#5594)', () => {
    it('should return Monday for Mon/Wed/Fri repeat created on Saturday', () => {
      // This is the exact scenario from the bug report
      // Saturday, December 14, 2024
      const saturday = new Date('2024-12-14T12:00:00');
      const cfg = createMockRepeatCfg({
        repeatCycle: 'WEEKLY',
        repeatEvery: 1,
        startDate: '2024-12-14', // Start date is Saturday
        monday: true,
        tuesday: false,
        wednesday: true,
        thursday: false,
        friday: true,
        saturday: false,
        sunday: false,
      });

      const result = getFirstRepeatOccurrence(cfg, saturday);

      expect(result).not.toBeNull();
      // Next Monday is December 16
      expect(result!.getDate()).toBe(16);
      expect(result!.getDay()).toBe(1); // Monday
    });

    it('should return Sunday for Sunday-only repeat created on Saturday', () => {
      // Saturday, December 14, 2024
      const saturday = new Date('2024-12-14T12:00:00');
      const cfg = createMockRepeatCfg({
        repeatCycle: 'WEEKLY',
        repeatEvery: 1,
        startDate: '2024-12-14',
        monday: false,
        tuesday: false,
        wednesday: false,
        thursday: false,
        friday: false,
        saturday: false,
        sunday: true,
      });

      const result = getFirstRepeatOccurrence(cfg, saturday);

      expect(result).not.toBeNull();
      // Next Sunday is December 15
      expect(result!.getDate()).toBe(15);
      expect(result!.getDay()).toBe(0); // Sunday
    });

    it('should return today for daily repeat when today matches start date', () => {
      const today = new Date('2024-12-14T12:00:00');
      const cfg = createMockRepeatCfg({
        repeatCycle: 'DAILY',
        repeatEvery: 1,
        startDate: '2024-12-14',
      });

      const result = getFirstRepeatOccurrence(cfg, today);

      expect(result).not.toBeNull();
      expect(result!.getDate()).toBe(14);
    });

    it('should return future date for daily repeat with future start date', () => {
      // Today is December 14, start date is December 20
      const today = new Date('2024-12-14T12:00:00');
      const cfg = createMockRepeatCfg({
        repeatCycle: 'DAILY',
        repeatEvery: 1,
        startDate: '2024-12-20',
      });

      const result = getFirstRepeatOccurrence(cfg, today);

      expect(result).not.toBeNull();
      expect(result!.getDate()).toBe(20);
    });
  });

  describe('WEEKLY additional scenarios', () => {
    it('should return today for weekday repeat when today is a weekday', () => {
      // Monday, January 13, 2025
      const monday = new Date('2025-01-13T12:00:00');
      const cfg = createMockRepeatCfg({
        repeatCycle: 'WEEKLY',
        repeatEvery: 1,
        startDate: '2025-01-01',
        monday: true,
        tuesday: true,
        wednesday: true,
        thursday: true,
        friday: true,
        saturday: false,
        sunday: false,
      });

      const result = getFirstRepeatOccurrence(cfg, monday);

      expect(result).not.toBeNull();
      expect(result!.getDate()).toBe(13); // Today (Monday)
    });

    it('should return Saturday for weekend-only repeat created on Friday', () => {
      // Friday, January 17, 2025
      const friday = new Date('2025-01-17T12:00:00');
      const cfg = createMockRepeatCfg({
        repeatCycle: 'WEEKLY',
        repeatEvery: 1,
        startDate: '2025-01-01',
        monday: false,
        tuesday: false,
        wednesday: false,
        thursday: false,
        friday: false,
        saturday: true,
        sunday: true,
      });

      const result = getFirstRepeatOccurrence(cfg, friday);

      expect(result).not.toBeNull();
      // Next Saturday is January 18
      expect(result!.getDate()).toBe(18);
      expect(result!.getDay()).toBe(6); // Saturday
    });

    it('should return today for all-days repeat', () => {
      const today = new Date('2025-01-15T12:00:00');
      const cfg = createMockRepeatCfg({
        repeatCycle: 'WEEKLY',
        repeatEvery: 1,
        startDate: '2025-01-01',
        monday: true,
        tuesday: true,
        wednesday: true,
        thursday: true,
        friday: true,
        saturday: true,
        sunday: true,
      });

      const result = getFirstRepeatOccurrence(cfg, today);

      expect(result).not.toBeNull();
      expect(result!.getDate()).toBe(15); // Today
    });

    it('should handle Thursday-only repeat on Monday', () => {
      // Monday, January 13, 2025
      const monday = new Date('2025-01-13T12:00:00');
      const cfg = createMockRepeatCfg({
        repeatCycle: 'WEEKLY',
        repeatEvery: 1,
        startDate: '2025-01-01',
        monday: false,
        tuesday: false,
        wednesday: false,
        thursday: true,
        friday: false,
        saturday: false,
        sunday: false,
      });

      const result = getFirstRepeatOccurrence(cfg, monday);

      expect(result).not.toBeNull();
      // Next Thursday is January 16
      expect(result!.getDate()).toBe(16);
      expect(result!.getDay()).toBe(4); // Thursday
    });
  });

  describe('MONTHLY additional scenarios', () => {
    it('should handle 30th in months with 30 days', () => {
      // April 1, 2025 (April has 30 days)
      const today = new Date('2025-04-01T12:00:00');
      const cfg = createMockRepeatCfg({
        repeatCycle: 'MONTHLY',
        repeatEvery: 1,
        startDate: '2025-01-30', // 30th of month
      });

      const result = getFirstRepeatOccurrence(cfg, today);

      expect(result).not.toBeNull();
      expect(result!.getMonth()).toBe(3); // April
      expect(result!.getDate()).toBe(30);
    });

    it('should handle 31st in February (clamped to 28)', () => {
      // February 1, 2025 (not leap year)
      const today = new Date('2025-02-01T12:00:00');
      const cfg = createMockRepeatCfg({
        repeatCycle: 'MONTHLY',
        repeatEvery: 1,
        startDate: '2025-01-31',
      });

      const result = getFirstRepeatOccurrence(cfg, today);

      expect(result).not.toBeNull();
      expect(result!.getMonth()).toBe(1); // February
      expect(result!.getDate()).toBe(28); // Clamped
    });

    it('should return 1st of next month for 1st-of-month repeat after the 1st', () => {
      // January 15, 2025
      const today = new Date('2025-01-15T12:00:00');
      const cfg = createMockRepeatCfg({
        repeatCycle: 'MONTHLY',
        repeatEvery: 1,
        startDate: '2025-01-01', // 1st of month
      });

      const result = getFirstRepeatOccurrence(cfg, today);

      expect(result).not.toBeNull();
      expect(result!.getMonth()).toBe(1); // February
      expect(result!.getDate()).toBe(1);
    });

    it('should return today for last-day-of-month repeat on last day', () => {
      // January 31, 2025
      const today = new Date('2025-01-31T12:00:00');
      const cfg = createMockRepeatCfg({
        repeatCycle: 'MONTHLY',
        repeatEvery: 1,
        startDate: '2024-12-31', // 31st of month
      });

      const result = getFirstRepeatOccurrence(cfg, today);

      expect(result).not.toBeNull();
      expect(result!.getMonth()).toBe(0); // January
      expect(result!.getDate()).toBe(31);
    });
  });

  describe('YEARLY additional scenarios', () => {
    it('should handle Dec 31 repeat', () => {
      // October 1, 2025
      const today = new Date('2025-10-01T12:00:00');
      const cfg = createMockRepeatCfg({
        repeatCycle: 'YEARLY',
        repeatEvery: 1,
        startDate: '2024-12-31', // Dec 31
      });

      const result = getFirstRepeatOccurrence(cfg, today);

      expect(result).not.toBeNull();
      expect(result!.getFullYear()).toBe(2025);
      expect(result!.getMonth()).toBe(11); // December
      expect(result!.getDate()).toBe(31);
    });

    it('should handle Jan 1 repeat when today is Jan 1', () => {
      // January 1, 2025
      const today = new Date('2025-01-01T12:00:00');
      const cfg = createMockRepeatCfg({
        repeatCycle: 'YEARLY',
        repeatEvery: 1,
        startDate: '2024-01-01', // Jan 1
      });

      const result = getFirstRepeatOccurrence(cfg, today);

      expect(result).not.toBeNull();
      expect(result!.getFullYear()).toBe(2025);
      expect(result!.getMonth()).toBe(0); // January
      expect(result!.getDate()).toBe(1);
    });

    it('should return next year for Jan 1 repeat when today is Jan 2', () => {
      // January 2, 2025
      const today = new Date('2025-01-02T12:00:00');
      const cfg = createMockRepeatCfg({
        repeatCycle: 'YEARLY',
        repeatEvery: 1,
        startDate: '2024-01-01', // Jan 1
      });

      const result = getFirstRepeatOccurrence(cfg, today);

      expect(result).not.toBeNull();
      expect(result!.getFullYear()).toBe(2026);
      expect(result!.getMonth()).toBe(0); // January
      expect(result!.getDate()).toBe(1);
    });

    it('should handle today being the exact yearly repeat date', () => {
      // June 15, 2025
      const today = new Date('2025-06-15T12:00:00');
      const cfg = createMockRepeatCfg({
        repeatCycle: 'YEARLY',
        repeatEvery: 1,
        startDate: '2024-06-15',
      });

      const result = getFirstRepeatOccurrence(cfg, today);

      expect(result).not.toBeNull();
      expect(result!.getFullYear()).toBe(2025);
      expect(result!.getMonth()).toBe(5); // June
      expect(result!.getDate()).toBe(15);
    });
  });

  describe('Time consistency', () => {
    it('should always return date at noon to avoid DST issues', () => {
      const today = new Date('2025-03-15T03:00:00'); // Around DST change
      const cfg = createMockRepeatCfg({
        repeatCycle: 'DAILY',
        repeatEvery: 1,
        startDate: '2025-03-01',
      });

      const result = getFirstRepeatOccurrence(cfg, today);

      expect(result).not.toBeNull();
      expect(result!.getHours()).toBe(12); // Noon
    });

    it('should handle early morning times correctly', () => {
      const today = new Date('2025-01-15T01:00:00'); // 1 AM
      const cfg = createMockRepeatCfg({
        repeatCycle: 'DAILY',
        repeatEvery: 1,
        startDate: '2025-01-01',
      });

      const result = getFirstRepeatOccurrence(cfg, today);

      expect(result).not.toBeNull();
      expect(result!.getDate()).toBe(15);
    });

    it('should handle late night times correctly', () => {
      const today = new Date('2025-01-15T23:59:00'); // 11:59 PM
      const cfg = createMockRepeatCfg({
        repeatCycle: 'DAILY',
        repeatEvery: 1,
        startDate: '2025-01-01',
      });

      const result = getFirstRepeatOccurrence(cfg, today);

      expect(result).not.toBeNull();
      expect(result!.getDate()).toBe(15);
    });
  });
});
