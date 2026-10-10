import { TestBed, fakeAsync, flush, tick } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { Action } from '@ngrx/store';
import { BehaviorSubject, EMPTY, of, Subject, Subscription } from 'rxjs';
import { CalendarIntegrationEffects } from './calendar-integration.effects';
import { GlobalTrackingIntervalService } from '../../../core/global-tracking-interval/global-tracking-interval.service';
import { BannerService } from '../../../core/banner/banner.service';
import { LocaleDatePipe } from 'src/app/ui/pipes/locale-date.pipe';
import { CalendarIntegrationService } from '../calendar-integration.service';
import { NavigateToTaskService } from '../../../core-ui/navigate-to-task/navigate-to-task.service';
import { IssueService } from '../../issue/issue.service';
import { DateService } from '../../../core/date/date.service';
import { TaskService } from '../../tasks/task.service';
import { TranslateService, TranslateStore } from '@ngx-translate/core';
import { SyncTriggerService } from '../../../imex/sync/sync-trigger.service';
import { HydrationStateService } from '../../../op-log/apply/hydration-state.service';
import { selectCalendarProviders } from '../../issue/store/issue-provider.selectors';
import { IssueProviderCalendar } from '../../issue/issue.model';
import { CalendarIntegrationEvent } from '../calendar-integration.model';
import { selectTaskFeatureState } from '../../tasks/store/task.selectors';
import { initialTaskState } from '../../tasks/store/task.reducer';
import { DEFAULT_TASK, Task, TaskState, TaskWithSubTasks } from '../../tasks/task.model';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';

