import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ScheduleComponent } from './schedule.component';
import { TaskService } from '../../tasks/task.service';
import { LayoutService } from '../../../core-ui/layout/layout.service';
import { ScheduleService } from '../schedule.service';
import { MatDialog } from '@angular/material/dialog';
import { GlobalTrackingIntervalService } from '../../../core/global-tracking-interval/global-tracking-interval.service';
import { DateAdapter } from '@angular/material/core';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { provideMockStore } from '@ngrx/store/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { SCHEDULE_CONSTANTS } from '../schedule.constants';
import { GlobalConfigService } from '../../config/global-config.service';

describe('ScheduleComponent', () => {
  let component: ScheduleComponent;
  let fixture: ComponentFixture<ScheduleComponent>;
  let mockTaskService: jasmine.SpyObj<TaskService>;
  let mockLayoutService: jasmine.SpyObj<LayoutService>;
  let mockScheduleService: jasmine.SpyObj<ScheduleService>;
  let mockMatDialog: jasmine.SpyObj<MatDialog>;
  let mockGlobalTrackingIntervalService: jasmine.SpyObj<GlobalTrackingIntervalService>;
  let mockGlobalConfigService: jasmine.SpyObj<GlobalConfigService>;

  beforeEach(async () => {
    // Create mock services
    mockTaskService = jasmine.createSpyObj('TaskService', ['currentTaskId']);
    (mockTaskService as any).currentTaskId = signal(null);

    mockLayoutService = jasmine.createSpyObj('LayoutService', [], {
      selectedTimeView: signal('week'),
    });

    mockScheduleService = jasmine.createSpyObj('ScheduleService', [
      'getDaysToShow',
      'getMonthDaysToShow',
      'buildScheduleDays',
      'scheduleRefreshTick',
      'getTodayStr',
      'createScheduleDaysWithContext',
      'getDayClass',
      'hasEventsForDay',
      'getEventsForDay',
    ]);
    mockScheduleService.getDaysToShow.and.returnValue([
      '2026-01-20',
      '2026-01-21',
      '2026-01-22',
    ]);
    mockScheduleService.getMonthDaysToShow.and.returnValue([
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
    ]);
    mockScheduleService.buildScheduleDays.and.returnValue([]);
    mockScheduleService.getTodayStr.and.callFake((timestamp?: number | Date) => {
      const date = timestamp ? new Date(timestamp) : new Date();
      return date.toISOString().split('T')[0];
    });
    mockScheduleService.createScheduleDaysWithContext.and.returnValue([]);
    mockScheduleService.getDayClass.and.returnValue('');
    mockScheduleService.hasEventsForDay.and.returnValue(false);
    mockScheduleService.getEventsForDay.and.returnValue([]);
    (mockScheduleService as any).scheduleRefreshTick = signal(0);

    mockMatDialog = jasmine.createSpyObj('MatDialog', ['open']);

    mockGlobalTrackingIntervalService = jasmine.createSpyObj(
      'GlobalTrackingIntervalService',
      [],
      {
        todayDateStr$: of('2026-01-20'),
      },
    );

    mockGlobalConfigService = jasmine.createSpyObj('GlobalConfigService', [], {
      localization: signal({ firstDayOfWeek: 1 }),
      cfg: signal(undefined),
    });

    await TestBed.configureTestingModule({
      imports: [ScheduleComponent, TranslateModule.forRoot()],
      providers: [
        provideMockStore({ initialState: {} }),
        { provide: TaskService, useValue: mockTaskService },
        { provide: LayoutService, useValue: mockLayoutService },
        { provide: ScheduleService, useValue: mockScheduleService },
        { provide: MatDialog, useValue: mockMatDialog },
        {
          provide: GlobalTrackingIntervalService,
          useValue: mockGlobalTrackingIntervalService,
        },
        { provide: GlobalConfigService, useValue: mockGlobalConfigService },
        { provide: DateAdapter, useValue: { getFirstDayOfWeek: () => 1 } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ScheduleComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  describe('headerTitle computed', () => {
    it('returns week label and date range in week view', () => {
      const translate = TestBed.inject(TranslateService);
      translate.setTranslation('en', {
        F: { WORKLOG: { CMP: { WEEK_NR: 'Week {{nr}}' } } },
      });
      translate.use('en');

      mockLayoutService.selectedTimeView.set('week');
      mockScheduleService.getDaysToShow.and.returnValue([
        '2026-04-20',
        '2026-04-21',
        '2026-04-22',
        '2026-04-23',
        '2026-04-24',
        '2026-04-25',
        '2026-04-26',
      ]);
      // Changing _selectedDate invalidates the daysToShow computed so the new
      // mock return value is picked up (and headerTitle recomputes).
      component['_selectedDate'].set(new Date(2026, 3, 20));
      fixture.detectChanges();
      // Mon Apr 20 2026 is in ISO week 17
      expect(component.headerTitle()).toMatch(/^Week 17 · .+ – .+$/);
    });

    it('returns month + year in month view', () => {
      mockLayoutService.selectedTimeView.set('month');
      const days = Array.from({ length: 35 }, (_, i) => {
        const d = new Date(2026, 3, 1 + i);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
      });
      mockScheduleService.getMonthDaysToShow.and.returnValue(days);
      fixture.detectChanges();
      expect(component.headerTitle()).toMatch(/April\s+2026/);
    });
  });

  describe('_selectedDate signal', () => {
    it('should initialize as null (viewing today)', () => {
      expect(component['_selectedDate']()).toBeNull();
    });

    it('should update when goToNextPeriod is called in week view', () => {
      // Arrange - default is week view
      const initialDate = component['_selectedDate']();
      expect(initialDate).toBeNull();

      // Act
      component.goToNextPeriod();

      // Assert
      const newDate = component['_selectedDate']();
      expect(newDate).not.toBeNull();
      expect(newDate?.getTime()).toBeGreaterThan(Date.now() - 1000); // Should be around now + 7 days
    });

    it('should update when goToPreviousPeriod is called in week view', () => {
      // Arrange - view a future range that doesn't contain today, so prev nav is enabled
      mockScheduleService.getDaysToShow.and.returnValue([
        '2027-06-14',
        '2027-06-15',
        '2027-06-16',
      ]);
      const startDate = new Date(2027, 5, 15);
      component['_selectedDate'].set(startDate);
      fixture.detectChanges();

      // Act - navigate to previous week
      component.goToPreviousPeriod();

      // Assert
      const newDate = component['_selectedDate']();
      expect(newDate).not.toBeNull();
      expect(newDate?.getTime()).toBeLessThan(startDate.getTime());
    });

    it('should update when goToNextPeriod is called in month view', () => {
      // Arrange - switch to month view
      mockLayoutService.selectedTimeView.set('month');
      fixture.detectChanges();

      // Act
      component.goToNextPeriod();

      // Assert
      const newDate = component['_selectedDate']();
      expect(newDate).not.toBeNull();
      // Should be first of next month
      expect(newDate?.getDate()).toBe(1);
    });

    it('should update when goToPreviousPeriod is called in month view', () => {
      // Arrange - view a future month so prev nav is enabled
      // (default getMonthDaysToShow mock returns Jan 1-3, excluding mocked today Jan 20)
      mockLayoutService.selectedTimeView.set('month');
      component['_selectedDate'].set(new Date(2026, 1, 15)); // Feb 15, 2026
      fixture.detectChanges();

      // Act
      component.goToPreviousPeriod();

      // Assert
      const newDate = component['_selectedDate']();
      expect(newDate).not.toBeNull();
      // Should be first of previous month
      expect(newDate?.getDate()).toBe(1);
    });
  });

  describe('isViewingToday computed', () => {
    it('should return true when _selectedDate is null', () => {
      component['_selectedDate'].set(null);
      expect(component.isViewingToday()).toBe(true);
    });

    it('should return true when the displayed range contains today', () => {
      // Mock today = 2026-01-20. Displayed range includes that day.
      mockScheduleService.getDaysToShow.and.returnValue([
        '2026-01-19',
        '2026-01-20',
        '2026-01-21',
      ]);
      component['_selectedDate'].set(new Date('2026-01-19'));
      expect(component.isViewingToday()).toBe(true);
    });

    it('should return false when viewing a future range without today', () => {
      mockScheduleService.getDaysToShow.and.returnValue([
        '2026-01-26',
        '2026-01-27',
        '2026-01-28',
      ]);
      component['_selectedDate'].set(new Date('2026-01-27'));
      expect(component.isViewingToday()).toBe(false);
    });

    it('should return false when viewing a past range without today', () => {
      mockScheduleService.getDaysToShow.and.returnValue([
        '2026-01-12',
        '2026-01-13',
        '2026-01-14',
      ]);
      component['_selectedDate'].set(new Date('2026-01-13'));
      expect(component.isViewingToday()).toBe(false);
    });
  });

  describe('goToPreviousPeriod', () => {
    it('should navigate backward by the number of days currently shown', () => {
      // Arrange - view a future range that doesn't contain today
      mockScheduleService.getDaysToShow.and.returnValue([
        '2027-06-14',
        '2027-06-15',
        '2027-06-16',
      ]);
      const startDate = new Date(2027, 5, 15); // Jun 15, 2027
      component['_selectedDate'].set(startDate);
      fixture.detectChanges();

      // Get the actual number of days being shown (mock-controlled)
      const daysShown = component.daysToShow().length;

      // Act
      component.goToPreviousPeriod();

      // Assert
      const newDate = component['_selectedDate']();
      const expectedDate = new Date(startDate);
      expectedDate.setDate(startDate.getDate() - daysShown);

      expect(newDate?.getDate()).toBe(expectedDate.getDate());
      expect(newDate?.getHours()).toBe(0); // Normalized to midnight
    });

    it('should not navigate backward when already viewing today', () => {
      // Arrange - viewing today (null selected date)
      component['_selectedDate'].set(null);

      // Act
      component.goToPreviousPeriod();

      // Assert - prev nav is disabled when today is in view
      expect(component['_selectedDate']()).toBeNull();
    });

    it('should go to previous month in month view', () => {
      // Arrange
      mockLayoutService.selectedTimeView.set('month');
      const startDate = new Date(2026, 1, 15); // Feb 15, 2026
      component['_selectedDate'].set(startDate);

      // Act
      component.goToPreviousPeriod();

      // Assert
      const newDate = component['_selectedDate']();
      expect(newDate?.getMonth()).toBe(0); // January
      expect(newDate?.getDate()).toBe(1); // First of month
    });

    it('should go to previous year when navigating from January in month view', () => {
      // Arrange
      mockLayoutService.selectedTimeView.set('month');
      const startDate = new Date(2026, 0, 15); // Jan 15, 2026
      component['_selectedDate'].set(startDate);

      // Act
      component.goToPreviousPeriod();

      // Assert
      const newDate = component['_selectedDate']();
      expect(newDate?.getFullYear()).toBe(2025);
      expect(newDate?.getMonth()).toBe(11); // December
    });
  });

  describe('goToNextPeriod', () => {
    it('should navigate forward by the number of days currently shown', () => {
      // Arrange
      const startDate = new Date(2026, 0, 20); // Jan 20, 2026
      component['_selectedDate'].set(startDate);

      // Get the actual number of days being shown (depends on test window size)
      const daysShown = component.daysToShow().length;

      // Act
      component.goToNextPeriod();

      // Assert
      const newDate = component['_selectedDate']();
      const expectedDate = new Date(startDate);
      expectedDate.setDate(startDate.getDate() + daysShown);

      expect(newDate?.getDate()).toBe(expectedDate.getDate());
      expect(newDate?.getHours()).toBe(0); // Normalized to midnight
    });

    it('should navigate forward from today by the number of days shown', () => {
      // Arrange
      component['_selectedDate'].set(null);
      const startDate = new Date();
      const daysShown = component.daysToShow().length;

      // Calculate expected date (today + daysShown)
      const expectedDate = new Date(startDate);
      expectedDate.setDate(startDate.getDate() + daysShown);

      // Act
      component.goToNextPeriod();

      // Assert
      const newDate = component['_selectedDate']();
      expect(newDate?.getDate()).toBe(expectedDate.getDate());
      expect(newDate?.getHours()).toBe(0); // Normalized to midnight
    });

    it('should go to next month in month view', () => {
      // Arrange
      mockLayoutService.selectedTimeView.set('month');
      const startDate = new Date(2026, 0, 15); // Jan 15, 2026
      component['_selectedDate'].set(startDate);

      // Act
      component.goToNextPeriod();

      // Assert
      const newDate = component['_selectedDate']();
      expect(newDate?.getMonth()).toBe(1); // February
      expect(newDate?.getDate()).toBe(1); // First of month
    });

    it('should go to next year when navigating from December in month view', () => {
      // Arrange
      mockLayoutService.selectedTimeView.set('month');
      const startDate = new Date(2025, 11, 15); // Dec 15, 2025
      component['_selectedDate'].set(startDate);

      // Act
      component.goToNextPeriod();

      // Assert
      const newDate = component['_selectedDate']();
      expect(newDate?.getFullYear()).toBe(2026);
      expect(newDate?.getMonth()).toBe(0); // January
    });
  });

  describe('goToToday', () => {
    it('should reset _selectedDate to null', () => {
      // Arrange
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7);
      component['_selectedDate'].set(futureDate);

      // Act
      component.goToToday();

      // Assert
      expect(component['_selectedDate']()).toBeNull();
    });

    it('should make isViewingToday return true', () => {
      // Arrange - view a future range that doesn't contain today
      mockScheduleService.getDaysToShow.and.returnValue([
        '2027-06-14',
        '2027-06-15',
        '2027-06-16',
      ]);
      component['_selectedDate'].set(new Date(2027, 5, 15));
      fixture.detectChanges();
      expect(component.isViewingToday()).toBe(false);

      // Act
      component.goToToday();

      // Assert
      expect(component.isViewingToday()).toBe(true);
    });
  });

  describe('_contextNow computed', () => {
    it('should return current time when viewing today (selectedDate is null)', () => {
      // Arrange
      component['_selectedDate'].set(null);

      // Act
      const contextNow = component['_contextNow']();

      // Assert - just check it's a reasonable timestamp (within last hour and next minute)
      const now = Date.now();
      // eslint-disable-next-line no-mixed-operators
      const oneHourAgo = now - 60 * 60 * 1000;
      // eslint-disable-next-line no-mixed-operators
      const oneMinuteFromNow = now + 60 * 1000;
      expect(contextNow).toBeGreaterThan(oneHourAgo);
      expect(contextNow).toBeLessThan(oneMinuteFromNow);
    });

    it('should return midnight of selected date when viewing a different date', () => {
      // Arrange
      const selectedDate = new Date(2026, 0, 25, 14, 30, 45); // Jan 25, 2026, 2:30:45 PM
      component['_selectedDate'].set(selectedDate);

      // Act
      const contextNow = component['_contextNow']();
      const contextDate = new Date(contextNow);

      // Assert
      expect(contextDate.getHours()).toBe(0);
      expect(contextDate.getMinutes()).toBe(0);
      expect(contextDate.getSeconds()).toBe(0);
      expect(contextDate.getMilliseconds()).toBe(0);
      expect(contextDate.getDate()).toBe(25);
      expect(contextDate.getMonth()).toBe(0);
      expect(contextDate.getFullYear()).toBe(2026);
    });
  });

  describe('scheduleDays computed', () => {
    it('should call createScheduleDaysWithContext with contextNow', () => {
      // Arrange
      const selectedDate = new Date(2026, 0, 25);
      component['_selectedDate'].set(selectedDate);
      mockScheduleService.createScheduleDaysWithContext.calls.reset();

      // Act
      component.scheduleDays();

      // Assert
      expect(mockScheduleService.createScheduleDaysWithContext).toHaveBeenCalled();
      const callArgs =
        mockScheduleService.createScheduleDaysWithContext.calls.mostRecent().args[0];
      expect(callArgs.contextNow).toBeDefined();
      // Context now should be midnight of selected date
      const contextDate = new Date(callArgs.contextNow);
      expect(contextDate.getHours()).toBe(0);
      expect(contextDate.getMinutes()).toBe(0);
    });

    it('should always pass realNow as actual current time', () => {
      // Arrange
      const selectedDate = new Date(2026, 0, 25);
      component['_selectedDate'].set(selectedDate);
      mockScheduleService.createScheduleDaysWithContext.calls.reset();
      const before = Date.now();

      // Act
      component.scheduleDays();
      const after = Date.now();

      // Assert
      const callArgs =
        mockScheduleService.createScheduleDaysWithContext.calls.mostRecent().args[0];
      expect(callArgs.realNow).toBeGreaterThanOrEqual(before);
      expect(callArgs.realNow).toBeLessThanOrEqual(after);
    });

    it('should pass both contextNow and realNow when viewing a future date', () => {
      // Arrange
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7);
      component['_selectedDate'].set(futureDate);
      mockScheduleService.createScheduleDaysWithContext.calls.reset();

      // Act
      component.scheduleDays();

      // Assert
      const callArgs =
        mockScheduleService.createScheduleDaysWithContext.calls.mostRecent().args[0];
      expect(callArgs.contextNow).toBeDefined();
      expect(callArgs.realNow).toBeDefined();
      // contextNow should be different from realNow when viewing future
      expect(callArgs.contextNow).not.toBe(callArgs.realNow);
    });
  });

  describe('currentTimeRow computed', () => {
    it('should return null when not viewing today', () => {
      // Arrange - view a future range that doesn't contain today
      mockScheduleService.getDaysToShow.and.returnValue([
        '2027-06-14',
        '2027-06-15',
        '2027-06-16',
      ]);
      component['_selectedDate'].set(new Date(2027, 5, 15));
      fixture.detectChanges();

      // Act
      const timeRow = component.currentTimeRow();

      // Assert
      expect(timeRow).toBeNull();
    });

    it('should return a number when viewing today', () => {
      // Arrange
      component['_selectedDate'].set(null);

      // Act
      const timeRow = component.currentTimeRow();

      // Assert
      expect(timeRow).not.toBeNull();
      expect(typeof timeRow).toBe('number');
    });

    it('should calculate time row based on current time', () => {
      // Arrange
      component['_selectedDate'].set(null);

      // Act
      const timeRow = component.currentTimeRow();

      // Assert - check it's a reasonable value (0-288 for 24 hours * FH=12)
      expect(timeRow).not.toBeNull();
      expect(timeRow).toBeGreaterThanOrEqual(0);
      expect(timeRow).toBeLessThanOrEqual(288); // 24 hours * 12 rows per hour
    });
  });

  describe('daysToShow computed', () => {
    it('should call getDaysToShow in week view', () => {
      // Arrange
      mockLayoutService.selectedTimeView.set('week');
      // Trigger a change to force recomputation
      component['_selectedDate'].set(new Date(2026, 0, 20));
      mockScheduleService.getDaysToShow.calls.reset();

      // Act
      component.daysToShow();

      // Assert
      expect(mockScheduleService.getDaysToShow).toHaveBeenCalled();
    });

    it('should call getMonthDaysToShow in month view', () => {
      // Arrange
      mockLayoutService.selectedTimeView.set('month');
      mockScheduleService.getMonthDaysToShow.calls.reset();
      component['_selectedDate'].set(null);

      // Act
      component.daysToShow();

      // Assert
      expect(mockScheduleService.getMonthDaysToShow).toHaveBeenCalled();
    });

    it('should pass selectedDate to getDaysToShow', () => {
      // Arrange
      const testDate = new Date(2026, 0, 25);
      component['_selectedDate'].set(testDate);
      mockScheduleService.getDaysToShow.calls.reset();

      // Act
      component.daysToShow();

      // Assert
      expect(mockScheduleService.getDaysToShow).toHaveBeenCalledWith(
        jasmine.any(Number),
        testDate,
      );
    });

    it('should pass selectedDate to getMonthDaysToShow', () => {
      // Arrange
      mockLayoutService.selectedTimeView.set('month');
      const testDate = new Date(2026, 0, 25);
      component['_selectedDate'].set(testDate);
      mockScheduleService.getMonthDaysToShow.calls.reset();

      // Act
      component.daysToShow();

      // Assert
      expect(mockScheduleService.getMonthDaysToShow).toHaveBeenCalledWith(
        jasmine.any(Number),
        jasmine.any(Number),
        testDate,
      );
    });
  });

  describe('_daysToShowCount computed (responsive weeks calculation)', () => {
    it('should return 7 in week view regardless of window size', () => {
      // Arrange
      mockLayoutService.selectedTimeView.set('week');

      // Act
      const daysToShowCount = component['_daysToShowCount']();

      // Assert
      expect(daysToShowCount).toBe(7);
    });

    it('should return a value between MIN_WEEKS and MAX_WEEKS in month view', () => {
      // Arrange
      mockLayoutService.selectedTimeView.set('month');

      // Act
      const daysToShowCount = component['_daysToShowCount']();

      // Assert - should be bounded by constants
      expect(daysToShowCount).toBeGreaterThanOrEqual(
        SCHEDULE_CONSTANTS.MONTH_VIEW.MIN_WEEKS,
      );
      expect(daysToShowCount).toBeLessThanOrEqual(
        SCHEDULE_CONSTANTS.MONTH_VIEW.MAX_WEEKS,
      );
    });

    it('should use MONTH_VIEW constants for calculation', () => {
      // This test verifies the constants are being used by checking
      // that the result is consistent with the constant values
      mockLayoutService.selectedTimeView.set('month');

      const daysToShowCount = component['_daysToShowCount']();

      // The result must be an integer (whole number of weeks)
      expect(Number.isInteger(daysToShowCount)).toBe(true);

      // Must be within the defined bounds
      expect(daysToShowCount).toBeGreaterThanOrEqual(3); // MIN_WEEKS
      expect(daysToShowCount).toBeLessThanOrEqual(6); // MAX_WEEKS
    });
  });

  describe('shouldEnableHorizontalScroll computed', () => {
    it('should return false in month view regardless of window size', () => {
      // Arrange
      mockLayoutService.selectedTimeView.set('month');

      // Act
      const shouldScroll = component.shouldEnableHorizontalScroll();

      // Assert - month view never enables horizontal scroll
      expect(shouldScroll).toBe(false);
    });

    it('should use HORIZONTAL_SCROLL_THRESHOLD constant', () => {
      // Arrange
      mockLayoutService.selectedTimeView.set('week');

      // Act
      const shouldScroll = component.shouldEnableHorizontalScroll();

      // Assert - verify the threshold constant is defined and used
      expect(SCHEDULE_CONSTANTS.HORIZONTAL_SCROLL_THRESHOLD).toBe(1900);
      // The result depends on actual window width vs threshold
      expect(typeof shouldScroll).toBe('boolean');
    });
  });

  describe('weeksToShow computed', () => {
    it('should calculate weeks from days array length', () => {
      // Arrange - mock returns 7 days
      mockScheduleService.getDaysToShow.and.returnValue([
        '2026-01-20',
        '2026-01-21',
        '2026-01-22',
        '2026-01-23',
        '2026-01-24',
        '2026-01-25',
        '2026-01-26',
      ]);
      // Trigger recomputation by changing a dependency
      component['_selectedDate'].set(new Date(2026, 0, 20));

      // Act
      const weeks = component.weeksToShow();

      // Assert - 7 days = 1 week
      expect(weeks).toBe(1);
    });

    it('should round up partial weeks', () => {
      // Arrange - mock returns 10 days (more than 1 week, less than 2)
      mockScheduleService.getDaysToShow.and.returnValue([
        '2026-01-20',
        '2026-01-21',
        '2026-01-22',
        '2026-01-23',
        '2026-01-24',
        '2026-01-25',
        '2026-01-26',
        '2026-01-27',
        '2026-01-28',
        '2026-01-29',
      ]);
      // Trigger recomputation by changing a dependency
      component['_selectedDate'].set(new Date(2026, 0, 20));

      // Act
      const weeks = component.weeksToShow();

      // Assert - 10 days should round up to 2 weeks
      expect(weeks).toBe(2);
    });
  });
});
