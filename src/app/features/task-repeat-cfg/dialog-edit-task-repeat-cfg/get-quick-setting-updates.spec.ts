import { getQuickSettingUpdates } from './get-quick-setting-updates';

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

    it('should NOT set startDate (fixes #5594)', () => {
      const result = getQuickSettingUpdates('MONTHLY_CURRENT_DATE');
      expect(result!.startDate).toBeUndefined();
    });
  });

  describe('YEARLY_CURRENT_DATE', () => {
    it('should return YEARLY cycle with repeatEvery 1', () => {
      const result = getQuickSettingUpdates('YEARLY_CURRENT_DATE');
      expect(result).toBeDefined();
      expect(result!.repeatCycle).toBe('YEARLY');
      expect(result!.repeatEvery).toBe(1);
    });

    it('should NOT set startDate (fixes #5594)', () => {
      const result = getQuickSettingUpdates('YEARLY_CURRENT_DATE');
      expect(result!.startDate).toBeUndefined();
    });
  });

  describe('CUSTOM', () => {
    it('should return undefined', () => {
      const result = getQuickSettingUpdates('CUSTOM');
      expect(result).toBeUndefined();
    });
  });
});
