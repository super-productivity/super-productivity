import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { BehaviorSubject, firstValueFrom, of, Subject } from 'rxjs';
import { DateAdapter } from '@angular/material/core';
import { getWorklogWeekForDate, WorklogService } from './worklog.service';
import { WorkContextService } from '../work-context/work-context.service';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { TaskService } from '../tasks/task.service';
import { TimeTrackingService } from '../time-tracking/time-tracking.service';
import { TaskArchiveService } from '../archive/task-archive.service';
import { DateTimeFormatService } from 'src/app/core/date-time-format/date-time-format.service';
import { WorkContext, WorkContextType } from '../work-context/work-context.model';
import { Worklog, WorklogDay } from './worklog.model';
import { DateService } from '../../core/date/date.service';
import { parseDbDateStr } from '../../util/parse-db-date-str';

const MONDAY = 1;
const TUESDAY = 2;

const createWorklog = (dateStrs: string[]): Worklog => {
  const worklog: Worklog = {};

  dateStrs.forEach((dateStr, index) => {
    const [year, month, day] = dateStr.split('-').map(Number);
    const worklogDay: WorklogDay = {
      dateStr,
      dayStr: dateStr,
      logEntries: [],
      timeSpent: index + 1,
      workStart: 0,
      workEnd: 0,
    };

    worklog[year] ??= {
      timeSpent: 0,
      monthWorked: 0,
      daysWorked: 0,
      ent: {},
    };
    worklog[year].ent[month] ??= {
      timeSpent: 0,
      daysWorked: 0,
      ent: {},
      weeks: [],
    };
    worklog[year].ent[month].ent[day] = worklogDay;
  });

  return worklog;
};

const getDateStrs = (week: ReturnType<typeof getWorklogWeekForDate>): string[] =>
  Object.values(week?.ent ?? {})
    .map((day) => day.dateStr)
    .sort();

describe('getWorklogWeekForDate()', () => {
  it('returns earlier days when the current month has no worklog bucket yet', () => {
    const worklog = createWorklog([
      '2026-07-27',
      '2026-07-28',
      '2026-07-29',
      '2026-07-30',
      '2026-07-31',
    ]);

    const result = getWorklogWeekForDate(worklog, parseDbDateStr('2026-08-01'), MONDAY);

    expect(getDateStrs(result)).toEqual([
      '2026-07-27',
      '2026-07-28',
      '2026-07-29',
      '2026-07-30',
      '2026-07-31',
    ]);
    expect(result?.daysWorked).toBe(5);
  });

  it('merges the current week across a month boundary up to the selected date', () => {
    const worklog = createWorklog([
      '2026-07-27',
      '2026-07-28',
      '2026-07-29',
      '2026-07-30',
      '2026-07-31',
      '2026-08-01',
      '2026-08-02',
    ]);

    const result = getWorklogWeekForDate(worklog, parseDbDateStr('2026-08-01'), MONDAY);

    expect(getDateStrs(result)).toEqual([
      '2026-07-27',
      '2026-07-28',
      '2026-07-29',
      '2026-07-30',
      '2026-07-31',
      '2026-08-01',
    ]);
    expect(result?.daysWorked).toBe(6);
    expect(result?.timeSpent).toBe(21);
  });

  it('merges the current week across a year boundary', () => {
    const worklog = createWorklog([
      '2026-12-28',
      '2026-12-29',
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ]);

    const result = getWorklogWeekForDate(worklog, parseDbDateStr('2027-01-02'), MONDAY);

    expect(getDateStrs(result)).toEqual([
      '2026-12-28',
      '2026-12-29',
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ]);
    expect(result?.daysWorked).toBe(6);
  });

  it('uses the configured first day of the week', () => {
    const worklog = createWorklog(['2026-08-03', '2026-08-04', '2026-08-05']);

    const result = getWorklogWeekForDate(worklog, parseDbDateStr('2026-08-05'), TUESDAY);

    expect(getDateStrs(result)).toEqual(['2026-08-04', '2026-08-05']);
    expect(result?.daysWorked).toBe(2);
  });

  it('returns null when the current week has no worklog data', () => {
    const worklog = createWorklog(['2026-07-31']);

    const result = getWorklogWeekForDate(worklog, parseDbDateStr('2026-08-08'), MONDAY);

    expect(result).toBeNull();
  });
});

describe('WorklogService moment replacement', () => {
  describe('date string parsing', () => {
    it('should parse date strings to Date objects', () => {
      const testCases = [
        { dateStr: '2023-10-15', expected: new Date(2023, 9, 15) },
        { dateStr: '2024-01-01', expected: new Date(2024, 0, 1) },
        { dateStr: '2024-12-31', expected: new Date(2024, 11, 31) },
      ];

      testCases.forEach(({ dateStr, expected }) => {
        const [year, month, day] = dateStr.split('-').map(Number);
        const result = new Date(year, month - 1, day);
        expect(result.getTime()).toBe(expected.getTime());
      });
    });
  });
});

