import { getNewestPossibleDueDate } from './get-newest-possible-due-date.util';
import { getRRuleOccurrencesInRange } from './rrule-occurrence.util';
import { taskRepeatCfgToRRuleInput } from './task-repeat-cfg-to-rrule-input.util';
import { DEFAULT_TASK_REPEAT_CFG, TaskRepeatCfg } from '../task-repeat-cfg.model';
import { getDbDateStr } from '../../../util/get-db-date-str';

// "Day-march" simulation — the highest-fidelity unit mirror of what the running
// app does as real days pass. Production (task-repeat-cfg.service.ts) creates an
// instance by calling getNewestPossibleDueDate(cfg, today) and then advancing
// lastTaskCreationDay to the created day. Here we step `today` forward one day
// at a time, feed lastTaskCreationDay back exactly like the service, and assert
// the *stream* of created days — catching rolling-loop bugs (double-create,
// skipped day, stalled anchor) that a single point-in-time call can't.
//
// Local-noon dates + getDbDateStr keep everything timezone-stable.

const D = (s: string): Date => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
};
const nextDay = (d: Date): Date =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 12, 0, 0);

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

/**
 * Walk `today` from startDay for `days` steps. On each open day, do exactly what
 * the service does: ask for the newest due day and, if one comes back, "create"
 * it and advance lastTaskCreationDay. `closedDays` simulates the app not running
 * (no day-change fires that day).
 */
const march = (
  cfg: TaskRepeatCfg,
  startDay: string,
  days: number,
  closedDays: Set<string> = new Set(),
): string[] => {
  let lastCreation = cfg.lastTaskCreationDay || '1970-01-01';
  const created: string[] = [];
  let today = D(startDay);
  for (let i = 0; i < days; i++) {
    const todayStr = getDbDateStr(today);
    if (!closedDays.has(todayStr)) {
      const due = getNewestPossibleDueDate(
        { ...cfg, lastTaskCreationDay: lastCreation },
        today,
      );
      if (due) {
        const ds = getDbDateStr(due);
        created.push(ds);
        lastCreation = ds; // service advances the anchor to the created day
      }
    }
    today = nextDay(today);
  }
  return created;
};

/** Ground truth: the rule's own occurrences across the same window. */
const occurrencesIn = (cfg: TaskRepeatCfg, startDay: string, days: number): string[] => {
  const last = (): Date => {
    let d = D(startDay);
    for (let i = 1; i < days; i++) d = nextDay(d);
    return d;
  };
  return getRRuleOccurrencesInRange(
    taskRepeatCfgToRRuleInput(cfg),
    D(startDay),
    last(),
  ).map(getDbDateStr);
};

const hasNoDupes = (xs: string[]): boolean => new Set(xs).size === xs.length;

describe('RRULE day-march — driving the create loop one day at a time', () => {
  describe('open every day → created stream equals the occurrence set, no dupes/skips', () => {
    const cases: { name: string; rrule: string; start: string; days: number }[] = [
      { name: 'DAILY', rrule: 'FREQ=DAILY', start: '2024-06-01', days: 30 },
      {
        name: 'WEEKLY multi-weekday',
        rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
        start: '2024-06-03',
        days: 28,
      },
      {
        name: 'every-other-week',
        rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO',
        start: '2024-06-03',
        days: 60,
      },
      {
        name: 'MONTHLY 2nd Tuesday',
        rrule: 'FREQ=MONTHLY;BYDAY=2TU',
        start: '2024-01-01',
        days: 160,
      },
      {
        name: 'MONTHLY last weekday (BYSETPOS=-1)',
        rrule: 'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1',
        start: '2024-05-01',
        days: 150,
      },
      {
        name: 'MONTHLY last day',
        rrule: 'FREQ=MONTHLY;BYMONTHDAY=-1',
        start: '2024-01-31',
        days: 200,
      },
    ];

    cases.forEach(({ name, rrule, start, days }) => {
      it(name, () => {
        const cfg = rruleCfg(rrule, { startDate: start });
        const created = march(cfg, start, days);
        expect(created).toEqual(occurrencesIn(cfg, start, days));
        expect(hasNoDupes(created)).toBe(true);
      });
    });
  });

  it('honors EXDATE across the loop — never creates the deleted day, never stalls', () => {
    const cfg = rruleCfg('FREQ=WEEKLY;BYDAY=MO', {
      startDate: '2024-06-03',
      deletedInstanceDates: ['2024-06-17'],
    });
    const created = march(cfg, '2024-06-03', 35);
    expect(created).not.toContain('2024-06-17');
    // The Mondays around the hole still fire, in order.
    expect(created).toEqual(['2024-06-03', '2024-06-10', '2024-06-24', '2024-07-01']);
    expect(occurrencesIn(cfg, '2024-06-03', 35)).toEqual(created);
  });

  it('stops creating once a COUNT-bounded rule is exhausted', () => {
    const cfg = rruleCfg('FREQ=DAILY;COUNT=5', { startDate: '2024-06-01' });
    const created = march(cfg, '2024-06-01', 30);
    expect(created).toEqual([
      '2024-06-01',
      '2024-06-02',
      '2024-06-03',
      '2024-06-04',
      '2024-06-05',
    ]);
  });

  it('is idempotent within a day — re-evaluating after a create yields null (no duplicate)', () => {
    // Anchor already at today → the same day must not produce a second instance.
    const cfg = rruleCfg('FREQ=DAILY', {
      startDate: '2024-06-01',
      lastTaskCreationDay: '2024-06-10',
    });
    expect(getNewestPossibleDueDate(cfg, D('2024-06-10'))).toBeNull();
  });

  describe('app-closed gaps (Phase-1 catch-up = newest missed only, no backfill)', () => {
    it('a single missed weekly occurrence is caught up one day late', () => {
      // App closed exactly on Monday Jun 10; reopened Tue Jun 11.
      const cfg = rruleCfg('FREQ=WEEKLY;BYDAY=MO', { startDate: '2024-06-03' });
      const created = march(cfg, '2024-06-03', 28, new Set(['2024-06-10']));
      // Jun 10 is still created (caught up) — just on the day the app reopened.
      expect(created).toContain('2024-06-10');
      expect(created).toEqual(['2024-06-03', '2024-06-10', '2024-06-17', '2024-06-24']);
    });

    it('multiple missed occurrences in one closed gap → only the newest is created', () => {
      // App closed across BOTH Jun 10 and Jun 17 Mondays; reopened Jun 22.
      const closed = new Set<string>();
      let d = D('2024-06-08');
      for (let i = 0; i < 14; i++) {
        closed.add(getDbDateStr(d));
        d = nextDay(d);
      } // closed Jun 8..21
      const cfg = rruleCfg('FREQ=WEEKLY;BYDAY=MO', { startDate: '2024-06-03' });
      const created = march(cfg, '2024-06-03', 35, closed);
      // Jun 3 created before the gap; on reopen (Jun 22) only the *newest* missed
      // Monday (Jun 17) is created — Jun 10 is dropped (backfill-each is Phase 5).
      // The loop then continues correctly from the new anchor.
      expect(created).toContain('2024-06-17');
      expect(created).not.toContain('2024-06-10');
      expect(created).toEqual(['2024-06-03', '2024-06-17', '2024-06-24', '2024-07-01']);
    });
  });
});
