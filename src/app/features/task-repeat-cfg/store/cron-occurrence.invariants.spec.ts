import {
  getFirstCronOccurrence,
  getNewestPossibleCronDueDate,
  getNextCronOccurrence,
  isCronExpressionValid,
} from './cron-occurrence.util';
import { getFirstRepeatOccurrence } from './get-first-repeat-occurrence.util';
import { DEFAULT_TASK_REPEAT_CFG, TaskRepeatCfg } from '../task-repeat-cfg.model';
import { getDbDateStr } from '../../../util/get-db-date-str';

// Property / invariant + calendar-edge tests for the cron occurrence engine.
// Local-time Date construction + getDbDateStr comparisons keep these
// timezone-independent. ISO `YYYY-MM-DD` strings compare correctly with < / >.

const cronCfg = (
  cronExpression: string,
  fields: Partial<TaskRepeatCfg> = {},
): TaskRepeatCfg => ({
  ...DEFAULT_TASK_REPEAT_CFG,
  id: 'CRON_INV',
  title: 'inv',
  projectId: null,
  order: 0,
  tagIds: [],
  repeatCycle: 'CRON',
  quickSetting: 'CRON',
  cronExpression,
  repeatEvery: 1,
  startDate: '1970-01-01',
  lastTaskCreationDay: '1970-01-01',
  ...fields,
});

const VALID_CRONS = [
  '0 0 0 * * ?', // daily midnight
  '0 0 9 ? * MON', // weekly, 9am
  '0 0 0 15 * ?', // monthly day-15
  '0 0 0 ? 3-11 SAT', // saturdays Mar-Nov
  '0 */5 * * * ?', // every 5 min (sub-daily)
  '0 30 14 * * ?', // daily 2:30pm
  '0 0 0 ? * MON-FRI', // weekdays
  '0 0 0 1 * ?', // monthly day-1
  '0 0 0 L * ?', // last day of month
  '0 0 0 ? * SAT#3', // 3rd saturday
  '0 0 12 * * ?', // daily noon
  '0 0 0 1 1 ?', // jan 1 yearly
];

const INVALID_CRONS = [
  '',
  '   ',
  'nope',
  'totally bogus text',
  '0 0 0 ? * MON 2027', // year field (engine-unsupported)
  '0 0 0 15W * ?', // nearest weekday
  '0 0 0 L-1 * ?', // n-to-last day
  '99 99 99 99 99 ?', // out of range
];

const BASE = new Date(2024, 5, 15, 12, 0, 0); // Sat Jun 15 2024, noon
const BASE_STR = getDbDateStr(BASE);

