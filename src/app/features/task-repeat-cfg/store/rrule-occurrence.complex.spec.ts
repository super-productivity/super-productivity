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
