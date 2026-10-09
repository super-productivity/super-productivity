import { getScheduledDateColor, ScheduledDateColor } from './get-scheduled-date-color';

describe('getScheduledDateColor', () => {
  const today = '2026-10-03';
  const now = new Date(2026, 9, 3, 12).getTime();
  const color = (dueDay: string): ScheduledDateColor =>
    getScheduledDateColor({ dueDay, isDone: false }, today, 0, now);

  it('colors only overdue dates', () => {
    expect(color('2026-10-02')).toBe('overdue');
    expect(color(today)).toBe('');
    expect(color('2026-10-04')).toBe('');
    expect(color('2026-10-12')).toBe('');
  });

  it('keeps completed, unscheduled and invalid dates at their default color', () => {
    expect(
      getScheduledDateColor({ dueDay: '2026-10-02', isDone: true }, today, 0, now),
    ).toBe('');
    expect(getScheduledDateColor({ isDone: false }, today, 0, now)).toBe('');
    expect(color('invalid')).toBe('');
    expect(color('2026-02-30')).toBe('');
  });

  it('turns red at the scheduled time without waiting for a day change', () => {
    const task = { isDone: false, dueWithTime: now };
    expect(getScheduledDateColor(task, today, 0, now - 1)).toBe('');
    expect(getScheduledDateColor(task, today, 0, now)).toBe('overdue');
    expect(getScheduledDateColor(task, today, 0, now + 1)).toBe('overdue');
  });

  it('uses the configured logical day for timestamps and prefers time over dueDay', () => {
    // 01:00 on Oct 3 belongs to Oct 2 when the day starts at 04:00.
    const earlyToday = new Date(2026, 9, 3, 1).getTime();
    const task = { isDone: false, dueDay: '2026-10-12', dueWithTime: earlyToday };
    const startOfNextDayDiffMs = 4 * 60 * 60 * 1000;
    expect(getScheduledDateColor(task, today, startOfNextDayDiffMs, 0)).toBe('overdue');
    expect(getScheduledDateColor(task, today, 0, 0)).toBe('');
  });
});
