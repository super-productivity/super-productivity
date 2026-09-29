import { loadIcalModule } from '../../../schedule/ical/ical-lazy-loader';
import {
  applyIcalDate,
  IcalApiLike,
  IcalComponentLike,
  toCaldavDateValue,
  truncateToSeconds,
} from './caldav-ical-date.util';

const BERLIN_VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Berlin',
  'BEGIN:STANDARD',
  'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'END:STANDARD',
  'BEGIN:DAYLIGHT',
  'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'END:DAYLIGHT',
  'END:VTIMEZONE',
];

const parse = async (
  todoLines: string[],
  withVtimezone = false,
): Promise<{ ical: IcalApiLike; vcal: IcalComponentLike; todo: IcalComponentLike }> => {
  const ical = await loadIcalModule();
  const vcal = new ical.Component(
    ical.parse(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Test//EN',
        ...(withVtimezone ? BERLIN_VTIMEZONE : []),
        'BEGIN:VTODO',
        'UID:u1',
        ...todoLines,
        'END:VTODO',
        'END:VCALENDAR',
      ].join('\r\n'),
    ),
  );
  return { ical, vcal, todo: vcal.getFirstSubcomponent('vtodo') };
};

const dateLines = (todo: IcalComponentLike): string[] =>
  todo
    .toString()
    .split('\r\n')
    .filter((l) => /^(DTSTART|DUE|DURATION)/.test(l));

const NOON_UTC = Date.UTC(2026, 8, 25, 12, 0, 0);

describe('caldav-ical-date.util', () => {
  describe('toCaldavDateValue', () => {
    it('returns null when absent', () => {
      expect(toCaldavDateValue(undefined, undefined)).toBeNull();
    });
    it('maps an all-day local-midnight timestamp to its date string', () => {
      expect(toCaldavDateValue(new Date(2026, 8, 25).getTime(), true)).toBe('2026-09-25');
    });
    it('truncates a timed value to seconds', () => {
      expect(toCaldavDateValue(NOON_UTC + 789, false)).toBe(NOON_UTC);
      expect(truncateToSeconds(NOON_UTC + 999)).toBe(NOON_UTC);
    });
  });

  describe('applyIcalDate', () => {
    it('writes an all-day value as VALUE=DATE and drops a stale TZID', async () => {
      const { ical, vcal, todo } = await parse(
        ['DTSTART;TZID=Europe/Berlin:20260110T090000'],
        true,
      );
      expect(applyIcalDate(ical, vcal, todo, 'dtstart', '2026-09-25')).toBeTrue();
      expect(dateLines(todo)).toEqual(['DTSTART;VALUE=DATE:20260925']);
    });

    it('writes a timed value as UTC when there is no TZID', async () => {
      const { ical, vcal, todo } = await parse(['DUE;VALUE=DATE:20260930']);
      expect(applyIcalDate(ical, vcal, todo, 'due', NOON_UTC)).toBeTrue();
      expect(dateLines(todo)).toEqual(['DUE:20260925T120000Z']);
    });

    it('keeps an existing TZID when its VTIMEZONE is present', async () => {
      const { ical, vcal, todo } = await parse(
        ['DTSTART;TZID=Europe/Berlin:20260110T090000'],
        true,
      );
      applyIcalDate(ical, vcal, todo, 'dtstart', NOON_UTC);
      expect(dateLines(todo)).toEqual(['DTSTART;TZID=Europe/Berlin:20260925T140000']);
    });

    it('rewrites a TZID without its VTIMEZONE as UTC', async () => {
      const { ical, vcal, todo } = await parse([
        'DTSTART;TZID=Europe/Berlin:20260110T090000',
      ]);
      applyIcalDate(ical, vcal, todo, 'dtstart', NOON_UTC);
      expect(dateLines(todo)).toEqual(['DTSTART:20260925T120000Z']);
    });

    it('returns false and leaves the VTODO alone when the value is unchanged', async () => {
      const { ical, vcal, todo } = await parse(['DUE;VALUE=DATE:20260930']);
      const before = todo.toString();
      expect(applyIcalDate(ical, vcal, todo, 'due', '2026-09-30')).toBeFalse();
      expect(todo.toString()).toBe(before);
    });

    it('removes the property on null, and reports no change when already absent', async () => {
      const { ical, vcal, todo } = await parse(['DUE:20260925T120000Z']);
      expect(applyIcalDate(ical, vcal, todo, 'due', null)).toBeTrue();
      expect(dateLines(todo)).toEqual([]);
      expect(applyIcalDate(ical, vcal, todo, 'due', null)).toBeFalse();
    });

    it('drops DURATION when writing DUE (RFC 5545: DUE and DURATION are exclusive)', async () => {
      const { ical, vcal, todo } = await parse([
        'DTSTART;VALUE=DATE:20260925',
        'DURATION:P2D',
      ]);
      applyIcalDate(ical, vcal, todo, 'due', '2026-09-30');
      expect(dateLines(todo)).toEqual([
        'DTSTART;VALUE=DATE:20260925',
        'DUE;VALUE=DATE:20260930',
      ]);
    });

    it('drops DURATION when removing DTSTART (DURATION requires DTSTART)', async () => {
      const { ical, vcal, todo } = await parse([
        'DTSTART;VALUE=DATE:20260925',
        'DURATION:P2D',
      ]);
      applyIcalDate(ical, vcal, todo, 'dtstart', null);
      expect(dateLines(todo)).toEqual([]);
    });
  });
});
