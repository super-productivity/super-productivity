import {
  legacyTaskRepeatCfgToRRule,
  rruleToLegacyTaskRepeatCfg,
} from './legacy-cfg-to-rrule.util';
import { TaskRepeatCfg } from '../task-repeat-cfg.model';
import { isRRuleValid } from '../store/rrule-occurrence.util';

const cfg = (over: Partial<TaskRepeatCfg>): TaskRepeatCfg =>
  ({
    id: 'r1',
    repeatEvery: 1,
    repeatCycle: 'WEEKLY',
    startDate: '2024-06-03', // a Monday
    ...over,
  }) as TaskRepeatCfg;

describe('legacyTaskRepeatCfgToRRule', () => {
  it('DAILY with interval', () => {
    expect(
      legacyTaskRepeatCfgToRRule(cfg({ repeatCycle: 'DAILY', repeatEvery: 3 })),
    ).toBe('FREQ=DAILY;INTERVAL=3');
  });

  it('DAILY interval 1 omits INTERVAL', () => {
    expect(legacyTaskRepeatCfgToRRule(cfg({ repeatCycle: 'DAILY' }))).toBe('FREQ=DAILY');
  });

  it('WEEKLY with selected weekdays in Mon-first order', () => {
    expect(
      legacyTaskRepeatCfgToRRule(
        cfg({
          repeatCycle: 'WEEKLY',
          repeatEvery: 2,
          monday: true,
          wednesday: true,
          friday: true,
        }),
      ),
    ).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR');
  });

  it('WEEKLY with no weekdays falls back to the start-date weekday', () => {
    // 2024-06-03 is a Monday.
    expect(legacyTaskRepeatCfgToRRule(cfg({ repeatCycle: 'WEEKLY' }))).toBe(
      'FREQ=WEEKLY;BYDAY=MO',
    );
  });

  it('MONTHLY day-of-month from the start date', () => {
    expect(
      legacyTaskRepeatCfgToRRule(
        cfg({ repeatCycle: 'MONTHLY', startDate: '2024-06-15' }),
      ),
    ).toBe('FREQ=MONTHLY;BYMONTHDAY=15');
  });

  it('MONTHLY day > 28 emits the clamp idiom (legacy clamps, plain BYMONTHDAY skips)', () => {
    expect(
      legacyTaskRepeatCfgToRRule(
        cfg({ repeatCycle: 'MONTHLY', startDate: '2024-01-31' }),
      ),
    ).toBe('FREQ=MONTHLY;BYMONTHDAY=31,-1;BYSETPOS=1');
  });

  it('YEARLY Feb-29 anchor emits the clamp idiom (legacy clamps to Feb 28)', () => {
    expect(
      legacyTaskRepeatCfgToRRule(cfg({ repeatCycle: 'YEARLY', startDate: '2024-02-29' })),
    ).toBe('FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29,-1;BYSETPOS=1');
  });

  it('MONTHLY last day', () => {
    expect(
      legacyTaskRepeatCfgToRRule(cfg({ repeatCycle: 'MONTHLY', monthlyLastDay: true })),
    ).toBe('FREQ=MONTHLY;BYMONTHDAY=-1');
  });

  it('MONTHLY nth-weekday (2nd Tuesday)', () => {
    expect(
      legacyTaskRepeatCfgToRRule(
        cfg({ repeatCycle: 'MONTHLY', monthlyWeekOfMonth: 2, monthlyWeekday: 2 }),
      ),
    ).toBe('FREQ=MONTHLY;BYDAY=2TU');
  });

  it('MONTHLY last-weekday (last Monday)', () => {
    expect(
      legacyTaskRepeatCfgToRRule(
        cfg({ repeatCycle: 'MONTHLY', monthlyWeekOfMonth: -1, monthlyWeekday: 1 }),
      ),
    ).toBe('FREQ=MONTHLY;BYDAY=-1MO');
  });

  it('YEARLY from the start date month/day', () => {
    expect(
      legacyTaskRepeatCfgToRRule(cfg({ repeatCycle: 'YEARLY', startDate: '2024-03-17' })),
    ).toBe('FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=17');
  });

  it('every conversion produces a valid RRULE', () => {
    const samples: Partial<TaskRepeatCfg>[] = [
      { repeatCycle: 'DAILY', repeatEvery: 2 },
      { repeatCycle: 'WEEKLY', tuesday: true, thursday: true },
      { repeatCycle: 'MONTHLY', monthlyLastDay: true },
      { repeatCycle: 'MONTHLY', monthlyWeekOfMonth: 3, monthlyWeekday: 5 },
      { repeatCycle: 'MONTHLY', startDate: '2024-01-31' },
      { repeatCycle: 'YEARLY', startDate: '2024-12-25' },
      { repeatCycle: 'YEARLY', startDate: '2024-02-29' },
    ];
    samples.forEach((s) =>
      expect(isRRuleValid(legacyTaskRepeatCfgToRRule(cfg(s)))).toBe(true),
    );
  });

  it('uses UTC weekday so a negative-offset timezone does not shift the day', () => {
    // 2024-06-03 is a Monday in UTC; must map to MO regardless of host tz.
    expect(legacyTaskRepeatCfgToRRule(cfg({ repeatCycle: 'WEEKLY' }))).toContain(
      'BYDAY=MO',
    );
  });
});

