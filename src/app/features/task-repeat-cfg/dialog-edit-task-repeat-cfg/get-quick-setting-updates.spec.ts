import { getQuickSettingUpdates } from './get-quick-setting-updates';
import { getDbDateStr } from '../../../util/get-db-date-str';

describe('getQuickSettingUpdates', () => {
  describe('DAILY', () => {
    it('should return DAILY cycle with repeatEvery 1', () => {
      const result = getQuickSettingUpdates('DAILY');
      expect(result).toBeDefined();
      expect(result!.repeatCycle).toBe('DAILY');
      expect(result!.repeatEvery).toBe(1);
    });

    it('should NOT set startDate (fixes #5594)', () => {
      const result = getQuickSettingUpdates('DAILY');
      expect(result!.startDate).toBeUndefined();
    });
  });

  describe('WEEKLY_CURRENT_WEEKDAY', () => {
    it('should return WEEKLY cycle with repeatEvery 1', () => {
      const result = getQuickSettingUpdates('WEEKLY_CURRENT_WEEKDAY');
      expect(result).toBeDefined();
      expect(result!.repeatCycle).toBe('WEEKLY');
      expect(result!.repeatEvery).toBe(1);
    });

    it('should NOT set startDate (fixes #5594)', () => {
      const result = getQuickSettingUpdates('WEEKLY_CURRENT_WEEKDAY');
      expect(result!.startDate).toBeUndefined();
    });

    it('should set only today weekday to true when no referenceDate provided', () => {
      const result = getQuickSettingUpdates('WEEKLY_CURRENT_WEEKDAY');
      const weekdays = [
        'sunday',
        'monday',
        'tuesday',
        'wednesday',
        'thursday',
        'friday',
        'saturday',
      ];
      const todayIndex = new Date().getDay();

      weekdays.forEach((day, index) => {
        if (index === todayIndex) {
          expect((result as any)[day]).toBe(true);
        } else {
          expect((result as any)[day]).toBe(false);
        }
      });
    });

    // Issue #5806: Use referenceDate weekday when provided
    it('should set Sunday to true when referenceDate is a Sunday (fixes #5806)', () => {
      // Sunday Dec 28, 2025
      const sunday = new Date(2025, 11, 28);
      const result = getQuickSettingUpdates('WEEKLY_CURRENT_WEEKDAY', sunday);
      expect(result).toBeDefined();
      expect((result as any).sunday).toBe(true);
      expect((result as any).monday).toBe(false);
      expect((result as any).tuesday).toBe(false);
      expect((result as any).wednesday).toBe(false);
      expect((result as any).thursday).toBe(false);
      expect((result as any).friday).toBe(false);
      expect((result as any).saturday).toBe(false);
    });

    it('should set Friday to true when referenceDate is a Friday (fixes #5806)', () => {
      // Friday Dec 26, 2025
      const friday = new Date(2025, 11, 26);
      const result = getQuickSettingUpdates('WEEKLY_CURRENT_WEEKDAY', friday);
      expect(result).toBeDefined();
      expect((result as any).sunday).toBe(false);
      expect((result as any).monday).toBe(false);
      expect((result as any).tuesday).toBe(false);
      expect((result as any).wednesday).toBe(false);
      expect((result as any).thursday).toBe(false);
      expect((result as any).friday).toBe(true);
      expect((result as any).saturday).toBe(false);
    });

    it('should set Wednesday to true when referenceDate is a Wednesday (fixes #5806)', () => {
      // Wednesday Dec 31, 2025
      const wednesday = new Date(2025, 11, 31);
      const result = getQuickSettingUpdates('WEEKLY_CURRENT_WEEKDAY', wednesday);
      expect(result).toBeDefined();
      expect((result as any).sunday).toBe(false);
      expect((result as any).monday).toBe(false);
      expect((result as any).tuesday).toBe(false);
      expect((result as any).wednesday).toBe(true);
      expect((result as any).thursday).toBe(false);
      expect((result as any).friday).toBe(false);
      expect((result as any).saturday).toBe(false);
    });
  });

  describe('MONDAY_TO_FRIDAY', () => {
    it('should return WEEKLY cycle with repeatEvery 1', () => {
      const result = getQuickSettingUpdates('MONDAY_TO_FRIDAY');
      expect(result).toBeDefined();
      expect(result!.repeatCycle).toBe('WEEKLY');
      expect(result!.repeatEvery).toBe(1);
    });

    it('should NOT set startDate (fixes #5594)', () => {
      const result = getQuickSettingUpdates('MONDAY_TO_FRIDAY');
      expect(result!.startDate).toBeUndefined();
    });

    it('should set monday through friday to true and weekend to false', () => {
      const result = getQuickSettingUpdates('MONDAY_TO_FRIDAY');
      expect((result as any).monday).toBe(true);
      expect((result as any).tuesday).toBe(true);
      expect((result as any).wednesday).toBe(true);
      expect((result as any).thursday).toBe(true);
      expect((result as any).friday).toBe(true);
      expect((result as any).saturday).toBe(false);
      expect((result as any).sunday).toBe(false);
    });
  });

  describe('MONTHLY_CURRENT_DATE', () => {
    it('should return MONTHLY cycle with repeatEvery 1', () => {
      const result = getQuickSettingUpdates('MONTHLY_CURRENT_DATE');
      expect(result).toBeDefined();
      expect(result!.repeatCycle).toBe('MONTHLY');
      expect(result!.repeatEvery).toBe(1);
    });

    it('should set startDate to today (fixes #6699)', () => {
      const result = getQuickSettingUpdates('MONTHLY_CURRENT_DATE');
      expect(result!.startDate).toBe(getDbDateStr());
    });
  });

  describe('MONTHLY_FIRST_DAY', () => {
    afterEach(() => jasmine.clock().uninstall());

    it('should return MONTHLY cycle with repeatEvery 1', () => {
      const result = getQuickSettingUpdates('MONTHLY_FIRST_DAY');
      expect(result).toBeDefined();
      expect(result!.repeatCycle).toBe('MONTHLY');
      expect(result!.repeatEvery).toBe(1);
    });

    it('should set startDate to the 1st of a month', () => {
      const result = getQuickSettingUpdates('MONTHLY_FIRST_DAY');
      const startDate = new Date(result!.startDate + 'T00:00:00');
      expect(startDate.getDate()).toBe(1);
    });

    it('should anchor to the NEXT 1st when today is not the 1st (#7726)', () => {
      // Issue scenario: setting this up on 2026-05-22 must schedule June 1,
      // never the already-past May 1.
      jasmine.clock().install();
      jasmine.clock().mockDate(new Date(2026, 4, 22));
      const result = getQuickSettingUpdates('MONTHLY_FIRST_DAY');
      expect(result!.startDate).toBe('2026-06-01');
    });

    it('should anchor to today when today IS the 1st', () => {
      jasmine.clock().install();
      jasmine.clock().mockDate(new Date(2026, 4, 1));
      const result = getQuickSettingUpdates('MONTHLY_FIRST_DAY');
      expect(result!.startDate).toBe('2026-05-01');
    });

    it('should roll over the year in December', () => {
      jasmine.clock().install();
      jasmine.clock().mockDate(new Date(2026, 11, 15));
      const result = getQuickSettingUpdates('MONTHLY_FIRST_DAY');
      expect(result!.startDate).toBe('2027-01-01');
    });
  });

  describe('MONTHLY_LAST_DAY', () => {
    afterEach(() => jasmine.clock().uninstall());

    it('should return MONTHLY cycle with repeatEvery 1', () => {
      const result = getQuickSettingUpdates('MONTHLY_LAST_DAY');
      expect(result).toBeDefined();
      expect(result!.repeatCycle).toBe('MONTHLY');
      expect(result!.repeatEvery).toBe(1);
    });

    it('should set the monthlyLastDay flag', () => {
      const result = getQuickSettingUpdates('MONTHLY_LAST_DAY');
      expect(result!.monthlyLastDay).toBe(true);
    });

    it('should anchor startDate to the last day of the current month (#7726)', () => {
      // Issue scenario: setting this up on 2026-05-22 must schedule May 31,
      // never the already-past Jan 31.
      jasmine.clock().install();
      jasmine.clock().mockDate(new Date(2026, 4, 22));
      const result = getQuickSettingUpdates('MONTHLY_LAST_DAY');
      expect(result!.startDate).toBe('2026-05-31');
    });

    it('should anchor to a short month-end when set up in a 30-day month', () => {
      jasmine.clock().install();
      jasmine.clock().mockDate(new Date(2026, 5, 10));
      const result = getQuickSettingUpdates('MONTHLY_LAST_DAY');
      expect(result!.startDate).toBe('2026-06-30');
    });
  });

  // Both callers pass a reference day — the picked date in the add bar, the
  // config's own start date in the repeat dialog — and these two presets used
  // to derive their anchor from `new Date()` regardless, so the saved
  // recurrence started in a month the user never chose.
  describe('monthly day-of-month presets honour the referenceDate', () => {
    afterEach(() => jasmine.clock().uninstall());

    const mockToday = (date: Date): void => {
      jasmine.clock().install();
      jasmine.clock().mockDate(date);
    };

    it('MONTHLY_FIRST_DAY anchors to the 1st after the reference date', () => {
      mockToday(new Date(2026, 7, 8));
      const result = getQuickSettingUpdates('MONTHLY_FIRST_DAY', new Date(2026, 11, 15));
      expect(result!.startDate).toBe('2027-01-01');
    });

    it('MONTHLY_FIRST_DAY keeps a reference date that already is the 1st', () => {
      mockToday(new Date(2026, 7, 8));
      const result = getQuickSettingUpdates('MONTHLY_FIRST_DAY', new Date(2026, 11, 1));
      expect(result!.startDate).toBe('2026-12-01');
    });

    it('MONTHLY_LAST_DAY anchors to the end of the reference month', () => {
      mockToday(new Date(2026, 7, 8));
      const result = getQuickSettingUpdates('MONTHLY_LAST_DAY', new Date(2026, 11, 15));
      expect(result!.startDate).toBe('2026-12-31');
    });

    // Re-deriving the preset from the date it already produced must be a no-op:
    // the dialog runs this on every save, and a changed startDate reschedules
    // the live instance (#7373).
    it('MONTHLY_LAST_DAY leaves an anchor it produced itself alone', () => {
      mockToday(new Date(2026, 7, 8));
      const result = getQuickSettingUpdates('MONTHLY_LAST_DAY', new Date(2026, 10, 30));
      expect(result!.startDate).toBe('2026-11-30');
    });

    // #7726 still holds: a stale start date must not drag a fresh anchor into
    // the past, so the reference day is floored at today.
    it('MONTHLY_FIRST_DAY ignores a reference date that is in the past', () => {
      mockToday(new Date(2026, 7, 8));
      const result = getQuickSettingUpdates('MONTHLY_FIRST_DAY', new Date(2020, 0, 15));
      expect(result!.startDate).toBe('2026-09-01');
    });

    it('MONTHLY_LAST_DAY ignores a reference date that is in the past', () => {
      mockToday(new Date(2026, 7, 8));
      const result = getQuickSettingUpdates('MONTHLY_LAST_DAY', new Date(2020, 0, 15));
      expect(result!.startDate).toBe('2026-08-31');
    });
  });

  describe('YEARLY_CURRENT_DATE', () => {
    it('should return YEARLY cycle with repeatEvery 1', () => {
      const result = getQuickSettingUpdates('YEARLY_CURRENT_DATE');
      expect(result).toBeDefined();
      expect(result!.repeatCycle).toBe('YEARLY');
      expect(result!.repeatEvery).toBe(1);
    });

    it('should set startDate to today (fixes #6699)', () => {
      const result = getQuickSettingUpdates('YEARLY_CURRENT_DATE');
      expect(result!.startDate).toBe(getDbDateStr());
    });
  });

  describe('MONTHLY_NTH_WEEKDAY (issue #6040)', () => {
    it('infers ordinal and weekday from referenceDate', () => {
      // 2026-01-12 is the 2nd Monday of Jan 2026.
      const ref = new Date(2026, 0, 12);
      const result = getQuickSettingUpdates('MONTHLY_NTH_WEEKDAY', ref);
      expect(result).toBeDefined();
      expect(result!.repeatCycle).toBe('MONTHLY');
      expect(result!.repeatEvery).toBe(1);
      expect(result!.monthlyWeekOfMonth).toBe(2);
      expect(result!.monthlyWeekday).toBe(1); // Monday
      expect(result!.startDate).toBe(getDbDateStr(ref));
    });

    it('caps the ordinal at 4 when start date is the 5th occurrence', () => {
      // 2026-01-29 is the 5th Thursday of Jan 2026 — capped to "4th".
      const ref = new Date(2026, 0, 29);
      const result = getQuickSettingUpdates('MONTHLY_NTH_WEEKDAY', ref);
      expect(result!.monthlyWeekOfMonth).toBe(4);
      expect(result!.monthlyWeekday).toBe(4); // Thursday
    });
  });

  describe('day-of-month presets clear NTH_WEEKDAY anchors', () => {
    it('MONTHLY_CURRENT_DATE explicitly clears the Nth-weekday anchor fields', () => {
      const result = getQuickSettingUpdates('MONTHLY_CURRENT_DATE');
      expect(result!.monthlyWeekOfMonth).toBeUndefined();
      expect(result!.monthlyWeekday).toBeUndefined();
    });

    it('MONTHLY_FIRST_DAY explicitly clears the Nth-weekday anchor fields', () => {
      const result = getQuickSettingUpdates('MONTHLY_FIRST_DAY');
      expect(result!.monthlyWeekOfMonth).toBeUndefined();
      expect(result!.monthlyWeekday).toBeUndefined();
    });

    it('MONTHLY_LAST_DAY explicitly clears the Nth-weekday anchor fields', () => {
      const result = getQuickSettingUpdates('MONTHLY_LAST_DAY');
      expect(result!.monthlyWeekOfMonth).toBeUndefined();
      expect(result!.monthlyWeekday).toBeUndefined();
    });
  });

  describe('monthlyLastDay anchor is mutually exclusive with other presets', () => {
    it('MONTHLY_CURRENT_DATE clears monthlyLastDay', () => {
      expect(
        getQuickSettingUpdates('MONTHLY_CURRENT_DATE')!.monthlyLastDay,
      ).toBeUndefined();
    });

    it('MONTHLY_FIRST_DAY clears monthlyLastDay', () => {
      expect(getQuickSettingUpdates('MONTHLY_FIRST_DAY')!.monthlyLastDay).toBeUndefined();
    });

    it('MONTHLY_NTH_WEEKDAY clears monthlyLastDay', () => {
      const ref = new Date(2026, 0, 12);
      expect(
        getQuickSettingUpdates('MONTHLY_NTH_WEEKDAY', ref)!.monthlyLastDay,
      ).toBeUndefined();
    });
  });

  describe('CUSTOM', () => {
    it('should return undefined', () => {
      const result = getQuickSettingUpdates('CUSTOM');
      expect(result).toBeUndefined();
    });
  });
});
