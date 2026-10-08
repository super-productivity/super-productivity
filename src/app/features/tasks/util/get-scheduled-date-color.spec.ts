import { getScheduledDateColor, ScheduledDateColor } from './get-scheduled-date-color';

describe('getScheduledDateColor', () => {
  const today = '2026-10-03';
  const now = new Date(2026, 9, 3, 12).getTime();
  const color = (dueDay: string): ScheduledDateColor =>
    getScheduledDateColor({ dueDay, isDone: false }, today, 0, now);

  it('classifies every range boundary without altering task data', () => {
    expect(color('2026-10-02')).toBe('overdue');
    expect(color(today)).toBe('today');
    expect(color('2026-10-04')).toBe('tomorrow');
    expect(color('2026-10-05')).toBe('upcoming');
    expect(color('2026-10-11')).toBe('upcoming');
    expect(color('2026-10-12')).toBe('');
  });

  it('keeps completed, unscheduled and invalid dates at their default color', () => {
    expect(getScheduledDateColor({ dueDay: today, isDone: true }, today, 0, now)).toBe(
      '',
    );
    expect(getScheduledDateColor({ isDone: false }, today, 0, now)).toBe('');
    expect(color('invalid')).toBe('');
    expect(color('2026-02-30')).toBe('');
  });

  it('turns red at the scheduled time without waiting for a day change', () => {
    const task = { isDone: false, dueWithTime: now };
    expect(getScheduledDateColor(task, today, 0, now - 1)).toBe('today');
    expect(getScheduledDateColor(task, today, 0, now)).toBe('overdue');
    expect(getScheduledDateColor(task, today, 0, now + 1)).toBe('overdue');
  });

  it('uses the configured logical day for timestamps and prefers time over dueDay', () => {
    const earlyTomorrow = new Date(2026, 9, 4, 2).getTime();
    const task = { isDone: false, dueDay: '2026-10-12', dueWithTime: earlyTomorrow };
    expect(getScheduledDateColor(task, today, 4 * 60 * 60 * 1000, now)).toBe('today');
    expect(getScheduledDateColor(task, today, 0, now)).toBe('tomorrow');
  });

  it('counts calendar days across DST, year and month boundaries', () => {
    for (const [start, next] of [
      ['2026-03-28', '2026-03-29'],
      ['2026-10-24', '2026-10-25'],
      ['2026-12-31', '2027-01-01'],
    ]) {
      expect(getScheduledDateColor({ dueDay: next, isDone: false }, start, 0, now)).toBe(
        'tomorrow',
      );
    }
  });
});
