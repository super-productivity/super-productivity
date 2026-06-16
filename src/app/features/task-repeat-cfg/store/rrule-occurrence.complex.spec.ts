import {
  getFirstRRuleOccurrence,
  getNewestPossibleRRuleDueDate,
  getNextRRuleOccurrence,
  getRRuleOccurrencesInRange,
  isRRuleValid,
  RRuleOccurrenceInput,
} from './rrule-occurrence.util';
import { getDbDateStr } from '../../../util/get-db-date-str';

// Complex RFC 5545 RRULE coverage at the engine level: a broad matrix of rule
// shapes (per-day ordinals, BYSETPOS, BYMONTHDAY=-1, seasonal BYMONTH,
// BYWEEKNO/BYYEARDAY, leap years) crossed with the engine's settings
// (startDate anchoring, lastTaskCreationDay, EXDATE, COUNT, UNTIL).
//
// The engine returns occurrences at LOCAL noon, so getDbDateStr() yields the
// firing calendar day and the assertions are timezone-stable.

/** Local-noon Date for a YYYY-MM-DD day (matches engine seed/return semantics). */
const D = (s: string): Date => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
};

const inp = (
  rrule: string,
  startDate: string,
  over: Partial<RRuleOccurrenceInput> = {},
): RRuleOccurrenceInput => ({ rrule, startDate, ...over });

const range = (
  rrule: string,
  startDate: string,
  fromS: string,
  toS: string,
  over: Partial<RRuleOccurrenceInput> = {},
): string[] =>
  getRRuleOccurrencesInRange(inp(rrule, startDate, over), D(fromS), D(toS)).map(
    getDbDateStr,
  );

