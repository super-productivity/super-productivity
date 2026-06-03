import { toSyncSafeQuickSetting } from './task-repeat-cfg.model';

describe('toSyncSafeQuickSetting (forward-compat)', () => {
  it('passes through values present in the released (master) union', () => {
    for (const safe of [
      'DAILY',
      'WEEKLY_CURRENT_WEEKDAY',
      'MONTHLY_CURRENT_DATE',
      'MONTHLY_FIRST_DAY',
      'MONTHLY_LAST_DAY',
      'MONTHLY_NTH_WEEKDAY',
      'MONDAY_TO_FRIDAY',
      'YEARLY_CURRENT_DATE',
      'CUSTOM',
    ] as const) {
      expect(toSyncSafeQuickSetting(safe)).toBe(safe);
    }
  });

  it('maps newer literals (and RRULE) to CUSTOM so old clients can validate', () => {
    for (const unsafe of [
      'RRULE',
      'EVERY_OTHER_DAY',
      'BIWEEKLY_CURRENT_WEEKDAY',
      'WEEKENDS',
      'MONTHLY_LAST_WEEKDAY',
      'QUARTERLY_CURRENT_DATE',
      'SEMIANNUALLY_CURRENT_DATE',
      'EVERY_OTHER_YEAR_CURRENT_DATE',
    ] as const) {
      expect(toSyncSafeQuickSetting(unsafe)).toBe('CUSTOM');
    }
  });
});
