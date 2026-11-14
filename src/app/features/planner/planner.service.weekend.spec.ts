import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { BehaviorSubject, of } from 'rxjs';
import { first } from 'rxjs/operators';
import { signal } from '@angular/core';
import { PlannerService } from './planner.service';
import { DateService } from '../../core/date/date.service';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';
import { CalendarIntegrationService } from '../calendar-integration/calendar-integration.service';
import { GlobalTrackingIntervalService } from '../../core/global-tracking-interval/global-tracking-interval.service';
import { LayoutService } from '../../core-ui/layout/layout.service';
import {
  selectAllTasksWithDueTime,
  selectMapOfAllTasksInActiveProjects,
} from '../tasks/store/task.selectors';
import { selectActiveTaskRepeatCfgs } from '../task-repeat-cfg/store/task-repeat-cfg.selectors';
import { selectTodayTaskIds } from '../work-context/store/work-context.selectors';
import { selectPlannerState } from './store/planner.selectors';
import { selectTimelineConfig } from '../config/store/global-config.reducer';
import { selectStartOfNextDayDiffMs } from '../../root-store/app-state/app-state.selectors';

/**
 * `days$` itself, without the mock override the main spec installs: the weekend
 * filter must never strand today (#7240 review).
 */
describe('PlannerService days$ with weekends hidden', () => {
  let service: PlannerService;
  let mockStore: MockStore;
  let todayDateStrSubject: BehaviorSubject<string>;

  const timeline = (isHideWeekends: boolean): unknown => ({
    isHideWeekends,
    isWorkStartEndEnabled: false,
    workStart: '09:00',
    workEnd: '17:00',
    isLunchBreakEnabled: false,
    lunchBreakStart: '12:00',
    lunchBreakEnd: '13:00',
  });

  beforeEach(() => {
    todayDateStrSubject = new BehaviorSubject<string>('2026-11-14'); // Saturday

    TestBed.configureTestingModule({
      providers: [
        DateService,
        PlannerService,
        provideMockStore({
          selectors: [
            { selector: selectAllTasksWithDueTime, value: [] },
            { selector: selectActiveTaskRepeatCfgs, value: [] },
            { selector: selectTodayTaskIds, value: [] },
            { selector: selectMapOfAllTasksInActiveProjects, value: new Map() },
            {
              selector: selectPlannerState,
              value: { days: {}, addPlannedTasksDialogLastShown: undefined },
            },
            { selector: selectTimelineConfig, value: timeline(true) },
            { selector: selectStartOfNextDayDiffMs, value: 0 },
          ],
        }),
        {
          provide: CalendarIntegrationService,
          useValue: { calendarEvents$: of([]) },
        },
        {
          provide: GlobalTrackingIntervalService,
          useValue: { todayDateStr$: todayDateStrSubject.asObservable() },
        },
        {
          provide: LayoutService,
          useValue: { isXs: signal(false) },
        },
        {
          provide: DateTimeFormatService,
          useValue: { currentLocale: () => 'en-us' },
        },
      ],
    });

    mockStore = TestBed.inject(MockStore);
    service = TestBed.inject(PlannerService);
  });

  it('should keep the today column when today is a hidden weekend day', (done) => {
    const dateService = TestBed.inject(DateService);
    spyOn(dateService, 'getLogicalTodayDate').and.returnValue(
      new Date(2026, 10, 14, 12, 0, 0),
    );

    service.days$.pipe(first()).subscribe((days) => {
      expect(days[0].dayDate).toBe('2026-11-14');
      expect(days[0].isToday).toBeTrue();
      // the Sunday is empty and not today, so it stays hidden
      expect(days.map((d) => d.dayDate)).not.toContain('2026-11-15');
      done();
    });
  });

  it('should keep tomorrow available to Finish day even when it is hidden', (done) => {
    const dateService = TestBed.inject(DateService);
    spyOn(dateService, 'getLogicalTodayDate').and.returnValue(
      new Date(2026, 10, 13, 12, 0, 0), // Friday
    );
    spyOn(dateService, 'getLogicalTomorrowMs').and.returnValue(
      new Date(2026, 10, 14, 12, 0, 0).getTime(), // Saturday
    );
    todayDateStrSubject.next('2026-11-13');
    mockStore.refreshState();

    service.tomorrow$.pipe(first()).subscribe((tomorrow) => {
      expect(tomorrow?.dayDate).toBe('2026-11-14');
      done();
    });
  });
});
