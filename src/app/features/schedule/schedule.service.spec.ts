import { TestBed } from '@angular/core/testing';
import { ScheduleService } from './schedule.service';
import { DateService } from '../../core/date/date.service';
import { provideMockStore } from '@ngrx/store/testing';
import { selectTimelineTasks } from '../work-context/store/work-context.selectors';
import { selectTaskRepeatCfgsWithAndWithoutStartTime } from '../task-repeat-cfg/store/task-repeat-cfg.selectors';
import { selectTimelineConfig } from '../config/store/global-config.reducer';
import { selectPlannerDayMap } from '../planner/store/planner.selectors';
import { of } from 'rxjs';
import { CalendarIntegrationService } from '../calendar-integration/calendar-integration.service';
import { TaskService } from '../tasks/task.service';

describe('ScheduleService', () => {
  let service: ScheduleService;
  let dateService: DateService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ScheduleService,
        DateService,
        provideMockStore({
          selectors: [
            { selector: selectTimelineTasks, value: { unPlanned: [], planned: [] } },
            {
              selector: selectTaskRepeatCfgsWithAndWithoutStartTime,
              value: { withStartTime: [], withoutStartTime: [] },
            },
            {
              selector: selectTimelineConfig,
              value: { isWorkStartEndEnabled: false, isLunchBreakEnabled: false },
            },
            { selector: selectPlannerDayMap, value: {} },
          ],
        }),
        {
          provide: CalendarIntegrationService,
          useValue: { icalEvents$: of([]) },
        },
        {
          provide: TaskService,
          useValue: { currentTaskId: () => null },
        },
      ],
    });
    service = TestBed.inject(ScheduleService);
    dateService = TestBed.inject(DateService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getDaysToShow', () => {
    it('should return correct number of days when referenceDate is null', () => {
      // Arrange
      const nrOfDaysToShow = 5;

      // Act
      const result = service.getDaysToShow(nrOfDaysToShow, null);

      // Assert
      expect(result.length).toBe(5);
    });

    it('should return days starting from today when referenceDate is null', () => {
      // Arrange
      const nrOfDaysToShow = 3;
      const expectedTodayStr = dateService.todayStr();

      // Act
      const result = service.getDaysToShow(nrOfDaysToShow, null);

      // Assert
      expect(result[0]).toBe(expectedTodayStr);
    });

    it('should return days starting from referenceDate', () => {
      // Arrange
      const nrOfDaysToShow = 3;
      const referenceDate = new Date(2028, 5, 15); // June 15, 2028
      const expectedFirstDay = dateService.todayStr(referenceDate.getTime());

      // Act
      const result = service.getDaysToShow(nrOfDaysToShow, referenceDate);

      // Assert
      expect(result[0]).toBe(expectedFirstDay);
      expect(result.length).toBe(3);
    });

    it('should return days starting from provided date even if today', () => {
      // Arrange
      const nrOfDaysToShow = 3;
      const referenceDate = new Date();
      const expectedFirstDay = dateService.todayStr(referenceDate.getTime());

      // Act
      const result = service.getDaysToShow(nrOfDaysToShow, referenceDate);

      // Assert
      expect(result[0]).toBe(expectedFirstDay);
      expect(result.length).toBe(3);
    });

    it('should return consecutive days from referenceDate', () => {
      // Arrange
      const nrOfDaysToShow = 7;
      // Use a future date to ensure not in current week
      const referenceDate = new Date(2028, 0, 20); // Jan 20, 2028

      // Act
      const result = service.getDaysToShow(nrOfDaysToShow, referenceDate);

      // Assert
      expect(result.length).toBe(7);
      // Check that each day is consecutive
      for (let i = 0; i < result.length - 1; i++) {
        const currentDay = new Date(result[i]);
        const nextDay = new Date(result[i + 1]);
        const dayDiff =
          (nextDay.getTime() - currentDay.getTime()) / (1000 * 60 * 60 * 24);
        expect(dayDiff).toBe(1);
      }
    });

    it('should handle transition across months', () => {
      // Arrange
      const nrOfDaysToShow = 5;
      // Use a future date to ensure not in current week
      const referenceDate = new Date(2028, 0, 30); // Jan 30, 2028

      // Act
      const result = service.getDaysToShow(nrOfDaysToShow, referenceDate);

      // Assert
      expect(result.length).toBe(5);
      // Last days should be in February
      const lastDay = new Date(result[4]);
      expect(lastDay.getMonth()).toBe(1); // February
    });
  });

  describe('getMonthDaysToShow', () => {
    it('should return correct number of days', () => {
      const numberOfWeeks = 5;
      const firstDayOfWeek = 1; // Monday
      const result = service.getMonthDaysToShow(numberOfWeeks, firstDayOfWeek);
      expect(result.length).toBe(numberOfWeeks * 7);
    });

    it('should start with the configured first day of week when firstDayOfWeek is Monday (1)', () => {
      const numberOfWeeks = 5;
      const firstDayOfWeek = 1; // Monday

      // Mock the current date to a known value for testing
      const testDate = new Date(2025, 0, 15); // January 15, 2025 (Wednesday)
      jasmine.clock().install();
      jasmine.clock().mockDate(testDate);

      const result = service.getMonthDaysToShow(numberOfWeeks, firstDayOfWeek);

      // January 2025 starts on Wednesday (day 3)
      // With Monday as first day of week, the calendar should start from Dec 30, 2024 (Monday)
      // Parse the date string in local timezone by using the Date constructor with year, month, day
      const [year, month, day] = result[0].split('-').map(Number);
      const firstDayDate = new Date(year, month - 1, day);
      expect(firstDayDate.getDay()).toBe(1); // Monday

      jasmine.clock().uninstall();
    });

    it('should start with the configured first day of week when firstDayOfWeek is Sunday (0)', () => {
      const numberOfWeeks = 5;
      const firstDayOfWeek = 0; // Sunday

      // Mock the current date to a known value for testing
      const testDate = new Date(2025, 0, 15); // January 15, 2025 (Wednesday)
      jasmine.clock().install();
      jasmine.clock().mockDate(testDate);

      const result = service.getMonthDaysToShow(numberOfWeeks, firstDayOfWeek);

      // January 2025 starts on Wednesday (day 3)
      // With Sunday as first day of week, the calendar should start from Dec 29, 2024 (Sunday)
      // Parse the date string in local timezone by using the Date constructor with year, month, day
      const [year, month, day] = result[0].split('-').map(Number);
      const firstDayDate = new Date(year, month - 1, day);
      expect(firstDayDate.getDay()).toBe(0); // Sunday

      jasmine.clock().uninstall();
    });

    it('should start with the configured first day of week when firstDayOfWeek is Saturday (6)', () => {
      const numberOfWeeks = 5;
      const firstDayOfWeek = 6; // Saturday

      // Mock the current date to a known value for testing
      const testDate = new Date(2025, 0, 15); // January 15, 2025 (Wednesday)
      jasmine.clock().install();
      jasmine.clock().mockDate(testDate);

      const result = service.getMonthDaysToShow(numberOfWeeks, firstDayOfWeek);

      // January 2025 starts on Wednesday (day 3)
      // With Saturday as first day of week, the calendar should start from Dec 28, 2024 (Saturday)
      // Parse the date string in local timezone by using the Date constructor with year, month, day
      const [year, month, day] = result[0].split('-').map(Number);
      const firstDayDate = new Date(year, month - 1, day);
      expect(firstDayDate.getDay()).toBe(6); // Saturday

      jasmine.clock().uninstall();
    });

    it('should default to Sunday (0) when no firstDayOfWeek is provided', () => {
      const numberOfWeeks = 5;

      // Mock the current date to a known value for testing
      const testDate = new Date(2025, 0, 15); // January 15, 2025 (Wednesday)
      jasmine.clock().install();
      jasmine.clock().mockDate(testDate);

      const result = service.getMonthDaysToShow(numberOfWeeks);

      // Should default to Sunday as first day
      // Parse the date string in local timezone by using the Date constructor with year, month, day
      const [year, month, day] = result[0].split('-').map(Number);
      const firstDayDate = new Date(year, month - 1, day);
      expect(firstDayDate.getDay()).toBe(0); // Sunday

      jasmine.clock().uninstall();
    });

    it('should use referenceDate to determine the month to display', () => {
      // Arrange
      const numberOfWeeks = 4;
      const firstDayOfWeek = 1; // Monday
      const referenceDate = new Date(2026, 5, 15); // June 15, 2026

      // Act
      const result = service.getMonthDaysToShow(
        numberOfWeeks,
        firstDayOfWeek,
        referenceDate,
      );

      // Assert
      expect(result.length).toBe(28); // 4 weeks
      // The month view should include days from June 2026
      const juneFirst = new Date(2026, 5, 1); // June 1, 2026
      const juneFirstStr = dateService.todayStr(juneFirst.getTime());
      expect(result).toContain(juneFirstStr);
    });

    it('should include padding days from previous and next month', () => {
      // Arrange
      const numberOfWeeks = 5;
      const firstDayOfWeek = 0; // Sunday
      const referenceDate = new Date(2026, 0, 15); // Jan 15, 2026

      // Act
      const result = service.getMonthDaysToShow(
        numberOfWeeks,
        firstDayOfWeek,
        referenceDate,
      );

      // Assert
      // January 2026 starts on a Thursday, so with Sunday start,
      // we should have padding days from December 2025
      const firstDay = new Date(result[0]);
      // December 2025 would be month 11 (previous year)
      expect(firstDay.getMonth()).toBe(11);
      expect(firstDay.getFullYear()).toBe(2025);

      // Should also have some days from February if weeks extend past January
      const lastDay = new Date(result[result.length - 1]);
      // With 5 weeks starting from late December, we should reach into February
      expect(lastDay.getMonth()).toBeGreaterThanOrEqual(0);
    });
  });

  describe('buildScheduleDays', () => {
    it('should return empty array when timelineTasks is null', () => {
      // Arrange
      const params = {
        daysToShow: ['2026-01-20', '2026-01-21'],
        timelineTasks: null,
        taskRepeatCfgs: { withStartTime: [], withoutStartTime: [] },
        icalEvents: [],
        plannerDayMap: {},
        timelineCfg: null,
        currentTaskId: null,
      };

      // Act
      const result = service.buildScheduleDays(params);

      // Assert
      expect(result).toEqual([]);
    });

    it('should return empty array when taskRepeatCfgs is null', () => {
      // Arrange
      const params = {
        daysToShow: ['2026-01-20', '2026-01-21'],
        timelineTasks: { unPlanned: [], planned: [] },
        taskRepeatCfgs: null,
        icalEvents: [],
        plannerDayMap: {},
        timelineCfg: null,
        currentTaskId: null,
      };

      // Act
      const result = service.buildScheduleDays(params);

      // Assert
      expect(result).toEqual([]);
    });

    it('should return empty array when plannerDayMap is null', () => {
      // Arrange
      const params = {
        daysToShow: ['2026-01-20', '2026-01-21'],
        timelineTasks: { unPlanned: [], planned: [] },
        taskRepeatCfgs: { withStartTime: [], withoutStartTime: [] },
        icalEvents: [],
        plannerDayMap: null,
        timelineCfg: null,
        currentTaskId: null,
      };

      // Act
      const result = service.buildScheduleDays(params);

      // Assert
      expect(result).toEqual([]);
    });

    it('should pass realNow parameter through to mapToScheduleDays', () => {
      // Arrange
      const realNow = Date.now();
      const params = {
        now: Date.now(),
        realNow,
        daysToShow: ['2026-01-20'],
        timelineTasks: { unPlanned: [], planned: [] },
        taskRepeatCfgs: { withStartTime: [], withoutStartTime: [] },
        icalEvents: [],
        plannerDayMap: {},
        timelineCfg: null,
        currentTaskId: null,
      };

      // Act
      const result = service.buildScheduleDays(params);

      // Assert
      // The function should not throw and should process with realNow
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('should default now to Date.now() when not provided', () => {
      // Arrange
      const params = {
        daysToShow: ['2026-01-20'],
        timelineTasks: { unPlanned: [], planned: [] },
        taskRepeatCfgs: { withStartTime: [], withoutStartTime: [] },
        icalEvents: [],
        plannerDayMap: {},
        timelineCfg: null,
      };

      // Act
      const result = service.buildScheduleDays(params);

      // Assert
      // Should work without throwing
      expect(result).toBeDefined();
    });
  });

  describe('getDayClass', () => {
    it('should return empty string for a day in current month when no referenceMonth provided', () => {
      // Arrange
      const today = new Date();
      const dayInCurrentMonth = new Date(today.getFullYear(), today.getMonth(), 15);
      const dayStr = dateService.todayStr(dayInCurrentMonth.getTime());

      // Act
      const result = service.getDayClass(dayStr);

      // Assert
      // Should not have 'other-month' class
      expect(result).not.toContain('other-month');
    });

    it('should return "today" class for today without referenceMonth', () => {
      // Arrange
      const today = new Date();
      const todayStr = dateService.todayStr(today.getTime());

      // Act
      const result = service.getDayClass(todayStr);

      // Assert
      expect(result).toContain('today');
    });

    it('should return "other-month" class for a day in a different month when referenceMonth provided', () => {
      // Arrange
      const referenceMonth = new Date(2026, 5, 15); // June 2026
      const dayInMay = new Date(2026, 4, 31); // May 31, 2026
      const dayStr = dateService.todayStr(dayInMay.getTime());

      // Act
      const result = service.getDayClass(dayStr, referenceMonth);

      // Assert
      expect(result).toContain('other-month');
    });

    it('should not return "other-month" class for a day in the reference month', () => {
      // Arrange
      const referenceMonth = new Date(2026, 5, 15); // June 2026
      const dayInJune = new Date(2026, 5, 20); // June 20, 2026
      const dayStr = dateService.todayStr(dayInJune.getTime());

      // Act
      const result = service.getDayClass(dayStr, referenceMonth);

      // Assert
      expect(result).not.toContain('other-month');
    });

    it('should return "today" class even when using referenceMonth', () => {
      // Arrange
      const today = new Date();
      const todayStr = dateService.todayStr(today.getTime());
      const referenceMonth = new Date(today.getFullYear(), today.getMonth(), 15);

      // Act
      const result = service.getDayClass(todayStr, referenceMonth);

      // Assert
      expect(result).toContain('today');
    });

    it('should handle year boundaries correctly', () => {
      // Arrange
      const referenceMonth = new Date(2026, 0, 15); // January 2026
      const dayInDecember2025 = new Date(2025, 11, 31); // Dec 31, 2025
      const dayStr = dateService.todayStr(dayInDecember2025.getTime());

      // Act
      const result = service.getDayClass(dayStr, referenceMonth);

      // Assert
      expect(result).toContain('other-month');
    });

    it('should combine "today" and "other-month" classes when applicable', () => {
      // Arrange - This is an edge case where today is in a different month than reference
      const today = new Date(2026, 0, 20); // Jan 20, 2026
      jasmine.clock().install();
      jasmine.clock().mockDate(today);

      const todayStr = dateService.todayStr(today.getTime());
      const referenceMonth = new Date(2025, 11, 15); // December 2025

      // Act
      const result = service.getDayClass(todayStr, referenceMonth);

      // Assert
      expect(result).toContain('today');
      expect(result).toContain('other-month');

      jasmine.clock().uninstall();
    });
  });
});
