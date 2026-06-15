import {
  getFirstRRuleOccurrence,
  getNewestPossibleRRuleDueDate,
  getNextRRuleOccurrence,
  getRRuleOccurrencesInRange,
  isRRuleValid,
  RRuleOccurrenceInput,
} from './rrule-occurrence.util';
import { getDbDateStr } from '../../../util/get-db-date-str';

// Property / invariant + calendar-edge tests for the RRULE occurrence engine.
// Every invariant is grammar-agnostic. Local-time Date construction +
// getDbDateStr comparisons keep these timezone-independent; ISO `YYYY-MM-DD`
// strings compare correctly with < / >.

const inp = (
  rrule: string,
  fields: Partial<RRuleOccurrenceInput> = {},
): RRuleOccurrenceInput => ({
  rrule,
  startDate: '1970-01-01',
  lastTaskCreationDay: '1970-01-01',
  ...fields,
});

const VALID_RRULES = [
  'FREQ=DAILY', // every day
  'FREQ=WEEKLY;BYDAY=MO', // weekly Monday
  'FREQ=MONTHLY;BYMONTHDAY=15', // monthly day-15
  'FREQ=YEARLY;BYMONTH=3,4,5,6,7,8,9,10,11;BYDAY=SA', // Saturdays Mar–Nov
  'FREQ=MONTHLY;BYMONTHDAY=-1', // last day of month  (cron `L`)
  'FREQ=MONTHLY;BYDAY=3SA', // 3rd Saturday        (cron `SAT#3`)
  'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', // weekdays
  'FREQ=MONTHLY;BYMONTHDAY=1', // monthly day-1
  'FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=1', // Jan 1 yearly
  // --- patterns cron CANNOT express ---
  'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO', // every other Monday
  'FREQ=DAILY;COUNT=10', // end after 10
  'FREQ=DAILY;UNTIL=20240630T120000Z', // end on a date
];

const INVALID_RRULES = [
  '',
  '   ',
  'nope',
  'totally bogus text',
  'INTERVAL=2', // no FREQ
  'FREQ=BOGUS', // bad frequency
  'FREQ=WEEKLY;BYDAY=99XX', // bad weekday token
];
// NB: rrule.js does NOT range-check BYMONTHDAY, so `BYMONTHDAY=99` parses as a
// valid-but-never-firing rule (handled like "Feb 30" below: occurrence = null),
// not as a parse error — hence it is intentionally absent from INVALID_RRULES.

const BASE = new Date(2024, 5, 15, 12, 0, 0); // Sat Jun 15 2024, noon
const BASE_STR = getDbDateStr(BASE);

