import { TranslateService } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { RepeatQuickSetting } from '../task-repeat-cfg.model';

const ORDINAL_KEYS = [
  T.F.TASK_REPEAT.F.ORD_FIRST,
  T.F.TASK_REPEAT.F.ORD_SECOND,
  T.F.TASK_REPEAT.F.ORD_THIRD,
  T.F.TASK_REPEAT.F.ORD_FOURTH,
];

export const buildRepeatQuickSettingOptions = (
  refDate: Date,
  locale: string,
  translateService: TranslateService,
): { value: RepeatQuickSetting; label: string }[] => {
  const refWeekdayStr = refDate.toLocaleDateString(locale, { weekday: 'long' });
  const refDayStr = refDate.toLocaleDateString(locale, { day: 'numeric' });
  const refDayAndMonthStr = refDate.toLocaleDateString(locale, {
    day: 'numeric',
    month: 'numeric',
  });
  // 1-based occurrence of refDate's weekday within its month, capped to 4.
  const weekOfMonth = Math.min(Math.floor((refDate.getDate() - 1) / 7) + 1, 4);
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
