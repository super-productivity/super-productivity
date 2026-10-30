import { shiftDayStr, toScheduleDayPage } from './schedule-day-page';
import { ScheduleDay } from './schedule.model';

const emptyDay = {
  dayDate: '2026-10-12',
  entries: [],
  beyondBudgetTasks: [],
  isToday: false,
} as unknown as ScheduleDay;

describe('schedule-day-page', () => {
  describe('shiftDayStr', () => {
    it('steps calendar days across month and year ends', () => {
      expect(shiftDayStr('2026-10-11', 1)).toBe('2026-10-12');
      expect(shiftDayStr('2026-10-31', 1)).toBe('2026-11-01');
      expect(shiftDayStr('2027-01-01', -1)).toBe('2026-12-31');
    });

    it('steps over a DST change by exactly one day', () => {
      // Europe/Berlin and America/Los_Angeles both switch in the next days.
      expect(shiftDayStr('2026-10-24', 1)).toBe('2026-10-25');
      expect(shiftDayStr('2026-10-25', 1)).toBe('2026-10-26');
      expect(shiftDayStr('2026-11-01', 1)).toBe('2026-11-02');
      expect(shiftDayStr('2026-03-29', -1)).toBe('2026-03-28');
    });
  });

  describe('toScheduleDayPage', () => {
    it('describes a single, empty day', () => {
      const page = toScheduleDayPage('2026-10-12', [emptyDay]);
      expect(page.day).toBe('2026-10-12');
      expect(page.daysToShow).toEqual(['2026-10-12']);
      expect(page.events).toEqual([]);
      expect(page.hasNoEvents).toBeTrue();
    });
  });
});