describe('rrule-occurrence engine — complex variants × settings', () => {
  describe('getRRuleOccurrencesInRange — frequency / BY* shapes', () => {
    it('WEEKLY multi-weekday BYDAY=MO,WE,FR', () => {
      expect(
        range('FREQ=WEEKLY;BYDAY=MO,WE,FR', '2024-06-03', '2024-06-03', '2024-06-09'),
      ).toEqual(['2024-06-03', '2024-06-05', '2024-06-07']);
    });

    it('WEEKLY INTERVAL=2 (every other Monday)', () => {
      expect(
        range(
          'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO',
          '2024-06-03',
          '2024-06-01',
          '2024-07-15',
        ),
      ).toEqual(['2024-06-03', '2024-06-17', '2024-07-01', '2024-07-15']);
    });

    it('MONTHLY BYMONTHDAY=-1 (last day, leap-Feb aware)', () => {
      expect(
        range('FREQ=MONTHLY;BYMONTHDAY=-1', '2024-01-31', '2024-01-01', '2024-06-30'),
      ).toEqual([
        '2024-01-31',
        '2024-02-29',
        '2024-03-31',
        '2024-04-30',
        '2024-05-31',
        '2024-06-30',
      ]);
    });

    it('MONTHLY nth-weekday BYDAY=2TU (2nd Tuesday)', () => {
      expect(
        range('FREQ=MONTHLY;BYDAY=2TU', '2024-01-01', '2024-01-01', '2024-06-30'),
      ).toEqual([
        '2024-01-09',
        '2024-02-13',
        '2024-03-12',
        '2024-04-09',
        '2024-05-14',
        '2024-06-11',
      ]);
    });

    it('MONTHLY per-day ordinals BYDAY=1MO,3MO (1st and 3rd Monday)', () => {
      expect(
        range('FREQ=MONTHLY;BYDAY=1MO,3MO', '2024-06-01', '2024-06-01', '2024-06-30'),
      ).toEqual(['2024-06-03', '2024-06-17']);
    });

    it('MONTHLY last weekday BYDAY=MO..FR;BYSETPOS=-1', () => {
      expect(
        range(
          'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1',
          '2024-05-01',
          '2024-05-01',
          '2024-06-30',
        ),
      ).toEqual(['2024-05-31', '2024-06-28']);
    });

    it('DAILY INTERVAL=3', () => {
      expect(
        range('FREQ=DAILY;INTERVAL=3', '2024-06-01', '2024-06-01', '2024-06-10'),
      ).toEqual(['2024-06-01', '2024-06-04', '2024-06-07', '2024-06-10']);
    });

    it('MONTHLY INTERVAL=3 + BYMONTHDAY (quarterly on the 15th)', () => {
      expect(
        range(
          'FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=15',
          '2024-01-15',
          '2024-01-01',
          '2024-12-31',
        ),
      ).toEqual(['2024-01-15', '2024-04-15', '2024-07-15', '2024-10-15']);
    });

    it('YEARLY BYMONTH+BYMONTHDAY=29 only fires in leap years', () => {
      expect(
        range(
          'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29',
          '2020-02-29',
          '2020-01-01',
          '2028-12-31',
        ),
      ).toEqual(['2020-02-29', '2024-02-29', '2028-02-29']);
    });

    it('YEARLY BYYEARDAY=1 (Jan 1 each year)', () => {
      expect(
        range('FREQ=YEARLY;BYYEARDAY=1', '2024-01-01', '2024-01-01', '2026-12-31'),
      ).toEqual(['2024-01-01', '2025-01-01', '2026-01-01']);
    });

    it('seasonal DAILY;BYMONTH=1 fires every day of January only', () => {
      const occ = range('FREQ=DAILY;BYMONTH=1', '2024-01-01', '2024-01-01', '2024-02-05');
      expect(occ.length).toBe(31);
      expect(occ[0]).toBe('2024-01-01');
      expect(occ[occ.length - 1]).toBe('2024-01-31');
    });
  });

  describe('getRRuleOccurrencesInRange — mixed with end conditions / EXDATE', () => {
    it('BYDAY multi + COUNT=5 terminates after the 5th instance', () => {
      expect(
        range(
          'FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=5',
          '2024-06-03',
          '2024-06-01',
          '2024-06-30',
        ),
      ).toEqual(['2024-06-03', '2024-06-05', '2024-06-07', '2024-06-10', '2024-06-12']);
    });

    it('BYDAY multi + UNTIL is inclusive of the until day', () => {
      expect(
        range(
          'FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20240613T120000Z',
          '2024-06-04',
          '2024-06-01',
          '2024-06-30',
        ),
      ).toEqual(['2024-06-04', '2024-06-06', '2024-06-11', '2024-06-13']);
    });

    it('EXDATE removes exactly the skipped occurrence', () => {
      expect(
        range('FREQ=WEEKLY;BYDAY=MO', '2024-06-03', '2024-06-01', '2024-06-30', {
          exdates: ['2024-06-10'],
        }),
      ).toEqual(['2024-06-03', '2024-06-17', '2024-06-24']);
    });
  });

  describe('getNextRRuleOccurrence — strict-after + start + lastCreation + EXDATE', () => {
    it('combines startDate, lastTaskCreationDay and EXDATE', () => {
      // lowerBound = max(from+1=06-06, lastCreation+1=06-11, start=06-03) = 06-11;
      // first Monday >= 06-11 is 06-17 but it is an EXDATE → 06-24.
      const r = getNextRRuleOccurrence(
        inp('FREQ=WEEKLY;BYDAY=MO', '2024-06-03', {
          lastTaskCreationDay: '2024-06-10',
          exdates: ['2024-06-17'],
        }),
        D('2024-06-05'),
      );
      expect(getDbDateStr(r!)).toBe('2024-06-24');
    });

    it('returns null once a COUNT-bounded rule is exhausted (valid rule, not malformed)', () => {
      const r = getNextRRuleOccurrence(
        inp('FREQ=DAILY;COUNT=3', '2024-06-01'),
        D('2024-06-03'),
      );
      expect(r).toBeNull();
    });

    it('honors an INTERVAL anchored to startDate', () => {
      // every 3rd day from 06-01: 06-01,06-04,06-07… next strictly after 06-05 → 06-07.
      const r = getNextRRuleOccurrence(
        inp('FREQ=DAILY;INTERVAL=3', '2024-06-01'),
        D('2024-06-05'),
      );
      expect(getDbDateStr(r!)).toBe('2024-06-07');
    });
  });

  describe('getNewestPossibleRRuleDueDate', () => {
    it('newest on/before today, strictly after lastTaskCreationDay', () => {
      const r = getNewestPossibleRRuleDueDate(
        inp('FREQ=WEEKLY;BYDAY=MO', '2024-06-03', { lastTaskCreationDay: '2024-06-10' }),
        D('2024-06-20'),
      );
      expect(getDbDateStr(r!)).toBe('2024-06-17');
    });

    it('null when the rule starts after today', () => {
      const r = getNewestPossibleRRuleDueDate(
        inp('FREQ=DAILY', '2024-07-01'),
        D('2024-06-20'),
      );
      expect(r).toBeNull();
    });
  });

  describe('getFirstRRuleOccurrence', () => {
    it('first firing on/after startDate, ignoring lastTaskCreationDay', () => {
      const r = getFirstRRuleOccurrence(
        inp('FREQ=WEEKLY;BYDAY=FR', '2024-06-03', { lastTaskCreationDay: '2025-01-01' }),
      );
      expect(getDbDateStr(r!)).toBe('2024-06-07');
    });
  });

  describe('isRRuleValid', () => {
    it('accepts well-formed complex rules', () => {
      [
        'FREQ=DAILY',
        'FREQ=MONTHLY;BYDAY=2TU',
        'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29',
        'FREQ=WEEKLY;BYDAY=MO,WE,FR;WKST=SU',
        'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1',
        'FREQ=YEARLY;BYWEEKNO=20;BYDAY=MO',
      ].forEach((r) => expect(isRRuleValid(r)).toBe(true));
    });

    it('rejects empty / FREQ-less / garbage', () => {
      [undefined, '', '   ', 'not an rrule', 'BYDAY=MO'].forEach((r) =>
        expect(isRRuleValid(r as string | undefined)).toBe(false),
      );
    });

    it('rejects sub-daily FREQs (day-granular engine — Phase 12 owns sub-daily)', () => {
      // The dialog blocks these at save; this engine-level gate covers rules
      // the dialog never saw (synced / imported / REST-ingested), which would
      // otherwise silently collapse to ~daily firing at local noon.
      ['FREQ=HOURLY', 'FREQ=MINUTELY;INTERVAL=30', 'FREQ=SECONDLY'].forEach((r) =>
        expect(isRRuleValid(r)).withContext(r).toBe(false),
      );
    });
  });

  describe('isRRuleValid never-firing rules', () => {
    // A parseable rule whose pattern matches no real date (BYMONTH=13, Feb-30)
    // walks period-by-period to rrule.js's MAXYEAR=9999 ceiling before yielding
    // nothing, and used to ALSO return `true`, so the engine deferred to a rule
    // that silently never fires (bypassing the legacy fallback). `_canNeverFire`
    // rejects these contradiction classes in O(1) before any probe; a never-firing
    // rule it doesn't recognise still resolves to false via the validity probe —
    // which is anchored near 9999, so that walk is bounded (sub-second, memoised)
    // rather than the multi-second freeze a 2020-anchored probe produced.
    it('rejects a never-firing rule instead of treating it as valid', () => {
      expect(isRRuleValid('FREQ=DAILY;BYMONTH=13')).toBe(false);
      expect(isRRuleValid('FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30')).toBe(false);
      expect(isRRuleValid('FREQ=DAILY;BYMONTH=13;BYMONTHDAY=2')).toBe(false);
    });

    it('pre-screens impossible BYMONTH × BYYEARDAY / BYWEEKNO combos in O(1)', () => {
      // These pass the simple range checks (every value individually valid) but
      // can never intersect: year-day 200 is July/August, week 53 is around the
      // Dec/Jan boundary — neither can fall in February. Without the pre-screen
      // each costs a one-time ~5-7s probe walk on first sight (e.g. a save click).
      const start = performance.now();
      expect(isRRuleValid('FREQ=DAILY;BYMONTH=2;BYYEARDAY=200')).toBe(false);
      expect(isRRuleValid('FREQ=DAILY;BYWEEKNO=53;BYMONTH=2')).toBe(false);
      expect(isRRuleValid('FREQ=DAILY;BYMONTH=6;BYWEEKNO=1,52')).toBe(false);
      // Generous bound — only meant to catch a regression back to the probe walk.
      expect(performance.now() - start).toBeLessThan(1000);
    });

    it('keeps satisfiable BYMONTH × BYYEARDAY / BYWEEKNO combos valid (no false positives)', () => {
      [
        'FREQ=DAILY;BYMONTH=7;BYYEARDAY=200', // yearday 200 IS in July
        'FREQ=DAILY;BYMONTH=12;BYWEEKNO=1', // ISO week 1 can include late December
        'FREQ=DAILY;BYMONTH=1;BYWEEKNO=53', // week 53 can spill into January
        'FREQ=DAILY;BYMONTH=2;BYYEARDAY=-320', // negative year-days skip the check
        'FREQ=DAILY;BYMONTH=2;BYWEEKNO=-46', // negative week numbers skip the check
      ].forEach((r) => expect(isRRuleValid(r)).withContext(r).toBe(true));
    });

    it('pre-screens positive BYSETPOS beyond the per-period set (DAILY/WEEKLY)', () => {
      // A day holds 1 occurrence and a week holds at most its BYDAY count, so a
      // POSITIVE BYSETPOS past that matches nothing. These previously walked
      // seconds to the ceiling on the probe; _canNeverFire now rejects them.
      expect(isRRuleValid('FREQ=DAILY;BYSETPOS=2')).toBe(false);
      expect(isRRuleValid('FREQ=DAILY;BYDAY=MO;BYSETPOS=2')).toBe(false);
      expect(isRRuleValid('FREQ=WEEKLY;BYDAY=MO;BYSETPOS=5')).toBe(false);
      expect(isRRuleValid('FREQ=WEEKLY;BYDAY=MO,TU,WE;BYSETPOS=4')).toBe(false);
    });

    it('keeps in-range BYSETPOS valid (no false positives)', () => {
      [
        'FREQ=DAILY;BYSETPOS=1', // the single daily slot
        'FREQ=DAILY;BYSETPOS=-1', // last == only
        'FREQ=WEEKLY;BYDAY=MO,TU,WE;BYSETPOS=2', // 2nd of 3
        'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1', // last weekday
        // rrule.js CLAMPS an out-of-range negative BYSETPOS and still fires, so
        // a negative value must never be flagged (regression: these were dropped
        // to the legacy fallback by the old `Math.abs(p) > slots` check).
        'FREQ=DAILY;BYSETPOS=-2',
        'FREQ=DAILY;BYSETPOS=-100',
        'FREQ=WEEKLY;BYDAY=MO;BYSETPOS=-2',
        // With NO BYDAY, BYMONTHDAY / BYYEARDAY / BYWEEKNO EXPAND the per-week set
        // past the (zero) BYDAY count, so the bound doesn't hold — must not flag.
        'FREQ=WEEKLY;BYMONTHDAY=1,2,3;BYSETPOS=2',
        'FREQ=WEEKLY;BYYEARDAY=1,2,3;BYSETPOS=2',
        'FREQ=WEEKLY;BYWEEKNO=10,20;BYSETPOS=2',
      ].forEach((r) => expect(isRRuleValid(r)).withContext(r).toBe(true));
    });

    it('pre-screens BYWEEKNO × BYYEARDAY contradictions (no BYMONTH)', () => {
      // A year-day and a week number that can never share a month can never
      // coincide — week 10 is ~March, year-day 300 is ~October. The BYMONTH-based
      // checks are skipped when bymonth is empty, so this needs its own pre-screen.
      expect(isRRuleValid('FREQ=DAILY;BYWEEKNO=10;BYYEARDAY=300')).toBe(false);
      expect(isRRuleValid('FREQ=YEARLY;BYWEEKNO=2;BYYEARDAY=200')).toBe(false);
    });

    it('keeps satisfiable BYWEEKNO × BYYEARDAY valid (no false positives)', () => {
      [
        'FREQ=DAILY;BYWEEKNO=10;BYYEARDAY=66', // year-day 66 (~Mar 7) sits in week 10
        'FREQ=YEARLY;BYWEEKNO=1;BYYEARDAY=1', // Jan 1 can be ISO week 1
        'FREQ=DAILY;BYWEEKNO=10;BYYEARDAY=-300', // negative year-days skip the check
      ].forEach((r) => expect(isRRuleValid(r)).withContext(r).toBe(true));
    });

    it('keeps a sound pattern with a past UNTIL / COUNT valid', () => {
      // UNTIL/COUNT are anchor-relative end conditions stripped for the validity
      // probe: the PATTERN is sound and the engine applies the real start/end per
      // cfg. Rejecting these would resurrect a finished rule forever via the
      // UNTIL-less legacy fallback.
      expect(isRRuleValid('FREQ=DAILY;UNTIL=20190601T000000Z')).toBe(true);
      expect(isRRuleValid('FREQ=WEEKLY;BYDAY=MO;COUNT=3')).toBe(true);
    });
  });

  describe('fail-soft', () => {
    it('a malformed rule yields [] / null, never throws', () => {
      expect(
        getRRuleOccurrencesInRange(
          inp('NONSENSE', '2024-06-01'),
          D('2024-06-01'),
          D('2024-06-30'),
        ),
      ).toEqual([]);
      expect(
        getNextRRuleOccurrence(inp('NONSENSE', '2024-06-01'), D('2024-06-01')),
      ).toBeNull();
      expect(getFirstRRuleOccurrence(inp('NONSENSE', '2024-06-01'))).toBeNull();
      expect(
        getNewestPossibleRRuleDueDate(inp('NONSENSE', '2024-06-01'), D('2024-06-30')),
      ).toBeNull();
    });
  });
});
