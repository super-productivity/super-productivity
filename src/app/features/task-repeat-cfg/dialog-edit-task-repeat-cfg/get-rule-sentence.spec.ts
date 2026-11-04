import { TranslateService } from '@ngx-translate/core';
import { DEFAULT_TASK_REPEAT_CFG, TaskRepeatCfg } from '../task-repeat-cfg.model';
import { DateTimeFormatService } from '../../../core/date-time-format/date-time-format.service';
import { T } from '../../../t.const';
import { getRuleSentence } from './get-rule-sentence';

const STRINGS: Record<string, string> = {
  [T.F.TASK_REPEAT.F.Q_MONDAY_TO_FRIDAY]: 'Every Monday through Friday',
  [T.F.TASK_REPEAT.F.Q_WEEKLY_CURRENT_WEEKDAY]: 'Every week on {{weekdayStr}}',
  [T.F.TASK_REPEAT.D_EDIT.RULE_WEEKLY_ON]: 'Every week on {{daysStr}}',
  [T.F.TASK_REPEAT.ADD_INFO_PANEL.EVERY_X_WEEKLY]: 'Every {{x}} weeks on {{daysStr}}',
  [T.F.TASK_REPEAT.F.Q_MONTHLY_NTH_WEEKDAY]:
    'Every month on the {{ordinalStr}} {{weekdayStr}}',
  [T.F.TASK_REPEAT.D_EDIT.RULE_EVERY_X_MONTHS_NTH_WEEKDAY]:
    'Every {{x}} months on the {{ordinalStr}} {{weekdayStr}}',
  [T.F.TASK_REPEAT.F.Q_MONTHLY_LAST_DAY]: 'Every month on the last day',
  [T.F.TASK_REPEAT.D_EDIT.RULE_EVERY_X_MONTHS_LAST_DAY]:
    'Every {{x}} months on the last day',
  [T.F.TASK_REPEAT.F.Q_MONTHLY_CURRENT_DATE]: 'Every month on day {{dateDayStr}}',
  [T.F.TASK_REPEAT.D_EDIT.RULE_EVERY_X_MONTHS_DAY]:
    'Every {{x}} months on day {{dateDayStr}}',
  [T.F.TASK_REPEAT.F.ORD_SECOND_NTH]: 'second',
  [T.F.TASK_REPEAT.F.ORD_LAST_NTH]: 'last',
  [T.F.TASK_REPEAT.ADD_INFO_PANEL.WITH_TIME]: '{{repeatStr}}, {{timeStr}}',
  [T.F.TASK_REPEAT.ADD_INFO_PANEL.UNTIL]: '{{repeatStr}}, until {{untilStr}}',
};

const translate = {
  instant: (key: string, params: Record<string, unknown> = {}) =>
    (STRINGS[key] ?? key).replace(/{{(\w+)}}/g, (_, name) => String(params[name])),
} as unknown as TranslateService;

const dateTimeFormat = {
  textLocale: () => 'en-US',
  currentLocale: () => 'en-US',
  formatTime: () => '13:00',
  formatDate: () => '12/31/2026',
} as unknown as DateTimeFormatService;

const NO_DAYS = {
  monday: false,
  tuesday: false,
  wednesday: false,
  thursday: false,
  friday: false,
  saturday: false,
  sunday: false,
};

const cfg = (patch: Partial<TaskRepeatCfg>): TaskRepeatCfg =>
  ({
    ...DEFAULT_TASK_REPEAT_CFG,
    id: 'c',
    quickSetting: 'CUSTOM',
    startDate: '2026-06-10',
    ...patch,
  }) as TaskRepeatCfg;

const sentence = (patch: Partial<TaskRepeatCfg>): string | null =>
  getRuleSentence(cfg(patch), dateTimeFormat, translate);

describe('getRuleSentence', () => {
  it('names the weekdays in full, with a verb', () => {
    expect(
      sentence({ repeatCycle: 'WEEKLY', ...NO_DAYS, monday: true, wednesday: true }),
    ).toBe('Every week on Monday and Wednesday');
    expect(
      sentence({
        repeatCycle: 'WEEKLY',
        repeatEvery: 2,
        ...NO_DAYS,
        monday: true,
        wednesday: true,
        friday: true,
      }),
    ).toBe('Every 2 weeks on Monday, Wednesday, and Friday');
  });

  it('lists the days Monday first, like the day chips', () => {
    expect(
      sentence({ repeatCycle: 'WEEKLY', ...NO_DAYS, sunday: true, saturday: true }),
    ).toBe('Every week on Saturday and Sunday');
  });

  it('uses the preset sentences where they say it', () => {
    expect(sentence({ repeatCycle: 'WEEKLY', ...NO_DAYS, friday: true })).toBe(
      'Every week on Friday',
    );
    expect(
      sentence({
        repeatCycle: 'WEEKLY',
        ...NO_DAYS,
        monday: true,
        tuesday: true,
        wednesday: true,
        thursday: true,
        friday: true,
      }),
    ).toBe('Every Monday through Friday');
  });

  it('keeps the monthly anchor for every N months', () => {
    expect(
      sentence({
        repeatCycle: 'MONTHLY',
        repeatEvery: 2,
        monthlyWeekOfMonth: 2,
        monthlyWeekday: 1,
      }),
    ).toBe('Every 2 months on the second Monday');
    expect(
      sentence({ repeatCycle: 'MONTHLY', repeatEvery: 3, monthlyLastDay: true }),
    ).toBe('Every 3 months on the last day');
    expect(sentence({ repeatCycle: 'MONTHLY', repeatEvery: 2 })).toBe(
      'Every 2 months on day 10',
    );
    expect(
      sentence({ repeatCycle: 'MONTHLY', monthlyWeekOfMonth: -1, monthlyWeekday: 5 }),
    ).toBe('Every month on the last Friday');
  });

  it('adds the time and the end date', () => {
    expect(
      sentence({
        repeatCycle: 'WEEKLY',
        ...NO_DAYS,
        friday: true,
        startTime: '13:00',
        repeatUntilDay: '2026-12-31',
      }),
    ).toBe('Every week on Friday, 13:00, until 12/31/2026');
  });

  it('leaves days, years, after completion and weekly without days to the shared text', () => {
    expect(sentence({ repeatCycle: 'DAILY', repeatEvery: 2 })).toBeNull();
    expect(sentence({ repeatCycle: 'YEARLY' })).toBeNull();
    expect(
      sentence({ repeatCycle: 'MONTHLY', repeatFromCompletionDate: true }),
    ).toBeNull();
    expect(sentence({ repeatCycle: 'WEEKLY', ...NO_DAYS })).toBeNull();
  });
});
