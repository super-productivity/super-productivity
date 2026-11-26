import { getRulePreviewDates } from './get-rule-preview-dates';
import { DEFAULT_TASK_REPEAT_CFG, TaskRepeatCfg } from '../task-repeat-cfg.model';
import { getDbDateStr } from '../../../util/get-db-date-str';

const NO_WEEKDAYS = {
  monday: false,
  tuesday: false,
  wednesday: false,
  thursday: false,
  friday: false,
  saturday: false,
  sunday: false,
};

const cfg = (changes: Partial<TaskRepeatCfg>): TaskRepeatCfg => ({
  ...DEFAULT_TASK_REPEAT_CFG,
  id: 'cfg1',
  quickSetting: 'CUSTOM',
  startDate: '2026-06-09',
  lastTaskCreationDay: '2026-06-08',
  ...changes,
});

const days = (dates: Date[]): string[] => dates.map((d) => getDbDateStr(d));

// Tue 2026-06-09
const TODAY = new Date(2026, 5, 9, 12);

describe('getRulePreviewDates', () => {
  it('lists the next dates of an every-2-weeks Mon/Wed rule', () => {
    const rule = cfg({
      repeatCycle: 'WEEKLY',
      repeatEvery: 2,
      ...NO_WEEKDAYS,
      monday: true,
      wednesday: true,
    });
    expect(days(getRulePreviewDates(rule, TODAY, true))).toEqual([
      '2026-06-10',
      '2026-06-15',
      '2026-06-24',
    ]);
  });

  it('lists every third day', () => {
    const rule = cfg({ repeatCycle: 'DAILY', repeatEvery: 3 });
    expect(days(getRulePreviewDates(rule, TODAY, true))).toEqual([
      '2026-06-09',
      '2026-06-12',
      '2026-06-15',
    ]);
  });

  it('leaves out skipped dates without ending early', () => {
    const rule = cfg({
      repeatCycle: 'DAILY',
      repeatEvery: 1,
      deletedInstanceDates: ['2026-06-10', '2026-06-11'],
    });
    expect(days(getRulePreviewDates(rule, TODAY, false))).toEqual([
      '2026-06-09',
      '2026-06-12',
      '2026-06-13',
    ]);
  });

  it('stops at the end date', () => {
    const rule = cfg({
      repeatCycle: 'DAILY',
      repeatEvery: 2,
      repeatUntilDay: '2026-06-12',
    });
    expect(days(getRulePreviewDates(rule, TODAY, true))).toEqual([
      '2026-06-09',
      '2026-06-11',
    ]);
  });

  it('starts an existing config at the logical today', () => {
    const rule = cfg({
      repeatCycle: 'MONTHLY',
      repeatEvery: 1,
      startDate: '2026-01-20',
    });
    expect(days(getRulePreviewDates(rule, TODAY, false))).toEqual([
      '2026-06-20',
      '2026-07-20',
      '2026-08-20',
    ]);
  });

  it('steps through yearly and nth-weekday rules', () => {
    const yearly = cfg({
      repeatCycle: 'YEARLY',
      repeatEvery: 1,
      startDate: '2025-10-20',
    });
    expect(days(getRulePreviewDates(yearly, TODAY, false))).toEqual([
      '2026-10-20',
      '2027-10-20',
      '2028-10-20',
    ]);
    const thirdTuesday = cfg({
      repeatCycle: 'MONTHLY',
      repeatEvery: 1,
      startDate: '2026-06-01',
      monthlyWeekOfMonth: 3,
      monthlyWeekday: 2,
    });
    expect(days(getRulePreviewDates(thirdTuesday, TODAY, false))).toEqual([
      '2026-06-16',
      '2026-07-21',
      '2026-08-18',
    ]);
  });

  it('returns nothing for a rule that never fires', () => {
    const rule = cfg({ repeatCycle: 'WEEKLY', repeatEvery: 1, ...NO_WEEKDAYS });
    expect(getRulePreviewDates(rule, TODAY, true)).toEqual([]);
  });
});
