import { TestBed, fakeAsync, flush, tick } from '@angular/core/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { BehaviorSubject, of, Subscription } from 'rxjs';
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

    TestBed.configureTestingModule({
      providers: [
        CalendarIntegrationEffects,
        provideMockStore({
          selectors: [{ selector: selectCalendarProviders, value: [buildProvider()] }],
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
      ],
    });

    effects = TestBed.inject(CalendarIntegrationEffects);
  });

  afterEach(() => {
    sub?.unsubscribe();
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
