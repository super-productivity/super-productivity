import {
  matchesBoardDateTimeframe,
  resolveBoardDateTimeframeRange,
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
