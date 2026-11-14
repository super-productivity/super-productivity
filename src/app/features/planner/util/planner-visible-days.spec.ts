import { PlannerDay } from '../planner.model';
import {
  hideEmptyWeekendDays,
  isEmptyPlannerDay,
  isWeekendDayStr,
} from './planner-visible-days';

const SAT_SUN = [6, 0];

const day = (dayDate: string, overrides: Partial<PlannerDay> = {}): PlannerDay => ({
  dayDate,
  timeEstimate: 0,
  timeLimit: 0,
  itemsTotal: 0,
  tasks: [],
  deadlineTasks: [],
  noStartTimeRepeatProjections: [],
  allDayEvents: [],
  scheduledIItems: [],
  ...overrides,
});

describe('isWeekendDayStr', () => {
  it('should read the weekday from the date string, not the clock', () => {
    // 2026-11-14 is a Saturday, 2026-11-15 a Sunday, 2026-11-16 a Monday.
    expect(isWeekendDayStr('2026-11-14', SAT_SUN)).toBe(true);
    expect(isWeekendDayStr('2026-11-15', SAT_SUN)).toBe(true);
    expect(isWeekendDayStr('2026-11-16', SAT_SUN)).toBe(false);
  });

  it('should follow the weekend days it is given', () => {
    // Friday/Saturday weekend (e.g. ar, he): 2026-11-13 is a Friday.
    expect(isWeekendDayStr('2026-11-13', [5, 6])).toBe(true);
    expect(isWeekendDayStr('2026-11-15', [5, 6])).toBe(false);
  });
});

describe('isEmptyPlannerDay', () => {
  it('should call a day empty when nothing is planned on it', () => {
    expect(isEmptyPlannerDay(day('2026-11-14'))).toBe(true);
  });

  it('should not call a day empty when it holds tasks, deadlines, repeats or events', () => {
    expect(isEmptyPlannerDay(day('2026-11-14', { tasks: [{} as never] }))).toBe(false);
    expect(isEmptyPlannerDay(day('2026-11-14', { deadlineTasks: [{} as never] }))).toBe(
      false,
    );
    expect(
      isEmptyPlannerDay(
        day('2026-11-14', { noStartTimeRepeatProjections: [{} as never] }),
      ),
    ).toBe(false);
    expect(isEmptyPlannerDay(day('2026-11-14', { allDayEvents: [{} as never] }))).toBe(
      false,
    );
    expect(isEmptyPlannerDay(day('2026-11-14', { scheduledIItems: [{} as never] }))).toBe(
      false,
    );
  });
});

describe('hideEmptyWeekendDays', () => {
  const week = [
    day('2026-11-13'), // Friday
    day('2026-11-14'), // Saturday
    day('2026-11-15'), // Sunday
    day('2026-11-16'), // Monday
  ];

  it('should drop empty weekend days and keep the weekdays in order', () => {
    expect(hideEmptyWeekendDays(week, SAT_SUN).map((d) => d.dayDate)).toEqual([
      '2026-11-13',
      '2026-11-16',
    ]);
  });

  it('should keep a weekend day that has work on it', () => {
    const withWork = week.map((d) =>
      d.dayDate === '2026-11-14' ? day(d.dayDate, { tasks: [{} as never] }) : d,
    );
    expect(hideEmptyWeekendDays(withWork, SAT_SUN).map((d) => d.dayDate)).toEqual([
      '2026-11-13',
      '2026-11-14',
      '2026-11-16',
    ]);
  });

  it('should keep today even when it is an empty weekend day', () => {
    const withToday = week.map((d) =>
      d.dayDate === '2026-11-14' ? { ...day(d.dayDate), isToday: true } : d,
    );
    expect(hideEmptyWeekendDays(withToday, SAT_SUN).map((d) => d.dayDate)).toEqual([
      '2026-11-13',
      '2026-11-14',
      '2026-11-16',
    ]);
  });

  it('should keep every day when the locale weekend is not among them', () => {
    expect(hideEmptyWeekendDays(week, [3]).length).toBe(4);
  });
});
