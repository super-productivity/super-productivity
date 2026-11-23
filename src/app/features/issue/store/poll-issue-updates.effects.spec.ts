import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { BehaviorSubject, filter, Observable, of, Subject } from 'rxjs';
import { PollIssueUpdatesEffects } from './poll-issue-updates.effects';
import { IssueService } from '../issue.service';
import { WorkContextService } from '../../work-context/work-context.service';
import { WorkContextType } from '../../work-context/work-context.model';
import { setActiveWorkContext } from '../../work-context/store/work-context.actions';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { selectEnabledIssueProviders } from './issue-provider.selectors';
import {
  selectAllCalendarIssueTasks,
  selectAllTasks,
} from '../../tasks/store/task.selectors';
import {
  DELAY_BEFORE_ISSUE_POLLING,
  ICAL_TYPE,
  GITHUB_TYPE,
  JIRA_TYPE,
  PLAINSPACE_TYPE,
} from '../issue.const';
import { Task, TaskWithSubTasks } from '../../tasks/task.model';
import { IssueProvider } from '../issue.model';
import { HttpErrorResponse } from '@angular/common/http';
import { IssueLog } from '../../../core/log';
import { SyncTriggerService } from '../../../imex/sync/sync-trigger.service';
import { HydrationStateService } from '../../../op-log/apply/hydration-state.service';
import { IS_ONLINE$ } from '../../../util/is-online.token';
import { PluginIssueProviderRegistryService } from '../../../plugins/issue-provider/plugin-issue-provider-registry.service';

