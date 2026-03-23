import { TranslateService } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { RepeatQuickSetting } from '../task-repeat-cfg.model';

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
