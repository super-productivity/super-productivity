import {
  BOARD_TIMEFRAME_MAX_DAYS,
  adjustDateToBoardTimeframe,
  matchesBoardDateTimeframe,
  resolveBoardDateTimeframeRange,
  sanitizeBoardDateTimeframeCfg,
} from './board-date-filter.util';
import { BoardDateTimeframeCfg } from './boards.model';

describe('board date timeframe filtering', () => {
  const todayStr = '2026-03-18';
  const startOfNextDayDiffMs = 0;
  const firstDayOfWeek = 1;

  const matches = (
    timeframe: BoardDateTimeframeCfg,
    value: { day?: string | null; timestamp?: number | null },
  ): boolean =>
    matchesBoardDateTimeframe({
      timeframe,
      dateOnly: value.day,
      timestamp: value.timestamp,
      todayStr,
      firstDayOfWeek,
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

  it('resolves next week from the first day of week', () => {
    const nextWeek = (today: string, firstDay: number): unknown =>
      resolveBoardDateTimeframeRange({
        timeframe: { type: 'nextWeek' },
        todayStr: today,
        firstDayOfWeek: firstDay,
      });
    // 2026-03-18 is a Wednesday.
    expect(nextWeek(todayStr, 1)).toEqual({ start: '2026-03-23', end: '2026-03-29' });
    expect(nextWeek(todayStr, 0)).toEqual({ start: '2026-03-22', end: '2026-03-28' });
    expect(nextWeek(todayStr, 6)).toEqual({ start: '2026-03-21', end: '2026-03-27' });
    // On the first day of the week itself, next week starts 7 days later.
    expect(nextWeek('2026-03-23', 1)).toEqual({ start: '2026-03-30', end: '2026-04-05' });
    expect(nextWeek('2026-03-22', 0)).toEqual({ start: '2026-03-29', end: '2026-04-04' });
    // Across a year boundary.
    expect(nextWeek('2026-12-30', 1)).toEqual({ start: '2027-01-04', end: '2027-01-10' });
  });

  it('resolves next month across a year boundary', () => {
    expect(
      resolveBoardDateTimeframeRange({
        timeframe: { type: 'nextMonth' },
        todayStr: '2026-12-15',
        firstDayOfWeek,
      }),
    ).toEqual({ start: '2027-01-01', end: '2027-01-31' });
  });

  it('rejects day counts above the cap instead of producing invalid dates', () => {
    for (const type of ['nextNDays', 'atLeastNDaysFuture'] as const) {
      expect(
        resolveBoardDateTimeframeRange({
          timeframe: { type, days: BOARD_TIMEFRAME_MAX_DAYS + 1 },
          todayStr,
          firstDayOfWeek,
        }),
      )
        .withContext(type)
        .toBeNull();
      expect(sanitizeBoardDateTimeframeCfg({ type, days: 1e9 }))
        .withContext(type)
        .toBeUndefined();
      expect(
        adjustDateToBoardTimeframe({
          timeframe: { type, days: 1e9 },
          currentDate: todayStr,
          todayStr,
          firstDayOfWeek,
        }),
      )
        .withContext(type)
        .toBeNull();
    }
    expect(
      sanitizeBoardDateTimeframeCfg({
        type: 'atLeastNDaysFuture',
        days: BOARD_TIMEFRAME_MAX_DAYS,
      }),
    ).toEqual({ type: 'atLeastNDaysFuture', days: BOARD_TIMEFRAME_MAX_DAYS });
  });

  it('resolves next month as the next calendar month', () => {
    expect(
      resolveBoardDateTimeframeRange({
        timeframe: { type: 'nextMonth' },
        todayStr,
        firstDayOfWeek,
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
        firstDayOfWeek,
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
        firstDayOfWeek,
      }),
    ).toBeNull();
    expect(
      resolveBoardDateTimeframeRange({
        timeframe: { type: 'customRange' },
        todayStr,
        firstDayOfWeek,
      }),
    ).toBeNull();
    expect(
      resolveBoardDateTimeframeRange({
        timeframe: { type: 'nextNDays', days: 0 },
        todayStr,
        firstDayOfWeek,
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
        firstDayOfWeek,
      }),
    ).toBe('2026-03-18');
    expect(
      adjustDateToBoardTimeframe({
        timeframe: { type: 'nextNDays', days: 3 },
        currentDate: '2026-03-19',
        todayStr,
        firstDayOfWeek,
      }),
    ).toBe('2026-03-19');
    expect(
      adjustDateToBoardTimeframe({
        timeframe: { type: 'nextNDays', days: 3 },
        currentDate: '2026-03-25',
        todayStr,
        firstDayOfWeek,
      }),
    ).toBe('2026-03-20');
  });

  it('uses today as the auto-adjust source date when the task has no date yet', () => {
    expect(
      adjustDateToBoardTimeframe({
        timeframe: { type: 'atLeastNDaysFuture', days: 3 },
        currentDate: null,
        todayStr,
        firstDayOfWeek,
      }),
    ).toBe('2026-03-21');
  });

  it('uses the logical-day offset for timestamp values', () => {
    expect(
      matchesBoardDateTimeframe({
        timeframe: { type: 'today' },
        timestamp: new Date(2026, 2, 19, 2, 30).getTime(),
        todayStr,
        firstDayOfWeek,
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
