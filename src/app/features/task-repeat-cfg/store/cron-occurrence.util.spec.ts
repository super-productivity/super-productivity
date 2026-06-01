import {
  getNewestPossibleCronDueDate,
  getNextCronOccurrence,
  isCronExpressionValid,
} from './cron-occurrence.util';
import { DEFAULT_TASK_REPEAT_CFG, TaskRepeatCfg } from '../task-repeat-cfg.model';
import { getDbDateStr } from '../../../util/get-db-date-str';

// All dates are constructed with local-time `new Date(y, m, d)` and compared
// via getDbDateStr, so these tests are timezone-independent (the util mixes
// local-midnight construction with local setHours, same as the rest of the
// repeat engine).

const cronCfg = (
  cronExpression: string,
  fields: Partial<TaskRepeatCfg> = {},
): TaskRepeatCfg => ({
  ...DEFAULT_TASK_REPEAT_CFG,
  id: 'CRON_TEST',
  title: 'cron test',
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

// 2022-01-10 is a Monday; 2022-01-12 a Wednesday.
const MON_JAN_10 = new Date(2022, 0, 10);
const WED_JAN_12 = new Date(2022, 0, 12);

describe('cron-occurrence.util', () => {
  describe('isCronExpressionValid()', () => {
    it('accepts standard + Quartz forms cron-parser supports', () => {
      [
        '0 0 0 * * ?',
        '0 0 9 ? * MON',
        '0 0 0 15 * ?',
        '0 0 0 L * ?',
        '0 9 * * 1',
      ].forEach((e) => expect(isCronExpressionValid(e)).withContext(e).toBe(true));
    });

    it('rejects empty/undefined/garbage and engine-unsupported Quartz', () => {
      [
        undefined,
        '',
        '   ',
        'not a cron',
        '0 0 0 ? * MON 2027', // year field
        '0 0 0 15W * ?', // nearest weekday
        '0 0 0 L-1 * ?', // n-to-last day
      ].forEach((e) => expect(isCronExpressionValid(e)).withContext(`${e}`).toBe(false));
    });
  });

  describe('getNextCronOccurrence()', () => {
    it('returns null for an invalid expression', () => {
      expect(getNextCronOccurrence(cronCfg('nope'), MON_JAN_10)).toBeNull();
      expect(getNextCronOccurrence(cronCfg('0 0 0 ? * MON 2027'), MON_JAN_10)).toBeNull();
    });

    it('daily (midnight): next day after fromDate — no off-by-one', () => {
      // cron-parser next() is exclusive of an exact-boundary currentDate, so a
      // naive midnight seed would skip Jan 11. Must match the non-cron daily
      // convention (fromDate + 1 day).
      const r = getNextCronOccurrence(cronCfg('0 0 0 * * ?'), MON_JAN_10);
      expect(getDbDateStr(r!)).toBe('2022-01-11');
    });

    it('weekly Monday: next Monday after a Wednesday', () => {
      const r = getNextCronOccurrence(cronCfg('0 0 0 ? * MON'), WED_JAN_12);
      expect(getDbDateStr(r!)).toBe('2022-01-17');
    });

    it('time-of-day does not change the resolved day (day-granular)', () => {
      const midnight = getNextCronOccurrence(cronCfg('0 0 0 ? * MON'), WED_JAN_12);
      const nineAm = getNextCronOccurrence(cronCfg('0 0 9 ? * MON'), WED_JAN_12);
      const evening = getNextCronOccurrence(cronCfg('0 30 17 ? * MON'), WED_JAN_12);
      expect(getDbDateStr(midnight!)).toBe('2022-01-17');
      expect(getDbDateStr(nineAm!)).toBe('2022-01-17');
      expect(getDbDateStr(evening!)).toBe('2022-01-17');
    });

    it('monthly day-of-month: next 15th', () => {
      const r = getNextCronOccurrence(cronCfg('0 0 0 15 * ?'), MON_JAN_10);
      expect(getDbDateStr(r!)).toBe('2022-01-15');
    });

    it('month range: first Saturday within Mar-Nov window', () => {
      // every Saturday, March through November — from January the next fire is
      // the first Saturday of March 2022 (Mar 5).
      const r = getNextCronOccurrence(cronCfg('0 0 0 ? 3-11 SAT'), MON_JAN_10);
      expect(getDbDateStr(r!)).toBe('2022-03-05');
    });

    it('respects a future startDate (first fire is the start day itself)', () => {
      const r = getNextCronOccurrence(
        cronCfg('0 0 0 * * ?', { startDate: '2022-02-01' }),
        MON_JAN_10,
      );
      // Daily from a Feb 1 start → the first occurrence is Feb 1 (matches the
      // non-cron daily convention; no off-by-one at the start boundary).
      expect(getDbDateStr(r!)).toBe('2022-02-01');
    });
  });

  describe('getNewestPossibleCronDueDate()', () => {
    it('returns null for an invalid expression', () => {
      expect(getNewestPossibleCronDueDate(cronCfg('nope'), MON_JAN_10)).toBeNull();
    });

    it('daily: fires today', () => {
      const r = getNewestPossibleCronDueDate(cronCfg('0 0 0 * * ?'), MON_JAN_10);
      expect(getDbDateStr(r!)).toBe('2022-01-10');
    });

    it('sub-daily (every minute): resolves to today', () => {
      const r = getNewestPossibleCronDueDate(cronCfg('0 * * * * ?'), MON_JAN_10);
      expect(getDbDateStr(r!)).toBe('2022-01-10');
    });

    it('weekly Monday: most recent Monday on/before today', () => {
      const r = getNewestPossibleCronDueDate(cronCfg('0 0 0 ? * MON'), WED_JAN_12);
      expect(getDbDateStr(r!)).toBe('2022-01-10');
    });

    it('time-of-day is ignored for the due day', () => {
      const r = getNewestPossibleCronDueDate(cronCfg('0 30 17 ? * MON'), WED_JAN_12);
      expect(getDbDateStr(r!)).toBe('2022-01-10');
    });

    it('returns null when the only fire was already created (lastTaskCreationDay)', () => {
      const r = getNewestPossibleCronDueDate(
        cronCfg('0 0 0 ? * MON', { lastTaskCreationDay: '2022-01-10' }),
        WED_JAN_12,
      );
      expect(r).toBeNull();
    });

    it('returns null when startDate is in the future', () => {
      const r = getNewestPossibleCronDueDate(
        cronCfg('0 0 0 * * ?', { startDate: '2022-01-20' }),
        MON_JAN_10,
      );
      expect(r).toBeNull();
    });

    it('does not return a fire earlier than startDate', () => {
      // Weekly Monday, start mid-week (Tue Jan 11): the Jan 10 Monday predates
      // startDate, and the next Monday (Jan 17) is after today → null today.
      const r = getNewestPossibleCronDueDate(
        cronCfg('0 0 0 ? * MON', { startDate: '2022-01-11' }),
        WED_JAN_12,
      );
      expect(r).toBeNull();
    });
  });
});
