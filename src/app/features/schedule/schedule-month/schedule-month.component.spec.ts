import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ScheduleMonthComponent } from './schedule-month.component';
import { ScheduleService } from '../schedule.service';
import { DateTimeFormatService } from '../../../core/date-time-format/date-time-format.service';
import { parseDbDateStr } from '../../../util/parse-db-date-str';

describe('ScheduleMonthComponent', () => {
  let component: ScheduleMonthComponent;
  let fixture: ComponentFixture<ScheduleMonthComponent>;
  let mockScheduleService: jasmine.SpyObj<ScheduleService>;
  let mockDateTimeFormatService: jasmine.SpyObj<DateTimeFormatService>;

  beforeEach(async () => {
    mockScheduleService = jasmine.createSpyObj('ScheduleService', [
      'getDayClass',
      'hasEventsForDay',
      'getEventsForDay',
      'getEventDayStr',
    ]);
    mockScheduleService.getDayClass.and.returnValue('');
    mockScheduleService.hasEventsForDay.and.returnValue(false);
    mockScheduleService.getEventsForDay.and.returnValue([]);
    mockScheduleService.getEventDayStr.and.returnValue(null);

    mockDateTimeFormatService = jasmine.createSpyObj('DateTimeFormatService', ['-'], {
      currentLocale: 'en-US',
    });

    await TestBed.configureTestingModule({
      imports: [ScheduleMonthComponent],
      providers: [
        { provide: ScheduleService, useValue: mockScheduleService },
        { provide: DateTimeFormatService, useValue: mockDateTimeFormatService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ScheduleMonthComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('referenceMonth computed', () => {
    it('should return current date when daysToShow is empty', () => {
      // Arrange
      fixture.componentRef.setInput('daysToShow', []);
      fixture.detectChanges();

      // Act
      const result = component.referenceMonth();

      // Assert
      expect(result).toBeInstanceOf(Date);
      // Should be close to current date
      const now = new Date();
      expect(Math.abs(result.getTime() - now.getTime())).toBeLessThan(1000);
    });

    it('should use middle day from daysToShow as reference', () => {
      // Arrange - Create a month view for January 2026
      const days = [
        '2025-12-29', // Week 1 - padding from prev month
        '2025-12-30',
        '2025-12-31',
        '2026-01-01',
        '2026-01-02',
        '2026-01-03',
        '2026-01-04',
        '2026-01-05', // Week 2
        '2026-01-06',
        '2026-01-07',
        '2026-01-08',
        '2026-01-09',
        '2026-01-10',
        '2026-01-11',
        '2026-01-12', // Week 3 - Middle of month
        '2026-01-13',
        '2026-01-14', // Day 14 - near middle
        '2026-01-15', // Middle index (14/2 = 7, but floor(28/2) = 14)
        '2026-01-16',
        '2026-01-17',
        '2026-01-18',
        '2026-01-19', // Week 4
        '2026-01-20',
        '2026-01-21',
        '2026-01-22',
        '2026-01-23',
        '2026-01-24',
        '2026-01-25',
      ];
      fixture.componentRef.setInput('daysToShow', days);
      fixture.detectChanges();

      // Act
      const result = component.referenceMonth();

      // Assert
      // Middle index = floor(28/2) = 14, which is '2026-01-12'
      expect(result.getFullYear()).toBe(2026);
      expect(result.getMonth()).toBe(0); // January
      expect(result.getDate()).toBe(12);
    });

    it('should handle a 5-week month view', () => {
      // Arrange - 35 days (5 weeks)
      const days: string[] = [];
      const startDate = new Date(2026, 0, 1); // Jan 1, 2026
      for (let i = 0; i < 35; i++) {
        const date = new Date(startDate);
        date.setDate(date.getDate() + i);
        days.push(date.toISOString().split('T')[0]);
      }
      fixture.componentRef.setInput('daysToShow', days);
      fixture.detectChanges();

      // Act
      const result = component.referenceMonth();

      // Assert
      // Middle index = floor(35/2) = 17
      const middleDay = parseDbDateStr(days[17]);
      expect(result.getFullYear()).toBe(middleDay.getFullYear());
      expect(result.getMonth()).toBe(middleDay.getMonth());
      expect(result.getDate()).toBe(middleDay.getDate());
    });

    it('should handle a 6-week month view', () => {
      // Arrange - 42 days (6 weeks)
      const days: string[] = [];
      const startDate = new Date(2026, 0, 1);
      for (let i = 0; i < 42; i++) {
        const date = new Date(startDate);
        date.setDate(date.getDate() + i);
        days.push(date.toISOString().split('T')[0]);
      }
      fixture.componentRef.setInput('daysToShow', days);
      fixture.detectChanges();

      // Act
      const result = component.referenceMonth();

      // Assert
      // Middle index = floor(42/2) = 21
      const middleDay = parseDbDateStr(days[21]);
      expect(result.getFullYear()).toBe(middleDay.getFullYear());
      expect(result.getMonth()).toBe(middleDay.getMonth());
    });
  });

  describe('getDayClass', () => {
    it('should pass referenceMonth to service.getDayClass', () => {
      // Arrange
      const days = ['2026-01-15', '2026-01-16', '2026-01-17'];
      fixture.componentRef.setInput('daysToShow', days);
      fixture.detectChanges();
      mockScheduleService.getDayClass.calls.reset();

      const testDay = '2026-01-15';

      // Act
      component.getDayClass(testDay);

      // Assert
      expect(mockScheduleService.getDayClass).toHaveBeenCalled();
      const args = mockScheduleService.getDayClass.calls.mostRecent().args;
      expect(args[0]).toBe(testDay);
      expect(args[1]).toBeInstanceOf(Date);
      // Reference month should be the middle day
      const referenceMonth = args[1] as Date;
      expect(referenceMonth.getFullYear()).toBe(2026);
      expect(referenceMonth.getMonth()).toBe(0); // January
    });

    it('should return the class string from service', () => {
      // Arrange
      mockScheduleService.getDayClass.and.returnValue('test-class');
      const days = ['2026-01-15'];
      fixture.componentRef.setInput('daysToShow', days);
      fixture.detectChanges();

      // Act
      const result = component.getDayClass('2026-01-15');

      // Assert
      expect(result).toBe('test-class');
    });

    it('should handle "other-month" class for padding days', () => {
      // Arrange
      mockScheduleService.getDayClass.and.callFake((day: string, ref?: Date) => {
        const dayDate = parseDbDateStr(day);
        if (ref && dayDate.getMonth() !== ref.getMonth()) {
          return 'other-month';
        }
        return '';
      });

      const days = [
        '2025-12-31', // Previous month
        '2026-01-01', // Current month
        '2026-02-01', // Next month
      ];
      fixture.componentRef.setInput('daysToShow', days);
      fixture.detectChanges();

      // Act
      const prevMonthClass = component.getDayClass('2025-12-31');
      const currentMonthClass = component.getDayClass('2026-01-01');
      const nextMonthClass = component.getDayClass('2026-02-01');

      // Assert
      expect(prevMonthClass).toBe('other-month');
      expect(currentMonthClass).toBe('');
      expect(nextMonthClass).toBe('other-month');
    });
  });

  describe('getWeekIndex', () => {
    it('should return 0 for first week (days 0-6)', () => {
      expect(component.getWeekIndex(0)).toBe(0);
      expect(component.getWeekIndex(3)).toBe(0);
      expect(component.getWeekIndex(6)).toBe(0);
    });

    it('should return 1 for second week (days 7-13)', () => {
      expect(component.getWeekIndex(7)).toBe(1);
      expect(component.getWeekIndex(10)).toBe(1);
      expect(component.getWeekIndex(13)).toBe(1);
    });

    it('should return correct week index for later weeks', () => {
      expect(component.getWeekIndex(14)).toBe(2);
      expect(component.getWeekIndex(21)).toBe(3);
      expect(component.getWeekIndex(28)).toBe(4);
      expect(component.getWeekIndex(35)).toBe(5);
    });
  });

  describe('getDayIndex', () => {
    it('should return 0-6 for days within a week', () => {
      expect(component.getDayIndex(0)).toBe(0);
      expect(component.getDayIndex(1)).toBe(1);
      expect(component.getDayIndex(6)).toBe(6);
      expect(component.getDayIndex(7)).toBe(0);
      expect(component.getDayIndex(13)).toBe(6);
      expect(component.getDayIndex(14)).toBe(0);
    });
  });

  describe('weekdayHeaders computed', () => {
    it('should generate 7 weekday headers', () => {
      // Arrange
      fixture.componentRef.setInput('firstDayOfWeek', 0); // Sunday
      fixture.detectChanges();

      // Act
      const headers = component.weekdayHeaders();

      // Assert
      expect(headers.length).toBe(7);
    });

    it('should start with Sunday when firstDayOfWeek is 0', () => {
      // Arrange
      fixture.componentRef.setInput('firstDayOfWeek', 0);
      fixture.detectChanges();

      // Act
      const headers = component.weekdayHeaders();

      // Assert
      // Sunday should be first
      expect(headers[0]).toContain('Sun');
    });

    it('should start with Monday when firstDayOfWeek is 1', () => {
      // Arrange
      fixture.componentRef.setInput('firstDayOfWeek', 1);
      fixture.detectChanges();

      // Act
      const headers = component.weekdayHeaders();

      // Assert
      // Monday should be first
      expect(headers[0]).toContain('Mon');
    });

    it('should cycle correctly for all days of week', () => {
      // Arrange
      fixture.componentRef.setInput('firstDayOfWeek', 0); // Sunday
      fixture.detectChanges();

      // Act
      const headers = component.weekdayHeaders();

      // Assert
      expect(headers.length).toBe(7);
      // Should have all unique days
      const uniqueHeaders = new Set(headers);
      expect(uniqueHeaders.size).toBe(7);
    });
  });

  describe('Service method delegation', () => {
    it('should delegate hasEventsForDay to service', () => {
      // Arrange
      mockScheduleService.hasEventsForDay.and.returnValue(true);
      const testDay = '2026-01-15';
      const testEvents = [] as any;
      fixture.componentRef.setInput('events', testEvents);
      fixture.detectChanges();

      // Act
      const result = component.hasEventsForDay(testDay);

      // Assert
      expect(mockScheduleService.hasEventsForDay).toHaveBeenCalledWith(
        testDay,
        testEvents,
      );
      expect(result).toBe(true);
    });

    it('should delegate getEventsForDay to service', () => {
      // Arrange
      const testEvents = [{ id: 'event1' }] as any;
      mockScheduleService.getEventsForDay.and.returnValue(testEvents);
      const testDay = '2026-01-15';
      fixture.componentRef.setInput('events', []);
      fixture.detectChanges();

      // Act
      const result = component.getEventsForDay(testDay);

      // Assert
      expect(mockScheduleService.getEventsForDay).toHaveBeenCalledWith(testDay, []);
      expect(result).toEqual(testEvents);
    });

    it('should delegate getEventDayStr to service', () => {
      // Arrange
      const testEvent = { id: 'event1' } as any;
      mockScheduleService.getEventDayStr.and.returnValue('2026-01-15');

      // Act
      const result = component.getEventDayStr(testEvent);

      // Assert
      expect(mockScheduleService.getEventDayStr).toHaveBeenCalledWith(testEvent);
      expect(result).toBe('2026-01-15');
    });
  });

  describe('Input handling', () => {
    it('should accept events input', () => {
      // Arrange
      const testEvents = [{ id: 'event1' }] as any;

      // Act
      fixture.componentRef.setInput('events', testEvents);
      fixture.detectChanges();

      // Assert
      expect(component.events()).toEqual(testEvents);
    });

    it('should accept daysToShow input', () => {
      // Arrange
      const testDays = ['2026-01-01', '2026-01-02', '2026-01-03'];

      // Act
      fixture.componentRef.setInput('daysToShow', testDays);
      fixture.detectChanges();

      // Assert
      expect(component.daysToShow()).toEqual(testDays);
    });

    it('should accept weeksToShow input', () => {
      // Arrange
      const testWeeks = 5;

      // Act
      fixture.componentRef.setInput('weeksToShow', testWeeks);
      fixture.detectChanges();

      // Assert
      expect(component.weeksToShow()).toBe(testWeeks);
    });

    it('should accept firstDayOfWeek input', () => {
      // Arrange
      const testFirstDay = 1; // Monday

      // Act
      fixture.componentRef.setInput('firstDayOfWeek', testFirstDay);
      fixture.detectChanges();

      // Assert
      expect(component.firstDayOfWeek()).toBe(testFirstDay);
    });

    it('should default weeksToShow to 6', () => {
      // Act & Assert
      expect(component.weeksToShow()).toBe(6);
    });

    it('should default firstDayOfWeek to 1', () => {
      // Act & Assert
      expect(component.firstDayOfWeek()).toBe(1);
    });
  });
});
