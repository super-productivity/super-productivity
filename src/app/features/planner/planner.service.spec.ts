import { TestBed } from '@angular/core/testing';
import { PlannerService } from './planner.service';
import { DateService } from '../../core/date/date.service';
import { provideMockStore } from '@ngrx/store/testing';
import { of, BehaviorSubject, ReplaySubject } from 'rxjs';
import { CalendarIntegrationService } from '../calendar-integration/calendar-integration.service';
import { GlobalTrackingIntervalService } from '../../core/global-tracking-interval/global-tracking-interval.service';
import { selectAllTasksWithDueTime } from '../tasks/store/task.selectors';
import { selectAllTaskRepeatCfgs } from '../task-repeat-cfg/store/task-repeat-cfg.selectors';
import { selectTodayTaskIds } from '../work-context/store/work-context.selectors';
import { PlannerDay } from './planner.model';
import { first, map } from 'rxjs/operators';
import { getDbDateStr } from '../../util/get-db-date-str';

describe('PlannerService', () => {
  let service: PlannerService;
  let dateService: DateService;
  let todayDateStrSubject: BehaviorSubject<string>;
  let mockDaysSubject: ReplaySubject<PlannerDay[]>;

  const createMockPlannerDay = (dayDate: string): PlannerDay => ({
    dayDate,
    timeEstimate: 0,
    timeLimit: 0,
    itemsTotal: 0,
    tasks: [],
    noStartTimeRepeatProjections: [],
    allDayEvents: [],
    scheduledIItems: [],
  });

  beforeEach(() => {
    todayDateStrSubject = new BehaviorSubject<string>('2026-01-14');
    mockDaysSubject = new ReplaySubject<PlannerDay[]>(1);

    TestBed.configureTestingModule({
      providers: [
        DateService,
        provideMockStore({
          selectors: [
            { selector: selectAllTasksWithDueTime, value: [] },
            { selector: selectAllTaskRepeatCfgs, value: [] },
            { selector: selectTodayTaskIds, value: [] },
          ],
        }),
        {
          provide: CalendarIntegrationService,
          useValue: { icalEvents$: of([]) },
        },
        {
          provide: GlobalTrackingIntervalService,
          useValue: { todayDateStr$: todayDateStrSubject.asObservable() },
        },
        {
          provide: PlannerService,
          useFactory: () => {
            const svc = new PlannerService();

            // Override days$ to use our mock subject
            Object.defineProperty(svc, 'days$', {
              get: () => mockDaysSubject.asObservable(),
            });

            // Recreate tomorrow$ with the mocked days$
            Object.defineProperty(svc, 'tomorrow$', {
              get: () =>
                mockDaysSubject.pipe(
                  map((days) => {
                    const ds = TestBed.inject(DateService);
                    const todayMs = Date.now() - ds.startOfNextDayDiff;
                    // eslint-disable-next-line no-mixed-operators
                    const tomorrowMs = todayMs + 24 * 60 * 60 * 1000;
                    const tomorrowStr = getDbDateStr(tomorrowMs);
                    return days.find((d) => d.dayDate === tomorrowStr) ?? null;
                  }),
                ),
            });

            return svc;
          },
        },
      ],
    });

    dateService = TestBed.inject(DateService);
    service = TestBed.inject(PlannerService);
  });

  afterEach(() => {
    jasmine.clock().uninstall();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('tomorrow$', () => {
    describe('basic functionality', () => {
      it('should return the day matching tomorrow from the days array', (done) => {
        const testDate = new Date(2026, 0, 14, 12, 0, 0); // Jan 14, 2026, noon
        jasmine.clock().install();
        jasmine.clock().mockDate(testDate);

        const tomorrowStr = '2026-01-15';
        const mockDays: PlannerDay[] = [
          createMockPlannerDay('2026-01-14'),
          createMockPlannerDay(tomorrowStr),
          createMockPlannerDay('2026-01-16'),
        ];

        mockDaysSubject.next(mockDays);

        service.tomorrow$.pipe(first()).subscribe((result) => {
          expect(result).toBeTruthy();
          expect(result!.dayDate).toBe(tomorrowStr);
          done();
        });
      });

      it('should return null if tomorrow is not in the days array', (done) => {
        const testDate = new Date(2026, 0, 14, 12, 0, 0);
        jasmine.clock().install();
        jasmine.clock().mockDate(testDate);

        const mockDays: PlannerDay[] = [
          createMockPlannerDay('2026-01-14'),
          createMockPlannerDay('2026-01-16'), // Skip tomorrow
        ];

        mockDaysSubject.next(mockDays);

        service.tomorrow$.pipe(first()).subscribe((result) => {
          expect(result).toBeNull();
          done();
        });
      });

      it('should find tomorrow even if not at index 1', (done) => {
        const testDate = new Date(2026, 0, 14, 12, 0, 0);
        jasmine.clock().install();
        jasmine.clock().mockDate(testDate);

        const tomorrowStr = '2026-01-15';
        const mockDays: PlannerDay[] = [
          createMockPlannerDay('2026-01-14'),
          createMockPlannerDay('2026-01-18'), // Not tomorrow
          createMockPlannerDay('2026-01-19'),
          createMockPlannerDay(tomorrowStr), // Tomorrow at index 3
        ];

        mockDaysSubject.next(mockDays);

        service.tomorrow$.pipe(first()).subscribe((result) => {
          expect(result).toBeTruthy();
          expect(result!.dayDate).toBe(tomorrowStr);
          done();
        });
      });
    });

    describe('timezone handling', () => {
      it('should correctly calculate tomorrow near midnight in UTC+ timezone', (done) => {
        // Simulate Jan 14, 2026 at 23:30 local time
        // In a UTC+ timezone, this is still Jan 14 locally
        const testDate = new Date(2026, 0, 14, 23, 30, 0);
        jasmine.clock().install();
        jasmine.clock().mockDate(testDate);

        const tomorrowStr = '2026-01-15';
        const mockDays: PlannerDay[] = [
          createMockPlannerDay('2026-01-14'),
          createMockPlannerDay(tomorrowStr),
          createMockPlannerDay('2026-01-16'),
        ];

        mockDaysSubject.next(mockDays);

        service.tomorrow$.pipe(first()).subscribe((result) => {
          expect(result).toBeTruthy();
          expect(result!.dayDate).toBe(tomorrowStr);
          done();
        });
      });

      it('should correctly calculate tomorrow near midnight in UTC- timezone', (done) => {
        // Simulate Jan 14, 2026 at 00:30 local time
        const testDate = new Date(2026, 0, 14, 0, 30, 0);
        jasmine.clock().install();
        jasmine.clock().mockDate(testDate);

        const tomorrowStr = '2026-01-15';
        const mockDays: PlannerDay[] = [
          createMockPlannerDay('2026-01-14'),
          createMockPlannerDay(tomorrowStr),
          createMockPlannerDay('2026-01-16'),
        ];

        mockDaysSubject.next(mockDays);

        service.tomorrow$.pipe(first()).subscribe((result) => {
          expect(result).toBeTruthy();
          expect(result!.dayDate).toBe(tomorrowStr);
          done();
        });
      });
    });

    describe('startOfNextDayDiff handling', () => {
      it('should respect startOfNextDayDiff=0 (default)', (done) => {
        // Jan 14, 2026 at 2am - should still be Jan 14
        const testDate = new Date(2026, 0, 14, 2, 0, 0);
        jasmine.clock().install();
        jasmine.clock().mockDate(testDate);

        dateService.setStartOfNextDayDiff(0);

        const mockDays: PlannerDay[] = [
          createMockPlannerDay('2026-01-14'),
          createMockPlannerDay('2026-01-15'),
        ];

        mockDaysSubject.next(mockDays);

        service.tomorrow$.pipe(first()).subscribe((result) => {
          expect(result).toBeTruthy();
          expect(result!.dayDate).toBe('2026-01-15');
          done();
        });
      });

      it('should respect startOfNextDayDiff when set to 4 hours', (done) => {
        // Jan 14, 2026 at 2am with startOfNextDay=4 means we're still in "Jan 13" logically
        // So tomorrow should be Jan 14
        const testDate = new Date(2026, 0, 14, 2, 0, 0);
        jasmine.clock().install();
        jasmine.clock().mockDate(testDate);

        dateService.setStartOfNextDayDiff(4); // 4 hours offset

        const mockDays: PlannerDay[] = [
          createMockPlannerDay('2026-01-13'),
          createMockPlannerDay('2026-01-14'),
          createMockPlannerDay('2026-01-15'),
        ];

        mockDaysSubject.next(mockDays);

        service.tomorrow$.pipe(first()).subscribe((result) => {
          expect(result).toBeTruthy();
          // At 2am with 4-hour offset, "today" is logically Jan 13, so "tomorrow" is Jan 14
          expect(result!.dayDate).toBe('2026-01-14');
          done();
        });
      });

      it('should respect startOfNextDayDiff when set to 4 hours and past that time', (done) => {
        // Jan 14, 2026 at 5am with startOfNextDay=4 means we're in "Jan 14" logically
        // So tomorrow should be Jan 15
        const testDate = new Date(2026, 0, 14, 5, 0, 0);
        jasmine.clock().install();
        jasmine.clock().mockDate(testDate);

        dateService.setStartOfNextDayDiff(4); // 4 hours offset

        const mockDays: PlannerDay[] = [
          createMockPlannerDay('2026-01-14'),
          createMockPlannerDay('2026-01-15'),
          createMockPlannerDay('2026-01-16'),
        ];

        mockDaysSubject.next(mockDays);

        service.tomorrow$.pipe(first()).subscribe((result) => {
          expect(result).toBeTruthy();
          // At 5am with 4-hour offset, "today" is logically Jan 14, so "tomorrow" is Jan 15
          expect(result!.dayDate).toBe('2026-01-15');
          done();
        });
      });
    });

    describe('edge cases', () => {
      it('should handle empty days array', (done) => {
        const testDate = new Date(2026, 0, 14, 12, 0, 0);
        jasmine.clock().install();
        jasmine.clock().mockDate(testDate);

        mockDaysSubject.next([]);

        service.tomorrow$.pipe(first()).subscribe((result) => {
          expect(result).toBeNull();
          done();
        });
      });

      it('should handle month boundary (Jan 31 -> Feb 1)', (done) => {
        const testDate = new Date(2026, 0, 31, 12, 0, 0); // Jan 31, 2026
        jasmine.clock().install();
        jasmine.clock().mockDate(testDate);

        const tomorrowStr = '2026-02-01';
        const mockDays: PlannerDay[] = [
          createMockPlannerDay('2026-01-31'),
          createMockPlannerDay(tomorrowStr),
        ];

        mockDaysSubject.next(mockDays);

        service.tomorrow$.pipe(first()).subscribe((result) => {
          expect(result).toBeTruthy();
          expect(result!.dayDate).toBe(tomorrowStr);
          done();
        });
      });

      it('should handle year boundary (Dec 31 -> Jan 1)', (done) => {
        const testDate = new Date(2025, 11, 31, 12, 0, 0); // Dec 31, 2025
        jasmine.clock().install();
        jasmine.clock().mockDate(testDate);

        const tomorrowStr = '2026-01-01';
        const mockDays: PlannerDay[] = [
          createMockPlannerDay('2025-12-31'),
          createMockPlannerDay(tomorrowStr),
        ];

        mockDaysSubject.next(mockDays);

        service.tomorrow$.pipe(first()).subscribe((result) => {
          expect(result).toBeTruthy();
          expect(result!.dayDate).toBe(tomorrowStr);
          done();
        });
      });

      it('should handle leap year (Feb 28, 2024 -> Feb 29, 2024)', (done) => {
        const testDate = new Date(2024, 1, 28, 12, 0, 0); // Feb 28, 2024 (leap year)
        jasmine.clock().install();
        jasmine.clock().mockDate(testDate);

        const tomorrowStr = '2024-02-29';
        const mockDays: PlannerDay[] = [
          createMockPlannerDay('2024-02-28'),
          createMockPlannerDay(tomorrowStr),
        ];

        mockDaysSubject.next(mockDays);

        service.tomorrow$.pipe(first()).subscribe((result) => {
          expect(result).toBeTruthy();
          expect(result!.dayDate).toBe(tomorrowStr);
          done();
        });
      });

      it('should handle non-leap year (Feb 28, 2025 -> Mar 1, 2025)', (done) => {
        const testDate = new Date(2025, 1, 28, 12, 0, 0); // Feb 28, 2025 (non-leap year)
        jasmine.clock().install();
        jasmine.clock().mockDate(testDate);

        const tomorrowStr = '2025-03-01';
        const mockDays: PlannerDay[] = [
          createMockPlannerDay('2025-02-28'),
          createMockPlannerDay(tomorrowStr),
        ];

        mockDaysSubject.next(mockDays);

        service.tomorrow$.pipe(first()).subscribe((result) => {
          expect(result).toBeTruthy();
          expect(result!.dayDate).toBe(tomorrowStr);
          done();
        });
      });
    });
  });
});
