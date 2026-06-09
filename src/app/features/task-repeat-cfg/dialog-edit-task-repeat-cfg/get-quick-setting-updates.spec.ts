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

  // The numeric anchors reset via PRESENT-but-undefined keys so the
  // spread-merge overwrites stale values in memory. NOT null: released
  // clients' typia schema allows these fields only absent-or-numeric, so a
  // null must never reach the wire.
  describe('day-of-month presets clear NTH_WEEKDAY anchors', () => {
    it('MONTHLY_CURRENT_DATE explicitly clears the Nth-weekday anchor fields', () => {
      const result = getQuickSettingUpdates('MONTHLY_CURRENT_DATE');
      expect('monthlyWeekOfMonth' in result!).toBe(true);
      expect('monthlyWeekday' in result!).toBe(true);
      expect(result!.monthlyWeekOfMonth).toBeUndefined();
      expect(result!.monthlyWeekday).toBeUndefined();
    });

    it('MONTHLY_FIRST_DAY explicitly clears the Nth-weekday anchor fields', () => {
      const result = getQuickSettingUpdates('MONTHLY_FIRST_DAY');
      expect('monthlyWeekOfMonth' in result!).toBe(true);
      expect(result!.monthlyWeekOfMonth).toBeUndefined();
      expect(result!.monthlyWeekday).toBeUndefined();
    });

    it('MONTHLY_LAST_DAY explicitly clears the Nth-weekday anchor fields', () => {
      const result = getQuickSettingUpdates('MONTHLY_LAST_DAY');
      expect('monthlyWeekOfMonth' in result!).toBe(true);
      expect(result!.monthlyWeekOfMonth).toBeUndefined();
      expect(result!.monthlyWeekday).toBeUndefined();
    });
  });

  describe('monthlyLastDay anchor is mutually exclusive with other presets', () => {
    it('MONTHLY_CURRENT_DATE clears monthlyLastDay', () => {
      expect(getQuickSettingUpdates('MONTHLY_CURRENT_DATE')!.monthlyLastDay).toBe(false);
    });

    it('MONTHLY_FIRST_DAY clears monthlyLastDay', () => {
      expect(getQuickSettingUpdates('MONTHLY_FIRST_DAY')!.monthlyLastDay).toBe(false);
    });

    it('MONTHLY_NTH_WEEKDAY clears monthlyLastDay', () => {
      const ref = new Date(2026, 0, 12);
      expect(getQuickSettingUpdates('MONTHLY_NTH_WEEKDAY', ref)!.monthlyLastDay).toBe(
        false,
      );
    });
  });

  describe('CUSTOM', () => {
    it('should return undefined', () => {
      const result = getQuickSettingUpdates('CUSTOM');
      expect(result).toBeUndefined();
    });
  });

  describe('rrule presets (every preset emits a canonical rrule)', () => {
    it('DAILY → FREQ=DAILY', () => {
      expect(getQuickSettingUpdates('DAILY')!.rrule).toBe('FREQ=DAILY');
    });

    it('MONDAY_TO_FRIDAY → weekday rule', () => {
      expect(getQuickSettingUpdates('MONDAY_TO_FRIDAY')!.rrule).toBe(
        'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
      );
    });

    it('WEEKLY_CURRENT_WEEKDAY → BYDAY for the reference weekday', () => {
      const monday = new Date(2025, 11, 29); // a Monday
      expect(getQuickSettingUpdates('WEEKLY_CURRENT_WEEKDAY', monday)!.rrule).toBe(
        'FREQ=WEEKLY;BYDAY=MO',
      );
    });

    it('MONTHLY_CURRENT_DATE → BYMONTHDAY for the reference day', () => {
      const ref = new Date(2024, 5, 15);
      expect(getQuickSettingUpdates('MONTHLY_CURRENT_DATE', ref)!.rrule).toBe(
        'FREQ=MONTHLY;BYMONTHDAY=15',
      );
    });

    it('MONTHLY_LAST_DAY → BYMONTHDAY=-1', () => {
      expect(getQuickSettingUpdates('MONTHLY_LAST_DAY')!.rrule).toBe(
        'FREQ=MONTHLY;BYMONTHDAY=-1',
      );
    });

    it('MONTHLY_NTH_WEEKDAY → BYDAY=<pos><weekday> (3rd Saturday)', () => {
      const ref = new Date(2024, 5, 15); // 3rd Saturday of June 2024
      expect(getQuickSettingUpdates('MONTHLY_NTH_WEEKDAY', ref)!.rrule).toBe(
        'FREQ=MONTHLY;BYDAY=3SA',
      );
    });

    it('YEARLY_CURRENT_DATE → BYMONTH;BYMONTHDAY', () => {
      const ref = new Date(2024, 2, 17);
      expect(getQuickSettingUpdates('YEARLY_CURRENT_DATE', ref)!.rrule).toBe(
        'FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=17',
      );
    });

    it('RRULE baseline does not set rrule (the builder assembles it)', () => {
      expect(getQuickSettingUpdates('RRULE')!.rrule).toBeUndefined();
    });
  });

  describe('interval & weekend presets', () => {
    it('EVERY_OTHER_DAY → DAILY every 2, no startDate', () => {
      const result = getQuickSettingUpdates('EVERY_OTHER_DAY');
      expect(result!.repeatCycle).toBe('DAILY');
      expect(result!.repeatEvery).toBe(2);
      expect(result!.startDate).toBeUndefined();
      expect(result!.rrule).toBe('FREQ=DAILY;INTERVAL=2');
    });

    it('BIWEEKLY_CURRENT_WEEKDAY → WEEKLY every 2 on the reference weekday', () => {
      const monday = new Date(2025, 11, 29); // a Monday
      const result = getQuickSettingUpdates('BIWEEKLY_CURRENT_WEEKDAY', monday);
      expect(result!.repeatCycle).toBe('WEEKLY');
      expect(result!.repeatEvery).toBe(2);
      expect((result as any).monday).toBe(true);
      expect(result!.rrule).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO');
    });

    it('WEEKENDS → WEEKLY on Saturday & Sunday only', () => {
      const result = getQuickSettingUpdates('WEEKENDS');
      expect(result!.repeatCycle).toBe('WEEKLY');
      expect(result!.repeatEvery).toBe(1);
      expect((result as any).saturday).toBe(true);
      expect((result as any).sunday).toBe(true);
      expect((result as any).monday).toBe(false);
      expect((result as any).friday).toBe(false);
      expect(result!.startDate).toBeUndefined();
      expect(result!.rrule).toBe('FREQ=WEEKLY;BYDAY=SA,SU');
    });

    it('QUARTERLY_CURRENT_DATE → MONTHLY every 3 on the reference day', () => {
      const ref = new Date(2024, 5, 15);
      const result = getQuickSettingUpdates('QUARTERLY_CURRENT_DATE', ref);
      expect(result!.repeatCycle).toBe('MONTHLY');
      expect(result!.repeatEvery).toBe(3);
      expect(result!.startDate).toBe(getDbDateStr(ref));
      expect(result!.rrule).toBe('FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=15');
    });

    it('SEMIANNUALLY_CURRENT_DATE → MONTHLY every 6 on the reference day', () => {
      const ref = new Date(2024, 5, 15);
      const result = getQuickSettingUpdates('SEMIANNUALLY_CURRENT_DATE', ref);
      expect(result!.repeatCycle).toBe('MONTHLY');
      expect(result!.repeatEvery).toBe(6);
      expect(result!.rrule).toBe('FREQ=MONTHLY;INTERVAL=6;BYMONTHDAY=15');
    });

    it('MONTHLY_LAST_WEEKDAY → BYDAY=-1<weekday> for the reference weekday', () => {
      const friday = new Date(2026, 5, 26); // last Friday of June 2026
      const result = getQuickSettingUpdates('MONTHLY_LAST_WEEKDAY', friday);
      expect(result!.repeatCycle).toBe('MONTHLY');
      expect(result!.monthlyWeekOfMonth).toBe(-1);
      expect(result!.monthlyWeekday).toBe(5); // Friday
      expect(result!.rrule).toBe('FREQ=MONTHLY;BYDAY=-1FR');
    });

    it('EVERY_OTHER_YEAR_CURRENT_DATE → YEARLY every 2 on the reference day/month', () => {
      const ref = new Date(2024, 2, 17);
      const result = getQuickSettingUpdates('EVERY_OTHER_YEAR_CURRENT_DATE', ref);
      expect(result!.repeatCycle).toBe('YEARLY');
      expect(result!.repeatEvery).toBe(2);
      expect(result!.rrule).toBe('FREQ=YEARLY;INTERVAL=2;BYMONTH=3;BYMONTHDAY=17');
    });
  });
});
