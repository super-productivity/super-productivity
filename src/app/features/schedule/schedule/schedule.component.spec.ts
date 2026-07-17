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
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { selectCalendarProviders } from '../../issue/store/issue-provider.selectors';
import { HiddenCalendarProvidersService } from '../../calendar-integration/hidden-calendar-providers.service';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { SCHEDULE_CONSTANTS } from '../schedule.constants';
import { GlobalConfigService } from '../../config/global-config.service';
import { ScheduleDay } from '../schedule.model';
import { CalendarEventActionsService } from '../../calendar-integration/calendar-event-actions.service';

describe('ScheduleComponent', () => {
  let component: ScheduleComponent;
  let fixture: ComponentFixture<ScheduleComponent>;
  let mockTaskService: jasmine.SpyObj<TaskService>;
  let mockLayoutService: jasmine.SpyObj<LayoutService>;
  let mockScheduleService: jasmine.SpyObj<ScheduleService>;
  let mockMatDialog: jasmine.SpyObj<MatDialog>;
  let mockGlobalTrackingIntervalService: jasmine.SpyObj<GlobalTrackingIntervalService>;
  let mockGlobalConfigService: jasmine.SpyObj<GlobalConfigService>;
  let mockCalendarEventActionsService: jasmine.SpyObj<CalendarEventActionsService>;
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
    mockCalendarEventActionsService = jasmine.createSpyObj(
      'CalendarEventActionsService',
      [
        'hasEventUrl',
        'isPluginEvent',
        'canMoveEvent',
        'openEventLink',
        'reschedule',
        'createAsTask',
        'hideForever',
        'deleteEvent',
      ],
    );

    mockGlobalTrackingIntervalService = jasmine.createSpyObj(
      'GlobalTrackingIntervalService',
      [],
      {
        todayDateStr$: of('2026-01-20'),
      },
    );

    mockGlobalConfigService = jasmine.createSpyObj('GlobalConfigService', [], {
      // Pin the date locale so Intl-formatted headers are deterministic across
      // runners (an en-GB runner would render "20 Jan", not "Jan 20").
      localization: signal({ firstDayOfWeek: 1, dateTimeLocale: 'en-US' }),
      cfg: signal(undefined),
    });

    await TestBed.configureTestingModule({
      imports: [ScheduleComponent, TranslateModule.forRoot()],
      providers: [
        provideMockStore({ initialState: { issueProvider: { ids: [], entities: {} } } }),
        { provide: TaskService, useValue: mockTaskService },
        { provide: LayoutService, useValue: mockLayoutService },
        { provide: ScheduleService, useValue: mockScheduleService },
        { provide: MatDialog, useValue: mockMatDialog },
        {
          provide: CalendarEventActionsService,
          useValue: mockCalendarEventActionsService,
        },
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
    it('should go back exactly one day in day view', () => {
      mockLayoutService.selectedTimeView.set('day');
      mockScheduleService.getDaysToShow.and.returnValue(['2027-06-15']);
      component['_selectedDate'].set(new Date(2027, 5, 15)); // Jun 15, 2027 (future → no snap-to-today)
      fixture.detectChanges();
      expect(component.daysToShow().length).toBe(1);

      component.goToPreviousPeriod();

      const d = component['_selectedDate']();
      expect(d?.getFullYear()).toBe(2027);
      expect(d?.getMonth()).toBe(5);
      expect(d?.getDate()).toBe(14); // back by exactly one day
      expect(d?.getHours()).toBe(0); // normalized to midnight
    });

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
    it('should advance exactly one day in day view', () => {
      mockLayoutService.selectedTimeView.set('day');
      mockScheduleService.getDaysToShow.and.returnValue(['2027-06-15']);
      component['_selectedDate'].set(new Date(2027, 5, 15)); // Jun 15, 2027
      fixture.detectChanges();
      expect(component.daysToShow().length).toBe(1);

      component.goToNextPeriod();

      const d = component['_selectedDate']();
      expect(d?.getFullYear()).toBe(2027);
      expect(d?.getMonth()).toBe(5);
      expect(d?.getDate()).toBe(16); // advanced by exactly one day
      expect(d?.getHours()).toBe(0); // normalized to midnight
    });

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

    it('should keep the reference live as time passes rather than freezing at first read', () => {
      // The computed caches, and Date.now() is not reactive: without the refresh
      // tick this pins the layout to whenever the view was first rendered.
      let clock = new Date(2026, 0, 20, 9, 0, 0).getTime();
      spyOn(Date, 'now').and.callFake(() => clock);
      // Round-trip through a date: the computed already ran against the real
      // clock on init, and re-setting null over null would not invalidate it.
      component['_selectedDate'].set(new Date(2026, 0, 21));
      component['_selectedDate'].set(null);
      expect(component['_contextNow']()).toBe(clock);

      clock = new Date(2026, 0, 20, 17, 0, 0).getTime();
      (mockScheduleService as any).scheduleRefreshTick.set(1);

      expect(component['_contextNow']()).toBe(clock);
    });

    it('should keep using midnight when today sits later in the displayed week', () => {
      // Week view can show a range that starts before today; day 0 is fully
      // elapsed, so it stays the layout reference.
      const clock = new Date(2026, 0, 20, 9, 0, 0).getTime();
      spyOn(Date, 'now').and.callFake(() => clock);

      component['_selectedDate'].set(new Date(2026, 0, 19));

      expect(component['_contextNow']()).toBe(new Date(2026, 0, 19).setHours(0, 0, 0, 0));
    });

    it('should never anchor day 0 with a now that falls outside it', () => {
      // contextNow anchors dayDates[0], so a now past that day's end would push
      // every day-0 entry over its boundary and empty the column. Reachable with
      // a custom start-of-next-day, where the logical "today" is still Jan 20
      // while the wall clock already reads 02:00 on Jan 21.
      const clock = new Date(2026, 0, 21, 2, 0, 0).getTime();
      spyOn(Date, 'now').and.callFake(() => clock);

      component['_selectedDate'].set(new Date(2026, 0, 20));

      const contextNow = component['_contextNow']();
      expect(contextNow).toBeGreaterThanOrEqual(
        new Date(2026, 0, 20).setHours(0, 0, 0, 0),
      );
      expect(contextNow).toBeLessThan(new Date(2026, 0, 21).setHours(0, 0, 0, 0));
    });

    it('should switch to the real now once the viewed day rolls over into today', () => {
      // Viewing tomorrow at 22:00, then the app is left open past midnight. The
      // view does not move, so the day it shows silently becomes today.
      let clock = new Date(2026, 0, 20, 22, 0, 0).getTime();
      spyOn(Date, 'now').and.callFake(() => clock);
      component['_selectedDate'].set(new Date(2026, 0, 21));
      expect(component['_contextNow']()).toBe(new Date(2026, 0, 21).setHours(0, 0, 0, 0));

      // Rollover happens at 00:00 and the user comes back at 09:00; only the
      // refresh tick moves, exactly as in production.
      clock = new Date(2026, 0, 21, 9, 0, 0).getTime();
      (mockScheduleService as any).scheduleRefreshTick.set(1);

      expect(component['_contextNow']()).toBe(clock);
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
      // Arrange - a week past the mocked today (2026-01-20). The clock is pinned
      // so both timestamps can be named exactly; asserting only that they differ
      // would pass for arbitrary wrong values.
      const clock = new Date(2026, 0, 20, 9, 0, 0).getTime();
      spyOn(Date, 'now').and.callFake(() => clock);
      component['_selectedDate'].set(new Date(2026, 0, 27));
      mockScheduleService.createScheduleDaysWithContext.calls.reset();

      // Act
      component.scheduleDays();

      // Assert
      const callArgs =
        mockScheduleService.createScheduleDaysWithContext.calls.mostRecent().args[0];
      expect(callArgs.contextNow).toBe(new Date(2026, 0, 27).setHours(0, 0, 0, 0));
      expect(callArgs.realNow).toBe(clock);
    });
  });

  describe('monthEvents computed', () => {
    it('should include beyond-budget task events for the month view', () => {
      const beyondBudgetTask = {
        id: 'beyond-budget-task',
        title: 'Beyond budget task',
        timeEstimate: 30 * 60 * 1000,
        timeSpent: 0,
        subTaskIds: [],
        dueDay: '2026-01-20',
      } as unknown as ScheduleDay['beyondBudgetTasks'][number];
      const scheduleDays: ScheduleDay[] = [
        {
          dayDate: '2026-01-20',
          entries: [],
          beyondBudgetTasks: [beyondBudgetTask],
          isToday: true,
        },
      ];
      mockScheduleService.createScheduleDaysWithContext.and.returnValue(scheduleDays);
      component['_selectedDate'].set(new Date(2026, 0, 20));

      const result = component.monthEvents();

      expect(result.map((event) => event.id)).toContain('beyond-budget-task');
      expect(
        result.find((event) => event.id === 'beyond-budget-task')?.plannedForDay,
      ).toBe('2026-01-20');
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
    it('should return false in day view', () => {
      mockLayoutService.selectedTimeView.set('day');
      fixture.detectChanges();
      expect(component.shouldEnableHorizontalScroll()).toBe(false);
    });

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

  describe('showCalFilterBtn computed', () => {
    const makeProvider = (id: string): any => ({
      id,
      isEnabled: true,
      issueProviderKey: 'ICAL',
      icalUrl: `https://example.com/${id}.ics`,
    });

    beforeEach(() => {
      localStorage.removeItem('SUP_HIDDEN_CALENDAR_PROVIDER_IDS');
      const hidden = TestBed.inject(HiddenCalendarProvidersService);
      hidden.setHidden([]);
    });

    // overrideSelector mutates the selector itself, so always reset to avoid
    // leaking provider lists into unrelated tests later in the file.
    afterEach(() => {
      TestBed.inject(MockStore).resetSelectors();
    });

    it('should be false when no providers are enabled', () => {
      const store = TestBed.inject(MockStore);
      store.overrideSelector(selectCalendarProviders, []);
      store.refreshState();
      fixture.detectChanges();
      expect(component.showCalFilterBtn()).toBe(false);
    });

    it('should be false with a single visible provider', () => {
      const store = TestBed.inject(MockStore);
      store.overrideSelector(selectCalendarProviders, [makeProvider('only')]);
      store.refreshState();
      fixture.detectChanges();
      expect(component.showCalFilterBtn()).toBe(false);
    });

    it('should be true when the only enabled provider is hidden (C2 regression)', () => {
      const store = TestBed.inject(MockStore);
      store.overrideSelector(selectCalendarProviders, [makeProvider('only')]);
      store.refreshState();
      const hidden = TestBed.inject(HiddenCalendarProvidersService);
      hidden.setHidden(['only']);
      fixture.detectChanges();
      expect(component.showCalFilterBtn()).toBe(true);
    });

    it('should be true with multiple enabled providers', () => {
      const store = TestBed.inject(MockStore);
      store.overrideSelector(selectCalendarProviders, [
        makeProvider('a'),
        makeProvider('b'),
      ]);
      store.refreshState();
      fixture.detectChanges();
      expect(component.showCalFilterBtn()).toBe(true);
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

  describe('day view persistence', () => {
    afterEach(() => localStorage.removeItem('SELECTED_TIME_VIEW'));

    it('persists the day view and reads it back', () => {
      component.selectTimeView('day');
      expect(mockLayoutService.selectedTimeView()).toBe('day');
      expect(localStorage.getItem('SELECTED_TIME_VIEW')).toBe('day');
      // getTimeView is private; cast to reach it
      expect((component as any).getTimeView()).toBe('day');
    });

    it('reads back month, and defaults to week for absent or unknown values', () => {
      localStorage.setItem('SELECTED_TIME_VIEW', 'month');
      expect((component as any).getTimeView()).toBe('month');

      localStorage.removeItem('SELECTED_TIME_VIEW');
      expect((component as any).getTimeView()).toBe('week');

      localStorage.setItem('SELECTED_TIME_VIEW', 'not-a-view');
      expect((component as any).getTimeView()).toBe('week');
    });
  });

  describe('day view mode logic', () => {
    it('shows exactly one day in day mode', () => {
      mockScheduleService.getDaysToShow.and.returnValue(['2026-01-20']);
      mockLayoutService.selectedTimeView.set('day');
      fixture.detectChanges();
      expect((component as any)._daysToShowCount()).toBe(1);
      // Verify the count is actually wired into the day range (the mock returns
      // a fixed 1-element array regardless of args, so length alone is not proof).
      expect(mockScheduleService.getDaysToShow).toHaveBeenCalledWith(1, null);
      expect(component.daysToShow().length).toBe(1);
      expect(component.isDayView()).toBe(true);
      expect(component.isMonthView()).toBe(false);
    });

    it('renders the full single-date header when roomy', () => {
      // Force the roomy (non-tablet) state so the full form is deterministic
      // regardless of the test runner's window width.
      component['_isTablet'] = signal(false);
      mockScheduleService.getDaysToShow.and.returnValue(['2026-01-20']);
      mockLayoutService.selectedTimeView.set('day');
      fixture.detectChanges();
      // 2026-01-20 is a Tuesday (en-US locale pinned in beforeEach).
      expect(component.headerTitle()).toBe('Tue, Jan 20, 2026');
    });

    it('compacts the day header to month and day when tight', () => {
      component['_isTablet'] = signal(true);
      mockScheduleService.getDaysToShow.and.returnValue(['2026-01-20']);
      mockLayoutService.selectedTimeView.set('day');
      fixture.detectChanges();
      // Compact form is month + day only (no weekday, no year).
      expect(component.headerTitle()).toBe('Jan 20');
    });

    it('exposes mutually exclusive view-mode flags', () => {
      mockLayoutService.selectedTimeView.set('week');
      fixture.detectChanges();
      expect(component.isWeekView()).toBe(true);
      expect(component.isDayView()).toBe(false);
      expect(component.isMonthView()).toBe(false);

      mockLayoutService.selectedTimeView.set('day');
      fixture.detectChanges();
      expect(component.isDayView()).toBe(true);
      expect(component.isWeekView()).toBe(false);
      expect(component.isMonthView()).toBe(false);
    });
  });

  describe('day view toggle rendering', () => {
    afterEach(() => localStorage.removeItem('SELECTED_TIME_VIEW'));

    it('renders a schedule-week (not schedule-month) with one day when in day view', () => {
      mockScheduleService.getDaysToShow.and.returnValue(['2026-01-20']);
      mockLayoutService.selectedTimeView.set('day');
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('schedule-week')).toBeTruthy();
      expect(el.querySelector('schedule-month')).toBeFalsy();
    });

    it('has a day-view toggle button that selects day mode', () => {
      const el: HTMLElement = fixture.nativeElement;
      const dayBtn = el.querySelector<HTMLButtonElement>(
        '.time-view-btn.e2e-day-view-btn',
      );
      expect(dayBtn).toBeTruthy();
      dayBtn!.click();
      expect(mockLayoutService.selectedTimeView()).toBe('day');
    });
  });
});