describe('PollIssueUpdatesEffects', () => {
  let effects: PollIssueUpdatesEffects;
  let actions$: Observable<any>;
  let store: MockStore;
  let issueServiceSpy: jasmine.SpyObj<IssueService>;
  let workContextServiceSpy: jasmine.SpyObj<WorkContextService>;
  let initialSyncDone$: BehaviorSubject<boolean>;
  let isOnline$: BehaviorSubject<boolean>;
  let registrationChanges$: BehaviorSubject<number>;

  const createMockTask = (overrides: Partial<Task> = {}): Task =>
    ({
      id: 'task-1',
      title: 'Test Task',
      projectId: 'project-1',
      tagIds: [],
      subTaskIds: [],
      timeSpentOnDay: {},
      timeSpent: 0,
      timeEstimate: 0,
      isDone: false,
      created: Date.now(),
      attachments: [],
      ...overrides,
    }) as Task;

  const createMockIssueProvider = (
    overrides: Partial<IssueProvider> = {},
  ): IssueProvider =>
    ({
      id: 'provider-1',
      issueProviderKey: ICAL_TYPE,
      isEnabled: true,
      isAutoPoll: true,
      isAutoAddToBacklog: false,
      isIntegratedAddTaskBar: false,
      defaultProjectId: null,
      pinnedSearch: null,
      ...overrides,
    }) as IssueProvider;

  beforeEach(() => {
    initialSyncDone$ = new BehaviorSubject(true);
    isOnline$ = new BehaviorSubject<boolean>(true);
    registrationChanges$ = new BehaviorSubject(0);
    issueServiceSpy = jasmine.createSpyObj('IssueService', [
      'getPollInterval',
      'refreshIssueTasks',
    ]);
    issueServiceSpy.refreshIssueTasks.and.returnValue(Promise.resolve());
    workContextServiceSpy = jasmine.createSpyObj('WorkContextService', [], {
      allTasksForCurrentContext$: of([]),
    });

    // Default: calendar poll interval is 10 minutes
    issueServiceSpy.getPollInterval.and.callFake((providerKey: string) => {
      if (providerKey === ICAL_TYPE) return 600000; // 10 minutes
      if (providerKey === GITHUB_TYPE || providerKey === PLAINSPACE_TYPE) return 300000; // 5 minutes
      return 0;
    });

    TestBed.configureTestingModule({
      providers: [
        PollIssueUpdatesEffects,
        provideMockActions(() => actions$),
        provideMockStore({
          selectors: [
            { selector: selectEnabledIssueProviders, value: [] },
            { selector: selectAllCalendarIssueTasks, value: [] },
            { selector: selectAllTasks, value: [] },
          ],
        }),
        { provide: IssueService, useValue: issueServiceSpy },
        { provide: WorkContextService, useValue: workContextServiceSpy },
        HydrationStateService,
        {
          provide: SyncTriggerService,
          useValue: {
            isInitialSyncDoneSync: () => initialSyncDone$.value,
            afterInitialSyncDoneStrict$: initialSyncDone$.pipe(filter(Boolean)),
          },
        },
        { provide: IS_ONLINE$, useValue: isOnline$ },
        {
          provide: PluginIssueProviderRegistryService,
          useValue: { registrationChanges$ },
        },
      ],
    });

    effects = TestBed.inject(PollIssueUpdatesEffects);
    store = TestBed.inject(MockStore);
  });

  afterEach(() => {
    store.resetSelectors();
  });

  describe('pending refresh across a sync window', () => {
    beforeEach(() => {
      // Creating the effects schedules change detection on a real timer and
      // animation frame. Run it before fakeAsync: cancelling that real frame
      // inside fakeAsync removes the fake timer with the same id, which can be
      // the poll timer when this is the first spec of the run.
      TestBed.tick();
    });

    for (const {
      trigger,
      disable,
      initialSyncPending,
      windowMs,
      readyBeforeTickMs = 0,
    } of [
      { trigger: 'startup', disable: false, initialSyncPending: false, windowMs: 1000 },
      { trigger: 'look', disable: false, initialSyncPending: false, windowMs: 2000 },
      { trigger: 'startup', disable: true, initialSyncPending: false, windowMs: 1000 },
      { trigger: 'look', disable: true, initialSyncPending: false, windowMs: 2000 },
      { trigger: 'startup', disable: false, initialSyncPending: false, windowMs: 31000 },
      { trigger: 'startup', disable: false, initialSyncPending: true, windowMs: 1000 },
      { trigger: 'startup', disable: true, initialSyncPending: true, windowMs: 1000 },
      {
        trigger: 'startup',
        disable: false,
        initialSyncPending: true,
        windowMs: 0,
        readyBeforeTickMs: 5000,
      },
    ]) {
      it(`${trigger}: disable=${disable}, initial sync pending=${initialSyncPending}, window=${windowMs}ms`, fakeAsync(() => {
        const provider = createMockIssueProvider({
          issueProviderKey: PLAINSPACE_TYPE,
          pollingMode: trigger === 'look' ? 'always' : 'whenProjectOpen',
        });
        const task = createMockTask({ issueId: 'issue-1', issueProviderId: provider.id });
        const enabled = store.overrideSelector(selectEnabledIssueProviders, [provider]);
        store.overrideSelector(selectAllTasks, [task]);
        Object.defineProperty(workContextServiceSpy, 'allTasksForCurrentContext$', {
          get: () => of([{ ...task, subTasks: [] }]),
        });
        initialSyncDone$.next(!initialSyncPending);
        const hydration = TestBed.inject(HydrationStateService);
        const actionsSubject = new Subject<ReturnType<typeof setActiveWorkContext>>();
        actions$ = actionsSubject;
        const sub = (
          trigger === 'look'
            ? effects.pollIssueChangesAlways$
            : effects.pollIssueChangesForCurrentContext$
        ).subscribe();
        actionsSubject.next(
          setActiveWorkContext({
            activeType: WorkContextType.PROJECT,
            activeId: 'project-1',
          }),
        );
        // Publish the closed signal before opening the window: its observable
        // can still replay that old value within the visibility event's turn.
        TestBed.tick();
        if (readyBeforeTickMs) {
          tick(readyBeforeTickMs);
          initialSyncDone$.next(true);
          tick(DELAY_BEFORE_ISSUE_POLLING - readyBeforeTickMs - 1);
          expect(issueServiceSpy.refreshIssueTasks).not.toHaveBeenCalled();
          tick(1);
          expect(issueServiceSpy.refreshIssueTasks).toHaveBeenCalledTimes(1);
          // Opening the gate must not move the original 8s deadline to 13s.
          tick(readyBeforeTickMs);
          expect(issueServiceSpy.refreshIssueTasks).toHaveBeenCalledTimes(1);
          sub.unsubscribe();
          return;
        }
        if (trigger === 'look') {
          // The always-mode effect only starts after the initial sync, so look
          // events can't arrive before it. Let its first poll run.
          tick(DELAY_BEFORE_ISSUE_POLLING);
          expect(issueServiceSpy.refreshIssueTasks).toHaveBeenCalledTimes(1);
          issueServiceSpy.refreshIssueTasks.calls.reset();
          spyOnProperty(document, 'visibilityState', 'get').and.returnValue('visible');
          // SyncTriggerService's constructor opens this synchronously before
          // the look listener, even with app sync disabled. No sync follows,
          // so the real hydration service's 2s failsafe closes the window.
          hydration.openSyncWindow();
          document.dispatchEvent(new Event('visibilitychange'));
        } else {
          hydration.startApplyingRemoteOps();
          tick(DELAY_BEFORE_ISSUE_POLLING);
        }
        expect(issueServiceSpy.refreshIssueTasks).not.toHaveBeenCalled();
        TestBed.tick();
        if (disable) {
          enabled.setResult([]);
          store.refreshState();
        }
        tick(windowMs - 1);
        TestBed.tick();
        expect(issueServiceSpy.refreshIssueTasks).not.toHaveBeenCalled();
        tick(1);
        if (trigger === 'startup') {
          hydration.endApplyingRemoteOps();
        }
        TestBed.tick();
        tick();
        if (initialSyncPending) {
          expect(issueServiceSpy.refreshIssueTasks).not.toHaveBeenCalled();
          initialSyncDone$.next(true);
          TestBed.tick();
          tick();
        }
        expect(issueServiceSpy.refreshIssueTasks).toHaveBeenCalledTimes(disable ? 0 : 1);
        sub.unsubscribe();
      }));
    }
  });

  describe('pollIssueChangesForCurrentContext$', () => {
    it('stops a running timer when the provider is disabled and restarts when enabled', fakeAsync(() => {
      const provider = createMockIssueProvider({ id: 'cal-provider-1' });
      const task = createMockTask({ issueId: 'issue-1', issueProviderId: provider.id });
      const enabled = store.overrideSelector(selectEnabledIssueProviders, [provider]);
      store.overrideSelector(selectAllCalendarIssueTasks, [task]);
      const actionsSubject = new Subject<ReturnType<typeof setActiveWorkContext>>();
      actions$ = actionsSubject;
      const sub = effects.pollIssueChangesForCurrentContext$.subscribe();
      actionsSubject.next(
        setActiveWorkContext({
          activeType: WorkContextType.PROJECT,
          activeId: 'project-1',
        }),
      );
      tick(10001);
      expect(issueServiceSpy.refreshIssueTasks).toHaveBeenCalledTimes(1);
      enabled.setResult([]);
      store.refreshState();
      tick(600001);
      expect(issueServiceSpy.refreshIssueTasks).toHaveBeenCalledTimes(1);
      enabled.setResult([provider]);
      store.refreshState();
      tick(10001);
      expect(issueServiceSpy.refreshIssueTasks).toHaveBeenCalledTimes(2);
      sub.unsubscribe();
    }));

    it('should start polling when a plugin provider registers after the context switch', fakeAsync(() => {
      let linearInterval = 0;
      issueServiceSpy.getPollInterval.and.callFake(() => linearInterval);
      const provider = createMockIssueProvider({
        id: 'linear-1',
        issueProviderKey: 'LINEAR',
        pollingMode: 'whenProjectOpen',
      });
      const task = createMockTask({
        issueId: 'LIN-1',
        issueType: 'LINEAR',
        issueProviderId: 'linear-1',
      });
      Object.defineProperty(workContextServiceSpy, 'allTasksForCurrentContext$', {
        value: of([task]),
      });
      store.overrideSelector(selectEnabledIssueProviders, [provider]);
      store.refreshState();

      const actionsSubject = new Subject<any>();
      actions$ = actionsSubject.asObservable();
      const subscription = effects.pollIssueChangesForCurrentContext$.subscribe();
      actionsSubject.next(
        setActiveWorkContext({
          activeType: WorkContextType.PROJECT,
          activeId: 'project-1',
        }),
      );

      tick(300000);
      expect(issueServiceSpy.refreshIssueTasks).not.toHaveBeenCalled();

      // The plugin registers: its poll interval becomes known.
      linearInterval = 300000;
      registrationChanges$.next(1);
      tick(10001);
      expect(issueServiceSpy.refreshIssueTasks).toHaveBeenCalledWith([task], provider);

      subscription.unsubscribe();
    }));

    it('should trigger polling when setActiveWorkContext action is dispatched', fakeAsync(() => {
      const calendarProvider = createMockIssueProvider({
        id: 'cal-provider-1',
        issueProviderKey: ICAL_TYPE,
      });

      const calendarTask = createMockTask({
        id: 'cal-task-1',
        issueId: 'cal-event-123',
        issueType: ICAL_TYPE,
        issueProviderId: 'cal-provider-1',
      });

      store.overrideSelector(selectEnabledIssueProviders, [calendarProvider]);
      store.overrideSelector(selectAllCalendarIssueTasks, [calendarTask]);
      store.refreshState();

      const actionsSubject = new Subject<any>();
      actions$ = actionsSubject.asObservable();

      // Subscribe to the effect
      effects.pollIssueChangesForCurrentContext$.subscribe();

      // Dispatch the action
      actionsSubject.next(
        setActiveWorkContext({
          activeType: WorkContextType.PROJECT,
          activeId: 'project-1',
        }),
      );

      // Wait for the delay before polling starts (default is 10 seconds)
      tick(10001);

      // Should call refreshIssueTasks with calendar tasks
      expect(issueServiceSpy.refreshIssueTasks).toHaveBeenCalledWith(
        [calendarTask],
        calendarProvider,
      );
    }));

    it('should use selectAllCalendarIssueTasks for ICAL providers instead of current context', fakeAsync(() => {
      // Setup: Calendar provider and tasks in DIFFERENT projects
      const calendarProvider = createMockIssueProvider({
        id: 'cal-provider-1',
        issueProviderKey: ICAL_TYPE,
      });

      // Calendar tasks from multiple projects
      const calTaskProject1 = createMockTask({
        id: 'cal-task-1',
        projectId: 'project-1',
        issueId: 'cal-event-1',
        issueType: ICAL_TYPE,
        issueProviderId: 'cal-provider-1',
      });

      const calTaskProject2 = createMockTask({
        id: 'cal-task-2',
        projectId: 'project-2', // Different project
        issueId: 'cal-event-2',
        issueType: ICAL_TYPE,
        issueProviderId: 'cal-provider-1',
      });

      const calTaskProject3 = createMockTask({
        id: 'cal-task-3',
        projectId: 'project-3', // Third project
        issueId: 'cal-event-3',
        issueType: ICAL_TYPE,
        issueProviderId: 'cal-provider-1',
      });

      // Current context only has tasks from project-1
      const currentContextTasks: TaskWithSubTasks[] = [
        { ...calTaskProject1, subTasks: [] },
      ];

      // But selectAllCalendarIssueTasks returns tasks from ALL projects
      const allCalendarTasks = [calTaskProject1, calTaskProject2, calTaskProject3];

      store.overrideSelector(selectEnabledIssueProviders, [calendarProvider]);
      store.overrideSelector(selectAllCalendarIssueTasks, allCalendarTasks);
      store.refreshState();

      // Mock current context to only return project-1 tasks
      Object.defineProperty(workContextServiceSpy, 'allTasksForCurrentContext$', {
        get: () => of(currentContextTasks),
      });

      const actionsSubject = new Subject<any>();
      actions$ = actionsSubject.asObservable();

      effects.pollIssueChangesForCurrentContext$.subscribe();

      actionsSubject.next(
        setActiveWorkContext({
          activeType: WorkContextType.PROJECT,
          activeId: 'project-1',
        }),
      );

      tick(10001);

      // Should call refreshIssueTasks with ALL calendar tasks, not just current context
      expect(issueServiceSpy.refreshIssueTasks).toHaveBeenCalledWith(
        allCalendarTasks,
        calendarProvider,
      );

      // Verify it's NOT using current context tasks (which would only have 1 task)
      const callArgs = issueServiceSpy.refreshIssueTasks.calls.mostRecent().args;
      expect(callArgs[0].length).toBe(3); // All 3 calendar tasks
    }));

    it('should use current context tasks for non-ICAL providers like GITHUB', fakeAsync(() => {
      const githubProvider = createMockIssueProvider({
        id: 'github-provider-1',
        issueProviderKey: GITHUB_TYPE,
      });

      const githubTaskCurrentContext = createMockTask({
        id: 'github-task-1',
        projectId: 'project-1',
        issueId: 'issue-123',
        issueType: GITHUB_TYPE,
        issueProviderId: 'github-provider-1',
      });

      const currentContextTasks: TaskWithSubTasks[] = [
        { ...githubTaskCurrentContext, subTasks: [] },
      ];

      store.overrideSelector(selectEnabledIssueProviders, [githubProvider]);
      store.overrideSelector(selectAllCalendarIssueTasks, []); // No calendar tasks
      store.refreshState();

      Object.defineProperty(workContextServiceSpy, 'allTasksForCurrentContext$', {
        get: () => of(currentContextTasks),
      });

      const actionsSubject = new Subject<any>();
      actions$ = actionsSubject.asObservable();

      effects.pollIssueChangesForCurrentContext$.subscribe();

      actionsSubject.next(
        setActiveWorkContext({
          activeType: WorkContextType.PROJECT,
          activeId: 'project-1',
        }),
      );

      tick(10001);

      // For GITHUB provider, should use current context tasks
      expect(issueServiceSpy.refreshIssueTasks).toHaveBeenCalled();
      const callArgs = issueServiceSpy.refreshIssueTasks.calls.mostRecent().args;
      // Verify the task has the expected properties (subTasks may be added by stream)
      expect(callArgs[0][0].id).toBe('github-task-1');
      expect(callArgs[0][0].issueType).toBe(GITHUB_TYPE);
      expect(callArgs[0][0].issueProviderId).toBe('github-provider-1');
      expect(callArgs[1]).toEqual(githubProvider);
    }));

    it('should filter calendar tasks by provider ID', fakeAsync(() => {
      const calendarProvider1 = createMockIssueProvider({
        id: 'cal-provider-1',
        issueProviderKey: ICAL_TYPE,
      });

      const calendarProvider2 = createMockIssueProvider({
        id: 'cal-provider-2',
        issueProviderKey: ICAL_TYPE,
      });

      const calTaskProvider1 = createMockTask({
        id: 'cal-task-1',
        issueId: 'cal-event-1',
        issueType: ICAL_TYPE,
        issueProviderId: 'cal-provider-1',
      });

      const calTaskProvider2 = createMockTask({
        id: 'cal-task-2',
        issueId: 'cal-event-2',
        issueType: ICAL_TYPE,
        issueProviderId: 'cal-provider-2',
      });

      store.overrideSelector(selectEnabledIssueProviders, [
        calendarProvider1,
        calendarProvider2,
      ]);
      store.overrideSelector(selectAllCalendarIssueTasks, [
        calTaskProvider1,
        calTaskProvider2,
      ]);
      store.refreshState();

      const actionsSubject = new Subject<any>();
      actions$ = actionsSubject.asObservable();

      effects.pollIssueChangesForCurrentContext$.subscribe();

      actionsSubject.next(
        setActiveWorkContext({
          activeType: WorkContextType.PROJECT,
          activeId: 'project-1',
        }),
      );

      tick(10001);

      // Should be called twice - once for each provider
      expect(issueServiceSpy.refreshIssueTasks).toHaveBeenCalledTimes(2);

      // First call should only have tasks for provider 1
      const firstCall = issueServiceSpy.refreshIssueTasks.calls.argsFor(0);
      expect(firstCall[0]).toEqual([calTaskProvider1]);
      expect(firstCall[1]).toEqual(calendarProvider1);

      // Second call should only have tasks for provider 2
      const secondCall = issueServiceSpy.refreshIssueTasks.calls.argsFor(1);
      expect(secondCall[0]).toEqual([calTaskProvider2]);
      expect(secondCall[1]).toEqual(calendarProvider2);
    }));

    it('should not poll providers with isAutoPoll set to false', fakeAsync(() => {
      const calendarProvider = createMockIssueProvider({
        id: 'cal-provider-1',
        issueProviderKey: ICAL_TYPE,
        isAutoPoll: false, // Disabled
      });

      store.overrideSelector(selectEnabledIssueProviders, [calendarProvider]);
      store.refreshState();

      const actionsSubject = new Subject<any>();
      actions$ = actionsSubject.asObservable();

      effects.pollIssueChangesForCurrentContext$.subscribe();

      actionsSubject.next(
        setActiveWorkContext({
          activeType: WorkContextType.PROJECT,
          activeId: 'project-1',
        }),
      );

      tick(10001);

      // Should NOT call refreshIssueTasks since auto-poll is disabled
      expect(issueServiceSpy.refreshIssueTasks).not.toHaveBeenCalled();
    }));

    it('should not poll providers with 0 poll interval', fakeAsync(() => {
      const calendarProvider = createMockIssueProvider({
        id: 'cal-provider-1',
        issueProviderKey: JIRA_TYPE, // JIRA returns 0 poll interval
      });

      // Override to return 0 for JIRA
      issueServiceSpy.getPollInterval.and.callFake((providerKey: string) => {
        if (providerKey === JIRA_TYPE) return 0;
        return 600000;
      });

      store.overrideSelector(selectEnabledIssueProviders, [calendarProvider]);
      store.refreshState();

      const actionsSubject = new Subject<any>();
      actions$ = actionsSubject.asObservable();

      effects.pollIssueChangesForCurrentContext$.subscribe();

      actionsSubject.next(
        setActiveWorkContext({
          activeType: WorkContextType.PROJECT,
          activeId: 'project-1',
        }),
      );

      tick(10001);

      // Should NOT call refreshIssueTasks since poll interval is 0
      expect(issueServiceSpy.refreshIssueTasks).not.toHaveBeenCalled();
    }));

    it('should handle empty providers array gracefully', fakeAsync(() => {
      store.overrideSelector(selectEnabledIssueProviders, []);
      store.refreshState();

      const actionsSubject = new Subject<any>();
      actions$ = actionsSubject.asObservable();

      effects.pollIssueChangesForCurrentContext$.subscribe();

      actionsSubject.next(
        setActiveWorkContext({
          activeType: WorkContextType.PROJECT,
          activeId: 'project-1',
        }),
      );

      tick(10001);

      // Should NOT call refreshIssueTasks since no providers
      expect(issueServiceSpy.refreshIssueTasks).not.toHaveBeenCalled();
    }));

    it('should not call refreshIssueTasks when no tasks match the provider', fakeAsync(() => {
      const calendarProvider = createMockIssueProvider({
        id: 'cal-provider-1',
        issueProviderKey: ICAL_TYPE,
      });

      // Return empty array - no tasks match this provider
      store.overrideSelector(selectEnabledIssueProviders, [calendarProvider]);
      store.overrideSelector(selectAllCalendarIssueTasks, []);
      store.refreshState();

      const actionsSubject = new Subject<any>();
      actions$ = actionsSubject.asObservable();

      effects.pollIssueChangesForCurrentContext$.subscribe();

      actionsSubject.next(
        setActiveWorkContext({
          activeType: WorkContextType.PROJECT,
          activeId: 'project-1',
        }),
      );

      tick(10001);

      // Should NOT call refreshIssueTasks since no tasks match
      expect(issueServiceSpy.refreshIssueTasks).not.toHaveBeenCalled();
    }));

    it('should filter out tasks without issueId', fakeAsync(() => {
      const calendarProvider = createMockIssueProvider({
        id: 'cal-provider-1',
        issueProviderKey: ICAL_TYPE,
      });

      const validTask = createMockTask({
        id: 'cal-task-1',
        issueId: 'cal-event-123',
        issueType: ICAL_TYPE,
        issueProviderId: 'cal-provider-1',
      });

      // Task without issueId (corrupted data)
      const invalidTask = createMockTask({
        id: 'cal-task-2',
        issueId: undefined as any, // Missing issueId
        issueType: ICAL_TYPE,
        issueProviderId: 'cal-provider-1',
      });

      store.overrideSelector(selectEnabledIssueProviders, [calendarProvider]);
      store.overrideSelector(selectAllCalendarIssueTasks, [validTask, invalidTask]);
      store.refreshState();

      const actionsSubject = new Subject<any>();
      actions$ = actionsSubject.asObservable();

      effects.pollIssueChangesForCurrentContext$.subscribe();

      actionsSubject.next(
        setActiveWorkContext({
          activeType: WorkContextType.PROJECT,
          activeId: 'project-1',
        }),
      );

      tick(10001);

      // Should only call with valid task (the one with issueId)
      expect(issueServiceSpy.refreshIssueTasks).toHaveBeenCalledWith(
        [validTask],
        calendarProvider,
      );
    }));

    it('should continue polling after an error occurs', fakeAsync(() => {
      const calendarProvider = createMockIssueProvider({
        id: 'cal-provider-1',
        issueProviderKey: ICAL_TYPE,
      });

      const calendarTask = createMockTask({
        id: 'cal-task-1',
        issueId: 'cal-event-123',
        issueType: ICAL_TYPE,
        issueProviderId: 'cal-provider-1',
      });

      store.overrideSelector(selectEnabledIssueProviders, [calendarProvider]);
      store.overrideSelector(selectAllCalendarIssueTasks, [calendarTask]);
      store.refreshState();

      // First call rejects, second succeeds
      let callCount = 0;
      issueServiceSpy.refreshIssueTasks.and.callFake(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error('Network error'));
        }
        return Promise.resolve();
      });

      const actionsSubject = new Subject<any>();
      actions$ = actionsSubject.asObservable();

      effects.pollIssueChangesForCurrentContext$.subscribe();

      actionsSubject.next(
        setActiveWorkContext({
          activeType: WorkContextType.PROJECT,
          activeId: 'project-1',
        }),
      );

      // First poll (should fail but not crash)
      tick(10001);
      expect(issueServiceSpy.refreshIssueTasks).toHaveBeenCalledTimes(1);

      // Second poll (should succeed)
      tick(600000); // 10 minutes
      expect(issueServiceSpy.refreshIssueTasks).toHaveBeenCalledTimes(2);
    }));

    // Log history is exportable: an HTTP error carries the provider's URL.
    it('logs only the status of a failed request', fakeAsync(() => {
      const calendarProvider = createMockIssueProvider({
        id: 'cal-provider-1',
        issueProviderKey: ICAL_TYPE,
      });
      store.overrideSelector(selectEnabledIssueProviders, [calendarProvider]);
      store.overrideSelector(selectAllCalendarIssueTasks, [
        createMockTask({
          issueId: 'cal-event-123',
          issueType: ICAL_TYPE,
          issueProviderId: 'cal-provider-1',
        }),
      ]);
      store.refreshState();
      issueServiceSpy.refreshIssueTasks.and.rejectWith(
        new HttpErrorResponse({ status: 0, url: 'https://private.example/cal.ics' }),
      );
      const logSpy = spyOn(IssueLog, 'error');
      const actionsSubject = new Subject<any>();
      actions$ = actionsSubject.asObservable();
      effects.pollIssueChangesForCurrentContext$.subscribe();

      actionsSubject.next(
        setActiveWorkContext({
          activeType: WorkContextType.PROJECT,
          activeId: 'project-1',
        }),
      );
      tick(10001);

      expect(logSpy).toHaveBeenCalledOnceWith(jasmine.any(String), { status: 0 });
    }));

    it('should skip polls while offline and poll once the connection is back', fakeAsync(() => {
      const calendarProvider = createMockIssueProvider({ id: 'cal-provider-1' });
      store.overrideSelector(selectEnabledIssueProviders, [calendarProvider]);
      store.overrideSelector(selectAllCalendarIssueTasks, [
        createMockTask({
          issueId: 'cal-event-123',
          issueType: ICAL_TYPE,
          issueProviderId: 'cal-provider-1',
        }),
      ]);
      store.refreshState();
      const actionsSubject = new Subject<any>();
      actions$ = actionsSubject.asObservable();
      isOnline$.next(false);

      const sub = effects.pollIssueChangesForCurrentContext$.subscribe();
      actionsSubject.next(loadAllData({ appDataComplete: {} as any }));
      tick(10001);
      tick(600000);
      expect(issueServiceSpy.refreshIssueTasks).not.toHaveBeenCalled();

      isOnline$.next(true);
      tick(8000);
      expect(issueServiceSpy.refreshIssueTasks).toHaveBeenCalledTimes(1);

      sub.unsubscribe();
    }));

    it('should NOT poll providers with pollingMode always (handled by separate effect)', fakeAsync(() => {
      const jiraProvider = createMockIssueProvider({
        id: 'jira-provider-1',
        issueProviderKey: JIRA_TYPE,
        pollingMode: 'always',
      });

      issueServiceSpy.getPollInterval.and.callFake((providerKey: string) => {
        if (providerKey === JIRA_TYPE) return 300000;
        return 600000;
      });

      store.overrideSelector(selectEnabledIssueProviders, [jiraProvider]);
      store.refreshState();

      const actionsSubject = new Subject<any>();
      actions$ = actionsSubject.asObservable();

      effects.pollIssueChangesForCurrentContext$.subscribe();

      actionsSubject.next(
        setActiveWorkContext({
          activeType: WorkContextType.PROJECT,
          activeId: 'project-1',
        }),
      );

      tick(10001);

      expect(issueServiceSpy.refreshIssueTasks).not.toHaveBeenCalled();
    }));

    it('should use current context tasks for providers without pollingMode always', fakeAsync(() => {
      const jiraProvider = createMockIssueProvider({
        id: 'jira-provider-1',
        issueProviderKey: JIRA_TYPE,
        pollingMode: 'whenProjectOpen',
      });

      issueServiceSpy.getPollInterval.and.callFake((providerKey: string) => {
        if (providerKey === JIRA_TYPE) return 300000;
        return 600000;
      });

      const taskProject1 = createMockTask({
        id: 'jira-task-1',
        projectId: 'project-1',
        issueId: 'JIRA-1',
        issueType: JIRA_TYPE,
        issueProviderId: 'jira-provider-1',
      });

      const taskProject2 = createMockTask({
        id: 'jira-task-2',
        projectId: 'project-2',
        issueId: 'JIRA-2',
        issueType: JIRA_TYPE,
        issueProviderId: 'jira-provider-1',
      });

      // Current context only has project-1 tasks
      const currentContextTasks: TaskWithSubTasks[] = [{ ...taskProject1, subTasks: [] }];

      store.overrideSelector(selectEnabledIssueProviders, [jiraProvider]);
      store.overrideSelector(selectAllTasks, [taskProject1, taskProject2]);
      store.refreshState();

      Object.defineProperty(workContextServiceSpy, 'allTasksForCurrentContext$', {
        get: () => of(currentContextTasks),
      });

      const actionsSubject = new Subject<any>();
      actions$ = actionsSubject.asObservable();

      effects.pollIssueChangesForCurrentContext$.subscribe();

      actionsSubject.next(
        setActiveWorkContext({
          activeType: WorkContextType.PROJECT,
          activeId: 'project-1',
        }),
      );

      tick(10001);

      // Should only poll tasks in current context (project-1)
      expect(issueServiceSpy.refreshIssueTasks).toHaveBeenCalled();
      const callArgs = issueServiceSpy.refreshIssueTasks.calls.mostRecent().args;
      expect(callArgs[0].length).toBe(1);
      expect(callArgs[0][0].id).toBe('jira-task-1');
    }));

    it('should default to whenProjectOpen when pollingMode is undefined', fakeAsync(() => {
      const jiraProvider = createMockIssueProvider({
        id: 'jira-provider-1',
        issueProviderKey: JIRA_TYPE,
        // pollingMode not set (undefined) — should behave as 'whenProjectOpen'
      });

      issueServiceSpy.getPollInterval.and.callFake((providerKey: string) => {
        if (providerKey === JIRA_TYPE) return 300000;
        return 600000;
      });

      const taskProject1 = createMockTask({
        id: 'jira-task-1',
        projectId: 'project-1',
        issueId: 'JIRA-1',
        issueType: JIRA_TYPE,
        issueProviderId: 'jira-provider-1',
      });

      const taskProject2 = createMockTask({
        id: 'jira-task-2',
        projectId: 'project-2',
        issueId: 'JIRA-2',
        issueType: JIRA_TYPE,
        issueProviderId: 'jira-provider-1',
      });

      const currentContextTasks: TaskWithSubTasks[] = [{ ...taskProject1, subTasks: [] }];

      store.overrideSelector(selectEnabledIssueProviders, [jiraProvider]);
      store.overrideSelector(selectAllTasks, [taskProject1, taskProject2]);
      store.refreshState();

      Object.defineProperty(workContextServiceSpy, 'allTasksForCurrentContext$', {
        get: () => of(currentContextTasks),
      });

      const actionsSubject = new Subject<any>();
      actions$ = actionsSubject.asObservable();

      effects.pollIssueChangesForCurrentContext$.subscribe();

      actionsSubject.next(
        setActiveWorkContext({
          activeType: WorkContextType.PROJECT,
          activeId: 'project-1',
        }),
      );

      tick(10001);

      // Should only poll tasks in current context (default = whenProjectOpen)
      expect(issueServiceSpy.refreshIssueTasks).toHaveBeenCalled();
      const callArgs = issueServiceSpy.refreshIssueTasks.calls.mostRecent().args;
      expect(callArgs[0].length).toBe(1);
      expect(callArgs[0][0].id).toBe('jira-task-1');
    }));

    it('should trigger polling on loadAllData action', fakeAsync(() => {
      const calendarProvider = createMockIssueProvider({
        id: 'cal-provider-1',
        issueProviderKey: ICAL_TYPE,
      });

      const calendarTask = createMockTask({
        id: 'cal-task-1',
        issueId: 'cal-event-123',
        issueType: ICAL_TYPE,
        issueProviderId: 'cal-provider-1',
      });

      store.overrideSelector(selectEnabledIssueProviders, [calendarProvider]);
      store.overrideSelector(selectAllCalendarIssueTasks, [calendarTask]);
      store.refreshState();

      const actionsSubject = new Subject<any>();
      actions$ = actionsSubject.asObservable();

      effects.pollIssueChangesForCurrentContext$.subscribe();

      // Use loadAllData instead of setActiveWorkContext
      actionsSubject.next(loadAllData({ appDataComplete: {} as any }));

      tick(10001);

      expect(issueServiceSpy.refreshIssueTasks).toHaveBeenCalledWith(
        [calendarTask],
        calendarProvider,
      );
    }));
  });

  describe('pollIssueChangesAlways$', () => {
    it('should start polling when a plugin provider registers after the initial sync', fakeAsync(() => {
      let linearInterval = 0;
      issueServiceSpy.getPollInterval.and.callFake(() => linearInterval);
      const provider = createMockIssueProvider({
        id: 'linear-1',
        issueProviderKey: 'LINEAR',
        pollingMode: 'always',
      });
      const task = createMockTask({
        issueId: 'LIN-1',
        issueType: 'LINEAR',
        issueProviderId: 'linear-1',
      });
      store.overrideSelector(selectEnabledIssueProviders, [provider]);
      store.overrideSelector(selectAllTasks, [task]);
      store.refreshState();

      const subscription = effects.pollIssueChangesAlways$.subscribe();
      initialSyncDone$.next(true);

      tick(300000);
      expect(issueServiceSpy.refreshIssueTasks).not.toHaveBeenCalled();

      // The plugin registers: its poll interval becomes known.
      linearInterval = 300000;
      registrationChanges$.next(1);
      tick(10001);
      expect(issueServiceSpy.refreshIssueTasks).toHaveBeenCalledWith([task], provider);

      subscription.unsubscribe();
    }));

    it('should poll ALL tasks for providers with pollingMode always', fakeAsync(() => {
      const jiraProvider = createMockIssueProvider({
        id: 'jira-provider-1',
        issueProviderKey: JIRA_TYPE,
        pollingMode: 'always',
      });

      issueServiceSpy.getPollInterval.and.callFake((providerKey: string) => {
        if (providerKey === JIRA_TYPE) return 300000;
        return 600000;
      });

      // Tasks across different projects
      const taskProject1 = createMockTask({
        id: 'jira-task-1',
        projectId: 'project-1',
        issueId: 'JIRA-1',
        issueType: JIRA_TYPE,
        issueProviderId: 'jira-provider-1',
      });

      const taskProject2 = createMockTask({
        id: 'jira-task-2',
        projectId: 'project-2',
        issueId: 'JIRA-2',
        issueType: JIRA_TYPE,
        issueProviderId: 'jira-provider-1',
      });

      const unrelatedTask = createMockTask({
        id: 'other-task',
        projectId: 'project-1',
        issueId: 'OTHER-1',
        issueType: JIRA_TYPE,
        issueProviderId: 'other-provider',
      });

      store.overrideSelector(selectEnabledIssueProviders, [jiraProvider]);
      store.overrideSelector(selectAllTasks, [taskProject1, taskProject2, unrelatedTask]);
      store.refreshState();

      const actionsSubject = new Subject<any>();
      actions$ = actionsSubject.asObservable();

      effects.pollIssueChangesAlways$.subscribe();

      // The initial sync (and data load) starts the always-polling
      initialSyncDone$.next(true);

      tick(10001);

      // Should poll ALL tasks for this provider, not just current context
      expect(issueServiceSpy.refreshIssueTasks).toHaveBeenCalledWith(
        [taskProject1, taskProject2],
        jiraProvider,
      );
    }));

    it('should default to whenProjectOpen when pollingMode is undefined', fakeAsync(() => {
      const jiraProvider = createMockIssueProvider({
        id: 'jira-provider-1',
        issueProviderKey: JIRA_TYPE,
        // pollingMode not set (undefined) -- should NOT be picked up by always effect
      });

      issueServiceSpy.getPollInterval.and.callFake((providerKey: string) => {
        if (providerKey === JIRA_TYPE) return 300000;
        return 600000;
      });

      store.overrideSelector(selectEnabledIssueProviders, [jiraProvider]);
      store.refreshState();

      const actionsSubject = new Subject<any>();
      actions$ = actionsSubject.asObservable();

      effects.pollIssueChangesAlways$.subscribe();

      initialSyncDone$.next(true);

      tick(10001);

      // Provider with undefined pollingMode should NOT be in the always effect
      expect(issueServiceSpy.refreshIssueTasks).not.toHaveBeenCalled();
    }));

    it('should NOT restart timers on subsequent context switches', fakeAsync(() => {
      const jiraProvider = createMockIssueProvider({
        id: 'jira-provider-1',
        issueProviderKey: JIRA_TYPE,
        pollingMode: 'always',
      });

      issueServiceSpy.getPollInterval.and.callFake((providerKey: string) => {
        if (providerKey === JIRA_TYPE) return 300000;
        return 600000;
      });

      const task = createMockTask({
        id: 'jira-task-1',
        issueId: 'JIRA-1',
        issueType: JIRA_TYPE,
        issueProviderId: 'jira-provider-1',
      });

      store.overrideSelector(selectEnabledIssueProviders, [jiraProvider]);
      store.overrideSelector(selectAllTasks, [task]);
      store.refreshState();

      const actionsSubject = new Subject<any>();
      actions$ = actionsSubject.asObservable();

      effects.pollIssueChangesAlways$.subscribe();

      initialSyncDone$.next(true);

      tick(10001);
      expect(issueServiceSpy.refreshIssueTasks).toHaveBeenCalledTimes(1);

      // A context switch does not restart the timer
      actionsSubject.next(
        setActiveWorkContext({
          activeType: WorkContextType.PROJECT,
          activeId: 'project-2',
        }),
      );

      // Wait for what would be a second initial poll if timers restarted
      tick(10001);

      // Should still be 1 — no restart happened
      expect(issueServiceSpy.refreshIssueTasks).toHaveBeenCalledTimes(1);
    }));

    describe('start', () => {
      const setUpAlwaysProvider = (): void => {
        const jiraProvider = createMockIssueProvider({
          id: 'jira-provider-1',
          issueProviderKey: JIRA_TYPE,
          pollingMode: 'always',
        });
        issueServiceSpy.getPollInterval.and.returnValue(300000);
        store.overrideSelector(selectEnabledIssueProviders, [jiraProvider]);
        store.overrideSelector(selectAllTasks, [
          createMockTask({
            id: 'jira-task-1',
            issueId: 'JIRA-1',
            issueType: JIRA_TYPE,
            issueProviderId: 'jira-provider-1',
          }),
        ]);
        store.refreshState();
      };

      it('polls without any context switch or loadAllData', fakeAsync(() => {
        setUpAlwaysProvider();
        actions$ = new Subject<any>().asObservable();
        effects.pollIssueChangesAlways$.subscribe();

        initialSyncDone$.next(true);
        tick(10001);

        expect(issueServiceSpy.refreshIssueTasks).toHaveBeenCalledTimes(1);
      }));

      it('does not poll before the initial sync is done, whatever is dispatched', fakeAsync(() => {
        initialSyncDone$.next(false);
        setUpAlwaysProvider();
        const actionsSubject = new Subject<any>();
        actions$ = actionsSubject.asObservable();
        effects.pollIssueChangesAlways$.subscribe();

        actionsSubject.next(
          setActiveWorkContext({
            activeType: WorkContextType.PROJECT,
            activeId: 'project-1',
          }),
        );
        actionsSubject.next(loadAllData({ appDataComplete: {} as any }));
        tick(10001);
        expect(issueServiceSpy.refreshIssueTasks).not.toHaveBeenCalled();

        initialSyncDone$.next(true);
        tick(10001);
        expect(issueServiceSpy.refreshIssueTasks).toHaveBeenCalledTimes(1);
      }));

      it('runs one timer for a later loadAllData', fakeAsync(() => {
        setUpAlwaysProvider();
        const actionsSubject = new Subject<any>();
        actions$ = actionsSubject.asObservable();
        effects.pollIssueChangesAlways$.subscribe();

        initialSyncDone$.next(true);
        actionsSubject.next(loadAllData({ appDataComplete: {} as any }));
        tick(10001);

        expect(issueServiceSpy.refreshIssueTasks).toHaveBeenCalledTimes(1);
      }));
    });
  });
});
