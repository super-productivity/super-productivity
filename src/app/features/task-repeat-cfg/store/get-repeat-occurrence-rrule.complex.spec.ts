import { getNextRepeatOccurrence } from './get-next-repeat-occurrence.util';
import { getFirstRepeatOccurrence } from './get-first-repeat-occurrence.util';
import { getNewestPossibleDueDate } from './get-newest-possible-due-date.util';
import { DEFAULT_TASK_REPEAT_CFG, TaskRepeatCfg } from '../task-repeat-cfg.model';
import { getDbDateStr } from '../../../util/get-db-date-str';

// Integration: complex RRULE strings routed through the cfg → engine adapter
// (taskRepeatCfgToRRuleInput), crossed with cfg-level settings
// (deletedInstanceDates → EXDATE, startDate, lastTaskCreationDay), plus the
// validity guard that keeps a malformed rule from stopping a synced task.
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

describe('cfg → RRULE engine routing — complex rules × cfg settings', () => {
  it('routes MONTHLY per-day ordinals (1st & 3rd Monday) for the first occurrence', () => {
    const r = getFirstRepeatOccurrence(
      rruleCfg('FREQ=MONTHLY;BYDAY=1MO,3MO', { startDate: '2024-06-01' }),
    );
    expect(getDbDateStr(r!)).toBe('2024-06-03');
  });

  it('applies deletedInstanceDates as EXDATE on a complex monthly rule', () => {
    const r = getFirstRepeatOccurrence(
      rruleCfg('FREQ=MONTHLY;BYDAY=1MO,3MO', {
        startDate: '2024-06-01',
        deletedInstanceDates: ['2024-06-03'],
      }),
    );
    // 1st Monday Jun 3 skipped → first becomes the 3rd Monday, Jun 17.
    expect(getDbDateStr(r!)).toBe('2024-06-17');
  });

  it('routes last-weekday (BYSETPOS=-1) for the newest-possible due date', () => {
    const r = getNewestPossibleDueDate(
      rruleCfg('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1', {
        startDate: '2024-05-01',
      }),
      new Date(2024, 5, 20, 12),
    );
    // Newest last-weekday on/before Jun 20 is May 31 (June's is Jun 28).
    expect(getDbDateStr(r!)).toBe('2024-05-31');
  });

  it('routes quarterly (MONTHLY;INTERVAL=3) for the next occurrence', () => {
    const r = getNextRepeatOccurrence(
      rruleCfg('FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=15', { startDate: '2024-01-15' }),
      new Date(2024, 1, 1, 12),
    );
    expect(getDbDateStr(r!)).toBe('2024-04-15');
  });

  it('a valid rrule takes precedence over the legacy weekday fields', () => {
    // rrule = daily; legacy says weekly-Monday. The engine (daily) must win.
    const r = getNextRepeatOccurrence(
      rruleCfg('FREQ=DAILY', { startDate: '2024-06-01', monday: true }),
      new Date(2024, 5, 15, 12),
    );
    expect(getDbDateStr(r!)).toBe('2024-06-16');
  });

  it('a malformed rrule falls back to the legacy schedule instead of stopping (§2a)', () => {
    const r = getNextRepeatOccurrence(
      rruleCfg('totally-broken-rule', {
        startDate: '2024-06-03',
        monday: true,
      }),
      new Date(2024, 5, 15, 12),
    );
    // Legacy WEEKLY-Monday from a Saturday → next Monday Jun 17, not null.
    expect(r).not.toBeNull();
    expect(getDbDateStr(r!)).toBe('2024-06-17');
  });
});
