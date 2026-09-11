import { anchorContextNow } from './anchor-context-now';

describe('anchorContextNow', () => {
  const dayStr = '2026-01-20';
  const dayStart = new Date(2026, 0, 20, 0, 0, 0, 0).getTime();

  it('returns the live clock when it sits inside the day', () => {
    const clock = new Date(2026, 0, 20, 14, 30).getTime();

    expect(anchorContextNow(dayStr, clock)).toBe(clock);
  });

  it('returns the day start when the clock is already past the day', () => {
    const clock = new Date(2026, 0, 21, 2, 15).getTime();

    expect(anchorContextNow(dayStr, clock)).toBe(dayStart);
  });

  it('returns the day start when the clock is still before the day', () => {
    const clock = new Date(2026, 0, 19, 23, 45).getTime();

    expect(anchorContextNow(dayStr, clock)).toBe(dayStart);
  });

  it('keeps the first and last instants of the day', () => {
    const lastMs = new Date(2026, 0, 20, 23, 59, 59, 999).getTime();

    expect(anchorContextNow(dayStr, dayStart)).toBe(dayStart);
    expect(anchorContextNow(dayStr, lastMs)).toBe(lastMs);
  });

  it('anchors a wall clock past a logical day end back into that day', () => {
    // The day panel case: logical today is still 2026-01-20 while the wall
    // clock has passed midnight into the 21st, before a 04:00 start of next
    // day. Without the clamp the mapper is handed a now beyond day 0's end.
    const clock = new Date(2026, 0, 21, 3, 0).getTime();

    expect(anchorContextNow(dayStr, clock)).toBe(dayStart);
  });
});
