import { getWeekRange } from './get-week-range';

describe('getWeekRange', () => {
  it('returns correct range for a date in the middle of the week', () => {
    const inputDate = new Date('2025-11-26'); // Wednesday
    const startOfWeekDay = 0; // Sunday
    const expectedStart = new Date('2025-11-23T00:00:00.000'); // Start of the week (Sunday)
    const expectedEnd = new Date('2025-11-29T23:59:59.999'); // End of the week (Saturday)

    const result = getWeekRange(inputDate, startOfWeekDay);

    expect(result.start).toEqual(expectedStart);
    expect(result.end).toEqual(expectedEnd);
  });

  it('handles week starting on Monday', () => {
    const inputDate = new Date('2025-11-26'); // Wednesday
    const startOfWeekDay = 1; // Monday
    const expectedStart = new Date('2025-11-24T00:00:00.000'); // Start of week (Monday)
    const expectedEnd = new Date('2025-11-30T23:59:59.999'); // End of week (Sunday)

    const result = getWeekRange(inputDate, startOfWeekDay);

    expect(result.start).toEqual(expectedStart);
    expect(result.end).toEqual(expectedEnd);
  });

  it('correctly calculates the range for a Sunday input', () => {
    const inputDate = new Date('2025-11-30'); // Sunday
    const startOfWeekDay = 0; // Sunday
    const expectedStart = new Date('2025-11-30T00:00:00.000'); // Start of week (Sunday)
    const expectedEnd = new Date('2025-12-06T23:59:59.999'); // End of week (Saturday)

    const result = getWeekRange(inputDate, startOfWeekDay);

    expect(result.start).toEqual(expectedStart);
    expect(result.end).toEqual(expectedEnd);
  });

  it('correctly handles startOfWeekDay greater than current day', () => {
    const inputDate = new Date('2025-11-30'); // Sunday
    const startOfWeekDay = 3; // Wednesday
    const expectedStart = new Date('2025-11-26T00:00:00.000'); // Start of week (Wednesday)
    const expectedEnd = new Date('2025-12-02T23:59:59.999'); // End of week (Tuesday)

    const result = getWeekRange(inputDate, startOfWeekDay);

    expect(result.start).toEqual(expectedStart);
    expect(result.end).toEqual(expectedEnd);
  });

  it('start and end date are the same when date is the first day of week', () => {
    const inputDate = new Date('2025-11-30'); // Sunday
    const startOfWeekDay = 0; // Sunday
    const expectedStart = new Date('2025-11-30T00:00:00.000');
    const expectedEnd = new Date('2025-12-06T23:59:59.999'); // End of the week (Saturday)

    const result = getWeekRange(inputDate, startOfWeekDay);

    expect(result.start).toEqual(expectedStart);
    expect(result.end).toEqual(expectedEnd);
  });
});
