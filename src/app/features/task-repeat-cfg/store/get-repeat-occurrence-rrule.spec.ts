import { getNextRepeatOccurrence } from './get-next-repeat-occurrence.util';
import { getFirstRepeatOccurrence } from './get-first-repeat-occurrence.util';
import { getNewestPossibleDueDate } from './get-newest-possible-due-date.util';
import { DEFAULT_TASK_REPEAT_CFG, TaskRepeatCfg } from '../task-repeat-cfg.model';
import { getDbDateStr } from '../../../util/get-db-date-str';

// Integration: the three routing utils must defer to the RRULE engine whenever
// `cfg.rrule` is set (via taskRepeatCfgToRRuleInput), bypassing the legacy
// repeatCycle calculation entirely.
const rruleCfg = (rrule: string, over: Partial<TaskRepeatCfg> = {}): TaskRepeatCfg => ({
  ...DEFAULT_TASK_REPEAT_CFG,
  id: 'RR',
  rrule,
  repeatCycle: 'WEEKLY',
  repeatEvery: 1,
  startDate: '2024-06-01',
  lastTaskCreationDay: '1970-01-01',
  ...over,
});

describe('repeat occurrence routing on cfg.rrule', () => {
  it('getNextRepeatOccurrence → weekly Monday', () => {
    // Sat Jun 15 2024 → next Monday is Jun 17.
    const r = getNextRepeatOccurrence(
      rruleCfg('FREQ=WEEKLY;BYDAY=MO'),
      new Date(2024, 5, 15, 12),
    );
    expect(getDbDateStr(r!)).toBe('2024-06-17');
  });

  it('getFirstRepeatOccurrence → first Monday on/after a Saturday start', () => {
    const r = getFirstRepeatOccurrence(
      rruleCfg('FREQ=WEEKLY;BYDAY=MO', { startDate: '2024-06-01' }),
    );
    expect(getDbDateStr(r!)).toBe('2024-06-03');
  });

  it('getNewestPossibleDueDate → daily, newest on/before today', () => {
    const r = getNewestPossibleDueDate(rruleCfg('FREQ=DAILY'), new Date(2024, 5, 15, 12));
    expect(getDbDateStr(r!)).toBe('2024-06-15');
  });

  it('routes every-other-week (a pattern the legacy path could not express)', () => {
    // dtstart Mon Jun 3; occurrences Jun 3, 17, Jul 1 … next after Jun 4 → Jun 17.
    const r = getNextRepeatOccurrence(
      rruleCfg('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO', { startDate: '2024-06-03' }),
      new Date(2024, 5, 4, 12),
    );
    expect(getDbDateStr(r!)).toBe('2024-06-17');
  });

  it('respects COUNT termination through the routing layer', () => {
    const cfg = rruleCfg('FREQ=DAILY;COUNT=3', { startDate: '2024-06-01' });
    // Jun 1,2,3 then done → nothing after Jun 3.
    expect(getNextRepeatOccurrence(cfg, new Date(2024, 5, 3, 12))).toBeNull();
  });

  it('applies deletedInstanceDates as EXDATEs through the routing layer', () => {
    const cfg = rruleCfg('FREQ=WEEKLY;BYDAY=MO', {
      startDate: '2024-06-01',
      deletedInstanceDates: ['2024-06-03'],
    });
    // First Monday Jun 3 is skipped → first occurrence is Jun 10.
    expect(getDbDateStr(getFirstRepeatOccurrence(cfg)!)).toBe('2024-06-10');
  });
});
