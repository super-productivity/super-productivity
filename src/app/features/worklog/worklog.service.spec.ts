import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { BehaviorSubject, of, Subject } from 'rxjs';
import { DateAdapter } from '@angular/material/core';
import { WorklogService } from './worklog.service';
import { WorkContextService } from '../work-context/work-context.service';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { TaskService } from '../tasks/task.service';
import { TimeTrackingService } from '../time-tracking/time-tracking.service';
import { TaskArchiveService } from '../archive/task-archive.service';
import { DateTimeFormatService } from 'src/app/core/date-time-format/date-time-format.service';
import { WorkContext, WorkContextType } from '../work-context/work-context.model';

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

  beforeEach(() => {
    activeWorkContext$ = new BehaviorSubject<WorkContext>(ctxA);
    routerEvents$ = new Subject<NavigationEnd>();
    loadCalls = [];

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
          useValue: { getFirstDayOfWeek: () => 0 },
        },
        {
          provide: DateTimeFormatService,
          useValue: { currentLocale: () => 'en-US' },
        },
      ],
    });
    service = TestBed.inject(WorklogService);

    spyOn<any>(service, '_loadWorklogForWorkContext').and.callFake((ctx: WorkContext) => {
      loadCalls.push(ctx);
      return Promise.resolve({ worklog: {}, totalTimeSpent: 0 });
    });
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
