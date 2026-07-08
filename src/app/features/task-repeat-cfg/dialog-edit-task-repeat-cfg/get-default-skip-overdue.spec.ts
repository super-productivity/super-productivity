import { getDefaultSkipOverdue } from './get-default-skip-overdue';
import { RepeatCycleOption, RepeatQuickSetting } from '../task-repeat-cfg.model';

const cfg = (
  quickSetting: RepeatQuickSetting,
  repeatCycle: RepeatCycleOption = 'DAILY',
  repeatEvery = 1,
): {
  quickSetting: RepeatQuickSetting;
  repeatCycle: RepeatCycleOption;
  repeatEvery: number;
} => ({
  quickSetting,
  repeatCycle,
  repeatEvery,
});

describe('getDefaultSkipOverdue', () => {
  it('is ON for the Daily preset (everyday → never drops to zero)', () => {
    expect(getDefaultSkipOverdue(cfg('DAILY', 'DAILY', 1))).toBe(true);
  });

  it('is OFF for the Mon–Fri preset (a missed workday must stay visible)', () => {
    expect(getDefaultSkipOverdue(cfg('MONDAY_TO_FRIDAY', 'WEEKLY', 1))).toBe(false);
  });

  it('is OFF for weekly/monthly/yearly presets (missed occurrence must stay visible)', () => {
    const offPresets: RepeatQuickSetting[] = [
      'WEEKLY_CURRENT_WEEKDAY',
      'MONTHLY_CURRENT_DATE',
      'MONTHLY_FIRST_DAY',
      'MONTHLY_LAST_DAY',
      'MONTHLY_NTH_WEEKDAY',
      'YEARLY_CURRENT_DATE',
    ];
    offPresets.forEach((preset) => {
      expect(getDefaultSkipOverdue(cfg(preset, 'WEEKLY', 1))).toBe(false);
    });
  });

  describe('CUSTOM', () => {
    it('is ON only for an every-single-day custom cycle (same as the Daily preset)', () => {
      expect(getDefaultSkipOverdue(cfg('CUSTOM', 'DAILY', 1))).toBe(true);
    });

    it('is OFF for every-N-days (N > 1) — today is no longer always scheduled', () => {
      expect(getDefaultSkipOverdue(cfg('CUSTOM', 'DAILY', 2))).toBe(false);
    });

    it('is OFF for weekly/monthly/yearly custom cycles', () => {
      expect(getDefaultSkipOverdue(cfg('CUSTOM', 'WEEKLY', 1))).toBe(false);
      expect(getDefaultSkipOverdue(cfg('CUSTOM', 'MONTHLY', 1))).toBe(false);
      expect(getDefaultSkipOverdue(cfg('CUSTOM', 'YEARLY', 1))).toBe(false);
    });

    it('treats a missing repeatEvery as 1', () => {
      expect(
        getDefaultSkipOverdue({ quickSetting: 'CUSTOM', repeatCycle: 'DAILY' }),
      ).toBe(true);
    });
  });
});
