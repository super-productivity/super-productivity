import { moveClockTimeIntoLogicalDay } from './move-clock-time-into-logical-day';

describe('moveClockTimeIntoLogicalDay', () => {
  const FOUR_HOURS = 4 * 60 * 60 * 1000;

  it('moves a time before the day start to the next calendar date', () => {
    expect(moveClockTimeIntoLogicalDay(new Date(2030, 5, 16, 1, 30), FOUR_HOURS)).toEqual(
      new Date(2030, 5, 17, 1, 30),
    );
  });

  it('keeps a time at or after the day start', () => {
    expect(moveClockTimeIntoLogicalDay(new Date(2030, 5, 16, 4), FOUR_HOURS)).toEqual(
      new Date(2030, 5, 16, 4),
    );
    expect(
      moveClockTimeIntoLogicalDay(new Date(2030, 5, 16, 22, 15), FOUR_HOURS),
    ).toEqual(new Date(2030, 5, 16, 22, 15));
  });

  it('keeps every time with a midnight day start', () => {
    expect(moveClockTimeIntoLogicalDay(new Date(2030, 5, 16, 0, 0), 0)).toEqual(
      new Date(2030, 5, 16, 0, 0),
    );
  });

  it('rolls over a month end', () => {
    expect(moveClockTimeIntoLogicalDay(new Date(2030, 5, 30, 1, 30), FOUR_HOURS)).toEqual(
      new Date(2030, 6, 1, 1, 30),
    );
  });
});
