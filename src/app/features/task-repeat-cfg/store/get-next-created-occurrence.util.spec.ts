import { getDbDateStr } from '../../../util/get-db-date-str';
import { DEFAULT_TASK_REPEAT_CFG, TaskRepeatCfg } from '../task-repeat-cfg.model';
import { getNextCreatedOccurrence } from './get-next-created-occurrence.util';

const fromJune9 = new Date(2026, 5, 9, 10, 0, 0);

const cfg = (overrides: Partial<TaskRepeatCfg>): TaskRepeatCfg => ({
  ...DEFAULT_TASK_REPEAT_CFG,
  id: 'cfg',
  title: 'Repeat',
  repeatEvery: 1,
  startDate: '2026-06-01',
  lastTaskCreationDay: '2026-06-09',
  repeatCycle: 'DAILY',
  ...overrides,
});

const nextDay = (overrides: Partial<TaskRepeatCfg>): string | null => {
  const next = getNextCreatedOccurrence(cfg(overrides), fromJune9);
  return next ? getDbDateStr(next) : null;
};

describe('getNextCreatedOccurrence', () => {
  it('returns the next daily instance when nothing is skipped', () => {
    expect(nextDay({})).toBe('2026-06-10');
  });

  it('passes over a skipped daily instance', () => {
    expect(nextDay({ deletedInstanceDates: ['2026-06-10'] })).toBe('2026-06-11');
  });

  it('passes over consecutive skipped daily instances', () => {
    expect(nextDay({ deletedInstanceDates: ['2026-06-10', '2026-06-11'] })).toBe(
      '2026-06-12',
    );
  });

  it('passes over a skipped monthly instance', () => {
    expect(
      nextDay({
        repeatCycle: 'MONTHLY',
        startDate: '2026-05-10',
        lastTaskCreationDay: '2026-05-10',
        deletedInstanceDates: ['2026-06-10'],
      }),
    ).toBe('2026-07-10');
  });

  it('passes over consecutive skipped monthly instances', () => {
    expect(
      nextDay({
        repeatCycle: 'MONTHLY',
        startDate: '2026-05-10',
        lastTaskCreationDay: '2026-05-10',
        deletedInstanceDates: ['2026-06-10', '2026-07-10'],
      }),
    ).toBe('2026-08-10');
  });

  it('keeps the completion-date anchor when passing over a skipped month', () => {
    // Skipping does not move lastTaskCreationDay, so the May 31 anchor holds
    // and the month after a skipped June 30 is July 31, not July 30.
    expect(
      nextDay({
        repeatCycle: 'MONTHLY',
        repeatFromCompletionDate: true,
        startDate: '2026-01-15',
        lastTaskCreationDay: '2026-05-31',
        deletedInstanceDates: ['2026-06-30'],
      }),
    ).toBe('2026-07-31');
  });

  it('passes over a skipped yearly instance', () => {
    expect(
      nextDay({
        repeatCycle: 'YEARLY',
        startDate: '2025-06-10',
        lastTaskCreationDay: '2025-06-10',
        deletedInstanceDates: ['2026-06-10'],
      }),
    ).toBe('2027-06-10');
  });
});