describe('rruleToLegacyTaskRepeatCfg', () => {
  // Every result carries explicit monthly-anchor resets (undefined) so a
  // spread-merge clears stale values from a previous preset/rule.
  const ANCHOR_RESETS = {
    monthlyWeekOfMonth: undefined,
    monthlyWeekday: undefined,
    monthlyLastDay: undefined,
  };

  it('DAILY with interval', () => {
    expect(rruleToLegacyTaskRepeatCfg('FREQ=DAILY;INTERVAL=3')).toEqual({
      repeatCycle: 'DAILY',
      repeatEvery: 3,
      ...ANCHOR_RESETS,
    });
  });

  it('WEEKLY sets exactly the rule weekdays, clearing the rest', () => {
    const out = rruleToLegacyTaskRepeatCfg('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR');
    expect(out.repeatCycle).toBe('WEEKLY');
    expect(out.repeatEvery).toBe(2);
    expect(out.monday).toBe(true);
    expect(out.wednesday).toBe(true);
    expect(out.friday).toBe(true);
    expect(out.tuesday).toBe(false);
    expect(out.thursday).toBe(false);
    expect(out.saturday).toBe(false);
    expect(out.sunday).toBe(false);
  });

  it('MONTHLY nth-weekday → anchor fields (legacy 0=Sun weekday)', () => {
    expect(rruleToLegacyTaskRepeatCfg('FREQ=MONTHLY;BYDAY=2TU')).toEqual({
      repeatCycle: 'MONTHLY',
      repeatEvery: 1,
      ...ANCHOR_RESETS,
      monthlyWeekOfMonth: 2,
      monthlyWeekday: 2, // Tuesday (Sun=0)
    });
  });

  it('MONTHLY last weekday', () => {
    expect(rruleToLegacyTaskRepeatCfg('FREQ=MONTHLY;BYDAY=-1MO')).toEqual({
      repeatCycle: 'MONTHLY',
      repeatEvery: 1,
      ...ANCHOR_RESETS,
      monthlyWeekOfMonth: -1,
      monthlyWeekday: 1, // Monday
    });
  });

  it('MONTHLY last day → monthlyLastDay', () => {
    expect(rruleToLegacyTaskRepeatCfg('FREQ=MONTHLY;BYMONTHDAY=-1')).toEqual({
      repeatCycle: 'MONTHLY',
      repeatEvery: 1,
      ...ANCHOR_RESETS,
      monthlyLastDay: true,
    });
  });

  it('YEARLY', () => {
    expect(rruleToLegacyTaskRepeatCfg('FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=17')).toEqual({
      repeatCycle: 'YEARLY',
      repeatEvery: 1,
      ...ANCHOR_RESETS,
    });
  });

  it('returns {} for garbage / sub-daily', () => {
    expect(rruleToLegacyTaskRepeatCfg('not an rrule')).toEqual({});
    expect(rruleToLegacyTaskRepeatCfg('FREQ=HOURLY')).toEqual({});
  });

  // A BYDAY-less FREQ=WEEKLY would otherwise leave all weekday flags false, and
  // the legacy WEEKLY engine needs one set — so old clients would never fire.
  it('maps a BYDAY-less weekly rule onto the start weekday', () => {
    // 2024-06-12 is a Wednesday.
    const out = rruleToLegacyTaskRepeatCfg('FREQ=WEEKLY', '2024-06-12');
    expect(out.repeatCycle).toBe('WEEKLY');
    expect(out.wednesday).toBe(true);
    expect(out.monday).toBe(false);
    expect(out.tuesday).toBe(false);
    expect(out.thursday).toBe(false);
  });

  it('leaves weekday flags untouched-false when no startDate is given', () => {
    const out = rruleToLegacyTaskRepeatCfg('FREQ=WEEKLY');
    expect(out.repeatCycle).toBe('WEEKLY');
    expect(out.monday).toBe(false);
    expect(out.sunday).toBe(false);
  });

  it('always resets the monthly anchors so stale values cannot survive a merge', () => {
    // A cfg that previously carried nth-weekday anchors gets a day-of-month
    // rule: the spread-merge in onRRuleChange must clear the old anchors, else
    // old clients keep firing on the nth weekday.
    const out = rruleToLegacyTaskRepeatCfg('FREQ=MONTHLY;BYMONTHDAY=15');
    expect('monthlyWeekOfMonth' in out).toBe(true);
    expect(out.monthlyWeekOfMonth).toBeUndefined();
    expect('monthlyWeekday' in out).toBe(true);
    expect(out.monthlyWeekday).toBeUndefined();
    expect('monthlyLastDay' in out).toBe(true);
    expect(out.monthlyLastDay).toBeUndefined();
  });

  it('does NOT set monthlyLastDay for the clamp idiom (BYMONTHDAY=31,-1;BYSETPOS=1)', () => {
    const out = rruleToLegacyTaskRepeatCfg(
      'FREQ=MONTHLY;BYMONTHDAY=31,-1;BYSETPOS=1',
      '2024-01-31',
    );
    expect(out.monthlyLastDay).toBeUndefined();
    // startDate already sits on an occurrence — no realignment emitted.
    expect(out.startDate).toBeUndefined();
  });

  it('aligns startDate to the first occurrence for a monthly day rule', () => {
    // Old clients read the day from startDate: BYMONTHDAY=15 anchored on the
    // 3rd must move the start to the 15th, else they fire on the 3rd.
    const out = rruleToLegacyTaskRepeatCfg('FREQ=MONTHLY;BYMONTHDAY=15', '2024-06-03');
    expect(out.startDate).toBe('2024-06-15');
  });

  it('keeps startDate untouched when it already sits on an occurrence', () => {
    const out = rruleToLegacyTaskRepeatCfg('FREQ=MONTHLY;BYMONTHDAY=15', '2024-06-15');
    expect('startDate' in out).toBe(false);
  });

  it('aligns startDate for a yearly rule (month + day)', () => {
    // Legacy YEARLY reads month AND day from startDate.
    const out = rruleToLegacyTaskRepeatCfg(
      'FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=10',
      '2024-06-03',
    );
    expect(out.startDate).toBe('2025-03-10');
  });

  it('does not align startDate for weekday-based monthly rules', () => {
    // Legacy nth-weekday recurrence uses the anchor fields, not startDate.
    const out = rruleToLegacyTaskRepeatCfg('FREQ=MONTHLY;BYDAY=2TU', '2024-06-03');
    expect('startDate' in out).toBe(false);
  });

  it('round-trips a weekly cfg (legacy → rrule → legacy)', () => {
    const legacy = cfg({
      repeatCycle: 'WEEKLY',
      repeatEvery: 2,
      monday: true,
      thursday: true,
      tuesday: false,
      wednesday: false,
      friday: false,
      saturday: false,
      sunday: false,
    });
    const back = rruleToLegacyTaskRepeatCfg(legacyTaskRepeatCfgToRRule(legacy));
    expect(back.repeatCycle).toBe('WEEKLY');
    expect(back.repeatEvery).toBe(2);
    expect(back.monday).toBe(true);
    expect(back.thursday).toBe(true);
    expect(back.tuesday).toBe(false);
  });
});
