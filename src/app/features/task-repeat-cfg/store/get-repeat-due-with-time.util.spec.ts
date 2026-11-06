import { getRepeatDueWithTime } from './get-repeat-due-with-time.util';
import { getDateTimeFromClockString } from '../../../util/get-date-time-from-clock-string';
import { getDbDateStr } from '../../../util/get-db-date-str';

const H = 60 * 60 * 1000;

describe('getRepeatDueWithTime', () => {
  // noon of the logical day, as passed by TaskRepeatCfgService
  const logicalDay = new Date(2026, 5, 10, 12, 0, 0, 0);

  const expectLocal = (ts: number, [y, mo, d, h, mi]: number[]): void => {
    const dt = new Date(ts);
    expect([
      dt.getFullYear(),
      dt.getMonth(),
      dt.getDate(),
      dt.getHours(),
      dt.getMinutes(),
    ]).toEqual([y, mo, d, h, mi]);
  };

  it('matches getDateTimeFromClockString when the offset is 0', () => {
    for (const time of ['0:00', '02:00', '06:00', '23:59']) {
      expect(getRepeatDueWithTime(time, logicalDay, 0)).toBe(
        getDateTimeFromClockString(time, logicalDay),
      );
    }
  });

  it('rolls a time before the offset to the next calendar day (#3378)', () => {
    expectLocal(getRepeatDueWithTime('02:00', logicalDay, 5 * H), [2026, 5, 11, 2, 0]);
  });

  it('keeps a time after the offset on the logical day', () => {
    expectLocal(getRepeatDueWithTime('06:00', logicalDay, 5 * H), [2026, 5, 10, 6, 0]);
  });

  it('keeps a time exactly at the offset on the logical day', () => {
    expectLocal(getRepeatDueWithTime('05:00', logicalDay, 5 * H), [2026, 5, 10, 5, 0]);
  });

  it('respects minutes in the offset', () => {
    const offset = 4.5 * H;
    expectLocal(getRepeatDueWithTime('04:29', logicalDay, offset), [2026, 5, 11, 4, 29]);
    expectLocal(getRepeatDueWithTime('04:30', logicalDay, offset), [2026, 5, 10, 4, 30]);
  });

  it('accepts a midnight timestamp as the logical day', () => {
    const midnight = new Date(2026, 5, 10).getTime();
    expectLocal(getRepeatDueWithTime('02:00', midnight, 5 * H), [2026, 5, 11, 2, 0]);
  });

  // Berlin switches on 2026-03-29 / 2026-10-25, LA on 2026-03-08 / 2026-11-01;
  // each date below is the logical day before one of those nights.
  [
    new Date(2026, 2, 7, 12),
    new Date(2026, 2, 28, 12),
    new Date(2026, 9, 24, 12),
    new Date(2026, 9, 31, 12),
  ].forEach((dstEve) => {
    it(`stays inside logical ${getDbDateStr(dstEve)} across a DST night`, () => {
      const ts = getRepeatDueWithTime('02:00', dstEve, 5 * H);
      const next = new Date(dstEve);
      next.setDate(next.getDate() + 1);
      expect(getDbDateStr(ts)).toBe(getDbDateStr(next));
      const offset = 5 * H;
      expect(getDbDateStr(ts - offset)).toBe(getDbDateStr(dstEve));
    });
  });

  it('throws for an invalid clock string like getDateTimeFromClockString', () => {
    expect(() => getRepeatDueWithTime('nope', logicalDay, 5 * H)).toThrowError();
  });
});