describe('cron-occurrence invariants', () => {
  describe('getNextCronOccurrence — for every valid cron', () => {
    VALID_CRONS.forEach((expr) => {
      it(`"${expr}" returns a Date strictly after fromDate's day, never throws`, () => {
        let r: Date | null = null;
        expect(() => (r = getNextCronOccurrence(cronCfg(expr), BASE))).not.toThrow();
        expect(r).not.toBeNull();
        // result is normalized to noon and lands on a later calendar day
        expect(getDbDateStr(r!) > BASE_STR)
          .withContext(`${expr} → ${r}`)
          .toBe(true);
        expect(r!.getHours()).toBe(12);
      });
    });
  });

  describe('getNewestPossibleCronDueDate — for every valid cron', () => {
    VALID_CRONS.forEach((expr) => {
      it(`"${expr}" returns null or a day on/before today and >= startDate`, () => {
        let r: Date | null = null;
        expect(
          () => (r = getNewestPossibleCronDueDate(cronCfg(expr), BASE)),
        ).not.toThrow();
        if (r !== null) {
          expect(getDbDateStr(r!) <= BASE_STR)
            .withContext(`${expr} → ${r}`)
            .toBe(true);
          expect(getDbDateStr(r!) >= '1970-01-01').toBe(true);
        }
      });
    });
  });

  describe('invalid expressions are rejected gracefully (null, no throw)', () => {
    INVALID_CRONS.forEach((expr) => {
      it(`"${expr}"`, () => {
        expect(isCronExpressionValid(expr)).toBe(false);
        expect(getNextCronOccurrence(cronCfg(expr), BASE)).toBeNull();
        expect(getNewestPossibleCronDueDate(cronCfg(expr), BASE)).toBeNull();
        expect(getFirstCronOccurrence(cronCfg(expr))).toBeNull();
      });
    });
  });

  it('getNextCronOccurrence is deterministic', () => {
    const a = getNextCronOccurrence(cronCfg('0 0 0 ? * MON'), BASE);
    const b = getNextCronOccurrence(cronCfg('0 0 0 ? * MON'), BASE);
    expect(getDbDateStr(a!)).toBe(getDbDateStr(b!));
  });

  it('advancing fromDate yields strictly increasing occurrence days (monotonic)', () => {
    const days: string[] = [];
    let from = BASE;
    for (let i = 0; i < 6; i++) {
      const next = getNextCronOccurrence(cronCfg('0 0 0 ? * MON'), from);
      expect(next).not.toBeNull();
      const s = getDbDateStr(next!);
      if (days.length) expect(s > days[days.length - 1]).toBe(true);
      days.push(s);
      from = next!;
    }
    expect(days.length).toBe(6);
  });

  describe('calendar edges', () => {
    it('leap day: next Feb 29 from a leap year start', () => {
      const cfg = cronCfg('0 0 0 29 2 ?', { startDate: '2024-01-01' });
      expect(getDbDateStr(getNextCronOccurrence(cfg, new Date(2024, 0, 1, 12))!)).toBe(
        '2024-02-29',
      );
      // After Feb 29 2024 the next leap-day is 2028.
      expect(getDbDateStr(getNextCronOccurrence(cfg, new Date(2024, 2, 1, 12))!)).toBe(
        '2028-02-29',
      );
    });

    it('leap day: due today on Feb 29, null on Feb 28 (no fire yet this year)', () => {
      const cfg = cronCfg('0 0 0 29 2 ?', { startDate: '2024-01-01' });
      expect(
        getDbDateStr(getNewestPossibleCronDueDate(cfg, new Date(2024, 1, 29, 12))!),
      ).toBe('2024-02-29');
      expect(getNewestPossibleCronDueDate(cfg, new Date(2024, 1, 28, 12))).toBeNull();
    });

    it('year rollover: monthly day-1 from mid-December → Jan 1 next year', () => {
      const r = getNextCronOccurrence(cronCfg('0 0 0 1 * ?'), new Date(2024, 11, 15, 12));
      expect(getDbDateStr(r!)).toBe('2025-01-01');
    });

    it('yearly Jan 1 from February → Jan 1 next year', () => {
      const r = getNextCronOccurrence(cronCfg('0 0 0 1 1 ?'), new Date(2024, 1, 10, 12));
      expect(getDbDateStr(r!)).toBe('2025-01-01');
    });

    it('pathological "Feb 30" never fires → null, returns promptly (no hang)', () => {
      const cfg = cronCfg('0 0 0 30 2 ?');
      expect(getNextCronOccurrence(cfg, BASE)).toBeNull();
      expect(getNewestPossibleCronDueDate(cfg, BASE)).toBeNull();
    });

    it('DST spring-forward: next() is correct; documents cron-parser prev() skip', () => {
      // US spring-forward 2024-03-10. next() correctly lands on Mar 10.
      expect(
        getDbDateStr(
          getNextCronOccurrence(cronCfg('0 0 0 * * ?'), new Date(2024, 2, 9, 12))!,
        ),
      ).toBe('2024-03-10');
      // Known upstream quirk: cron-parser's prev() skips the spring-forward
      // midnight (Mar 10 00:00) in DST zones, so "newest due" can land on Mar 9
      // rather than Mar 10. Day-granular creation still yields a valid recent
      // day (and lastTaskCreationDay prevents duplicates). Accept either so the
      // test is meaningful in both DST and non-DST runner timezones.
      const newest = getNewestPossibleCronDueDate(
        cronCfg('0 0 0 * * ?'),
        new Date(2024, 2, 10, 12),
      );
      expect(newest).not.toBeNull();
      expect(['2024-03-09', '2024-03-10']).toContain(getDbDateStr(newest!));
    });

    it('DST fall-back week: daily cron still resolves the right days', () => {
      // US fall-back 2024-11-03.
      expect(
        getDbDateStr(
          getNextCronOccurrence(cronCfg('0 0 0 * * ?'), new Date(2024, 10, 2, 12))!,
        ),
      ).toBe('2024-11-03');
    });
  });

  describe('getFirstCronOccurrence', () => {
    it('daily: first occurrence is the start day itself', () => {
      const r = getFirstCronOccurrence(
        cronCfg('0 0 0 * * ?', { startDate: '2024-06-01' }),
      );
      expect(getDbDateStr(r!)).toBe('2024-06-01');
    });

    it('weekly Monday: first Monday on/after a Saturday start', () => {
      // 2024-06-01 is a Saturday → first Monday is 2024-06-03.
      const r = getFirstCronOccurrence(
        cronCfg('0 0 0 ? * MON', { startDate: '2024-06-01' }),
      );
      expect(getDbDateStr(r!)).toBe('2024-06-03');
    });

    it('weekly with time-of-day: still the start day when it matches', () => {
      // 2024-06-03 is a Monday; the 9am fire on that day counts.
      const r = getFirstCronOccurrence(
        cronCfg('0 0 9 ? * MON', { startDate: '2024-06-03' }),
      );
      expect(getDbDateStr(r!)).toBe('2024-06-03');
    });

    it('getFirstRepeatOccurrence routes CRON to getFirstCronOccurrence', () => {
      const r = getFirstRepeatOccurrence(
        cronCfg('0 0 0 ? * MON', { startDate: '2024-06-01' }),
      );
      expect(getDbDateStr(r!)).toBe('2024-06-03');
    });

    it('getFirstRepeatOccurrence returns null for an invalid CRON expression', () => {
      expect(
        getFirstRepeatOccurrence(cronCfg('nope', { startDate: '2024-06-01' })),
      ).toBeNull();
    });
  });

  describe('serialization integrity (sync / backup)', () => {
    it('a CRON cfg survives a JSON round-trip with identical occurrence behavior', () => {
      const cfg = cronCfg('0 0 9 ? * MON', { startDate: '2024-06-01' });
      const roundTripped = JSON.parse(JSON.stringify(cfg)) as TaskRepeatCfg;
      expect(roundTripped.cronExpression).toBe(cfg.cronExpression);
      expect(roundTripped.repeatCycle).toBe('CRON');
      // Occurrence engine yields the same day before and after serialization.
      expect(getDbDateStr(getNextCronOccurrence(roundTripped, BASE)!)).toBe(
        getDbDateStr(getNextCronOccurrence(cfg, BASE)!),
      );
      expect(getDbDateStr(getFirstCronOccurrence(roundTripped)!)).toBe(
        getDbDateStr(getFirstCronOccurrence(cfg)!),
      );
    });
  });
});