describe('rrule-occurrence invariants', () => {
  describe('getNextRRuleOccurrence — for every valid rrule', () => {
    VALID_RRULES.forEach((rrule) => {
      it(`"${rrule}" returns a Date strictly after fromDate's day, never throws`, () => {
        // UNTIL/COUNT rules may legitimately have no occurrence after BASE; use a
        // start aligned with BASE so unbounded rules still produce one.
        const cfg = inp(rrule, { startDate: '2024-06-01' });
        // A throw would fail this test; null is allowed (COUNT/UNTIL may be spent).
        const r = getNextRRuleOccurrence(cfg, BASE);
        if (r !== null) {
          expect(getDbDateStr(r) > BASE_STR)
            .withContext(`${rrule} → ${r}`)
            .toBe(true);
          expect(r.getHours()).toBe(12);
        }
      });
    });

    it('an unbounded rule always returns a later day', () => {
      const r = getNextRRuleOccurrence(inp('FREQ=DAILY'), BASE);
      expect(r).not.toBeNull();
      expect(getDbDateStr(r!) > BASE_STR).toBe(true);
    });
  });

  describe('getNewestPossibleRRuleDueDate — for every valid rrule', () => {
    VALID_RRULES.forEach((rrule) => {
      it(`"${rrule}" returns null or a day on/before today and >= startDate`, () => {
        const r = getNewestPossibleRRuleDueDate(inp(rrule), BASE);
        if (r !== null) {
          expect(getDbDateStr(r) <= BASE_STR)
            .withContext(`${rrule} → ${r}`)
            .toBe(true);
          expect(getDbDateStr(r) >= '1970-01-01').toBe(true);
        }
      });
    });
  });

  describe('invalid expressions are rejected gracefully (null, no throw)', () => {
    INVALID_RRULES.forEach((rrule) => {
      it(`"${rrule}"`, () => {
        expect(isRRuleValid(rrule)).toBe(false);
        expect(getNextRRuleOccurrence(inp(rrule), BASE)).toBeNull();
        expect(getNewestPossibleRRuleDueDate(inp(rrule), BASE)).toBeNull();
        expect(getFirstRRuleOccurrence(inp(rrule))).toBeNull();
      });
    });
  });

  describe('never-firing rules stay bounded (no multi-second freeze)', () => {
    // rrule.js cannot stop a never-firing walk early: no day passes the
    // BY-filters, so its iterator callback never fires and it spins one period
    // at a time up to MAXYEAR=9999. A 2020-anchored probe walked ~8000 years of
    // periods → a 7–11s main-thread freeze (measured) on these inputs. These
    // rules are NOT caught by the O(1) `_canNeverFire` heuristic (BYYEARDAY ×
    // BYWEEKNO, BYSETPOS past its set) — they reach the probe — so they exercise
    // exactly the anchor-near-9999 bound that replaced the freeze.
    const NEVER_FIRE_UNCAUGHT = [
      'FREQ=DAILY;BYYEARDAY=60;BYWEEKNO=53',
      'FREQ=WEEKLY;BYDAY=MO;BYSETPOS=2',
      'FREQ=MONTHLY;BYMONTHDAY=15;BYSETPOS=3',
    ];
    NEVER_FIRE_UNCAUGHT.forEach((rrule) => {
      it(`"${rrule}" → invalid, resolved well below the old freeze`, () => {
        // Cold cache (unique strings) → this measures the actual probe walk, not
        // a memo hit.
        const t0 = performance.now();
        const valid = isRRuleValid(rrule);
        const elapsedMs = performance.now() - t0;
        // A never-firing rule must be rejected so the engine uses the legacy
        // fallback instead of a rule that silently never creates a task.
        expect(valid).toBe(false);
        // The bounded walk is sub-second locally (~0.5s worst). 4s leaves wide
        // CI headroom while still flagging a regression to the ~8000-year walk
        // (7–11s) a 2020 anchor produced. NB: only isRRuleValid is timed here —
        // getNext/getFirst use the cfg's real start (not the bounded anchor) and
        // would walk to 9999 for a never-firing DAILY rule; in production they
        // are always gated behind isRRuleValid, which now rejects these.
        expect(elapsedMs).toBeLessThan(4000);
      });
    });

    it('INTERVAL phase that never fires from the real start → empty, bounded', () => {
      // Passes isRRuleValid: the PATTERN fires (Wednesdays) at the canonical
      // anchor (itself a Wednesday). But FREQ=DAILY;INTERVAL=7 from a MONDAY
      // start locks every 7th day to a Monday → never a Wednesday. The queries
      // anchor at the real start, so without the `_firesFromStart` guard rrule
      // would walk start→9999. 2024-06-03 is a Monday.
      const RULE = 'FREQ=DAILY;INTERVAL=7;BYDAY=WE';
      expect(isRRuleValid(RULE)).toBe(true);
      const cfg = inp(RULE, { startDate: '2024-06-03' });
      const t0 = performance.now();
      const next = getNextRRuleOccurrence(cfg, new Date(2024, 5, 3, 12));
      const ms = performance.now() - t0;
      expect(next).toBeNull();
      expect(getFirstRRuleOccurrence(cfg)).toBeNull();
      expect(
        getRRuleOccurrencesInRange(
          cfg,
          new Date(2024, 0, 1, 12),
          new Date(2025, 0, 1, 12),
        ),
      ).toEqual([]);
      expect(ms).toBeLessThan(4000);
    });

    it('the same INTERVAL-phase rule DOES fire from an aligned (Wednesday) start', () => {
      // Positive control for the guard above: 2024-06-05 is a Wednesday, so the
      // interval-7 phase lands on Wednesdays and the start day itself fires.
      const cfg = inp('FREQ=DAILY;INTERVAL=7;BYDAY=WE', { startDate: '2024-06-05' });
      expect(getDbDateStr(getFirstRRuleOccurrence(cfg)!)).toBe('2024-06-05');
    });
  });

  describe('"fires within a decade" probe boundary (deliberate product rule)', () => {
    // isRRuleValid probes a fixed 10-year window (anchored near MAXYEAR to bound
    // the never-fire walk — see rrule-occurrence.util). A rule whose FIRST
    // occurrence is >10y past that anchor is therefore classified invalid, by
    // design: a real recurrence that first fires more than a decade out does not
    // exist in practice, and accepting it would reintroduce the unbounded probe.
    // These specs pin the boundary so a future window/anchor edit can't silently
    // flip a real rule (reachable only via raw override).
    it('rejects a rule whose first occurrence is >10y past the probe anchor', () => {
      // "Feb 29 that is also a Monday" recurs only every ~28y, so the first hit
      // lands well beyond the 10-year window (9644-02-29 from the 9620 anchor).
      expect(isRRuleValid('FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29;BYDAY=MO')).toBe(false);
    });

    it('accepts the analogous rule that DOES fire within the decade', () => {
      // Plain "Feb 29" fires on the very first leap year in-window — control
      // ensuring the rejection above is the >10y boundary, not the BY-parts.
      expect(isRRuleValid('FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29')).toBe(true);
    });
  });

  it('getNextRRuleOccurrence is deterministic', () => {
    const a = getNextRRuleOccurrence(inp('FREQ=WEEKLY;BYDAY=MO'), BASE);
    const b = getNextRRuleOccurrence(inp('FREQ=WEEKLY;BYDAY=MO'), BASE);
    expect(getDbDateStr(a!)).toBe(getDbDateStr(b!));
  });

  it('advancing fromDate yields strictly increasing occurrence days (monotonic)', () => {
    const days: string[] = [];
    let from = BASE;
    for (let i = 0; i < 6; i++) {
      const next = getNextRRuleOccurrence(inp('FREQ=WEEKLY;BYDAY=MO'), from);
      expect(next).not.toBeNull();
      const s = getDbDateStr(next!);
      if (days.length) expect(s > days[days.length - 1]).toBe(true);
      days.push(s);
      from = next!;
    }
    expect(days.length).toBe(6);
  });

  describe('calendar edges', () => {
    it('leap day: next Feb 29 from a leap-year start', () => {
      const cfg = inp('FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29', { startDate: '2024-01-01' });
      expect(getDbDateStr(getNextRRuleOccurrence(cfg, new Date(2024, 0, 1, 12))!)).toBe(
        '2024-02-29',
      );
      // After Feb 29 2024 the next leap-day is 2028.
      expect(getDbDateStr(getNextRRuleOccurrence(cfg, new Date(2024, 2, 1, 12))!)).toBe(
        '2028-02-29',
      );
    });

    it('leap day: due today on Feb 29, null on Feb 28 (no fire yet this year)', () => {
      const cfg = inp('FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29', { startDate: '2024-01-01' });
      expect(
        getDbDateStr(getNewestPossibleRRuleDueDate(cfg, new Date(2024, 1, 29, 12))!),
      ).toBe('2024-02-29');
      expect(getNewestPossibleRRuleDueDate(cfg, new Date(2024, 1, 28, 12))).toBeNull();
    });

    it('year rollover: monthly day-1 from mid-December → Jan 1 next year', () => {
      const r = getNextRRuleOccurrence(
        inp('FREQ=MONTHLY;BYMONTHDAY=1'),
        new Date(2024, 11, 15, 12),
      );
      expect(getDbDateStr(r!)).toBe('2025-01-01');
    });

    it('yearly Jan 1 from February → Jan 1 next year', () => {
      const r = getNextRRuleOccurrence(
        inp('FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=1'),
        new Date(2024, 1, 10, 12),
      );
      expect(getDbDateStr(r!)).toBe('2025-01-01');
    });

    it('pathological "Feb 30" never fires → null, returns promptly (no hang)', () => {
      const cfg = inp('FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30');
      expect(getNextRRuleOccurrence(cfg, BASE)).toBeNull();
      expect(getNewestPossibleRRuleDueDate(cfg, BASE)).toBeNull();
    });

    it('DST spring-forward: next() AND newest both resolve the exact day', () => {
      // US spring-forward 2024-03-10. UTC-space math is structurally DST-immune.
      expect(
        getDbDateStr(
          getNextRRuleOccurrence(inp('FREQ=DAILY'), new Date(2024, 2, 9, 12))!,
        ),
      ).toBe('2024-03-10');
      expect(
        getDbDateStr(
          getNewestPossibleRRuleDueDate(inp('FREQ=DAILY'), new Date(2024, 2, 10, 12))!,
        ),
      ).toBe('2024-03-10');
    });

    it('DST fall-back: next() and newest both resolve the exact day', () => {
      // US fall-back 2024-11-03.
      expect(
        getDbDateStr(
          getNextRRuleOccurrence(inp('FREQ=DAILY'), new Date(2024, 10, 2, 12))!,
        ),
      ).toBe('2024-11-03');
      expect(
        getDbDateStr(
          getNewestPossibleRRuleDueDate(inp('FREQ=DAILY'), new Date(2024, 10, 3, 12))!,
        ),
      ).toBe('2024-11-03');
    });
  });

  describe('getFirstRRuleOccurrence', () => {
    it('daily: first occurrence is the start day itself', () => {
      const r = getFirstRRuleOccurrence(inp('FREQ=DAILY', { startDate: '2024-06-01' }));
      expect(getDbDateStr(r!)).toBe('2024-06-01');
    });

    it('weekly Monday: first Monday on/after a Saturday start', () => {
      // 2024-06-01 is a Saturday → first Monday is 2024-06-03.
      const r = getFirstRRuleOccurrence(
        inp('FREQ=WEEKLY;BYDAY=MO', { startDate: '2024-06-01' }),
      );
      expect(getDbDateStr(r!)).toBe('2024-06-03');
    });

    it('returns null for an invalid RRULE', () => {
      expect(
        getFirstRRuleOccurrence(inp('nope', { startDate: '2024-06-01' })),
      ).toBeNull();
    });
  });

  // Metamorphic relations — these have NO cron analogue; they exercise exactly
  // the capabilities (true intervals, finite series, exception dates) that
  // motivated the move off cron.
  describe('metamorphic relations (beyond cron)', () => {
    it('INTERVAL=2 occurrences are a subset of INTERVAL=1', () => {
      const every = inp('FREQ=WEEKLY;BYDAY=MO', { startDate: '2024-06-01' });
      const other = inp('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO', { startDate: '2024-06-01' });
      const everySet = new Set<string>();
      let from = new Date(2024, 5, 1, 12);
      for (let i = 0; i < 8; i++) {
        const n = getNextRRuleOccurrence(every, from)!;
        everySet.add(getDbDateStr(n));
        from = n;
      }
      from = new Date(2024, 5, 1, 12);
      for (let i = 0; i < 4; i++) {
        const n = getNextRRuleOccurrence(other, from)!;
        expect(everySet.has(getDbDateStr(n)))
          .withContext(`every-other Monday ${getDbDateStr(n)} must be a weekly Monday`)
          .toBe(true);
        from = n;
      }
    });

    it('COUNT=N terminates: no occurrence past the Nth', () => {
      const cfg = inp('FREQ=DAILY;COUNT=3', { startDate: '2024-06-01' });
      // Occurrences: Jun 1, 2, 3. Asking after Jun 3 → null.
      expect(getDbDateStr(getNextRRuleOccurrence(cfg, new Date(2024, 5, 2, 12))!)).toBe(
        '2024-06-03',
      );
      expect(getNextRRuleOccurrence(cfg, new Date(2024, 5, 3, 12))).toBeNull();
    });

    it('UNTIL bounds the series', () => {
      const cfg = inp('FREQ=DAILY;UNTIL=20240603T120000Z', { startDate: '2024-06-01' });
      expect(getNextRRuleOccurrence(cfg, new Date(2024, 5, 3, 12))).toBeNull();
    });

    it('EXDATE removes exactly the skipped day, keeps the rest', () => {
      const base = inp('FREQ=WEEKLY;BYDAY=MO', { startDate: '2024-06-01' });
      // First Monday after a Sat-Jun-1 start is Jun 3; skip it → next is Jun 10.
      const withSkip = inp('FREQ=WEEKLY;BYDAY=MO', {
        startDate: '2024-06-01',
        exdates: ['2024-06-03'],
      });
      expect(getDbDateStr(getFirstRRuleOccurrence(base)!)).toBe('2024-06-03');
      expect(getDbDateStr(getFirstRRuleOccurrence(withSkip)!)).toBe('2024-06-10');
    });
  });

  describe('serialization integrity (sync / backup)', () => {
    it('an RRULE input survives a JSON round-trip with identical occurrence behavior', () => {
      const cfg = inp('FREQ=WEEKLY;BYDAY=MO', { startDate: '2024-06-01' });
      const roundTripped = JSON.parse(JSON.stringify(cfg)) as RRuleOccurrenceInput;
      expect(roundTripped.rrule).toBe(cfg.rrule);
      expect(getDbDateStr(getNextRRuleOccurrence(roundTripped, BASE)!)).toBe(
        getDbDateStr(getNextRRuleOccurrence(cfg, BASE)!),
      );
      expect(getDbDateStr(getFirstRRuleOccurrence(roundTripped)!)).toBe(
        getDbDateStr(getFirstRRuleOccurrence(cfg)!),
      );
    });
  });

  describe('getRRuleOccurrencesInRange (heatmap projection)', () => {
    const fmt = (ds: Date[]): string[] => ds.map(getDbDateStr);

    it('returns every daily occurrence within an inclusive range', () => {
      const out = getRRuleOccurrencesInRange(
        inp('FREQ=DAILY', { startDate: '2024-06-01' }),
        new Date(2024, 5, 10, 12),
        new Date(2024, 5, 14, 12),
      );
      expect(fmt(out)).toEqual([
        '2024-06-10',
        '2024-06-11',
        '2024-06-12',
        '2024-06-13',
        '2024-06-14',
      ]);
    });

    it('returns the weekly occurrences in a month window', () => {
      const out = getRRuleOccurrencesInRange(
        inp('FREQ=WEEKLY;BYDAY=MO', { startDate: '2024-06-01' }),
        new Date(2024, 5, 1, 12),
        new Date(2024, 5, 30, 12),
      );
      expect(fmt(out)).toEqual(['2024-06-03', '2024-06-10', '2024-06-17', '2024-06-24']);
    });

    it('honors EXDATEs', () => {
      const out = getRRuleOccurrencesInRange(
        inp('FREQ=WEEKLY;BYDAY=MO', {
          startDate: '2024-06-01',
          exdates: ['2024-06-10'],
        }),
        new Date(2024, 5, 1, 12),
        new Date(2024, 5, 30, 12),
      );
      expect(fmt(out)).toEqual(['2024-06-03', '2024-06-17', '2024-06-24']);
    });

    it('returns [] for a malformed rule', () => {
      expect(
        getRRuleOccurrencesInRange(
          inp('nope'),
          new Date(2024, 5, 1, 12),
          new Date(2024, 5, 30, 12),
        ),
      ).toEqual([]);
    });

    it('Friday the 13th (BYMONTHDAY=13;BYDAY=FR) fires only on Friday-13ths', () => {
      const out = getRRuleOccurrencesInRange(
        inp('FREQ=MONTHLY;BYMONTHDAY=13;BYDAY=FR', { startDate: '2024-01-01' }),
        new Date(2024, 0, 1, 12),
        new Date(2024, 11, 31, 12),
      );
      // 2024's only Friday-the-13ths are September and December.
      expect(out.map(getDbDateStr)).toEqual(['2024-09-13', '2024-12-13']);
      // Every occurrence is both a Friday and the 13th of its month.
      out.forEach((d) => {
        expect(d.getDay()).toBe(5); // Friday
        expect(d.getDate()).toBe(13);
      });
    });
  });
});
