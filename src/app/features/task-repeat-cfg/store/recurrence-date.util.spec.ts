import { DEFAULT_TASK_REPEAT_CFG } from '../task-repeat-cfg.model';
import {
  getRepeatScanDates,
  moveToMonthDay,
  moveToYearDay,
} from './recurrence-date.util';

const noon = (year: number, month: number, day: number): Date =>
  new Date(year, month, day, 12);

describe('getRepeatScanDates', () => {
  it('returns noon copies and leaves the passed date untouched', () => {
    const from = new Date(2024, 2, 10, 23, 59);
    const dates = getRepeatScanDates(
      {
        ...DEFAULT_TASK_REPEAT_CFG,
        id: 'R',
        startDate: '2024-01-31',
        lastTaskCreationDay: '2024-03-01',
      },
      from,
    );
    expect(dates).toEqual({
      checkDate: noon(2024, 2, 10),
      startDate: noon(2024, 0, 31),
      lastTaskCreation: noon(2024, 2, 1),
    });
    expect(from).toEqual(new Date(2024, 2, 10, 23, 59));
  });
});

describe('moveToMonthDay', () => {
  const move = (date: Date, monthDelta: number, day: number): Date => {
    moveToMonthDay(date, monthDelta, day);
    return date;
  };

  it('clamps to shorter months instead of overflowing into the next one', () => {
    expect(move(noon(2023, 2, 30), -1, 30)).toEqual(noon(2023, 1, 28));
    expect(move(noon(2024, 0, 31), 1, 31)).toEqual(noon(2024, 1, 29));
    expect(move(noon(2024, 9, 31), 4, 31)).toEqual(noon(2025, 1, 28));
    expect(move(noon(2024, 3, 15), 0, 31)).toEqual(noon(2024, 3, 30));
  });
});

describe('moveToYearDay', () => {
  const feb29In = (year: number): Date => {
    const date = noon(year - 1, 5, 15);
    moveToYearDay(date, 1, 1, 29);
    return date;
  };

  it('keeps Feb 29 in leap years only', () => {
    expect(feb29In(2024)).toEqual(noon(2024, 1, 29));
    expect(feb29In(2000)).toEqual(noon(2000, 1, 29));
    expect(feb29In(2023)).toEqual(noon(2023, 1, 28));
    expect(feb29In(2100)).toEqual(noon(2100, 1, 28));
  });
});
