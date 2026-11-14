import { msLeftToday } from './ms-left-today';

describe('msLeftToday', () => {
  it('returns the milliseconds until the next local midnight', () => {
    const now = new Date(2026, 9, 26, 12, 34, 56).getTime();
    const nextLocalMidnight = new Date(2026, 9, 27).getTime();
    expect(msLeftToday(now)).toBe(nextLocalMidnight - now);
  });

  it('returns a full day at local midnight on a regular day', () => {
    const now = new Date(2026, 6, 15).getTime();
    const nextLocalMidnight = new Date(2026, 6, 16).getTime();
    expect(msLeftToday(now)).toBe(nextLocalMidnight - now);
    expect(msLeftToday(now)).toBe(24 * 60 * 60 * 1000);
  });

  it('counts remaining time across the end-of-DST 25h day', () => {
    if (new Date(2026, 9, 25).getTimezoneOffset() !== -120) {
      pending('requires the Europe/Berlin timezone');
    }
    // 2026-10-25 has 25 hours in Europe/Berlin; at local noon 12h remain
    // until the next midnight (the old startOfDay+24h formula gave 11h).
    const now = new Date(2026, 9, 25, 12, 0, 0).getTime();
    expect(msLeftToday(now)).toBe(new Date(2026, 9, 26).getTime() - now);
    expect(msLeftToday(now)).toBe(12 * 60 * 60 * 1000);
  });

  it('counts remaining time across the start-of-DST 23h day', () => {
    if (new Date(2026, 2, 29).getTimezoneOffset() !== -60) {
      pending('requires the Europe/Berlin timezone');
    }
    // 2026-03-29 has 23 hours in Europe/Berlin; at local noon 12h remain
    // until the next midnight (the old startOfDay+24h formula gave 13h).
    const now = new Date(2026, 2, 29, 12, 0, 0).getTime();
    expect(msLeftToday(now)).toBe(new Date(2026, 2, 30).getTime() - now);
    expect(msLeftToday(now)).toBe(12 * 60 * 60 * 1000);
  });
});
