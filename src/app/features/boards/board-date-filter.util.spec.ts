import {
  adjustDateToBoardTimeframe,
  matchesBoardDateTimeframe,
  resolveBoardDateTimeframeRange,
  sanitizeBoardDateTimeframeCfg,
} from './board-date-filter.util';
import { BoardDateTimeframeCfg } from './boards.model';

describe('board date timeframe filtering', () => {
  const todayStr = '2026-03-18';
  const startOfNextDayDiffMs = 0;

  const matches = (
    timeframe: BoardDateTimeframeCfg,
    value: { day?: string | null; timestamp?: number | null },
  ): boolean =>
    matchesBoardDateTimeframe({
      timeframe,
      dateOnly: value.day,
      timestamp: value.timestamp,
      todayStr,
      startOfNextDayDiffMs,
    });

  it('matches today for date-only and timestamp values', () => {
    expect(matches({ type: 'today' }, { day: todayStr })).toBeTrue();
    expect(
      matches({ type: 'today' }, { timestamp: new Date(2026, 2, 18, 14, 30).getTime() }),
    ).toBeTrue();
    expect(matches({ type: 'today' }, { day: '2026-03-19' })).toBeFalse();
  });

  it('matches tomorrow for date-only and timestamp values', () => {
    expect(matches({ type: 'tomorrow' }, { day: '2026-03-19' })).toBeTrue();
    expect(
      matches({ type: 'tomorrow' }, { timestamp: new Date(2026, 2, 19, 8, 0).getTime() }),
    ).toBeTrue();
    expect(matches({ type: 'tomorrow' }, { day: todayStr })).toBeFalse();
  });

  it('matches next 7 days from today through today plus 6 days', () => {
    expect(matches({ type: 'next7Days' }, { day: '2026-03-18' })).toBeTrue();
    expect(matches({ type: 'next7Days' }, { day: '2026-03-24' })).toBeTrue();
    expect(matches({ type: 'next7Days' }, { day: '2026-03-25' })).toBeFalse();
  });

  it('matches all timeframe for any task with a date value', () => {
    expect(matches({ type: 'all' }, { day: '2026-03-18' })).toBeTrue();
    expect(matches({ type: 'all' }, { day: '2028-01-01' })).toBeTrue();
    expect(matches({ type: 'all' }, {})).toBeFalse();
  });

  it('matches next N days from today through today plus N minus 1 days', () => {
    expect(matches({ type: 'nextNDays', days: 3 }, { day: '2026-03-18' })).toBeTrue();
    expect(matches({ type: 'nextNDays', days: 3 }, { day: '2026-03-20' })).toBeTrue();
    expect(matches({ type: 'nextNDays', days: 3 }, { day: '2026-03-21' })).toBeFalse();
  });

  it('matches tasks at least N days in the future', () => {
    expect(
      matches({ type: 'atLeastNDaysFuture', days: 3 }, { day: '2026-03-20' }),
    ).toBeFalse();
    expect(
      matches({ type: 'atLeastNDaysFuture', days: 3 }, { day: '2026-03-21' }),
    ).toBeTrue();
    expect(
      matches({ type: 'atLeastNDaysFuture', days: 3 }, { day: '2027-01-01' }),
    ).toBeTrue();
  });

  it('resolves next week as the next ISO calendar week', () => {
    expect(
      resolveBoardDateTimeframeRange({
        timeframe: { type: 'nextWeek' },
        todayStr,
      }),
    ).toEqual({ start: '2026-03-23', end: '2026-03-29' });
  });

  it('resolves next month as the next calendar month', () => {
    expect(
      resolveBoardDateTimeframeRange({
        timeframe: { type: 'nextMonth' },
        todayStr,
      }),
    ).toEqual({ start: '2026-04-01', end: '2026-04-30' });
  });

  it('matches custom date and custom range values', () => {
    expect(
      matches({ type: 'customDate', customDate: '2026-04-02' }, { day: '2026-04-02' }),
    ).toBeTrue();
    expect(
      matches(
        { type: 'customRange', customStart: '2026-04-02', customEnd: '2026-04-05' },
        { day: '2026-04-05' },
      ),
    ).toBeTrue();
    expect(
      matches(
        { type: 'customRange', customStart: '2026-04-02', customEnd: '2026-04-05' },
        { day: '2026-04-06' },
      ),
    ).toBeFalse();
  });

  it('matches half-bounded custom range values', () => {
    expect(
      matches({ type: 'customRange', customStart: '2026-04-02' }, { day: '2026-04-01' }),
    ).toBeFalse();
    expect(
      matches({ type: 'customRange', customStart: '2026-04-02' }, { day: '2026-04-02' }),
    ).toBeTrue();
    expect(
      matches({ type: 'customRange', customEnd: '2026-04-05' }, { day: '2026-04-05' }),
    ).toBeTrue();
    expect(
      matches({ type: 'customRange', customEnd: '2026-04-05' }, { day: '2026-04-06' }),
    ).toBeFalse();
  });

  it('does not resolve invalid custom date and custom range values', () => {
    expect(
      resolveBoardDateTimeframeRange({
        timeframe: { type: 'customDate', customDate: '2026-02-31' },
        todayStr,
      }),
    ).toBeNull();
    expect(
      resolveBoardDateTimeframeRange({
        timeframe: {
          type: 'customRange',
          customStart: '2026-04-05',
          customEnd: '2026-04-02',
        },
        todayStr,
      }),
    ).toBeNull();
    expect(
      resolveBoardDateTimeframeRange({
        timeframe: { type: 'customRange' },
        todayStr,
      }),
    ).toBeNull();
    expect(
      resolveBoardDateTimeframeRange({
        timeframe: { type: 'nextNDays', days: 0 },
        todayStr,
      }),
    ).toBeNull();
  });

  it('sanitizes valid custom range timeframe values', () => {
    expect(
      sanitizeBoardDateTimeframeCfg({
        type: 'customRange',
        customStart: '2026-04-01',
      }),
    ).toEqual({
      type: 'customRange',
      customStart: '2026-04-01',
    });
    expect(
      sanitizeBoardDateTimeframeCfg({
        type: 'customRange',
        customEnd: '2026-04-30',
      }),
    ).toEqual({
      type: 'customRange',
      customEnd: '2026-04-30',
    });
    expect(
      sanitizeBoardDateTimeframeCfg({
        type: 'customRange',
        customStart: '2026-04-01',
        customEnd: '2026-04-30',
      }),
    ).toEqual({
      type: 'customRange',
      customStart: '2026-04-01',
      customEnd: '2026-04-30',
    });
  });

  it('drops invalid custom range timeframe values', () => {
    expect(
      sanitizeBoardDateTimeframeCfg({
        type: 'customRange',
        customStart: '2026-02-31',
      }),
    ).toBeUndefined();
    expect(
      sanitizeBoardDateTimeframeCfg({
        type: 'customRange',
      }),
    ).toBeUndefined();
    expect(
      sanitizeBoardDateTimeframeCfg({
        type: 'customRange',
        customStart: '2026-04-30',
        customEnd: '2026-04-01',
      }),
    ).toBeUndefined();
  });

  it('adjusts dates to the nearest valid timeframe date', () => {
    expect(
      adjustDateToBoardTimeframe({
        timeframe: { type: 'nextNDays', days: 3 },
        currentDate: '2026-03-17',
        todayStr,
      }),
    ).toBe('2026-03-18');
    expect(
      adjustDateToBoardTimeframe({
        timeframe: { type: 'nextNDays', days: 3 },
        currentDate: '2026-03-19',
        todayStr,
      }),
    ).toBe('2026-03-19');
    expect(
      adjustDateToBoardTimeframe({
        timeframe: { type: 'nextNDays', days: 3 },
        currentDate: '2026-03-25',
        todayStr,
      }),
    ).toBe('2026-03-20');
  });

  it('uses today as the auto-adjust source date when the task has no date yet', () => {
    expect(
      adjustDateToBoardTimeframe({
        timeframe: { type: 'atLeastNDaysFuture', days: 3 },
        currentDate: null,
        todayStr,
      }),
    ).toBe('2026-03-21');
  });

  it('uses the logical-day offset for timestamp values', () => {
    expect(
      matchesBoardDateTimeframe({
        timeframe: { type: 'today' },
        timestamp: new Date(2026, 2, 19, 2, 30).getTime(),
        todayStr,
        startOfNextDayDiffMs: 4 * 60 * 60 * 1000,
      }),
    ).toBeTrue();
  });

  it('does not match tasks without a date value', () => {
    expect(matches({ type: 'today' }, {})).toBeFalse();
  });

  it('lets timestamp values take precedence over stale date-only values', () => {
    expect(
      matches(
        { type: 'today' },
        { day: todayStr, timestamp: new Date(2026, 2, 19).getTime() },
      ),
    ).toBeFalse();
  });
});
