import { TranslateService } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { TASK_REPEAT_WEEKDAY_MAP, TaskRepeatCfg } from '../task-repeat-cfg.model';
import { DateTimeFormatService } from '../../../core/date-time-format/date-time-format.service';
import { hasNthWeekdayAnchor } from '../store/get-nth-weekday-of-month.util';
import { getEffectiveRepeatStartDate } from '../store/get-effective-repeat-start-date.util';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';
import { isValidSplitTime } from '../../../util/is-valid-split-time';
import { getDateTimeFromClockString } from '../../../util/get-date-time-from-clock-string';

const MONDAY_TO_FRIDAY = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
// In the order of the day chips above the summary.
const MONDAY_FIRST = [...TASK_REPEAT_WEEKDAY_MAP.slice(1), TASK_REPEAT_WEEKDAY_MAP[0]];

const ORDINAL_KEYS = [
  T.F.TASK_REPEAT.F.ORD_FIRST_NTH,
  T.F.TASK_REPEAT.F.ORD_SECOND_NTH,
  T.F.TASK_REPEAT.F.ORD_THIRD_NTH,
  T.F.TASK_REPEAT.F.ORD_FOURTH_NTH,
];

// TASK_REPEAT_WEEKDAY_MAP starts on Sunday; 2026-01-04 is a Sunday.
const weekdayName = (dayIndex: number, locale: string): string =>
  new Date(Date.UTC(2026, 0, 4 + dayIndex)).toLocaleDateString(locale, {
    weekday: 'long',
    timeZone: 'UTC',
  });

const getWeeklyKey = (
  cfg: TaskRepeatCfg,
  locale: string,
): [string, Record<string, string | number>] | null => {
  const days = MONDAY_FIRST.filter((day) => cfg[day]);
  if (!days.length) {
    return null;
  }
  if (cfg.repeatEvery === 1 && days.join() === MONDAY_TO_FRIDAY.join()) {
    return [T.F.TASK_REPEAT.F.Q_MONDAY_TO_FRIDAY, {}];
  }
  const names = days.map((day) =>
    weekdayName(TASK_REPEAT_WEEKDAY_MAP.indexOf(day), locale),
  );
  if (cfg.repeatEvery === 1 && names.length === 1) {
    return [T.F.TASK_REPEAT.F.Q_WEEKLY_CURRENT_WEEKDAY, { weekdayStr: names[0] }];
  }
  const daysStr = new Intl.ListFormat(locale, { type: 'conjunction' }).format(names);
  return cfg.repeatEvery === 1
    ? [T.F.TASK_REPEAT.D_EDIT.RULE_WEEKLY_ON, { daysStr }]
    : [T.F.TASK_REPEAT.ADD_INFO_PANEL.EVERY_X_WEEKLY, { x: cfg.repeatEvery, daysStr }];
};

const getMonthlyKey = (
  cfg: TaskRepeatCfg,
  weekdayLocale: string,
  numericLocale: string,
  translate: TranslateService,
): [string, Record<string, string | number>] => {
  const x = cfg.repeatEvery;
  if (hasNthWeekdayAnchor(cfg)) {
    const ordinalKey =
      cfg.monthlyWeekOfMonth === -1
        ? T.F.TASK_REPEAT.F.ORD_LAST_NTH
        : ORDINAL_KEYS[cfg.monthlyWeekOfMonth - 1];
    const params = {
      x,
      ordinalStr: translate.instant(ordinalKey),
      weekdayStr: weekdayName(cfg.monthlyWeekday, weekdayLocale),
    };
    return x === 1
      ? [T.F.TASK_REPEAT.F.Q_MONTHLY_NTH_WEEKDAY, params]
      : [T.F.TASK_REPEAT.D_EDIT.RULE_EVERY_X_MONTHS_NTH_WEEKDAY, params];
  }
  if (cfg.monthlyLastDay) {
    return x === 1
      ? [T.F.TASK_REPEAT.F.Q_MONTHLY_LAST_DAY, {}]
      : [T.F.TASK_REPEAT.D_EDIT.RULE_EVERY_X_MONTHS_LAST_DAY, { x }];
  }
  const dateDayStr = dateStrToUtcDate(
    getEffectiveRepeatStartDate(cfg),
  ).toLocaleDateString(numericLocale, { day: 'numeric' });
  return x === 1
    ? [T.F.TASK_REPEAT.F.Q_MONTHLY_CURRENT_DATE, { dateDayStr }]
    : [T.F.TASK_REPEAT.D_EDIT.RULE_EVERY_X_MONTHS_DAY, { x, dateDayStr }];
};

/**
 * The repeat dialog's summary as a sentence for weekly and monthly fixed
 * schedules ("Every week on Monday and Wednesday", "Every 2 months on the second
 * Monday"), with the time and end date the shared chip text also shows. Null
 * for other rules, where the shared text already reads as one.
 */
export const getRuleSentence = (
  cfg: TaskRepeatCfg,
  dateTimeFormatService: DateTimeFormatService,
  translate: TranslateService,
): string | null => {
  if (cfg.repeatFromCompletionDate) {
    return null;
  }
  // Names follow the UI language, also under the ISO 8601 option (#8987).
  const weekdayLocale = dateTimeFormatService.textLocale();
  const rule =
    cfg.repeatCycle === 'WEEKLY'
      ? getWeeklyKey(cfg, weekdayLocale)
      : cfg.repeatCycle === 'MONTHLY'
        ? getMonthlyKey(
            cfg,
            weekdayLocale,
            dateTimeFormatService.currentLocale(),
            translate,
          )
        : null;
  if (!rule) {
    return null;
  }
  let sentence = translate.instant(rule[0], rule[1]);
  if (cfg.startTime && isValidSplitTime(cfg.startTime)) {
    const timeStr = dateTimeFormatService.formatTime(
      getDateTimeFromClockString(cfg.startTime, new Date()),
    );
    sentence = translate.instant(T.F.TASK_REPEAT.ADD_INFO_PANEL.WITH_TIME, {
      repeatStr: sentence,
      timeStr,
    });
  }
  if (cfg.repeatUntilDay) {
    sentence = translate.instant(T.F.TASK_REPEAT.ADD_INFO_PANEL.UNTIL, {
      repeatStr: sentence,
      untilStr: dateTimeFormatService.formatDate(dateStrToUtcDate(cfg.repeatUntilDay)),
    });
  }
  return sentence;
};