describe('WorklogService context-aware loading', () => {
  const ctxA: WorkContext = {
    id: 'project-A',
    type: WorkContextType.PROJECT,
    title: 'A',
  } as WorkContext;
  const ctxB: WorkContext = {
    id: 'project-B',
    type: WorkContextType.PROJECT,
    title: 'B',
  } as WorkContext;

  let activeWorkContext$: BehaviorSubject<WorkContext>;
  let routerEvents$: Subject<NavigationEnd>;
  let service: WorklogService;
  let loadCalls: WorkContext[];
  let worklogToLoad: Worklog;
  let getFirstDayOfWeek: jasmine.Spy<() => number>;
  let getLogicalTodayDate: jasmine.Spy<() => Date>;

  beforeEach(() => {
    activeWorkContext$ = new BehaviorSubject<WorkContext>(ctxA);
    routerEvents$ = new Subject<NavigationEnd>();
    loadCalls = [];
    worklogToLoad = {};
    getFirstDayOfWeek = jasmine.createSpy().and.returnValue(TUESDAY);
    getLogicalTodayDate = jasmine
      .createSpy()
      .and.returnValue(parseDbDateStr('2026-08-05'));

    TestBed.configureTestingModule({
      providers: [
        WorklogService,
        {
          provide: WorkContextService,
          useValue: { activeWorkContext$: activeWorkContext$.asObservable() },
        },
        {
          provide: DataInitStateService,
          useValue: { isAllDataLoadedInitially$: of(true) },
        },
        {
          provide: TaskService,
          useValue: { taskFeatureState$: of({ ids: [], entities: {} }) },
        },
        {
          provide: TimeTrackingService,
          useValue: {
            getLegacyWorkStartEndForWorkContext: () => Promise.resolve({}),
          },
        },
        {
          provide: TaskArchiveService,
          useValue: { load: () => Promise.resolve({ ids: [], entities: {} }) },
        },
        {
          provide: Router,
          useValue: { events: routerEvents$.asObservable() },
        },
        {
          provide: DateAdapter,
          useValue: { getFirstDayOfWeek },
        },
        {
          provide: DateService,
          useValue: { getLogicalTodayDate },
        },
        {
          provide: DateTimeFormatService,
          useValue: { textLocale: () => 'en-US' },
        },
      ],
    });
    service = TestBed.inject(WorklogService);

    spyOn<any>(service, '_loadWorklogForWorkContext').and.callFake((ctx: WorkContext) => {
      loadCalls.push(ctx);
      return Promise.resolve({ worklog: worklogToLoad, totalTimeSpent: 0 });
    });
  });

  it('uses the logical date and configured week start for currentWeek$', async () => {
    worklogToLoad = createWorklog(['2026-08-03', '2026-08-04', '2026-08-05']);

    const result = await firstValueFrom(service.currentWeek$);

    expect(getLogicalTodayDate).toHaveBeenCalledOnceWith();
    expect(getFirstDayOfWeek).toHaveBeenCalledOnceWith();
    expect(getDateStrs(result)).toEqual(['2026-08-04', '2026-08-05']);
  });

  it('reloads the worklog when the active context changes', async () => {
    const sub = service.worklog$.subscribe();
    // Let the initial load complete.
    await Promise.resolve();
    await Promise.resolve();

    expect(loadCalls.length).toBe(1);
    expect(loadCalls[0].id).toBe('project-A');

    activeWorkContext$.next(ctxB);
    await Promise.resolve();
    await Promise.resolve();

    expect(loadCalls.length).toBe(2);
    expect(loadCalls[1].id).toBe('project-B');

    sub.unsubscribe();
  });

  it('reloads on manual refresh even when the context has not changed', async () => {
    const sub = service.worklog$.subscribe();
    await Promise.resolve();
    await Promise.resolve();
    expect(loadCalls.length).toBe(1);

    service.refreshWorklog();
    await Promise.resolve();
    await Promise.resolve();

    // refreshWorklog() must always trigger a reload — the worklog page's
    // refresh button and post-edit refresh paths depend on this.
    expect(loadCalls.length).toBe(2);
    expect(loadCalls[1].id).toBe('project-A');

    sub.unsubscribe();
  });

  it('reloads on navigation to a metrics/worklog URL even on the same context', async () => {
    const sub = service.worklog$.subscribe();
    await Promise.resolve();
    await Promise.resolve();
    expect(loadCalls.length).toBe(1);

    routerEvents$.next(
      new NavigationEnd(1, '/project/project-A/metrics', '/project/project-A/metrics'),
    );
    await Promise.resolve();
    await Promise.resolve();

    // Visiting the page may need to reflect data that changed since last view.
    expect(loadCalls.length).toBe(2);
    expect(loadCalls[1].id).toBe('project-A');

    sub.unsubscribe();
  });
});
