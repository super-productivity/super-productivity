import { TranslateService } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { RepeatQuickSetting, RRULE_QUICK_SETTING } from '../task-repeat-cfg.model';

const ORDINAL_KEYS = [
  T.F.TASK_REPEAT.F.ORD_FIRST_NTH,
  T.F.TASK_REPEAT.F.ORD_SECOND_NTH,
  T.F.TASK_REPEAT.F.ORD_THIRD_NTH,
  T.F.TASK_REPEAT.F.ORD_FOURTH_NTH,
];

export const buildRepeatQuickSettingOptions = (
  refDate: Date,
  locale: string,
  translateService: TranslateService,
): { value: RepeatQuickSetting; label: string }[] => {
  // Guard against an invalid Date slipping through (e.g. a non-DB date string).
  // An invalid date makes the weekOfMonth math NaN, so ORDINAL_KEYS[NaN-1] is
  // undefined and translate's `instant(undefined)` throws, crashing the whole
  // dialog (#7945). Fall back to "today" so options still render.
  const safeRefDate = isNaN(refDate.getTime()) ? new Date() : refDate;
  // Compact forms for the concise preset labels ("Weekly (Mon)", "Monthly
  // (15th)", "Yearly (Jun 15)", "Every 3 months (15th)", …).
  const refWeekdayShortStr = safeRefDate.toLocaleDateString(locale, { weekday: 'short' });
  const refMonthDayShortStr = safeRefDate.toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
  });
  // Locale-aware day ordinal (en: 15→"15th", 1→"1st"); plain number if the
  // runtime can't form ordinals for the locale.
  const refDayOrdinalStr = ((n: number): string => {
    try {
      const suffix: Record<string, string> = {
        one: 'st',
        two: 'nd',
        few: 'rd',
        other: 'th',
      };
      const cat = new Intl.PluralRules(locale, { type: 'ordinal' }).select(n);
      return `${n}${suffix[cat] ?? 'th'}`;
    } catch {
      return String(n);
    }
  })(safeRefDate.getDate());
  // 1-based occurrence of refDate's weekday within its month, capped to 4.
  const weekOfMonth = Math.min(Math.floor((safeRefDate.getDate() - 1) / 7) + 1, 4);
  const ordinalStr = translateService.instant(ORDINAL_KEYS[weekOfMonth - 1]);

  const options: { value: RepeatQuickSetting; label: string }[] = [
    {
      value: 'DAILY',
      label: translateService.instant(T.F.TASK_REPEAT.F.Q_DAILY),
    },
    {
      value: 'EVERY_OTHER_DAY',
      label: translateService.instant(T.F.TASK_REPEAT.F.Q_EVERY_OTHER_DAY),
    },
    {
      value: 'MONDAY_TO_FRIDAY',
      label: translateService.instant(T.F.TASK_REPEAT.F.Q_MONDAY_TO_FRIDAY),
    },
    {
      value: 'WEEKENDS',
      label: translateService.instant(T.F.TASK_REPEAT.F.Q_WEEKENDS),
    },
    {
      value: 'WEEKLY_CURRENT_WEEKDAY',
      label: translateService.instant(T.F.TASK_REPEAT.F.Q_WEEKLY_CURRENT_WEEKDAY, {
        weekdayStr: refWeekdayShortStr,
      }),
    },
    {
      value: 'BIWEEKLY_CURRENT_WEEKDAY',
      label: translateService.instant(T.F.TASK_REPEAT.F.Q_BIWEEKLY_CURRENT_WEEKDAY, {
        weekdayStr: refWeekdayShortStr,
      }),
    },
    {
      value: 'MONTHLY_CURRENT_DATE',
      label: translateService.instant(T.F.TASK_REPEAT.F.Q_MONTHLY_CURRENT_DATE, {
        dateDayStr: refDayOrdinalStr,
      }),
    },
    {
      value: 'MONTHLY_FIRST_DAY',
      label: translateService.instant(T.F.TASK_REPEAT.F.Q_MONTHLY_FIRST_DAY),
    },
    {
      value: 'MONTHLY_LAST_DAY',
      label: translateService.instant(T.F.TASK_REPEAT.F.Q_MONTHLY_LAST_DAY),
    },
    {
      value: 'MONTHLY_NTH_WEEKDAY',
      label: translateService.instant(T.F.TASK_REPEAT.F.Q_MONTHLY_NTH_WEEKDAY, {
        ordinalStr,
        weekdayStr: refWeekdayShortStr,
      }),
    },
    {
      value: 'MONTHLY_LAST_WEEKDAY',
      label: translateService.instant(T.F.TASK_REPEAT.F.Q_MONTHLY_LAST_WEEKDAY, {
        weekdayStr: refWeekdayShortStr,
      }),
    },
    {
      value: 'QUARTERLY_CURRENT_DATE',
      label: translateService.instant(T.F.TASK_REPEAT.F.Q_QUARTERLY_CURRENT_DATE, {
        dateDayStr: refDayOrdinalStr,
      }),
    },
    {
      value: 'SEMIANNUALLY_CURRENT_DATE',
      label: translateService.instant(T.F.TASK_REPEAT.F.Q_SEMIANNUALLY_CURRENT_DATE, {
        dateDayStr: refDayOrdinalStr,
      }),
    },
    {
      value: 'YEARLY_CURRENT_DATE',
      label: translateService.instant(T.F.TASK_REPEAT.F.Q_YEARLY_CURRENT_DATE, {
        dayAndMonthStr: refMonthDayShortStr,
      }),
    },
    {
      value: 'EVERY_OTHER_YEAR_CURRENT_DATE',
      label: translateService.instant(T.F.TASK_REPEAT.F.Q_EVERY_OTHER_YEAR_CURRENT_DATE, {
        dayAndMonthStr: refMonthDayShortStr,
      }),
    },
  ];

  // The builder mode replaced the legacy "Custom" UI, so it must always be on
  // offer regardless of the per-device RRULE engine flag — flag-off devices
  // schedule from the legacy mirror fields the dialog persists alongside the
  // rule (rruleToLegacyTaskRepeatCfg), the same fallback old sync clients use.
  options.push({
    value: RRULE_QUICK_SETTING,
    label: translateService.instant(T.F.TASK_REPEAT.F.Q_RRULE),
  });

  return options;
};
