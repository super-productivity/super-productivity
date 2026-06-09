import { TranslateService } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { RepeatQuickSetting } from '../task-repeat-cfg.model';

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
  const refWeekdayStr = safeRefDate.toLocaleDateString(locale, { weekday: 'long' });
  const refDayStr = safeRefDate.toLocaleDateString(locale, { day: 'numeric' });
  const refDayAndMonthStr = safeRefDate.toLocaleDateString(locale, {
    day: 'numeric',
    month: 'numeric',
  });
  // 1-based occurrence of refDate's weekday within its month, capped to 4.
  const weekOfMonth = Math.min(Math.floor((safeRefDate.getDate() - 1) / 7) + 1, 4);
  const ordinalStr = translateService.instant(ORDINAL_KEYS[weekOfMonth - 1]);

  return [
    {
      value: 'DAILY',
      label: translateService.instant(T.F.TASK_REPEAT.F.Q_DAILY),
    },
    {
      value: 'MONDAY_TO_FRIDAY',
      label: translateService.instant(T.F.TASK_REPEAT.F.Q_MONDAY_TO_FRIDAY),
    },
    {
      value: 'WEEKLY_CURRENT_WEEKDAY',
      label: translateService.instant(T.F.TASK_REPEAT.F.Q_WEEKLY_CURRENT_WEEKDAY, {
        weekdayStr: refWeekdayStr,
      }),
    },
    {
      value: 'MONTHLY_CURRENT_DATE',
      label: translateService.instant(T.F.TASK_REPEAT.F.Q_MONTHLY_CURRENT_DATE, {
        dateDayStr: refDayStr,
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
        weekdayStr: refWeekdayStr,
      }),
    },
    {
      value: 'YEARLY_CURRENT_DATE',
      label: translateService.instant(T.F.TASK_REPEAT.F.Q_YEARLY_CURRENT_DATE, {
        dayAndMonthStr: refDayAndMonthStr,
      }),
    },
    {
      value: 'CUSTOM',
      label: translateService.instant(T.F.TASK_REPEAT.F.Q_CUSTOM),
    },
  ];
};