describe('CalendarIntegrationEffects pollChanges$ startup guard', () => {
  let effects: CalendarIntegrationEffects;
  let sub: Subscription;
  let addTaskFromIssueSpy: jasmine.Spy;
  let getAllIssueIdsSpy: jasmine.Spy;
  let checkForTaskWithIssueEverywhereSpy: jasmine.Spy;
  let todayDateStr$: BehaviorSubject<string>;
  let requestEvents$Spy: jasmine.Spy;
  let isInitialSyncDoneSyncSpy: jasmine.Spy;
  let isInSyncWindowSpy: jasmine.Spy;
  let taskStateForSelector: TaskState & {
    dismissedCalendarAutoImportEventIdsByProvider?: Record<string, string[]>;
  };

  const PROVIDER_ID = 'ip-cal-1';

  const buildProvider = (): IssueProviderCalendar =>
    ({
      id: PROVIDER_ID,
      issueProviderKey: 'ICAL',
      isEnabled: true,
      isAutoImportForCurrentDay: true,
      icalUrl: 'https://example.com/cal.ics',
      checkUpdatesEvery: 60 * 60 * 1000,
      showBannerBeforeThreshold: 2 * 60 * 60 * 1000,
      isReferenceCalendar: false,
      isDisabledForWebApp: false,
      filterIncludeRegex: null,
      filterExcludeRegex: null,
    }) as unknown as IssueProviderCalendar;

  const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
  const THIRTY_MINUTES_MS = 30 * 60 * 1000;

  // Default event start is far enough out that isCalenderEventDue is false,
  // so the import-only tests don't accidentally exercise the banner branch.
  const buildEvent = (
    id: string,
    overrides: Partial<CalendarIntegrationEvent> = {},
  ): CalendarIntegrationEvent => ({
    id,
    calProviderId: PROVIDER_ID,
    title: `Event ${id}`,
    start: Date.now() + SIX_HOURS_MS,
    duration: THIRTY_MINUTES_MS,
    issueProviderKey: 'ICAL',
    ...overrides,
  });

  beforeEach(() => {
    addTaskFromIssueSpy = jasmine.createSpy('addTaskFromIssue');
    getAllIssueIdsSpy = jasmine
      .createSpy('getAllIssueIdsForProviderEverywhere')
      .and.resolveTo([]);
    checkForTaskWithIssueEverywhereSpy = jasmine
      .createSpy('checkForTaskWithIssueEverywhere')
      .and.resolveTo(null);
    requestEvents$Spy = jasmine
      .createSpy('requestEvents$')
      .and.returnValue(of([buildEvent('cal-evt-1')]));
    isInitialSyncDoneSyncSpy = jasmine
      .createSpy('isInitialSyncDoneSync')
      .and.returnValue(true);
    isInSyncWindowSpy = jasmine.createSpy('isInSyncWindow').and.returnValue(false);

    todayDateStr$ = new BehaviorSubject<string>('2026-05-20');
    taskStateForSelector = { ...initialTaskState };

    TestBed.configureTestingModule({
      providers: [
        CalendarIntegrationEffects,
        provideMockStore({
          selectors: [
            { selector: selectCalendarProviders, value: [buildProvider()] },
            { selector: selectTaskFeatureState, value: taskStateForSelector },
          ],
        }),
        {
          provide: GlobalTrackingIntervalService,
          useValue: { todayDateStr$ },
        },
        {
          provide: BannerService,
          useValue: jasmine.createSpyObj('BannerService', ['open', 'dismiss']),
        },
        {
          provide: TaskService,
          useValue: {
            getAllIssueIdsForProviderEverywhere: getAllIssueIdsSpy,
            checkForTaskWithIssueEverywhere: checkForTaskWithIssueEverywhereSpy,
          },
        },
        {
          provide: LocaleDatePipe,
          useValue: { transform: () => '' },
        },
        {
          provide: CalendarIntegrationService,
          useValue: {
            requestEvents$: requestEvents$Spy,
            skippedEventIds$: new BehaviorSubject<string[]>([]),
          },
        },
        {
          provide: NavigateToTaskService,
          useValue: jasmine.createSpyObj('NavigateToTaskService', ['navigate']),
        },
        {
          provide: IssueService,
          useValue: { addTaskFromIssue: addTaskFromIssueSpy },
        },
        {
          provide: DateService,
          useValue: { isToday: () => true },
        },
        {
          provide: TranslateService,
          useValue: { instant: (k: string) => k, get: (k: string) => of(k) },
        },
        { provide: TranslateStore, useValue: {} },
        {
          provide: SyncTriggerService,
          useValue: { isInitialSyncDoneSync: isInitialSyncDoneSyncSpy },
        },
        {
          provide: HydrationStateService,
          useValue: { isInSyncWindow: isInSyncWindowSpy },
        },
        { provide: LOCAL_ACTIONS, useValue: EMPTY },
      ],
    });

    effects = TestBed.inject(CalendarIntegrationEffects);
  });

  afterEach(() => {
    sub?.unsubscribe();
    // overrideSelector() mutates the globally memoized selector, so without this
    // every later spec in the Karma run would read this empty task state.
    TestBed.inject(MockStore).resetSelectors();
  });

  it('imports a today event when first sync is done and we are NOT in a sync window', fakeAsync(() => {
    isInitialSyncDoneSyncSpy.and.returnValue(true);
    isInSyncWindowSpy.and.returnValue(false);

    sub = effects.pollChanges$.subscribe();
    tick(0);
    flush();

    expect(addTaskFromIssueSpy).toHaveBeenCalledTimes(1);
    expect(addTaskFromIssueSpy.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({
        issueProviderId: PROVIDER_ID,
        issueDataReduced: jasmine.objectContaining({ id: 'cal-evt-1' }),
        isForceDefaultProject: true,
        // Automatic auto-import must not inherit the active context's tag (#8673).
        isAutoImport: true,
      }),
    );
  }));

  it('does NOT auto-import an event dismissed by deleting its task', fakeAsync(() => {
    taskStateForSelector.dismissedCalendarAutoImportEventIdsByProvider = {
      [PROVIDER_ID]: ['legacy-cal-evt-1'],
    };
    requestEvents$Spy.and.returnValue(
      of([buildEvent('cal-evt-1', { legacyIds: ['legacy-cal-evt-1'] })]),
    );

    sub = effects.pollChanges$.subscribe();
    tick(0);
    flush();

    expect(addTaskFromIssueSpy).not.toHaveBeenCalled();
  }));

  it('keeps calendar event dismissals scoped to their provider', fakeAsync(() => {
    taskStateForSelector.dismissedCalendarAutoImportEventIdsByProvider = {
      another_provider: ['cal-evt-1'],
    };

    sub = effects.pollChanges$.subscribe();
    tick(0);
    flush();

    expect(addTaskFromIssueSpy).toHaveBeenCalledTimes(1);
  }));

  it('does NOT import while the initial sync has not completed (cold-start race)', fakeAsync(() => {
    isInitialSyncDoneSyncSpy.and.returnValue(false);
    isInSyncWindowSpy.and.returnValue(false);

    sub = effects.pollChanges$.subscribe();
    tick(0);
    flush();

    expect(addTaskFromIssueSpy).not.toHaveBeenCalled();
  }));

  it('does NOT import while we are inside the sync window (applying remote ops / post-sync cooldown)', fakeAsync(() => {
    isInitialSyncDoneSyncSpy.and.returnValue(true);
    isInSyncWindowSpy.and.returnValue(true);

    sub = effects.pollChanges$.subscribe();
    tick(0);
    flush();

    expect(addTaskFromIssueSpy).not.toHaveBeenCalled();
  }));

  it('does NOT import if the sync window opens during the IDB-read await (post-await race)', fakeAsync(() => {
    // Gate is open at the start...
    isInitialSyncDoneSyncSpy.and.returnValue(true);
    isInSyncWindowSpy.and.returnValue(false);

    // ...but the IDB read yields and a tab-resume opens a sync window before
    // the import loop runs. The second guard inside the tap must catch this.
    getAllIssueIdsSpy.and.callFake(async () => {
      isInSyncWindowSpy.and.returnValue(true);
      return [];
    });

    sub = effects.pollChanges$.subscribe();
    tick(0);
    flush();

    expect(addTaskFromIssueSpy).not.toHaveBeenCalled();
  }));

  it('does NOT import if the event is dismissed during the IDB-read await', fakeAsync(() => {
    getAllIssueIdsSpy.and.callFake(async () => {
      taskStateForSelector.dismissedCalendarAutoImportEventIdsByProvider = {
        [PROVIDER_ID]: ['cal-evt-1'],
      };
      return [];
    });

    sub = effects.pollChanges$.subscribe();
    tick(0);
    flush();

    expect(addTaskFromIssueSpy).not.toHaveBeenCalled();
  }));

  it('still queues the banner branch when the import branch is gated off', fakeAsync(() => {
    // Import gate closed
    isInitialSyncDoneSyncSpy.and.returnValue(true);
    isInSyncWindowSpy.and.returnValue(true);

    // Event starts in 30min — within showBannerBeforeThreshold (2h), so
    // isCalenderEventDue is true and the banner branch should fire.
    requestEvents$Spy.and.returnValue(
      of([buildEvent('cal-evt-due', { start: Date.now() + THIRTY_MINUTES_MS })]),
    );

    sub = effects.pollChanges$.subscribe();
    tick(0);
    flush();

    expect(addTaskFromIssueSpy).not.toHaveBeenCalled();
    // The banner branch pushes onto _currentlyShownBanners$. Asserting that
    // BehaviorSubject's value is the cleanest pin on "banner branch is
    // unaffected by the sync guard".
    const banners = (
      effects as unknown as {
        _currentlyShownBanners$: BehaviorSubject<{ id: string }[]>;
      }
    )._currentlyShownBanners$.getValue();
    expect(banners.length).toBe(1);
    expect(banners[0].id).toBe('cal-evt-due');
  }));

  it('does NOT queue the banner branch for an event already linked to an archived task', fakeAsync(() => {
    // Import gate closed: this pins the banner branch itself, not auto-import.
    isInitialSyncDoneSyncSpy.and.returnValue(false);
    checkForTaskWithIssueEverywhereSpy.and.resolveTo({
      task: { id: 'archived-task', title: 'Archived task' },
      subTasks: null,
      isFromArchive: true,
    });

    requestEvents$Spy.and.returnValue(
      of([
        buildEvent('cal-evt-archived', {
          start: Date.now() + THIRTY_MINUTES_MS,
        }),
      ]),
    );

    sub = effects.pollChanges$.subscribe();
    tick(0);
    flush();

    expect(checkForTaskWithIssueEverywhereSpy).toHaveBeenCalledWith(
      'cal-evt-archived',
      'ICAL',
      PROVIDER_ID,
    );
    expect(getAllIssueIdsSpy).not.toHaveBeenCalled();
    expect(addTaskFromIssueSpy).not.toHaveBeenCalled();

    const banners = (
      effects as unknown as {
        _currentlyShownBanners$: BehaviorSubject<{ id: string }[]>;
      }
    )._currentlyShownBanners$.getValue();
    expect(banners.length).toBe(0);
  }));

  it('still queues the banner branch for an event linked to an active task', fakeAsync(() => {
    // Import gate closed: this pins active linked task banner behavior.
    isInitialSyncDoneSyncSpy.and.returnValue(false);
    checkForTaskWithIssueEverywhereSpy.and.resolveTo({
      task: { id: 'active-task', title: 'Active task' },
      subTasks: null,
      isFromArchive: false,
    });

    requestEvents$Spy.and.returnValue(
      of([
        buildEvent('cal-evt-active', {
          start: Date.now() + THIRTY_MINUTES_MS,
        }),
      ]),
    );

    sub = effects.pollChanges$.subscribe();
    tick(0);
    flush();

    expect(addTaskFromIssueSpy).not.toHaveBeenCalled();

    const banners = (
      effects as unknown as {
        _currentlyShownBanners$: BehaviorSubject<{ id: string }[]>;
      }
    )._currentlyShownBanners$.getValue();
    expect(banners.length).toBe(1);
    expect(banners[0].id).toBe('cal-evt-active');
  }));

  it('removes an already queued banner when its event becomes linked to an archived task', fakeAsync(() => {
    // Import gate closed: this pins the banner queue reconciliation itself.
    isInitialSyncDoneSyncSpy.and.returnValue(false);
    checkForTaskWithIssueEverywhereSpy.and.resolveTo({
      task: { id: 'archived-task', title: 'Archived task' },
      subTasks: null,
      isFromArchive: true,
    });

    const event = buildEvent('cal-evt-stale', {
      start: Date.now() + THIRTY_MINUTES_MS,
    });
    (
      effects as unknown as {
        _currentlyShownBanners$: BehaviorSubject<
          {
            id: string;
            calEv: CalendarIntegrationEvent;
            calProvider: IssueProviderCalendar;
          }[]
        >;
      }
    )._currentlyShownBanners$.next([
      { id: event.id, calEv: event, calProvider: buildProvider() },
    ]);
    requestEvents$Spy.and.returnValue(of([event]));

    sub = effects.pollChanges$.subscribe();
    tick(0);
    flush();

    const banners = (
      effects as unknown as {
        _currentlyShownBanners$: BehaviorSubject<{ id: string }[]>;
      }
    )._currentlyShownBanners$.getValue();
    expect(banners.length).toBe(0);
  }));
});

