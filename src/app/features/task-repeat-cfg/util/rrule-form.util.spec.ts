import { RRule } from 'rrule';
import {
  defaultRRuleFormModel,
  formModelToRRule,
  RRuleFormModel,
  rruleToFormModel,
} from './rrule-form.util';

describe('rrule-form.util', () => {
  describe('formModelToRRule', () => {
    const base = (over: Partial<RRuleFormModel>): RRuleFormModel => ({
      ...defaultRRuleFormModel(new Date(2024, 5, 3)), // Mon Jun 3 2024
      ...over,
    });

    it('daily with interval', () => {
      expect(formModelToRRule(base({ freq: 'DAILY', interval: 1 }))).toBe('FREQ=DAILY');
      expect(formModelToRRule(base({ freq: 'DAILY', interval: 3 }))).toBe(
        'FREQ=DAILY;INTERVAL=3',
      );
    });

    it('weekly with weekdays (ordered Mon→Sun)', () => {
      expect(
        formModelToRRule(base({ freq: 'WEEKLY', interval: 2, byDay: ['WE', 'MO'] })),
      ).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE');
    });

    it('monthly nth-weekday (single row)', () => {
      expect(
        formModelToRRule(
          base({
            freq: 'MONTHLY',
            monthlyMode: 'NTH_WEEKDAY',
            nthDays: [{ pos: 2, days: ['TU'] }],
          }),
        ),
      ).toBe('FREQ=MONTHLY;BYDAY=2TU');
    });

    it('monthly last weekday (-1)', () => {
      expect(
        formModelToRRule(
          base({
            freq: 'MONTHLY',
            monthlyMode: 'NTH_WEEKDAY',
            nthDays: [{ pos: -1, days: ['FR'] }],
          }),
        ),
      ).toBe('FREQ=MONTHLY;BYDAY=-1FR');
    });

    it('monthly custom ordinals (5th Friday, 2nd-to-last Monday)', () => {
      expect(
        formModelToRRule(
          base({
            freq: 'MONTHLY',
            monthlyMode: 'NTH_WEEKDAY',
            nthDays: [
              { pos: 5, days: ['FR'] },
              { pos: -2, days: ['MO'] },
            ],
          }),
        ),
      ).toBe('FREQ=MONTHLY;BYDAY=5FR,-2MO');
    });

    it('dedupes identical ordinal+weekday tokens across rows', () => {
      expect(
        formModelToRRule(
          base({
            freq: 'MONTHLY',
            monthlyMode: 'NTH_WEEKDAY',
            nthDays: [
              { pos: 3, days: ['MO', 'TU'] },
              { pos: 3, days: ['TU'] },
            ],
          }),
        ),
      ).toBe('FREQ=MONTHLY;BYDAY=3MO,3TU');
    });

    it('monthly nth-weekday multiple rows (3rd Monday and 4th Sunday)', () => {
      expect(
        formModelToRRule(
          base({
            freq: 'MONTHLY',
            monthlyMode: 'NTH_WEEKDAY',
            nthDays: [
              { pos: 3, days: ['MO'] },
              { pos: 4, days: ['SU'] },
            ],
          }),
        ),
      ).toBe('FREQ=MONTHLY;BYDAY=3MO,4SU');
    });

    it('yearly nth-weekday rows, every other year (3rd Mon + 4th Sun in June)', () => {
      expect(
        formModelToRRule(
          base({
            freq: 'YEARLY',
            interval: 2,
            yearlyMode: 'NTH_WEEKDAY',
            byMonth: [6],
            nthDays: [
              { pos: 3, days: ['MO'] },
              { pos: 4, days: ['SU'] },
            ],
          }),
        ),
      ).toBe('FREQ=YEARLY;INTERVAL=2;BYMONTH=6;BYDAY=3MO,4SU');
    });

    it('monthly day-of-month', () => {
      expect(
        formModelToRRule(
          base({ freq: 'MONTHLY', monthlyMode: 'DAY_OF_MONTH', monthDays: [15] }),
        ),
      ).toBe('FREQ=MONTHLY;BYMONTHDAY=15');
    });

    it('monthly last day (-1 in the day grid)', () => {
      expect(
        formModelToRRule(
          base({ freq: 'MONTHLY', monthlyMode: 'DAY_OF_MONTH', monthDays: [-1] }),
        ),
      ).toBe('FREQ=MONTHLY;BYMONTHDAY=-1');
    });

    it('yearly with months + day', () => {
      expect(
        formModelToRRule(base({ freq: 'YEARLY', byMonth: [11, 3], monthDays: [15] })),
      ).toBe('FREQ=YEARLY;BYMONTH=3,11;BYMONTHDAY=15');
    });

    it('yearly weekdays within months (seasonal — the cron "Sat Mar–Nov" case)', () => {
      expect(
        formModelToRRule(
          base({
            freq: 'YEARLY',
            yearlyMode: 'WEEKDAYS',
            byMonth: [3, 4, 5, 6, 7, 8, 9, 10, 11],
            byDay: ['SA'],
          }),
        ),
      ).toBe('FREQ=YEARLY;BYMONTH=3,4,5,6,7,8,9,10,11;BYDAY=SA');
    });

    it('yearly nth-weekday via "which" (2nd Saturday of June, every other year)', () => {
      expect(
        formModelToRRule(
          base({
            freq: 'YEARLY',
            interval: 2,
            yearlyMode: 'WEEKDAYS',
            byMonth: [6],
            byDay: ['SA'],
            bySetPos: '2',
          }),
        ),
      ).toBe('FREQ=YEARLY;INTERVAL=2;BYMONTH=6;BYDAY=SA;BYSETPOS=2');
    });

    it('seasonal BYMONTH constraint on non-yearly frequencies', () => {
      expect(formModelToRRule(base({ freq: 'DAILY', byMonth: [1, 2, 3, 4] }))).toBe(
        'FREQ=DAILY;BYMONTH=1,2,3,4',
      );
      expect(
        formModelToRRule(base({ freq: 'WEEKLY', byDay: ['MO'], byMonth: [6] })),
      ).toBe('FREQ=WEEKLY;BYMONTH=6;BYDAY=MO');
    });

    it('end after N occurrences (COUNT)', () => {
      expect(formModelToRRule(base({ freq: 'DAILY', endType: 'COUNT', count: 5 }))).toBe(
        'FREQ=DAILY;COUNT=5',
      );
    });

    it('end on date (UNTIL → noon UTC)', () => {
      expect(
        formModelToRRule(base({ freq: 'DAILY', endType: 'UNTIL', until: '2024-06-30' })),
      ).toBe('FREQ=DAILY;UNTIL=20240630T120000Z');
    });
  });

  describe('rruleToFormModel ∘ formModelToRRule round-trips', () => {
    const cases = [
      'FREQ=DAILY',
      'FREQ=DAILY;INTERVAL=3',
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE',
      'FREQ=MONTHLY;BYDAY=2TU',
      'FREQ=MONTHLY;BYDAY=3MO,4SU',
      'FREQ=MONTHLY;BYDAY=-1FR',
      'FREQ=MONTHLY;BYMONTHDAY=15',
      'FREQ=MONTHLY;BYMONTHDAY=-1',
      'FREQ=YEARLY;BYMONTH=3,11;BYMONTHDAY=15',
      'FREQ=YEARLY;BYMONTH=3,4,5,6,7,8,9,10,11;BYDAY=SA',
      'FREQ=DAILY;BYMONTH=1,2,3,4',
      'FREQ=WEEKLY;BYMONTH=6;BYDAY=MO',
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;WKST=SU',
      'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1',
      'FREQ=DAILY;COUNT=5',
      'FREQ=DAILY;UNTIL=20240630T120000Z',
    ];
    cases.forEach((rrule) => {
      it(`"${rrule}" survives parse → build`, () => {
        expect(formModelToRRule(rruleToFormModel(rrule))).toBe(rrule);
      });
    });
  });

  describe('rruleToFormModel parsing', () => {
    it('maps nth-weekday back to a single row', () => {
      const m = rruleToFormModel('FREQ=MONTHLY;BYDAY=3SA');
      expect(m.freq).toBe('MONTHLY');
      expect(m.monthlyMode).toBe('NTH_WEEKDAY');
      expect(m.nthDays).toEqual([{ pos: 3, days: ['SA'] }]);
    });

    it('maps multiple nth-weekdays back to rows (3MO,4SU)', () => {
      const m = rruleToFormModel('FREQ=MONTHLY;BYDAY=3MO,4SU');
      expect(m.monthlyMode).toBe('NTH_WEEKDAY');
      expect(m.nthDays).toEqual([
        { pos: 3, days: ['MO'] },
        { pos: 4, days: ['SU'] },
      ]);
    });

    it('maps custom ordinals (outside the dropdown set) back to rows, no raw fallback', () => {
      const m = rruleToFormModel('FREQ=MONTHLY;BYDAY=-2MO,5FR');
      expect(m.monthlyMode).toBe('NTH_WEEKDAY');
      expect(m.nthDays).toEqual([
        { pos: -2, days: ['MO'] },
        { pos: 5, days: ['FR'] },
      ]);
      expect(m.rawOverride).toBe('');
    });

    it('maps yearly weekdays-within-months back to dropdown fields', () => {
      const m = rruleToFormModel('FREQ=YEARLY;BYMONTH=3,11;BYDAY=SA');
      expect(m.freq).toBe('YEARLY');
      expect(m.yearlyMode).toBe('WEEKDAYS');
      expect(m.byMonth).toEqual([3, 11]);
      expect(m.byDay).toEqual(['SA']);
    });

    it('maps a monthly weekday set (+ set position) back to dropdowns', () => {
      const m = rruleToFormModel('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1');
      expect(m.freq).toBe('MONTHLY');
      expect(m.monthlyMode).toBe('WEEKDAYS');
      expect(m.byDay).toEqual(['MO', 'TU', 'WE', 'TH', 'FR']);
      expect(m.bySetPos).toBe('-1');
    });

    it('maps a multi-value BYSETPOS back without a raw fallback', () => {
      const m = rruleToFormModel('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=2,-1');
      expect(m.monthlyMode).toBe('WEEKDAYS');
      expect(m.bySetPos).toBe('2,-1');
      expect(m.rawOverride).toBe('');
    });

    it('YEARLY date mode without BYMONTH omits BYMONTHDAY (bare yearly = anniversary)', () => {
      // Per RFC 5545 a bare FREQ=YEARLY;BYMONTHDAY=n expands across every
      // month — i.e. fires monthly. With no months selected, emit a plain
      // FREQ=YEARLY (anchors to the start date) instead.
      expect(
        formModelToRRule({
          ...defaultRRuleFormModel(new Date(2024, 5, 3)),
          freq: 'YEARLY',
          yearlyMode: 'DAY_OF_MONTH',
          byMonth: [],
          monthDays: [15],
        }),
      ).toBe('FREQ=YEARLY');
    });

    it('a parsed bare yearly BYMONTHDAY rule falls back to the raw override', () => {
      // Can't round-trip structurally without changing semantics (it fires
      // monthly) — preserve it verbatim instead.
      const m = rruleToFormModel('FREQ=YEARLY;BYMONTHDAY=15');
      expect(m.rawOverride).toBe('FREQ=YEARLY;BYMONTHDAY=15');
    });

    it('drops BYSETPOS=0 on parse (re-emitting it would create a dead rule)', () => {
      const m = rruleToFormModel('FREQ=MONTHLY;BYDAY=MO,TU;BYSETPOS=0');
      expect(m.bySetPos).not.toContain('0');
      // The cleanup must survive the round-trip guard: a raw override would
      // store the original rule verbatim and re-emit the dead BYSETPOS=0.
      expect(m.rawOverride).toBe('');
      expect(formModelToRRule(m)).toBe('FREQ=MONTHLY;BYDAY=MO,TU');
    });

    it('keeps non-zero BYSETPOS values when zeros are mixed in', () => {
      const m = rruleToFormModel('FREQ=MONTHLY;BYDAY=MO;BYSETPOS=0,2');
      expect(m.bySetPos).toBe('2');
      expect(m.rawOverride).toBe('');
      expect(formModelToRRule(m)).toBe('FREQ=MONTHLY;BYDAY=MO;BYSETPOS=2');
    });

    it('round-trips the migration clamp idiom structurally (no raw fallback)', () => {
      // BYMONTHDAY=31,-1;BYSETPOS=1 = "the 31st, or the last day of shorter
      // months" — emitted by the legacy-CUSTOM migration for day > 28 anchors.
      const m = rruleToFormModel('FREQ=MONTHLY;BYMONTHDAY=31,-1;BYSETPOS=1');
      expect(m.monthlyMode).toBe('DAY_OF_MONTH');
      expect(m.monthDays).toEqual([31, -1]);
      expect(m.bySetPos).toBe('1');
      expect(m.rawOverride).toBe('');
      expect(formModelToRRule(m)).toBe('FREQ=MONTHLY;BYMONTHDAY=31,-1;BYSETPOS=1');
    });

    it('maps COUNT to end condition', () => {
      const m = rruleToFormModel('FREQ=WEEKLY;BYDAY=MO;COUNT=12');
      expect(m.endType).toBe('COUNT');
      expect(m.count).toBe(12);
    });

    it('falls back to defaults for empty / garbage input', () => {
      expect(rruleToFormModel('').freq).toBe('WEEKLY');
      expect(rruleToFormModel('not an rrule').freq).toBe('WEEKLY');
      expect(rruleToFormModel(undefined).endType).toBe('NEVER');
    });
  });

  describe('advanced section (WKST + raw override)', () => {
    it('week-start (WKST) round-trips and expands the advanced section', () => {
      const m = rruleToFormModel('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;WKST=SU');
      expect(m.showAdvanced).toBe(true);
      expect(m.wkst).toBe('SU');
      expect(formModelToRRule(m)).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;WKST=SU');
    });

    it('truly exotic rules (time-of-day parts) are preserved via raw override', () => {
      const exotic = 'FREQ=DAILY;BYHOUR=9,17';
      const m = rruleToFormModel(exotic);
      expect(m.showAdvanced).toBe(true);
      expect(m.rawOverride).toBe(exotic);
      expect(formModelToRRule(m)).toBe(exotic);
    });

    it('raw override replaces the structured build when advanced is on', () => {
      const m = defaultRRuleFormModel(new Date(2024, 5, 3));
      m.showAdvanced = true;
      m.rawOverride = 'FREQ=YEARLY;BYYEARDAY=100';
      expect(formModelToRRule(m)).toBe('FREQ=YEARLY;BYYEARDAY=100');
    });

    it('an advanced value applies even when the section is collapsed (cosmetic)', () => {
      const m = defaultRRuleFormModel(new Date(2024, 5, 3)); // Monday
      m.showAdvanced = false; // collapsed UI, but the value still applies
      m.rawOverride = 'FREQ=YEARLY;BYYEARDAY=100';
      expect(formModelToRRule(m)).toBe('FREQ=YEARLY;BYYEARDAY=100');
    });
  });

  describe('advanced BY* forward build', () => {
    const adv = (over: Partial<RRuleFormModel>): RRuleFormModel => ({
      ...defaultRRuleFormModel(new Date(2024, 5, 3)),
      showAdvanced: true,
      ...over,
    });

    it('BYSETPOS in the weekday-set mode ("last weekday")', () => {
      expect(
        formModelToRRule(
          adv({
            freq: 'MONTHLY',
            monthlyMode: 'WEEKDAYS',
            byDay: ['MO', 'TU', 'WE', 'TH', 'FR'],
            bySetPos: '-1',
          }),
        ),
      ).toBe('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1');
    });

    it('multiple / negative days of the month via the day grid', () => {
      expect(
        formModelToRRule(
          adv({ freq: 'MONTHLY', monthlyMode: 'DAY_OF_MONTH', monthDays: [1, 15, -1] }),
        ),
      ).toBe('FREQ=MONTHLY;BYMONTHDAY=1,15,-1');
    });

    it('appends BYWEEKNO / BYYEARDAY', () => {
      expect(
        formModelToRRule(
          adv({ freq: 'YEARLY', byMonth: [], monthDays: [], byWeekNo: '20' }),
        ),
      ).toBe('FREQ=YEARLY;BYWEEKNO=20');
      expect(
        formModelToRRule(
          adv({ freq: 'YEARLY', byMonth: [], monthDays: [], byYearDay: '100,-1' }),
        ),
      ).toBe('FREQ=YEARLY;BYYEARDAY=100,-1');
    });
  });

  // The canonical guard guarantees that ANY valid rule survives edit → rebuild:
  // either the structured/advanced fields reproduce it, or it is preserved
  // verbatim in the raw override. Compared via rrule's canonical serialization.
  describe('every rule round-trips (structured or raw fallback)', () => {
    const canon = (s: string): string => RRule.fromString(s).toString();
    const rules = [
      'FREQ=DAILY',
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE',
      'FREQ=MONTHLY;BYMONTHDAY=15',
      'FREQ=MONTHLY;BYDAY=2TU',
      'FREQ=MONTHLY;BYDAY=3MO,4SU',
      'FREQ=MONTHLY;BYMONTHDAY=-1',
      'FREQ=YEARLY;BYMONTH=3,11;BYMONTHDAY=15',
      'FREQ=YEARLY;BYMONTH=3,4,5,6,7,8,9,10,11;BYDAY=SA',
      'FREQ=WEEKLY;BYDAY=MO;WKST=SU',
      'FREQ=DAILY;COUNT=5',
      'FREQ=DAILY;UNTIL=20240630T120000Z',
      // exotic → preserved via raw override
      'FREQ=MONTHLY;BYMONTHDAY=1,15,-1',
      'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1',
      'FREQ=YEARLY;BYWEEKNO=20',
      'FREQ=YEARLY;BYYEARDAY=100,-1',
      'FREQ=MINUTELY;INTERVAL=90',
    ];
    rules.forEach((rr) => {
      it(`"${rr}"`, () => {
        expect(canon(formModelToRRule(rruleToFormModel(rr)))).toBe(canon(rr));
      });
    });
  });
});
