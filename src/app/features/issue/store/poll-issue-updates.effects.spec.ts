import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { Observable, of, Subject } from 'rxjs';
import { PollIssueUpdatesEffects } from './poll-issue-updates.effects';
import { IssueService } from '../issue.service';
import { WorkContextService } from '../../work-context/work-context.service';
import { WorkContextType } from '../../work-context/work-context.model';
import { setActiveWorkContext } from '../../work-context/store/work-context.actions';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { selectEnabledIssueProviders } from './issue-provider.selectors';
import { selectAllCalendarIssueTasks } from '../../tasks/store/task.selectors';
import { ICAL_TYPE, GITHUB_TYPE, JIRA_TYPE } from '../issue.const';
import { Task, TaskWithSubTasks } from '../../tasks/task.model';
import { IssueProvider } from '../issue.model';

describe('PollIssueUpdatesEffects', () => {
  let effects: PollIssueUpdatesEffects;
  let actions$: Observable<any>;
  let store: MockStore;
  let issueServiceSpy: jasmine.SpyObj<IssueService>;
  let workContextServiceSpy: jasmine.SpyObj<WorkContextService>;

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
    issueServiceSpy = jasmine.createSpyObj('IssueService', [
      'getPollInterval',
      'refreshIssueTasks',
    ]);
    workContextServiceSpy = jasmine.createSpyObj('WorkContextService', [], {
      allTasksForCurrentContext$: of([]),
    });

    // Default: calendar poll interval is 10 minutes
    issueServiceSpy.getPollInterval.and.callFake((providerKey: string) => {
      if (providerKey === ICAL_TYPE) return 600000; // 10 minutes
      if (providerKey === GITHUB_TYPE) return 300000; // 5 minutes
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
          ],
        }),
        { provide: IssueService, useValue: issueServiceSpy },
        { provide: WorkContextService, useValue: workContextServiceSpy },
      ],
    });

    effects = TestBed.inject(PollIssueUpdatesEffects);
    store = TestBed.inject(MockStore);
  });

  afterEach(() => {
    store.resetSelectors();
  });

  describe('pollIssueChangesForCurrentContext$', () => {
    it('should be created', () => {
      expect(effects).toBeTruthy();
    });

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

      // First call throws error, second succeeds
      let callCount = 0;
      issueServiceSpy.refreshIssueTasks.and.callFake(() => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Network error');
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
});
