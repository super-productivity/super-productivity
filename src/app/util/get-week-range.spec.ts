import { getWeekRange } from './get-week-range';

describe('getWeekRange', () => {
  it('returns correct range for a date in the middle of the week', () => {
    const inputDate = new Date(2025, 10, 26); // Wednesday
    const startOfWeekDay = 0; // Sunday
    const expectedStart = new Date(2025, 10, 23, 0, 0, 0, 0); // Start of the week (Sunday)
    const expectedEnd = new Date(2025, 10, 29, 23, 59, 59, 999); // End of the week (Saturday)

    const result = getWeekRange(inputDate, startOfWeekDay);

    expect(result.start).toEqual(expectedStart);
    expect(result.end).toEqual(expectedEnd);
  });

  it('handles week starting on Monday', () => {
    const inputDate = new Date(2025, 10, 26); // Wednesday
    const startOfWeekDay = 1; // Monday
    const expectedStart = new Date(2025, 10, 24, 0, 0, 0, 0); // Start of week (Monday)
    const expectedEnd = new Date(2025, 10, 30, 23, 59, 59, 999); // End of week (Sunday)

    const result = getWeekRange(inputDate, startOfWeekDay);

    expect(result.start).toEqual(expectedStart);
    expect(result.end).toEqual(expectedEnd);
  });

  it('correctly calculates the range for a Sunday input', () => {
    const inputDate = new Date(2025, 10, 30); // Sunday
    const startOfWeekDay = 0; // Sunday
    const expectedStart = new Date(2025, 10, 30, 0, 0, 0, 0); // Start of week (Sunday)
    const expectedEnd = new Date(2025, 11, 6, 23, 59, 59, 999); // End of week (Saturday)

    const result = getWeekRange(inputDate, startOfWeekDay);

    expect(result.start).toEqual(expectedStart);
    expect(result.end).toEqual(expectedEnd);
  });

  it('correctly handles startOfWeekDay greater than current day', () => {
    const inputDate = new Date(2025, 10, 30); // Sunday
    const startOfWeekDay = 3; // Wednesday
    const expectedStart = new Date(2025, 10, 26, 0, 0, 0, 0); // Start of week (Wednesday)
    const expectedEnd = new Date(2025, 11, 2, 23, 59, 59, 999); // End of week (Tuesday)

    const result = getWeekRange(inputDate, startOfWeekDay);

    expect(result.start).toEqual(expectedStart);
    expect(result.end).toEqual(expectedEnd);
  });

  it('start and end date are the same when date is the first day of week', () => {
    const inputDate = new Date(2025, 10, 30); // Sunday
    const startOfWeekDay = 0; // Sunday
    const expectedStart = new Date(2025, 10, 30, 0, 0, 0, 0);
    const expectedEnd = new Date(2025, 11, 6, 23, 59, 59, 999); // End of the week (Saturday)

    const result = getWeekRange(inputDate, startOfWeekDay);

    expect(result.start).toEqual(expectedStart);
    expect(result.end).toEqual(expectedEnd);
  });

  it('keeps a local Monday midnight in its own week when weeks start on Monday', () => {
    const inputDate = new Date(2026, 9, 26); // Monday 00:00 local
    const expectedStart = new Date(2026, 9, 26, 0, 0, 0, 0);
    const expectedEnd = new Date(2026, 10, 1, 23, 59, 59, 999);

    const result = getWeekRange(inputDate, 1);

    expect(result.start).toEqual(expectedStart);
    expect(result.end).toEqual(expectedEnd);
  });

  it('maps Sunday 20:00 local to the week started the previous Monday', () => {
    const inputDate = new Date(2025, 10, 30, 20, 0, 0); // Sunday evening local
    const expectedStart = new Date(2025, 10, 24, 0, 0, 0, 0); // Previous Monday
    const expectedEnd = new Date(2025, 10, 30, 23, 59, 59, 999);

    const result = getWeekRange(inputDate, 1);

    expect(result.start).toEqual(expectedStart);
    expect(result.end).toEqual(expectedEnd);
  });

  it('keeps a late-night Saturday in the week that started the previous Sunday', () => {
    const inputDate = new Date(2025, 10, 29, 23, 30, 0); // Saturday 23:30 local
    const expectedStart = new Date(2025, 10, 23, 0, 0, 0, 0); // Sunday
    const expectedEnd = new Date(2025, 10, 29, 23, 59, 59, 999); // Same Saturday

    const result = getWeekRange(inputDate, 0);

    expect(result.start).toEqual(expectedStart);
    expect(result.end).toEqual(expectedEnd);
  });
});