describe('CalendarIntegrationEffects unskipEventsOfDeletedTasks$', () => {
  let effects: CalendarIntegrationEffects;
  let actions$: Subject<Action>;
  let sub: Subscription;
  let unskipCalendarEventsSpy: jasmine.Spy;

  const buildTask = (id: string, overrides: Partial<Task> = {}): Task => ({
    ...DEFAULT_TASK,
    id,
    title: id,
    projectId: 'project-1',
    ...overrides,
  });

  const icalTask = (id: string, eventId: string): Task =>
    buildTask(id, {
      issueType: 'ICAL',
      issueId: eventId,
      issueProviderId: 'ip-cal-1',
    });

  beforeEach(() => {
    actions$ = new Subject<Action>();
    unskipCalendarEventsSpy = jasmine.createSpy('unskipCalendarEvents');

    TestBed.configureTestingModule({
      providers: [
        CalendarIntegrationEffects,
        provideMockStore(),
        { provide: LOCAL_ACTIONS, useValue: actions$ },
        // createEffect() builds every effect eagerly, so pollChanges$ needs a source.
        { provide: GlobalTrackingIntervalService, useValue: { todayDateStr$: EMPTY } },
        { provide: BannerService, useValue: {} },
        { provide: TaskService, useValue: {} },
        { provide: LocaleDatePipe, useValue: {} },
        {
          provide: CalendarIntegrationService,
          useValue: { unskipCalendarEvents: unskipCalendarEventsSpy },
        },
        { provide: NavigateToTaskService, useValue: {} },
        { provide: IssueService, useValue: {} },
        { provide: DateService, useValue: {} },
        { provide: TranslateService, useValue: {} },
        { provide: TranslateStore, useValue: {} },
        { provide: SyncTriggerService, useValue: {} },
        { provide: HydrationStateService, useValue: {} },
      ],
    });

    effects = TestBed.inject(CalendarIntegrationEffects);
    sub = effects.unskipEventsOfDeletedTasks$.subscribe();
  });

  afterEach(() => {
    sub.unsubscribe();
  });

  it('unskips the event of a deleted iCal task and its iCal sub tasks (#10641)', () => {
    const task: TaskWithSubTasks = {
      ...icalTask('task-1', 'cal-evt-1'),
      subTasks: [icalTask('sub-1', 'cal-evt-2'), buildTask('sub-2')],
    };

    actions$.next(TaskSharedActions.deleteTask({ task }));

    expect(unskipCalendarEventsSpy).toHaveBeenCalledOnceWith(['cal-evt-1', 'cal-evt-2']);
  });

  it('handles a deleted task without a subTasks array', () => {
    const task = icalTask('task-1', 'cal-evt-1') as TaskWithSubTasks;

    actions$.next(TaskSharedActions.deleteTask({ task }));

    expect(unskipCalendarEventsSpy).toHaveBeenCalledOnceWith(['cal-evt-1']);
  });

  it('unskips the events of bulk-deleted iCal tasks', () => {
    const tasks = [
      icalTask('task-1', 'cal-evt-1'),
      buildTask('task-2'),
      icalTask('task-3', 'cal-evt-3'),
    ];

    actions$.next(
      TaskSharedActions.deleteTasks({ taskIds: tasks.map((t) => t.id), tasks }),
    );

    expect(unskipCalendarEventsSpy).toHaveBeenCalledOnceWith(['cal-evt-1', 'cal-evt-3']);
  });

  it('ignores deleted tasks that are not linked to an iCal event', () => {
    const task: TaskWithSubTasks = {
      ...buildTask('task-1', {
        issueType: 'GITHUB',
        issueId: '42',
        issueProviderId: 'ip-gh-1',
      }),
      subTasks: [],
    };

    actions$.next(TaskSharedActions.deleteTask({ task }));
    actions$.next(TaskSharedActions.deleteTasks({ taskIds: ['task-2'] }));

    expect(unskipCalendarEventsSpy).not.toHaveBeenCalled();
  });
});
