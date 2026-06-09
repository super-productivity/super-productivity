import { RRule } from 'rrule';
import {
  defaultRRuleFormModel,
  formModelToRRule,
  rruleToFormModel,
} from './rrule-form.util';

// Complex builder coverage: forward (model → string), the round-trip guard
// (string → model → string is semantically lossless), and the mode-detection
// that picks day-of-month vs nth-weekday vs weekday-set vs raw-override.

const REF = new Date(2024, 5, 3, 12); // Mon Jun 3 2024

/** Canonicalise like the util's round-trip guard so order/format don't matter. */
const canon = (s: string): string => {
  try {
    return RRule.fromString(s).toString();
  } catch {
    return s;
  }
};

const model = (
  over: Partial<ReturnType<typeof defaultRRuleFormModel>> = {},
): ReturnType<typeof defaultRRuleFormModel> => ({
  ...defaultRRuleFormModel(REF),
  ...over,
});

describe('rrule-form util — complex builder', () => {
  describe('formModelToRRule (model → string)', () => {
    it('MONTHLY per-day ordinals → BYDAY=3MO,4SU', () => {
      expect(
        formModelToRRule(
          model({
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

    it('MONTHLY one ordinal with multiple weekdays → BYDAY=1MO,1TU', () => {
      expect(
        formModelToRRule(
          model({
            freq: 'MONTHLY',
            monthlyMode: 'NTH_WEEKDAY',
            nthDays: [{ pos: 1, days: ['MO', 'TU'] }],
          }),
        ),
      ).toBe('FREQ=MONTHLY;BYDAY=1MO,1TU');
    });

    it('MONTHLY weekday-set + BYSETPOS=-1 (last weekday)', () => {
      expect(
        formModelToRRule(
          model({
            freq: 'MONTHLY',
            monthlyMode: 'WEEKDAYS',
            byDay: ['MO', 'TU', 'WE', 'TH', 'FR'],
            bySetPos: '-1',
          }),
        ),
      ).toBe('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1');
    });

    it('MONTHLY last day (BYMONTHDAY=-1)', () => {
      expect(
        formModelToRRule(
          model({ freq: 'MONTHLY', monthlyMode: 'DAY_OF_MONTH', monthDays: [-1] }),
        ),
      ).toBe('FREQ=MONTHLY;BYMONTHDAY=-1');
    });

    it('seasonal DAILY;BYMONTH=1,4,7,10 (sorted)', () => {
      expect(formModelToRRule(model({ freq: 'DAILY', byMonth: [7, 1, 10, 4] }))).toBe(
        'FREQ=DAILY;BYMONTH=1,4,7,10',
      );
    });

    it('WEEKLY INTERVAL + multi-weekday in Mon-first order', () => {
      expect(
        formModelToRRule(
          model({ freq: 'WEEKLY', interval: 2, byDay: ['FR', 'MO', 'WE'] }),
        ),
      ).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR');
    });

    it('YEARLY on a date (BYMONTH + BYMONTHDAY)', () => {
      expect(
        formModelToRRule(
          model({
            freq: 'YEARLY',
            yearlyMode: 'DAY_OF_MONTH',
            byMonth: [3],
            monthDays: [17],
          }),
        ),
      ).toBe('FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=17');
    });

    it('COUNT end condition', () => {
      expect(
        formModelToRRule(
          model({ freq: 'DAILY', interval: 3, endType: 'COUNT', count: 10 }),
        ),
      ).toBe('FREQ=DAILY;INTERVAL=3;COUNT=10');
    });

    it('UNTIL end condition (noon-UTC instant)', () => {
      expect(
        formModelToRRule(
          model({ freq: 'WEEKLY', byDay: ['MO'], endType: 'UNTIL', until: '2024-12-31' }),
        ),
      ).toBe('FREQ=WEEKLY;BYDAY=MO;UNTIL=20241231T120000Z');
    });

    it('WKST week-start', () => {
      expect(
        formModelToRRule(
          model({ freq: 'WEEKLY', byDay: ['MO', 'WE', 'FR'], wkst: 'SU' }),
        ),
      ).toBe('FREQ=WEEKLY;BYDAY=MO,WE,FR;WKST=SU');
    });

    it('a raw override wins over the structured fields', () => {
      expect(
        formModelToRRule(
          model({ freq: 'WEEKLY', byDay: ['MO'], rawOverride: 'FREQ=HOURLY;INTERVAL=2' }),
        ),
      ).toBe('FREQ=HOURLY;INTERVAL=2');
    });
  });

  describe('rruleToFormModel (string → model) mode detection', () => {
    it('per-day ordinals → NTH_WEEKDAY rows', () => {
      const m = rruleToFormModel('FREQ=MONTHLY;BYDAY=1MO,3MO', REF);
      expect(m.freq).toBe('MONTHLY');
      expect(m.monthlyMode).toBe('NTH_WEEKDAY');
      expect(m.nthDays).toEqual([
        { pos: 1, days: ['MO'] },
        { pos: 3, days: ['MO'] },
      ]);
    });

    it('weekdays sharing an ordinal collapse into one row (1MO,1TU)', () => {
      const m = rruleToFormModel('FREQ=MONTHLY;BYDAY=1MO,1TU', REF);
      expect(m.monthlyMode).toBe('NTH_WEEKDAY');
      expect(m.nthDays).toEqual([{ pos: 1, days: ['MO', 'TU'] }]);
    });

    it('weekday-set + BYSETPOS → WEEKDAYS mode', () => {
      const m = rruleToFormModel('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1', REF);
      expect(m.monthlyMode).toBe('WEEKDAYS');
      expect(m.byDay).toEqual(['MO', 'TU', 'WE', 'TH', 'FR']);
      expect(m.bySetPos).toBe('-1');
    });

    it('plain BYMONTHDAY → DAY_OF_MONTH', () => {
      const m = rruleToFormModel('FREQ=MONTHLY;BYMONTHDAY=-1', REF);
      expect(m.monthlyMode).toBe('DAY_OF_MONTH');
      expect(m.monthDays).toEqual([-1]);
    });

    it('YEARLY nth-weekday within a month', () => {
      const m = rruleToFormModel('FREQ=YEARLY;BYMONTH=6;BYDAY=2SA', REF);
      expect(m.freq).toBe('YEARLY');
      expect(m.yearlyMode).toBe('NTH_WEEKDAY');
      expect(m.byMonth).toEqual([6]);
      expect(m.nthDays).toEqual([{ pos: 2, days: ['SA'] }]);
    });

    it('COUNT / UNTIL parse into endType', () => {
      expect(rruleToFormModel('FREQ=DAILY;COUNT=7', REF).endType).toBe('COUNT');
      expect(rruleToFormModel('FREQ=DAILY;COUNT=7', REF).count).toBe(7);
      const u = rruleToFormModel('FREQ=WEEKLY;BYDAY=MO;UNTIL=20241231T120000Z', REF);
      expect(u.endType).toBe('UNTIL');
      expect(u.until).toBe('2024-12-31');
    });

    it('sub-daily FREQ falls back to a raw override', () => {
      const m = rruleToFormModel('FREQ=MINUTELY;INTERVAL=30', REF);
      expect(m.rawOverride).toBe('FREQ=MINUTELY;INTERVAL=30');
      expect(m.showAdvanced).toBe(true);
    });

    it('garbage → defaults (no raw override)', () => {
      const m = rruleToFormModel('garbage', REF);
      expect(m.freq).toBe('WEEKLY');
      expect(m.rawOverride).toBe('');
    });
  });

  describe('round-trip is semantically lossless (string → model → string)', () => {
    const RULES = [
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR',
      'FREQ=MONTHLY;BYMONTHDAY=-1',
      'FREQ=MONTHLY;BYMONTHDAY=1,15',
      'FREQ=MONTHLY;BYDAY=2TU',
      'FREQ=MONTHLY;BYDAY=1MO,3MO',
      'FREQ=MONTHLY;BYDAY=1MO,1TU',
      'FREQ=MONTHLY;BYDAY=2TU,4TH',
      'FREQ=YEARLY;BYMONTH=6;BYDAY=1SA,1SU',
      'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1',
      'FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=17',
      'FREQ=YEARLY;BYMONTH=6;BYDAY=2SA',
      'FREQ=YEARLY;BYYEARDAY=1',
      'FREQ=YEARLY;BYWEEKNO=20;BYDAY=MO',
      'FREQ=DAILY;INTERVAL=3;COUNT=10',
      'FREQ=WEEKLY;BYDAY=MO;UNTIL=20241231T120000Z',
      'FREQ=WEEKLY;BYDAY=MO,WE,FR;WKST=SU',
      'FREQ=DAILY;BYMONTH=1,4,7,10',
      'FREQ=MINUTELY;INTERVAL=30',
      'FREQ=HOURLY;INTERVAL=6',
    ];

    RULES.forEach((rule) => {
      it(rule, () => {
        expect(canon(formModelToRRule(rruleToFormModel(rule, REF)))).toBe(canon(rule));
      });
    });
  });
});
