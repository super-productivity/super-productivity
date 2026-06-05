import {
  TASK_REPEAT_WEEKDAY_MAP,
  TaskRepeatCfg,
} from '../../task-repeat-cfg/task-repeat-cfg.model';
import { T } from '../../../t.const';
import { getDateTimeFromClockString } from '../../../util/get-date-time-from-clock-string';
import { isValidSplitTime } from '../../../util/is-valid-split-time';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';
import { getWeekdaysMin } from '../../../util/get-weekdays-min';
import { DateTimeFormatService } from '../../../core/date-time-format/date-time-format.service';
import { getEffectiveRepeatStartDate } from '../../task-repeat-cfg/store/get-effective-repeat-start-date.util';
import { TranslateService } from '@ngx-translate/core';
import { hasNthWeekdayAnchor } from '../../task-repeat-cfg/store/get-nth-weekday-of-month.util';

export const getTaskRepeatInfoText = (
  repeatCfg: TaskRepeatCfg,
  locale: string | undefined,
  dateTimeFormatService: DateTimeFormatService | undefined,
  translateService: TranslateService,
): [string, { [key: string]: string | number }] => {
  const timeStr =
    repeatCfg.startTime && isValidSplitTime(repeatCfg.startTime)
      ? dateTimeFormatService
        ? dateTimeFormatService.formatTime(
            getDateTimeFromClockString(repeatCfg.startTime, new Date()),
          )
        : new Date(
            getDateTimeFromClockString(repeatCfg.startTime, new Date()),
          ).toLocaleTimeString(locale, {
            hour: 'numeric',
            minute: 'numeric',
          })
      : '';

  if (repeatCfg.repeatEvery !== 1) {
    switch (repeatCfg.repeatCycle) {
      case 'DAILY':
        return [
          timeStr
            ? T.F.TASK_REPEAT.ADD_INFO_PANEL.EVERY_X_DAILY_AND_TIME
            : T.F.TASK_REPEAT.ADD_INFO_PANEL.EVERY_X_DAILY,
          { timeStr, x: repeatCfg.repeatEvery },
        ];
      case 'MONTHLY':
        return [
          timeStr
            ? T.F.TASK_REPEAT.ADD_INFO_PANEL.EVERY_X_MONTHLY_AND_TIME
            : T.F.TASK_REPEAT.ADD_INFO_PANEL.EVERY_X_MONTHLY,
          { timeStr, x: repeatCfg.repeatEvery },
        ];
      case 'YEARLY':
        return [
          timeStr
            ? T.F.TASK_REPEAT.ADD_INFO_PANEL.EVERY_X_YEARLY_AND_TIME
            : T.F.TASK_REPEAT.ADD_INFO_PANEL.EVERY_X_YEARLY,
          { timeStr, x: repeatCfg.repeatEvery },
        ];
    }
    return [
      timeStr
        ? T.F.TASK_REPEAT.ADD_INFO_PANEL.CUSTOM_AND_TIME
        : T.F.TASK_REPEAT.ADD_INFO_PANEL.CUSTOM,
      { timeStr },
    ];
  }

  switch (repeatCfg.repeatCycle) {
    case 'DAILY':
      // case 'DAILY':
      //   return [
      //     timeStr
      //       ? T.F.TASK_REPEAT.ADD_INFO_PANEL.DAILY_AND_TIME
      //       : T.F.TASK_REPEAT.ADD_INFO_PANEL.DAILY,
      //     { timeStr },
      //   ];

      return [
        timeStr
          ? T.F.TASK_REPEAT.ADD_INFO_PANEL.DAILY_AND_TIME
          : T.F.TASK_REPEAT.ADD_INFO_PANEL.DAILY,
        { timeStr },
      ];

    case 'WEEKLY':
      const localWeekDays = getWeekdaysMin(locale);
      const enabledDays = TASK_REPEAT_WEEKDAY_MAP.filter((day) => repeatCfg[day]);

      if (enabledDays.length === 1) {
        const enabledDayIndex = TASK_REPEAT_WEEKDAY_MAP.findIndex(
          (day) => repeatCfg[day],
        );
        const weekDayDate = new Date(Date.UTC(2026, 0, 4 + enabledDayIndex));
        const weekdayStr = weekDayDate.toLocaleDateString(locale, {
          weekday: 'short',
          timeZone: 'UTC',
        });
        return [
          timeStr
            ? T.F.TASK_REPEAT.ADD_INFO_PANEL.WEEKLY_CURRENT_WEEKDAY_AND_TIME
            : T.F.TASK_REPEAT.ADD_INFO_PANEL.WEEKLY_CURRENT_WEEKDAY,
          {
            weekdayStr,
            timeStr,
          },
        ];
      }

      if (
        enabledDays.length === 5 &&
        JSON.stringify(enabledDays) ===
          JSON.stringify(['monday', 'tuesday', 'wednesday', 'thursday', 'friday'])
      ) {
        return [
          timeStr
            ? T.F.TASK_REPEAT.ADD_INFO_PANEL.MONDAY_TO_FRIDAY_AND_TIME
            : T.F.TASK_REPEAT.ADD_INFO_PANEL.MONDAY_TO_FRIDAY,
          { timeStr },
        ];
      }

      const daysStr = enabledDays
        .map((day, index) => localWeekDays[TASK_REPEAT_WEEKDAY_MAP.indexOf(day)])
        .join(', ');
      return [
        timeStr
          ? T.F.TASK_REPEAT.ADD_INFO_PANEL.CUSTOM_WEEKLY_AND_TIME
          : T.F.TASK_REPEAT.ADD_INFO_PANEL.CUSTOM_WEEKLY,
        {
          timeStr,
          daysStr,
        },
      ];

    case 'MONTHLY':
      if (hasNthWeekdayAnchor(repeatCfg)) {
        const weekDayDate = new Date(Date.UTC(2026, 0, 4 + repeatCfg.monthlyWeekday));
        const weekdayStr = weekDayDate.toLocaleDateString(locale, {
          weekday: 'long',
          timeZone: 'UTC',
        });

        let ordinalKey = '';
        if (repeatCfg.monthlyWeekOfMonth === -1) {
          ordinalKey = T.F.TASK_REPEAT.F.ORD_LAST_NTH;
        } else {
          const ordinalKeys = [
            T.F.TASK_REPEAT.F.ORD_FIRST_NTH,
            T.F.TASK_REPEAT.F.ORD_SECOND_NTH,
            T.F.TASK_REPEAT.F.ORD_THIRD_NTH,
            T.F.TASK_REPEAT.F.ORD_FOURTH_NTH,
          ];
          ordinalKey = ordinalKeys[repeatCfg.monthlyWeekOfMonth - 1] || '';
        }

        if (ordinalKey) {
          const ordinalStr = translateService.instant(ordinalKey);

          return [
            timeStr
              ? T.F.TASK_REPEAT.ADD_INFO_PANEL.MONTHLY_NTH_WEEKDAY_AND_TIME
              : T.F.TASK_REPEAT.ADD_INFO_PANEL.MONTHLY_NTH_WEEKDAY,
            {
              ordinalStr,
              weekdayStr,
              timeStr,
            },
          ];
        }
      }

      if (repeatCfg.monthlyLastDay) {
        return [
          timeStr
            ? T.F.TASK_REPEAT.ADD_INFO_PANEL.MONTHLY_LAST_DAY_AND_TIME
            : T.F.TASK_REPEAT.ADD_INFO_PANEL.MONTHLY_LAST_DAY,
          { timeStr },
        ];
      }

      const dateDayStr = dateStrToUtcDate(
        getEffectiveRepeatStartDate(repeatCfg),
      ).toLocaleDateString(locale, {
        day: 'numeric',
      });

      return [
        timeStr
          ? T.F.TASK_REPEAT.ADD_INFO_PANEL.MONTHLY_CURRENT_DATE_AND_TIME
          : T.F.TASK_REPEAT.ADD_INFO_PANEL.MONTHLY_CURRENT_DATE,
        {
          dateDayStr,
          timeStr,
        },
      ];

    case 'YEARLY':
      const dayAndMonthStr = dateStrToUtcDate(
        getEffectiveRepeatStartDate(repeatCfg),
      ).toLocaleDateString(locale, {
        day: 'numeric',
        month: 'numeric',
      });

      return [
        timeStr
          ? T.F.TASK_REPEAT.ADD_INFO_PANEL.YEARLY_CURRENT_DATE_AND_TIME
          : T.F.TASK_REPEAT.ADD_INFO_PANEL.YEARLY_CURRENT_DATE,
        {
          dayAndMonthStr,
          timeStr,
        },
      ];

    default:
      return [
        timeStr
          ? T.F.TASK_REPEAT.ADD_INFO_PANEL.CUSTOM_AND_TIME
          : T.F.TASK_REPEAT.ADD_INFO_PANEL.CUSTOM,
        { timeStr },
      ];
  }

  return ['???????', {}];
};
