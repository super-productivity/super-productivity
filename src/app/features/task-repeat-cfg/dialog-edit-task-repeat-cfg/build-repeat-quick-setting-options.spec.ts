import { TranslateService } from '@ngx-translate/core';
import { buildRepeatQuickSettingOptions } from './build-repeat-quick-setting-options';

// Mimics ngx-translate's `instant`, which throws when the key is empty/undefined
// ("Parameter 'key' is required and cannot be empty"). This is exactly what
// crashed the dialog in #7945, so the fake must reproduce it for the regression
// test to be meaningful.
const createTranslateServiceMock = (): TranslateService =>
  ({
    instant: (key: string, params?: Record<string, unknown>) => {
      if (!key) {
        throw new Error('Parameter "key" is required and cannot be empty');
      }
      return params ? `${key}:${JSON.stringify(params)}` : key;
    },
  }) as unknown as TranslateService;

describe('buildRepeatQuickSettingOptions', () => {
  let translateService: TranslateService;

  beforeEach(() => {
    translateService = createTranslateServiceMock();
  });

  it('should build the full set of quick-setting options for a valid date', () => {
    const options = buildRepeatQuickSettingOptions(
      new Date(2026, 5, 2),
      'en-US',
      translateService,
    );
    expect(options.map((o) => o.value)).toEqual([
      'DAILY',
      'MONDAY_TO_FRIDAY',
      'WEEKLY_CURRENT_WEEKDAY',
      'MONTHLY_CURRENT_DATE',
      'MONTHLY_FIRST_DAY',
      'MONTHLY_LAST_DAY',
      'MONTHLY_NTH_WEEKDAY',
      'YEARLY_CURRENT_DATE',
      'CUSTOM',
    ]);

    const monthlyNthWeekdayOption = options.find(
      (o) => o.value === 'MONTHLY_NTH_WEEKDAY',
    );
    expect(monthlyNthWeekdayOption).toBeTruthy();
    // Verify it uses the NTH/dative variant to ensure correct grammar in non-English locales
    expect(monthlyNthWeekdayOption?.label).toContain('F.TASK_REPEAT.F.ORD_FIRST_NTH');
    expect(monthlyNthWeekdayOption?.label).not.toContain('F.TASK_REPEAT.F.ORD_FIRST:');
  });

  // Regression test for #7945: a Date the form's `defaultValue` left unparsed
  // would reach `dateStrToUtcDate`, return Invalid Date, make weekOfMonth NaN,
  // and `ORDINAL_KEYS[NaN-1]` → undefined → instant(undefined) threw.
  it('should not throw when given an invalid date', () => {
    expect(() =>
      buildRepeatQuickSettingOptions(new Date('Invalid Date'), 'en-US', translateService),
    ).not.toThrow();
  });

  it('should still return all options for an invalid date', () => {
    const options = buildRepeatQuickSettingOptions(
      new Date('Invalid Date'),
      'en-US',
      translateService,
    );
    expect(options.length).toBe(9);
    options.forEach((o) => expect(o.label).toBeTruthy());
  });
});
