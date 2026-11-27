import { combineDateAndTime } from './combine-date-and-time';

describe('combineDateAndTime', () => {
  const FOUR_HOURS = 4 * 60 * 60 * 1000;

  it('puts the time on the given day without a day-start offset', () => {
    const result = combineDateAndTime(
      new Date(2026, 10, 28),
      new Date(2025, 0, 1, 2, 30),
      0,
    );
    expect(result).toEqual(new Date(2026, 10, 28, 2, 30, 0));
  });

  it('keeps a time after the day start on the given day', () => {
    const result = combineDateAndTime(
      new Date(2026, 10, 28),
      new Date(2025, 0, 1, 9, 15),
      FOUR_HOURS,
    );
    expect(result).toEqual(new Date(2026, 10, 28, 9, 15, 0));
  });

  // #12012: with the day starting at 04:00, 02:30 of Nov 28 lies on Nov 29
  it('moves a time before the day start to the next calendar date', () => {
    const result = combineDateAndTime(
      new Date(2026, 10, 28),
      new Date(2025, 0, 1, 2, 30),
      FOUR_HOURS,
    );
    expect(result).toEqual(new Date(2026, 10, 29, 2, 30, 0));
  });

  it('treats a time exactly at the day start as part of that day', () => {
    const result = combineDateAndTime(
      new Date(2026, 10, 28),
      new Date(2025, 0, 1, 4, 0),
      FOUR_HOURS,
    );
    expect(result).toEqual(new Date(2026, 10, 28, 4, 0, 0));
  });

  it('crosses a month end', () => {
    const result = combineDateAndTime(
      new Date(2026, 10, 30),
      new Date(2025, 0, 1, 1, 0),
      FOUR_HOURS,
    );
    expect(result).toEqual(new Date(2026, 11, 1, 1, 0, 0));
  });
});
