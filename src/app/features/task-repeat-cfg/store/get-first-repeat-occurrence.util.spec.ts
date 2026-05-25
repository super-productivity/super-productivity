import { getFirstRepeatOccurrence } from './get-first-repeat-occurrence.util';
import { DEFAULT_TASK_REPEAT_CFG, TaskRepeatCfg } from '../task-repeat-cfg.model';

const mkCfg = (overrides: Partial<TaskRepeatCfg> = {}): TaskRepeatCfg => ({
  ...DEFAULT_TASK_REPEAT_CFG,
  id: 'test-id',
  ...overrides,
});

describe('getFirstRepeatOccurrence', () => {
  describe('DAILY', () => {
    it('returns startDate', () => {
      const result = getFirstRepeatOccurrence(
        mkCfg({ repeatCycle: 'DAILY', repeatEvery: 1, startDate: '2025-01-15' }),
      );
      expect(result).not.toBeNull();
      expect(result!.getFullYear()).toBe(2025);
      expect(result!.getMonth()).toBe(0);
      expect(result!.getDate()).toBe(15);
    });

    it('returns startDate regardless of repeatEvery', () => {
      const result = getFirstRepeatOccurrence(
        mkCfg({ repeatCycle: 'DAILY', repeatEvery: 3, startDate: '2025-01-15' }),
      );
      expect(result!.getDate()).toBe(15);
    });

    it('anchors on startDate even when startDate is in the past (#7344)', () => {
      const result = getFirstRepeatOccurrence(
        mkCfg({ repeatCycle: 'DAILY', repeatEvery: 1, startDate: '2020-06-01' }),
      );
      expect(result!.getFullYear()).toBe(2020);
      expect(result!.getMonth()).toBe(5);
      expect(result!.getDate()).toBe(1);
    });

    it('anchors on startDate when in the future', () => {
      const result = getFirstRepeatOccurrence(
        mkCfg({ repeatCycle: 'DAILY', repeatEvery: 1, startDate: '2099-12-31' }),
      );
      expect(result!.getFullYear()).toBe(2099);
      expect(result!.getMonth()).toBe(11);
      expect(result!.getDate()).toBe(31);
    });
  });

  describe('WEEKLY', () => {
    it('returns startDate when startDate weekday is enabled', () => {
      // 2025-01-15 is a Wednesday
      const result = getFirstRepeatOccurrence(
        mkCfg({
          repeatCycle: 'WEEKLY',
          repeatEvery: 1,
          startDate: '2025-01-15',
          monday: true,
          wednesday: true,
          friday: true,
          tuesday: false,
          thursday: false,
          saturday: false,
          sunday: false,
        }),
      );
      expect(result!.getFullYear()).toBe(2025);
      expect(result!.getMonth()).toBe(0);
      expect(result!.getDate()).toBe(15);
    });

    it('scans forward to the next enabled weekday within a week', () => {
      // 2025-01-18 is a Saturday; only Mondays are enabled → should return Monday Jan 20
      const result = getFirstRepeatOccurrence(
        mkCfg({
          repeatCycle: 'WEEKLY',
          repeatEvery: 1,
          startDate: '2025-01-18',
          monday: true,
          tuesday: false,
          wednesday: false,
          thursday: false,
          friday: false,
          saturday: false,
          sunday: false,
        }),
      );
      expect(result!.getDate()).toBe(20);
      expect(result!.getDay()).toBe(1); // Monday
    });

    it('handles Sunday-only repeat starting on Saturday (#5594)', () => {
      // Saturday Dec 14 2024 → next Sunday is Dec 15
      const result = getFirstRepeatOccurrence(
        mkCfg({
          repeatCycle: 'WEEKLY',
          repeatEvery: 1,
          startDate: '2024-12-14',
          sunday: true,
          monday: false,
          tuesday: false,
          wednesday: false,
          thursday: false,
          friday: false,
          saturday: false,
        }),
      );
      expect(result!.getDate()).toBe(15);
      expect(result!.getDay()).toBe(0); // Sunday
    });

    it('returns Monday for Mon/Wed/Fri repeat starting on Saturday (#5594)', () => {
      const result = getFirstRepeatOccurrence(
        mkCfg({
          repeatCycle: 'WEEKLY',
          repeatEvery: 1,
          startDate: '2024-12-14', // Saturday
          monday: true,
          wednesday: true,
          friday: true,
          tuesday: false,
          thursday: false,
          saturday: false,
          sunday: false,
        }),
      );
      expect(result!.getDate()).toBe(16);
      expect(result!.getDay()).toBe(1); // Monday
    });

    it('returns null when no weekday is enabled', () => {
      const result = getFirstRepeatOccurrence(
        mkCfg({
          repeatCycle: 'WEEKLY',
          repeatEvery: 1,
          startDate: '2025-01-15',
          monday: false,
          tuesday: false,
          wednesday: false,
          thursday: false,
          friday: false,
          saturday: false,
          sunday: false,
        }),
      );
      expect(result).toBeNull();
    });
  });

  describe('MONTHLY', () => {
    it('returns startDate', () => {
      const result = getFirstRepeatOccurrence(
        mkCfg({ repeatCycle: 'MONTHLY', repeatEvery: 1, startDate: '2025-01-15' }),
      );
      expect(result!.getFullYear()).toBe(2025);
      expect(result!.getMonth()).toBe(0);
      expect(result!.getDate()).toBe(15);
    });

    it('handles month-end startDate (31st)', () => {
      const result = getFirstRepeatOccurrence(
        mkCfg({ repeatCycle: 'MONTHLY', repeatEvery: 1, startDate: '2025-01-31' }),
      );
      expect(result!.getMonth()).toBe(0);
      expect(result!.getDate()).toBe(31);
    });

    it('anchors on past startDate without advancing to next month', () => {
      const result = getFirstRepeatOccurrence(
        mkCfg({ repeatCycle: 'MONTHLY', repeatEvery: 2, startDate: '2020-06-15' }),
      );
      expect(result!.getFullYear()).toBe(2020);
      expect(result!.getMonth()).toBe(5);
      expect(result!.getDate()).toBe(15);
    });
  });

  describe('MONTHLY Nth weekday (issue #6040)', () => {
    it('returns the Nth weekday in the start month when on/after startDate', () => {
      // 2026-01-01 (Thu) is the 1st Thursday of Jan 2026 → returns Jan 1.
      const result = getFirstRepeatOccurrence(
        mkCfg({
          repeatCycle: 'MONTHLY',
          repeatEvery: 1,
          startDate: '2026-01-01',
          monthlyWeekOfMonth: 1,
          monthlyWeekday: 4,
        }),
      );
      expect(result!.getFullYear()).toBe(2026);
      expect(result!.getMonth()).toBe(0);
      expect(result!.getDate()).toBe(1);
    });

    it('advances to next month when startDate is past the Nth weekday', () => {
      // startDate Jan 15 2026 is past the 1st Thursday (Jan 1) → next is Feb 5.
      const result = getFirstRepeatOccurrence(
        mkCfg({
          repeatCycle: 'MONTHLY',
          repeatEvery: 1,
          startDate: '2026-01-15',
          monthlyWeekOfMonth: 1,
          monthlyWeekday: 4,
        }),
      );
      expect(result!.getMonth()).toBe(1);
      expect(result!.getDate()).toBe(5);
    });

    it('handles last weekday of the month', () => {
      // Last Monday of Jan 2026 = Jan 26 (start matches).
      const result = getFirstRepeatOccurrence(
        mkCfg({
          repeatCycle: 'MONTHLY',
          repeatEvery: 1,
          startDate: '2026-01-26',
          monthlyWeekOfMonth: -1,
          monthlyWeekday: 1,
        }),
      );
      expect(result!.getDate()).toBe(26);
    });
  });

  describe('YEARLY', () => {
    it('returns startDate', () => {
      const result = getFirstRepeatOccurrence(
        mkCfg({ repeatCycle: 'YEARLY', repeatEvery: 1, startDate: '2024-06-15' }),
      );
      expect(result!.getFullYear()).toBe(2024);
      expect(result!.getMonth()).toBe(5);
      expect(result!.getDate()).toBe(15);
    });

    it('anchors on past startDate for every-4-year repeats (#7344)', () => {
      // Before the fix, this returned the following leap year's date;
      // now it correctly returns startDate itself.
      const result = getFirstRepeatOccurrence(
        mkCfg({ repeatCycle: 'YEARLY', repeatEvery: 4, startDate: '2020-02-29' }),
      );
      expect(result!.getFullYear()).toBe(2020);
      expect(result!.getMonth()).toBe(1);
      expect(result!.getDate()).toBe(29);
    });

    it('handles future startDate', () => {
      const result = getFirstRepeatOccurrence(
        mkCfg({ repeatCycle: 'YEARLY', repeatEvery: 1, startDate: '2099-12-31' }),
      );
      expect(result!.getFullYear()).toBe(2099);
      expect(result!.getMonth()).toBe(11);
      expect(result!.getDate()).toBe(31);
    });
  });

  describe('edge cases', () => {
    it('returns null for repeatEvery=0', () => {
      const result = getFirstRepeatOccurrence(
        mkCfg({ repeatCycle: 'DAILY', repeatEvery: 0, startDate: '2025-01-15' }),
      );
      expect(result).toBeNull();
    });

    it('returns null for negative repeatEvery', () => {
      const result = getFirstRepeatOccurrence(
        mkCfg({ repeatCycle: 'DAILY', repeatEvery: -1, startDate: '2025-01-15' }),
      );
      expect(result).toBeNull();
    });

    it('returns null when startDate is missing', () => {
      const result = getFirstRepeatOccurrence(
        mkCfg({ repeatCycle: 'DAILY', repeatEvery: 1, startDate: undefined }),
      );
      expect(result).toBeNull();
    });

    it('returns null for unknown repeat cycle', () => {
      const result = getFirstRepeatOccurrence(
        mkCfg({
          repeatCycle: 'UNKNOWN' as any,
          repeatEvery: 1,
          startDate: '2025-01-15',
        }),
      );
      expect(result).toBeNull();
    });

    it('always returns date at noon to avoid DST issues', () => {
      const result = getFirstRepeatOccurrence(
        mkCfg({ repeatCycle: 'DAILY', repeatEvery: 1, startDate: '2025-03-15' }),
      );
      expect(result!.getHours()).toBe(12);
      expect(result!.getMinutes()).toBe(0);
    });
  });
});
