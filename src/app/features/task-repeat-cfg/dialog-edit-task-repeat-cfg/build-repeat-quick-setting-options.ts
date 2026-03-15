import { TranslateService } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { RepeatQuickSetting } from '../task-repeat-cfg.model';

export const buildRepeatQuickSettingOptions = (
  refDate: Date,
  locale: string,
  translateService: TranslateService,
): { value: RepeatQuickSetting; label: string }[] => {
  const weekdayStr = refDate.toLocaleDateString(locale, { weekday: 'long' });
  const dateDayStr = refDate.toLocaleDateString(locale, { day: 'numeric' });
  const dayAndMonthStr = refDate.toLocaleDateString(locale, {
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
        weekdayStr,
      }),
    },
    {
      value: 'MONTHLY_CURRENT_DATE',
      label: translateService.instant(T.F.TASK_REPEAT.F.Q_MONTHLY_CURRENT_DATE, {
        dateDayStr,
      }),
    },
    {
      value: 'YEARLY_CURRENT_DATE',
      label: translateService.instant(T.F.TASK_REPEAT.F.Q_YEARLY_CURRENT_DATE, {
        dayAndMonthStr,
      }),
    },
    {
      value: 'CUSTOM',
      label: translateService.instant(T.F.TASK_REPEAT.F.Q_CUSTOM),
    },
  ];
};
