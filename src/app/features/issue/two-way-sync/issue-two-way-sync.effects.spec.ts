import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { of, Subject } from 'rxjs';
import { IssueTwoWaySyncEffects } from './issue-two-way-sync.effects';
import { TaskService } from '../../tasks/task.service';
import { IssueProviderService } from '../issue-provider.service';
import { IssueSyncAdapterRegistryService } from './issue-sync-adapter-registry.service';
import { IssueSyncAdapterResolverService } from './issue-sync-adapter-resolver.service';
import { CaldavSyncAdapterService } from '../providers/caldav/caldav-sync-adapter.service';
import { PlainspaceSyncAdapterService } from '../providers/plainspace/plainspace-sync-adapter.service';
import { SnackService } from '../../../core/snack/snack.service';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { PlannerActions } from '../../planner/store/planner.actions';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import { Task, TaskWithSubTasks } from '../../tasks/task.model';
import { selectEnabledIssueProviders } from '../store/issue-provider.selectors';
import { FieldMapping } from './issue-sync.model';
import { IssueSyncAdapter } from './issue-sync-adapter.interface';
import { IssueProvider } from '../issue.model';
import { WorkContextType } from '../../work-context/work-context.model';
import { DeletedTaskIssueSidecarService } from './deleted-task-issue-sidecar.service';
import { DeletedTagTitlesSidecarService } from './deleted-tag-titles-sidecar.service';
import { deleteTag } from '../../tag/store/tag.actions';
import { selectAllTasks } from '../../tasks/store/task.selectors';

describe('IssueTwoWaySyncEffects', () => {
  let effects: IssueTwoWaySyncEffects;
  let actions$: Subject<any>;
  let store: MockStore;
  let taskServiceSpy: jasmine.SpyObj<TaskService>;
  let issueProviderServiceSpy: jasmine.SpyObj<IssueProviderService>;
  let adapterRegistry: IssueSyncAdapterRegistryService;
  let snackServiceSpy: jasmine.SpyObj<SnackService>;
  let deletedTaskIssueSidecar: DeletedTaskIssueSidecarService;
  let deletedTagTitlesSidecar: DeletedTagTitlesSidecarService;

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
      issueProviderKey: 'CALDAV',
      isEnabled: true,
      isAutoPoll: true,
      isAutoAddToBacklog: false,
      isIntegratedAddTaskBar: false,
      defaultProjectId: null,
      pinnedSearch: null,
      ...overrides,
    }) as IssueProvider;

  const createMockAdapter = (
    overrides: Partial<IssueSyncAdapter<unknown>> = {},
  ): IssueSyncAdapter<unknown> => ({
    getFieldMappings: jasmine.createSpy('getFieldMappings').and.returnValue([]),
    getSyncConfig: jasmine.createSpy('getSyncConfig').and.returnValue({}),
    fetchIssue: jasmine.createSpy('fetchIssue').and.resolveTo({}),
    pushChanges: jasmine.createSpy('pushChanges').and.resolveTo(),
    extractSyncValues: jasmine.createSpy('extractSyncValues').and.returnValue({}),
    ...overrides,
  });

  const isDoneFieldMapping: FieldMapping = {
    taskField: 'isDone',
    issueField: 'status',
    defaultDirection: 'both',
    toIssueValue: (val: unknown) => (val ? 'COMPLETED' : 'NEEDS-ACTION'),
    toTaskValue: (val: unknown) => val === 'COMPLETED',
  };

  const dueDayFieldMapping: FieldMapping = {
    taskField: 'dueDay',
    issueField: 'dtstart',
    defaultDirection: 'both',
    toIssueValue: (val: unknown) => val,
    toTaskValue: (val: unknown) => val,
  };

  const dueWithTimeFieldMapping: FieldMapping = {
    taskField: 'dueWithTime',
    issueField: 'dtstart',
    defaultDirection: 'both',
    toIssueValue: (val: unknown) => val,
    toTaskValue: (val: unknown) => val,
  };

  const tagIdsFieldMapping: FieldMapping = {
    taskField: 'tagIds',
    issueField: 'labels',
    defaultDirection: 'both',
    toIssueValue: (val: unknown) => val,
    toTaskValue: (val: unknown) => val,
  };

  const titleFieldMapping: FieldMapping = {
    taskField: 'title',
    issueField: 'summary',
    defaultDirection: 'both',
    toIssueValue: (val: unknown) => val,
    toTaskValue: (val: unknown) => val,
  };

  beforeEach(() => {
    actions$ = new Subject<any>();

    taskServiceSpy = jasmine.createSpyObj('TaskService', ['getByIdOnce$', 'update']);
    issueProviderServiceSpy = jasmine.createSpyObj('IssueProviderService', [
      'getCfgOnce$',
    ]);
    snackServiceSpy = jasmine.createSpyObj('SnackService', ['open']);

    const caldavSpy = jasmine.createSpyObj('CaldavSyncAdapterService', [
      'getFieldMappings',
      'getSyncConfig',
      'fetchIssue',
      'pushChanges',
      'extractSyncValues',
    ]);

    const plainspaceSpy = jasmine.createSpyObj('PlainspaceSyncAdapterService', [
      'getFieldMappings',
      'getSyncConfig',
      'fetchIssue',
      'pushChanges',
      'extractSyncValues',
    ]);

    TestBed.configureTestingModule({
      providers: [
        IssueTwoWaySyncEffects,
        provideMockActions(() => actions$),
        provideMockStore({
          selectors: [{ selector: selectEnabledIssueProviders, value: [] }],
        }),
        { provide: LOCAL_ACTIONS, useValue: actions$ },
        { provide: TaskService, useValue: taskServiceSpy },
        { provide: IssueProviderService, useValue: issueProviderServiceSpy },
        { provide: CaldavSyncAdapterService, useValue: caldavSpy },
        { provide: PlainspaceSyncAdapterService, useValue: plainspaceSpy },
        { provide: SnackService, useValue: snackServiceSpy },
        {
          provide: IssueSyncAdapterResolverService,
          useFactory: (registry: IssueSyncAdapterRegistryService) => ({
            getAdapter: (issueType: string) => registry.get(issueType),
          }),
          deps: [IssueSyncAdapterRegistryService],
        },
      ],
    });

    effects = TestBed.inject(IssueTwoWaySyncEffects);
    store = TestBed.inject(MockStore);
    adapterRegistry = TestBed.inject(IssueSyncAdapterRegistryService);
    deletedTaskIssueSidecar = TestBed.inject(DeletedTaskIssueSidecarService);
    deletedTagTitlesSidecar = TestBed.inject(DeletedTagTitlesSidecarService);
  });

  afterEach(() => {
    store.resetSelectors();
  });

  describe('pushFieldsOnTaskUpdate$', () => {
    it('should push isDone change to remote issue', fakeAsync(() => {
      const adapter = createMockAdapter({
        getFieldMappings: jasmine
          .createSpy('getFieldMappings')
          .and.returnValue([isDoneFieldMapping]),
        getSyncConfig: jasmine.createSpy('getSyncConfig').and.returnValue({}),
        fetchIssue: jasmine
          .createSpy('fetchIssue')
          .and.resolveTo({ status: 'NEEDS-ACTION' }),
        extractSyncValues: jasmine
          .createSpy('extractSyncValues')
          .and.returnValue({ status: 'NEEDS-ACTION' }),
      });
      adapterRegistry.register('TEST_PROVIDER', adapter);

      const task = createMockTask({
        id: 'task-1',
        issueType: 'TEST_PROVIDER' as any,
        issueId: 'issue-1',
        issueProviderId: 'provider-1',
        issueLastSyncedValues: { status: 'NEEDS-ACTION' },
      });

      taskServiceSpy.getByIdOnce$.and.returnValue(of(task));
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(of(createMockIssueProvider()));

      effects.pushFieldsOnTaskUpdate$.subscribe();

      actions$.next(
        TaskSharedActions.updateTask({
          task: { id: 'task-1', changes: { isDone: true } },
        }),
      );

      tick();

      expect(adapter.pushChanges).toHaveBeenCalled();

      adapterRegistry.unregister('TEST_PROVIDER');
    }));

    it('should not advance baseline when provider changed and nothing was pushed', fakeAsync(() => {
      const adapter = createMockAdapter({
        getFieldMappings: jasmine
          .createSpy('getFieldMappings')
          .and.returnValue([isDoneFieldMapping]),
        getSyncConfig: jasmine.createSpy('getSyncConfig').and.returnValue({}),
        fetchIssue: jasmine
          .createSpy('fetchIssue')
          .and.resolveTo({ status: 'COMPLETED' }),
        extractSyncValues: jasmine
          .createSpy('extractSyncValues')
          .and.returnValue({ status: 'COMPLETED' }),
      });
      adapterRegistry.register('TEST_PROVIDER', adapter);

      const task = createMockTask({
        id: 'task-1',
        issueType: 'TEST_PROVIDER' as any,
        issueId: 'issue-1',
        issueProviderId: 'provider-1',
        issueLastSyncedValues: { status: 'NEEDS-ACTION' },
        isDone: true,
      });

      taskServiceSpy.getByIdOnce$.and.returnValue(of(task));
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(of(createMockIssueProvider()));

      effects.pushFieldsOnTaskUpdate$.subscribe();

      actions$.next(
        TaskSharedActions.updateTask({
          task: { id: 'task-1', changes: { isDone: true } },
        }),
      );

      tick();

      expect(adapter.pushChanges).not.toHaveBeenCalled();
      expect(taskServiceSpy.update).not.toHaveBeenCalled();

      adapterRegistry.unregister('TEST_PROVIDER');
    }));

    it('should not create undefined baselines for missing fresh values', fakeAsync(() => {
      const adapter = createMockAdapter({
        getFieldMappings: jasmine
          .createSpy('getFieldMappings')
          .and.returnValue([isDoneFieldMapping, dueDayFieldMapping]),
        getSyncConfig: jasmine.createSpy('getSyncConfig').and.returnValue({}),
        fetchIssue: jasmine
          .createSpy('fetchIssue')
          .and.resolveTo({ status: 'NEEDS-ACTION' }),
        extractSyncValues: jasmine
          .createSpy('extractSyncValues')
          .and.returnValue({ status: 'NEEDS-ACTION' }),
      });
      adapterRegistry.register('TEST_PROVIDER', adapter);

      const task = createMockTask({
        id: 'task-1',
        issueType: 'TEST_PROVIDER' as any,
        issueId: 'issue-1',
        issueProviderId: 'provider-1',
        issueLastSyncedValues: { status: 'NEEDS-ACTION' },
        isDone: true,
      });

      taskServiceSpy.getByIdOnce$.and.returnValue(of(task));
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(of(createMockIssueProvider()));

      effects.pushFieldsOnTaskUpdate$.subscribe();

      actions$.next(
        TaskSharedActions.updateTask({
          task: { id: 'task-1', changes: { isDone: true } },
        }),
      );

      tick();

      const updateChanges = taskServiceSpy.update.calls.mostRecent()
        .args[1] as Partial<Task>;
      expect(updateChanges.issueLastSyncedValues).toEqual({ status: 'COMPLETED' });
      expect('dtstart' in updateChanges.issueLastSyncedValues!).toBeFalse();

      adapterRegistry.unregister('TEST_PROVIDER');
    }));

    it('should leave issueLastUpdated untouched when another changed field must be pulled', fakeAsync(() => {
      const adapter = createMockAdapter({
        getFieldMappings: jasmine
          .createSpy('getFieldMappings')
          .and.returnValue([isDoneFieldMapping, dueDayFieldMapping]),
        getSyncConfig: jasmine.createSpy('getSyncConfig').and.returnValue({}),
        fetchIssue: jasmine.createSpy('fetchIssue').and.resolveTo({
          status: 'NEEDS-ACTION',
          dtstart: '2026-03-22',
        }),
        extractSyncValues: jasmine.createSpy('extractSyncValues').and.returnValue({
          status: 'NEEDS-ACTION',
          dtstart: '2026-03-22',
        }),
      });
      adapterRegistry.register('TEST_PROVIDER', adapter);

      const task = createMockTask({
        id: 'task-1',
        issueType: 'TEST_PROVIDER' as any,
        issueId: 'issue-1',
        issueProviderId: 'provider-1',
        issueLastSyncedValues: {
          status: 'NEEDS-ACTION',
          dtstart: '2026-03-19',
        },
        isDone: true,
        dueDay: '2026-03-21',
        issueLastUpdated: 123,
      });

      taskServiceSpy.getByIdOnce$.and.returnValue(of(task));
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(of(createMockIssueProvider()));

      effects.pushFieldsOnTaskUpdate$.subscribe();

      actions$.next(
        TaskSharedActions.updateTask({
          task: {
            id: 'task-1',
            changes: { isDone: true, dueDay: '2026-03-21' },
          },
        }),
      );

      tick();

      expect(adapter.pushChanges).toHaveBeenCalledWith(
        'issue-1',
        { status: 'COMPLETED' },
        jasmine.any(Object),
      );
      const updateChanges = taskServiceSpy.update.calls.mostRecent()
        .args[1] as Partial<Task>;
      expect(updateChanges.issueLastSyncedValues).toEqual({
        status: 'COMPLETED',
        dtstart: '2026-03-19',
      });
      expect('issueLastUpdated' in updateChanges).toBeFalse();

      adapterRegistry.unregister('TEST_PROVIDER');
    }));

    it('keeps issueLastUpdated stale when an unrelated mapped field changed remotely (completed in Plainspace while renaming in SP)', fakeAsync(() => {
      // The user renamed the task in SP (pushable) but had already completed it in
      // Plainspace. `fetchIssue` (called before our write) reflects that completion
      // (status COMPLETED) in a field we are NOT pushing this cycle. Advancing
      // issueLastUpdated past it would make the poll skip it forever — the
      // completion would never reach SP. So the marker must stay stale.
      const adapter = createMockAdapter({
        getFieldMappings: jasmine
          .createSpy('getFieldMappings')
          .and.returnValue([titleFieldMapping, isDoneFieldMapping]),
        getSyncConfig: jasmine.createSpy('getSyncConfig').and.returnValue({}),
        fetchIssue: jasmine
          .createSpy('fetchIssue')
          .and.resolveTo({ summary: 'Old title', status: 'COMPLETED' }),
        extractSyncValues: jasmine
          .createSpy('extractSyncValues')
          .and.callFake((issue: { summary: unknown; status: unknown }) => ({
            summary: issue.summary,
            status: issue.status,
          })),
        getIssueLastUpdated: jasmine
          .createSpy('getIssueLastUpdated')
          .and.returnValue(999),
      });
      adapterRegistry.register('TEST_PROVIDER', adapter);

      const task = createMockTask({
        id: 'task-1',
        issueType: 'TEST_PROVIDER' as any,
        issueId: 'issue-1',
        issueProviderId: 'provider-1',
        title: 'New title',
        isDone: false,
        issueLastSyncedValues: { summary: 'Old title', status: 'NEEDS-ACTION' },
        issueLastUpdated: 123,
      });

      taskServiceSpy.getByIdOnce$.and.returnValue(of(task));
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(of(createMockIssueProvider()));

      effects.pushFieldsOnTaskUpdate$.subscribe();

      actions$.next(
        TaskSharedActions.updateTask({
          task: { id: 'task-1', changes: { title: 'New title' } },
        }),
      );

      tick();

      // The rename is still pushed...
      expect(adapter.pushChanges).toHaveBeenCalledWith(
        'issue-1',
        { summary: 'New title' },
        jasmine.any(Object),
      );
      const updateChanges = taskServiceSpy.update.calls.mostRecent()
        .args[1] as Partial<Task>;
      // ...the title baseline advances, the remote completion is left untouched...
      expect(updateChanges.issueLastSyncedValues).toEqual({
        summary: 'New title',
        status: 'NEEDS-ACTION',
      });
      // ...and issueLastUpdated is NOT advanced, so the next poll still pulls done.
      expect('issueLastUpdated' in updateChanges).toBeFalse();

      adapterRegistry.unregister('TEST_PROVIDER');
    }));

    it('advances issueLastUpdated after a clean push with no un-pulled remote changes', fakeAsync(() => {
      const adapter = createMockAdapter({
        getFieldMappings: jasmine
          .createSpy('getFieldMappings')
          .and.returnValue([titleFieldMapping, isDoneFieldMapping]),
        getSyncConfig: jasmine.createSpy('getSyncConfig').and.returnValue({}),
        fetchIssue: jasmine
          .createSpy('fetchIssue')
          .and.resolveTo({ summary: 'Old title', status: 'NEEDS-ACTION' }),
        extractSyncValues: jasmine
          .createSpy('extractSyncValues')
          .and.callFake((issue: { summary: unknown; status: unknown }) => ({
            summary: issue.summary,
            status: issue.status,
          })),
        getIssueLastUpdated: jasmine
          .createSpy('getIssueLastUpdated')
          .and.returnValue(999),
      });
      adapterRegistry.register('TEST_PROVIDER', adapter);

      const task = createMockTask({
        id: 'task-1',
        issueType: 'TEST_PROVIDER' as any,
        issueId: 'issue-1',
        issueProviderId: 'provider-1',
        title: 'New title',
        isDone: false,
        issueLastSyncedValues: { summary: 'Old title', status: 'NEEDS-ACTION' },
        issueLastUpdated: 123,
      });

      taskServiceSpy.getByIdOnce$.and.returnValue(of(task));
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(of(createMockIssueProvider()));

      effects.pushFieldsOnTaskUpdate$.subscribe();

      actions$.next(
        TaskSharedActions.updateTask({
          task: { id: 'task-1', changes: { title: 'New title' } },
        }),
      );

      tick();

      const updateChanges = taskServiceSpy.update.calls.mostRecent()
        .args[1] as Partial<Task>;
      expect(updateChanges.issueLastUpdated).toBe(999);

      adapterRegistry.unregister('TEST_PROVIDER');
    }));

    it('should skip push when no issueType on task', fakeAsync(() => {
      const adapter = createMockAdapter({
        getFieldMappings: jasmine
          .createSpy('getFieldMappings')
          .and.returnValue([isDoneFieldMapping]),
      });
      adapterRegistry.register('TEST_PROVIDER', adapter);

      const task = createMockTask({
        id: 'task-1',
        issueType: undefined,
        issueId: undefined,
        issueProviderId: undefined,
      });

      taskServiceSpy.getByIdOnce$.and.returnValue(of(task));

      effects.pushFieldsOnTaskUpdate$.subscribe();

      actions$.next(
        TaskSharedActions.updateTask({
          task: { id: 'task-1', changes: { isDone: true } },
        }),
      );

      tick();

      expect(adapter.pushChanges).not.toHaveBeenCalled();

      adapterRegistry.unregister('TEST_PROVIDER');
    }));

    it('should not crash when task is deleted before effect processes updateTask', fakeAsync(() => {
      const adapter = createMockAdapter({
        getFieldMappings: jasmine
          .createSpy('getFieldMappings')
          .and.returnValue([isDoneFieldMapping]),
      });
      adapterRegistry.register('TEST_PROVIDER', adapter);

      taskServiceSpy.getByIdOnce$.and.returnValue(of(undefined as any));

      effects.pushFieldsOnTaskUpdate$.subscribe();

      actions$.next(
        TaskSharedActions.updateTask({
          task: { id: 'deleted-task', changes: { isDone: true } },
        }),
      );

      tick();

      expect(adapter.pushChanges).not.toHaveBeenCalled();

      adapterRegistry.unregister('TEST_PROVIDER');
    }));

    it('should skip push for sync-bookkeeping changes (issueLastSyncedValues)', fakeAsync(() => {
      const adapter = createMockAdapter();
      adapterRegistry.register('TEST_PROVIDER', adapter);

      const task = createMockTask({
        id: 'task-1',
        issueType: 'TEST_PROVIDER' as any,
        issueId: 'issue-1',
        issueProviderId: 'provider-1',
      });

      taskServiceSpy.getByIdOnce$.and.returnValue(of(task));

      effects.pushFieldsOnTaskUpdate$.subscribe();

      actions$.next(
        TaskSharedActions.updateTask({
          task: {
            id: 'task-1',
            changes: { issueLastSyncedValues: { status: 'COMPLETED' } },
          },
        }),
      );

      tick();

      expect(adapter.pushChanges).not.toHaveBeenCalled();

      adapterRegistry.unregister('TEST_PROVIDER');
    }));

    it('should skip push for sync-bookkeeping changes (issueWasUpdated)', fakeAsync(() => {
      const adapter = createMockAdapter();
      adapterRegistry.register('TEST_PROVIDER', adapter);

      const task = createMockTask({
        id: 'task-1',
        issueType: 'TEST_PROVIDER' as any,
        issueId: 'issue-1',
        issueProviderId: 'provider-1',
      });

      taskServiceSpy.getByIdOnce$.and.returnValue(of(task));

      effects.pushFieldsOnTaskUpdate$.subscribe();

      actions$.next(
        TaskSharedActions.updateTask({
          task: {
            id: 'task-1',
            changes: { issueWasUpdated: true },
          },
        }),
      );

      tick();

      expect(adapter.pushChanges).not.toHaveBeenCalled();

      adapterRegistry.unregister('TEST_PROVIDER');
    }));

    it('should skip push for changes to non-synced fields', fakeAsync(() => {
      const adapter = createMockAdapter();
      adapterRegistry.register('TEST_PROVIDER', adapter);

      const task = createMockTask({
        id: 'task-1',
        issueType: 'TEST_PROVIDER' as any,
        issueId: 'issue-1',
        issueProviderId: 'provider-1',
      });

      taskServiceSpy.getByIdOnce$.and.returnValue(of(task));

      effects.pushFieldsOnTaskUpdate$.subscribe();

      // timeSpent is not in the tracked fields list
      // (isDone, title, notes, dueWithTime, dueDay, timeEstimate)
      actions$.next(
        TaskSharedActions.updateTask({
          task: {
            id: 'task-1',
            changes: { timeSpent: 5000 },
          },
        }),
      );

      tick();

      expect(adapter.pushChanges).not.toHaveBeenCalled();

      adapterRegistry.unregister('TEST_PROVIDER');
    }));

    it('should extract schedulingInfo.day from applyShortSyntax action', fakeAsync(() => {
      const adapter = createMockAdapter({
        getFieldMappings: jasmine
          .createSpy('getFieldMappings')
          .and.returnValue([dueDayFieldMapping]),
        getSyncConfig: jasmine.createSpy('getSyncConfig').and.returnValue({}),
        fetchIssue: jasmine.createSpy('fetchIssue').and.resolveTo({ dtstart: null }),
        extractSyncValues: jasmine
          .createSpy('extractSyncValues')
          .and.returnValue({ dtstart: null }),
      });
      adapterRegistry.register('TEST_PROVIDER', adapter);

      const task = createMockTask({
        id: 'task-1',
        issueType: 'TEST_PROVIDER' as any,
        issueId: 'issue-1',
        issueProviderId: 'provider-1',
        issueLastSyncedValues: { dtstart: null },
        dueDay: '2026-03-20',
      });

      taskServiceSpy.getByIdOnce$.and.returnValue(of(task));
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(of(createMockIssueProvider()));

      effects.pushFieldsOnTaskUpdate$.subscribe();

      actions$.next(
        TaskSharedActions.applyShortSyntax({
          task,
          taskChanges: { title: 'Updated Task' },
          schedulingInfo: { day: '2026-03-20' },
        }),
      );

      tick();

      // The effect should have proceeded with dueDay in the changes
      // and called fetchIssue (indicating it passed the filter)
      expect(adapter.fetchIssue).toHaveBeenCalled();

      adapterRegistry.unregister('TEST_PROVIDER');
    }));

    it('should extract schedulingInfo.dueWithTime from applyShortSyntax action', fakeAsync(() => {
      const adapter = createMockAdapter({
        getFieldMappings: jasmine
          .createSpy('getFieldMappings')
          .and.returnValue([dueWithTimeFieldMapping]),
        getSyncConfig: jasmine.createSpy('getSyncConfig').and.returnValue({}),
        fetchIssue: jasmine.createSpy('fetchIssue').and.resolveTo({ dtstart: null }),
        extractSyncValues: jasmine
          .createSpy('extractSyncValues')
          .and.returnValue({ dtstart: null }),
      });
      adapterRegistry.register('TEST_PROVIDER', adapter);

      const dueTimestamp = 1774008000000;
      const task = createMockTask({
        id: 'task-1',
        issueType: 'TEST_PROVIDER' as any,
        issueId: 'issue-1',
        issueProviderId: 'provider-1',
        issueLastSyncedValues: { dtstart: null },
        dueWithTime: dueTimestamp,
      });

      taskServiceSpy.getByIdOnce$.and.returnValue(of(task));
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(of(createMockIssueProvider()));

      effects.pushFieldsOnTaskUpdate$.subscribe();

      actions$.next(
        TaskSharedActions.applyShortSyntax({
          task,
          taskChanges: { title: 'Updated Task' },
          schedulingInfo: { dueWithTime: dueTimestamp },
        }),
      );

      tick();

      expect(adapter.fetchIssue).toHaveBeenCalled();

      adapterRegistry.unregister('TEST_PROVIDER');
    }));

    it('should push dueDay change from planTaskForDay to remote issue', fakeAsync(() => {
      const adapter = createMockAdapter({
        getFieldMappings: jasmine
          .createSpy('getFieldMappings')
          .and.returnValue([dueDayFieldMapping]),
        getSyncConfig: jasmine.createSpy('getSyncConfig').and.returnValue({}),
        fetchIssue: jasmine
          .createSpy('fetchIssue')
          .and.resolveTo({ dtstart: '2026-03-19' }),
        extractSyncValues: jasmine
          .createSpy('extractSyncValues')
          .and.returnValue({ dtstart: '2026-03-19' }),
      });
      adapterRegistry.register('TEST_PROVIDER', adapter);

      const task = createMockTask({
        id: 'task-1',
        issueType: 'TEST_PROVIDER' as any,
        issueId: 'issue-1',
        issueProviderId: 'provider-1',
        issueLastSyncedValues: { dtstart: '2026-03-19' },
        dueDay: '2026-03-21',
      });

      taskServiceSpy.getByIdOnce$.and.returnValue(of(task));
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(of(createMockIssueProvider()));

      effects.pushFieldsOnTaskUpdate$.subscribe();

      actions$.next(
        PlannerActions.planTaskForDay({
          task,
          day: '2026-03-21',
        }),
      );

      tick();

      expect(adapter.fetchIssue).toHaveBeenCalled();

      adapterRegistry.unregister('TEST_PROVIDER');
    }));

    it('should push dueDay change from transferTask to remote issue', fakeAsync(() => {
      const adapter = createMockAdapter({
        getFieldMappings: jasmine
          .createSpy('getFieldMappings')
          .and.returnValue([dueDayFieldMapping]),
        getSyncConfig: jasmine.createSpy('getSyncConfig').and.returnValue({}),
        fetchIssue: jasmine
          .createSpy('fetchIssue')
          .and.resolveTo({ dtstart: '2026-03-19' }),
        extractSyncValues: jasmine
          .createSpy('extractSyncValues')
          .and.returnValue({ dtstart: '2026-03-19' }),
      });
      adapterRegistry.register('TEST_PROVIDER', adapter);

      const task = createMockTask({
        id: 'task-1',
        issueType: 'TEST_PROVIDER' as any,
        issueId: 'issue-1',
        issueProviderId: 'provider-1',
        issueLastSyncedValues: { dtstart: '2026-03-19' },
        dueDay: '2026-03-22',
      });

      taskServiceSpy.getByIdOnce$.and.returnValue(of(task));
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(of(createMockIssueProvider()));

      effects.pushFieldsOnTaskUpdate$.subscribe();

      actions$.next(
        PlannerActions.transferTask({
          task,
          prevDay: '2026-03-19',
          newDay: '2026-03-22',
          targetIndex: 0,
          today: '2026-03-20',
        }),
      );

      tick();

      expect(adapter.fetchIssue).toHaveBeenCalled();

      adapterRegistry.unregister('TEST_PROVIDER');
    }));

    it('should show snack on push error and continue', fakeAsync(() => {
      const adapter = createMockAdapter({
        getFieldMappings: jasmine
          .createSpy('getFieldMappings')
          .and.returnValue([isDoneFieldMapping]),
        getSyncConfig: jasmine.createSpy('getSyncConfig').and.returnValue({}),
        fetchIssue: jasmine
          .createSpy('fetchIssue')
          .and.rejectWith(new Error('Network error')),
      });
      adapterRegistry.register('TEST_PROVIDER', adapter);

      const task = createMockTask({
        id: 'task-1',
        issueType: 'TEST_PROVIDER' as any,
        issueId: 'issue-1',
        issueProviderId: 'provider-1',
        issueLastSyncedValues: { status: 'NEEDS-ACTION' },
      });

      taskServiceSpy.getByIdOnce$.and.returnValue(of(task));
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(of(createMockIssueProvider()));

      effects.pushFieldsOnTaskUpdate$.subscribe();

      actions$.next(
        TaskSharedActions.updateTask({
          task: { id: 'task-1', changes: { isDone: true } },
        }),
      );

      tick();

      expect(snackServiceSpy.open).toHaveBeenCalledWith(
        jasmine.objectContaining({ type: 'ERROR' }),
      );

      adapterRegistry.unregister('TEST_PROVIDER');
    }));

    it('should NOT show a snack when push rejects with an expected sync-skip marker (#7492)', fakeAsync(() => {
      // The marker normally originates from a provider's updateIssue (e.g. a
      // single recurring CalDAV occurrence); injected here via fetchIssue, which
      // surfaces through the same push-pipe catch.
      const expectedSkip = Object.assign(new Error('single occurrence'), {
        isExpectedSyncSkip: true,
      });
      const adapter = createMockAdapter({
        getFieldMappings: jasmine
          .createSpy('getFieldMappings')
          .and.returnValue([isDoneFieldMapping]),
        getSyncConfig: jasmine.createSpy('getSyncConfig').and.returnValue({}),
        fetchIssue: jasmine.createSpy('fetchIssue').and.rejectWith(expectedSkip),
      });
      adapterRegistry.register('TEST_PROVIDER', adapter);

      const task = createMockTask({
        id: 'task-1',
        issueType: 'TEST_PROVIDER' as any,
        issueId: 'issue-1',
        issueProviderId: 'provider-1',
        issueLastSyncedValues: { status: 'NEEDS-ACTION' },
      });

      taskServiceSpy.getByIdOnce$.and.returnValue(of(task));
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(of(createMockIssueProvider()));

      effects.pushFieldsOnTaskUpdate$.subscribe();

      actions$.next(
        TaskSharedActions.updateTask({
          task: { id: 'task-1', changes: { isDone: true } },
        }),
      );

      tick();

      expect(snackServiceSpy.open).not.toHaveBeenCalled();

      adapterRegistry.unregister('TEST_PROVIDER');
    }));
  });

  describe('pushTagChangesAfterTagDelete$', () => {
    it('should push updated labels for linked tasks affected by deleted tag titles', fakeAsync(() => {
      const adapter = createMockAdapter({
        getFieldMappings: jasmine
          .createSpy('getFieldMappings')
          .and.returnValue([tagIdsFieldMapping]),
        getSyncConfig: jasmine.createSpy('getSyncConfig').and.returnValue({}),
        fetchIssue: jasmine
          .createSpy('fetchIssue')
          .and.resolveTo({ labels: ['bug', 'feature'] }),
        extractSyncValues: jasmine
          .createSpy('extractSyncValues')
          .and.returnValue({ labels: ['bug', 'feature'] }),
      });
      adapterRegistry.register('TEST_PROVIDER', adapter);

      const task = createMockTask({
        id: 'task-1',
        issueType: 'TEST_PROVIDER' as any,
        issueId: 'issue-1',
        issueProviderId: 'provider-1',
        tagIds: ['feature'],
        issueLastSyncedValues: { labels: ['bug', 'feature'] },
      });

      store.overrideSelector(selectAllTasks, [task]);
      taskServiceSpy.getByIdOnce$.and.returnValue(of(task));
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(of(createMockIssueProvider()));

      effects.pushTagChangesAfterTagDelete$.subscribe();

      deletedTagTitlesSidecar.set(['bug']);
      actions$.next(deleteTag({ id: 'tag-bug' }));
      tick();

      expect(adapter.pushChanges).toHaveBeenCalledWith(
        'issue-1',
        { labels: ['feature'] },
        jasmine.any(Object),
      );

      adapterRegistry.unregister('TEST_PROVIDER');
    }));

    it('should not push labels for tasks unaffected by deleted tag titles', fakeAsync(() => {
      const adapter = createMockAdapter({
        getFieldMappings: jasmine
          .createSpy('getFieldMappings')
          .and.returnValue([tagIdsFieldMapping]),
      });
      adapterRegistry.register('TEST_PROVIDER', adapter);

      const task = createMockTask({
        id: 'task-1',
        issueType: 'TEST_PROVIDER' as any,
        issueId: 'issue-1',
        issueProviderId: 'provider-1',
        tagIds: ['feature'],
        issueLastSyncedValues: { labels: ['feature'] },
      });

      store.overrideSelector(selectAllTasks, [task]);

      effects.pushTagChangesAfterTagDelete$.subscribe();

      deletedTagTitlesSidecar.set(['bug']);
      actions$.next(deleteTag({ id: 'tag-bug' }));
      tick();

      expect(adapter.pushChanges).not.toHaveBeenCalled();

      adapterRegistry.unregister('TEST_PROVIDER');
    }));
  });

  describe('deleteIssueOnTaskDelete$', () => {
    it('should call adapter.deleteIssue when task with issue is deleted', fakeAsync(() => {
      const deleteIssueSpy = jasmine.createSpy('deleteIssue').and.resolveTo(undefined);
      const adapter = createMockAdapter({ deleteIssue: deleteIssueSpy });
      adapterRegistry.register('TEST_PROVIDER', adapter);

      const cfg = createMockIssueProvider();
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(of(cfg));

      const task = createMockTask({
        id: 'task-1',
        issueType: 'TEST_PROVIDER' as any,
        issueId: 'issue-1',
        issueProviderId: 'provider-1',
        subTaskIds: [],
      }) as TaskWithSubTasks;
      (task as any).subTasks = [];

      effects.deleteIssueOnTaskDelete$.subscribe();

      actions$.next(TaskSharedActions.deleteTask({ task }));

      tick();

      expect(deleteIssueSpy).toHaveBeenCalledWith('issue-1', cfg);

      adapterRegistry.unregister('TEST_PROVIDER');
    }));

    it('should not call deleteIssue when adapter does not support it', fakeAsync(() => {
      const adapter = createMockAdapter();
      // Adapter without deleteIssue
      adapterRegistry.register('TEST_PROVIDER', adapter);

      const task = createMockTask({
        id: 'task-1',
        issueType: 'TEST_PROVIDER' as any,
        issueId: 'issue-1',
        issueProviderId: 'provider-1',
      }) as TaskWithSubTasks;
      (task as any).subTasks = [];

      effects.deleteIssueOnTaskDelete$.subscribe();

      actions$.next(TaskSharedActions.deleteTask({ task }));

      tick();

      // Adapter has no deleteIssue, so getCfgOnce$ should not be called
      expect(issueProviderServiceSpy.getCfgOnce$).not.toHaveBeenCalled();

      adapterRegistry.unregister('TEST_PROVIDER');
    }));

    it('should not call deleteIssue for task without issueId', fakeAsync(() => {
      const deleteIssueSpy = jasmine.createSpy('deleteIssue').and.resolveTo(undefined);
      const adapter = createMockAdapter({ deleteIssue: deleteIssueSpy });
      adapterRegistry.register('TEST_PROVIDER', adapter);

      const task = createMockTask({
        id: 'task-1',
        issueType: undefined,
        issueId: undefined,
        issueProviderId: undefined,
      }) as TaskWithSubTasks;
      (task as any).subTasks = [];

      effects.deleteIssueOnTaskDelete$.subscribe();

      actions$.next(TaskSharedActions.deleteTask({ task }));

      tick();

      expect(deleteIssueSpy).not.toHaveBeenCalled();

      adapterRegistry.unregister('TEST_PROVIDER');
    }));

    it('should show snack on delete error and continue', fakeAsync(() => {
      const deleteIssueSpy = jasmine
        .createSpy('deleteIssue')
        .and.rejectWith(new Error('Delete failed'));
      const adapter = createMockAdapter({ deleteIssue: deleteIssueSpy });
      adapterRegistry.register('TEST_PROVIDER', adapter);

      const cfg = createMockIssueProvider();
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(of(cfg));

      const task = createMockTask({
        id: 'task-1',
        issueType: 'TEST_PROVIDER' as any,
        issueId: 'issue-1',
        issueProviderId: 'provider-1',
      }) as TaskWithSubTasks;
      (task as any).subTasks = [];

      effects.deleteIssueOnTaskDelete$.subscribe();

      actions$.next(TaskSharedActions.deleteTask({ task }));

      tick();

      expect(snackServiceSpy.open).toHaveBeenCalledWith(
        jasmine.objectContaining({ type: 'ERROR' }),
      );

      adapterRegistry.unregister('TEST_PROVIDER');
    }));

    it('should NOT show a snack when delete rejects with an expected sync-skip marker (#7492)', fakeAsync(() => {
      const expectedSkip = Object.assign(new Error('single occurrence'), {
        isExpectedSyncSkip: true,
      });
      const deleteIssueSpy = jasmine
        .createSpy('deleteIssue')
        .and.rejectWith(expectedSkip);
      const adapter = createMockAdapter({ deleteIssue: deleteIssueSpy });
      adapterRegistry.register('TEST_PROVIDER', adapter);

      const cfg = createMockIssueProvider();
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(of(cfg));

      const task = createMockTask({
        id: 'task-1',
        issueType: 'TEST_PROVIDER' as any,
        issueId: 'issue-1',
        issueProviderId: 'provider-1',
      }) as TaskWithSubTasks;
      (task as any).subTasks = [];

      effects.deleteIssueOnTaskDelete$.subscribe();

      actions$.next(TaskSharedActions.deleteTask({ task }));

      tick();

      expect(snackServiceSpy.open).not.toHaveBeenCalled();

      adapterRegistry.unregister('TEST_PROVIDER');
    }));
  });

  describe('deleteIssueOnBulkTaskDelete$', () => {
    it('should delete remote issues for all linked tasks in bulk delete', fakeAsync(() => {
      const deleteIssueSpy = jasmine.createSpy('deleteIssue').and.resolveTo(undefined);
      const adapter = createMockAdapter({ deleteIssue: deleteIssueSpy });
      adapterRegistry.register('TEST_PROVIDER', adapter);

      const cfg = createMockIssueProvider();
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(of(cfg));

      effects.deleteIssueOnBulkTaskDelete$.subscribe();

      deletedTaskIssueSidecar.set([
        { issueId: 'issue-1', issueType: 'TEST_PROVIDER', issueProviderId: 'provider-1' },
        { issueId: 'issue-2', issueType: 'TEST_PROVIDER', issueProviderId: 'provider-1' },
      ]);
      actions$.next(
        TaskSharedActions.deleteTasks({
          taskIds: ['task-1', 'task-2'],
        }),
      );

      tick();

      expect(deleteIssueSpy).toHaveBeenCalledTimes(2);
      expect(deleteIssueSpy).toHaveBeenCalledWith('issue-1', cfg);
      expect(deleteIssueSpy).toHaveBeenCalledWith('issue-2', cfg);

      adapterRegistry.unregister('TEST_PROVIDER');
    }));

    it('should skip tasks without issue linkage in bulk delete', fakeAsync(() => {
      const deleteIssueSpy = jasmine.createSpy('deleteIssue').and.resolveTo(undefined);
      const adapter = createMockAdapter({ deleteIssue: deleteIssueSpy });
      adapterRegistry.register('TEST_PROVIDER', adapter);

      const cfg = createMockIssueProvider();
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(of(cfg));

      effects.deleteIssueOnBulkTaskDelete$.subscribe();

      deletedTaskIssueSidecar.set([
        { issueId: 'issue-1', issueType: 'TEST_PROVIDER', issueProviderId: 'provider-1' },
      ]);
      actions$.next(
        TaskSharedActions.deleteTasks({
          taskIds: ['task-1', 'task-2'],
        }),
      );

      tick();

      expect(deleteIssueSpy).toHaveBeenCalledTimes(1);
      expect(deleteIssueSpy).toHaveBeenCalledWith('issue-1', cfg);

      adapterRegistry.unregister('TEST_PROVIDER');
    }));

    it('should show snack on delete error during bulk delete and continue', fakeAsync(() => {
      const deleteIssueSpy = jasmine
        .createSpy('deleteIssue')
        .and.rejectWith(new Error('Delete failed'));
      const adapter = createMockAdapter({ deleteIssue: deleteIssueSpy });
      adapterRegistry.register('TEST_PROVIDER', adapter);

      const cfg = createMockIssueProvider();
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(of(cfg));

      effects.deleteIssueOnBulkTaskDelete$.subscribe();

      deletedTaskIssueSidecar.set([
        { issueId: 'issue-1', issueType: 'TEST_PROVIDER', issueProviderId: 'provider-1' },
      ]);
      actions$.next(TaskSharedActions.deleteTasks({ taskIds: ['task-1'] }));

      tick();

      expect(snackServiceSpy.open).toHaveBeenCalledWith(
        jasmine.objectContaining({ type: 'ERROR' }),
      );

      adapterRegistry.unregister('TEST_PROVIDER');
    }));
  });

  describe('autoCreateIssueOnTaskAdd$', () => {
    it('should create issue when task added to project with auto-create enabled', fakeAsync(() => {
      const createIssueSpy = jasmine.createSpy('createIssue').and.resolveTo({
        issueId: 'new-issue-1',
        issueNumber: 42,
        issueData: { summary: 'Test Task' },
      });
      const adapter = createMockAdapter({
        createIssue: createIssueSpy,
        getFieldMappings: jasmine.createSpy('getFieldMappings').and.returnValue([]),
        getSyncConfig: jasmine.createSpy('getSyncConfig').and.returnValue({}),
      });
      adapterRegistry.register('TEST_PROVIDER', adapter);

      const provider = createMockIssueProvider({
        id: 'provider-1',
        issueProviderKey: 'TEST_PROVIDER' as any,
        defaultProjectId: 'project-1',
        pluginConfig: { isAutoCreateIssues: true },
      } as any);

      store.overrideSelector(selectEnabledIssueProviders, [provider]);
      store.refreshState();

      const cfg = createMockIssueProvider({
        id: 'provider-1',
        issueProviderKey: 'TEST_PROVIDER' as any,
      });
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(of(cfg));

      const task = createMockTask({
        id: 'task-new',
        title: 'New Task',
        projectId: 'project-1',
        parentId: undefined,
        issueId: undefined,
      });

      // _pushInitialValues now re-fetches the task from the store
      taskServiceSpy.getByIdOnce$.and.returnValue(of(task));

      effects.autoCreateIssueOnTaskAdd$.subscribe();

      actions$.next(
        TaskSharedActions.addTask({
          task,
          workContextId: 'project-1',
          workContextType: WorkContextType.PROJECT,
          isAddToBacklog: false,
          isAddToBottom: false,
        }),
      );

      tick();

      expect(createIssueSpy).toHaveBeenCalledWith('New Task', cfg);
      expect(taskServiceSpy.update).toHaveBeenCalledWith(
        'task-new',
        jasmine.objectContaining({
          issueId: 'new-issue-1',
          issueType: 'TEST_PROVIDER',
          issueProviderId: 'provider-1',
        }),
      );

      adapterRegistry.unregister('TEST_PROVIDER');
    }));

    it('should not create issue when task already has an issueId', fakeAsync(() => {
      const createIssueSpy = jasmine.createSpy('createIssue').and.resolveTo({
        issueId: 'new-issue-1',
        issueData: { summary: 'Test' },
      });
      const adapter = createMockAdapter({ createIssue: createIssueSpy });
      adapterRegistry.register('TEST_PROVIDER', adapter);

      const provider = createMockIssueProvider({
        id: 'provider-1',
        issueProviderKey: 'TEST_PROVIDER' as any,
        defaultProjectId: 'project-1',
        pluginConfig: { isAutoCreateIssues: true },
      } as any);

      store.overrideSelector(selectEnabledIssueProviders, [provider]);
      store.refreshState();

      const task = createMockTask({
        id: 'task-existing',
        title: 'Existing Task',
        projectId: 'project-1',
        issueId: 'already-linked-issue',
      });

      effects.autoCreateIssueOnTaskAdd$.subscribe();

      actions$.next(
        TaskSharedActions.addTask({
          task,
          issue: { id: 'already-linked-issue' } as any,
          workContextId: 'project-1',
          workContextType: WorkContextType.PROJECT,
          isAddToBacklog: false,
          isAddToBottom: false,
        }),
      );

      tick();

      expect(createIssueSpy).not.toHaveBeenCalled();

      adapterRegistry.unregister('TEST_PROVIDER');
    }));

    it('should not create issue for subtasks (parentId set)', fakeAsync(() => {
      const createIssueSpy = jasmine.createSpy('createIssue').and.resolveTo({
        issueId: 'new-issue-1',
        issueData: { summary: 'Test' },
      });
      const adapter = createMockAdapter({ createIssue: createIssueSpy });
      adapterRegistry.register('TEST_PROVIDER', adapter);

      const provider = createMockIssueProvider({
        id: 'provider-1',
        issueProviderKey: 'TEST_PROVIDER' as any,
        defaultProjectId: 'project-1',
        pluginConfig: { isAutoCreateIssues: true },
      } as any);

      store.overrideSelector(selectEnabledIssueProviders, [provider]);
      store.refreshState();

      const task = createMockTask({
        id: 'subtask-1',
        title: 'Subtask',
        projectId: 'project-1',
        parentId: 'parent-task-1',
        issueId: undefined,
      });

      effects.autoCreateIssueOnTaskAdd$.subscribe();

      actions$.next(
        TaskSharedActions.addTask({
          task,
          workContextId: 'project-1',
          workContextType: WorkContextType.PROJECT,
          isAddToBacklog: false,
          isAddToBottom: false,
        }),
      );

      tick();

      expect(createIssueSpy).not.toHaveBeenCalled();

      adapterRegistry.unregister('TEST_PROVIDER');
    }));

    it('should not create issue when provider has no auto-create enabled', fakeAsync(() => {
      const createIssueSpy = jasmine.createSpy('createIssue').and.resolveTo({
        issueId: 'new-issue-1',
        issueData: { summary: 'Test' },
      });
      const adapter = createMockAdapter({ createIssue: createIssueSpy });
      adapterRegistry.register('TEST_PROVIDER', adapter);

      const provider = createMockIssueProvider({
        id: 'provider-1',
        issueProviderKey: 'TEST_PROVIDER' as any,
        defaultProjectId: 'project-1',
        // No pluginConfig or isAutoCreateIssues
      });

      store.overrideSelector(selectEnabledIssueProviders, [provider]);
      store.refreshState();

      const task = createMockTask({
        id: 'task-new',
        title: 'New Task',
        projectId: 'project-1',
        issueId: undefined,
      });

      effects.autoCreateIssueOnTaskAdd$.subscribe();

      actions$.next(
        TaskSharedActions.addTask({
          task,
          workContextId: 'project-1',
          workContextType: WorkContextType.PROJECT,
          isAddToBacklog: false,
          isAddToBottom: false,
        }),
      );

      tick();

      expect(createIssueSpy).not.toHaveBeenCalled();

      adapterRegistry.unregister('TEST_PROVIDER');
    }));

    it('should create issue for a native PLAINSPACE provider without a pluginConfig flag (collaborative by default)', fakeAsync(() => {
      // Contrast with the TEST_PROVIDER case above: a native provider with no
      // `pluginConfig.isAutoCreateIssues` normally does NOT auto-create. A bound
      // Plainspace provider does — the binding itself is the opt-in, so tasks
      // added to a shared project reach the team.
      const createIssueSpy = jasmine.createSpy('createIssue').and.resolveTo({
        issueId: 'ps-issue-1',
        issueData: { isDone: false, title: 'New Task', scheduledAt: null },
      });
      const adapter = createMockAdapter({
        createIssue: createIssueSpy,
        getFieldMappings: jasmine.createSpy('getFieldMappings').and.returnValue([]),
        getSyncConfig: jasmine.createSpy('getSyncConfig').and.returnValue({}),
      });
      // Override the Plainspace adapter the effects constructor registered.
      adapterRegistry.register('PLAINSPACE', adapter);

      const provider = createMockIssueProvider({
        id: 'provider-1',
        issueProviderKey: 'PLAINSPACE',
        defaultProjectId: 'project-1',
        // Configured (bound), but deliberately NO pluginConfig / isAutoCreateIssues.
        spaceId: 'space-1',
        token: 'pat_x',
      });

      store.overrideSelector(selectEnabledIssueProviders, [provider]);
      store.refreshState();

      const cfg = createMockIssueProvider({
        id: 'provider-1',
        issueProviderKey: 'PLAINSPACE',
      });
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(of(cfg));

      const task = createMockTask({
        id: 'task-new',
        title: 'New Task',
        projectId: 'project-1',
        parentId: undefined,
        issueId: undefined,
      });
      taskServiceSpy.getByIdOnce$.and.returnValue(of(task));

      effects.autoCreateIssueOnTaskAdd$.subscribe();

      actions$.next(
        TaskSharedActions.addTask({
          task,
          workContextId: 'project-1',
          workContextType: WorkContextType.PROJECT,
          isAddToBacklog: false,
          isAddToBottom: false,
        }),
      );

      tick();

      expect(createIssueSpy).toHaveBeenCalledWith('New Task', cfg);
      expect(taskServiceSpy.update).toHaveBeenCalledWith(
        'task-new',
        jasmine.objectContaining({
          issueId: 'ps-issue-1',
          issueType: 'PLAINSPACE',
          issueProviderId: 'provider-1',
        }),
      );
    }));

    it('should NOT create issue for a PLAINSPACE provider that is enabled but not yet configured (no spaceId/token)', fakeAsync(() => {
      // selectEnabledIssueProviders filters on the isEnabled flag only, so a
      // mid-connect provider (enabled, bound to the project, but spaceId/token
      // still null) reaches the gate. It must NOT auto-create — otherwise every
      // add POSTs an invalid create and error-snacks.
      const createIssueSpy = jasmine.createSpy('createIssue').and.resolveTo({
        issueId: 'ps-issue-1',
        issueData: {},
      });
      const adapter = createMockAdapter({ createIssue: createIssueSpy });
      adapterRegistry.register('PLAINSPACE', adapter);

      const provider = createMockIssueProvider({
        id: 'provider-1',
        issueProviderKey: 'PLAINSPACE',
        defaultProjectId: 'project-1',
        spaceId: null,
        token: null,
      });

      store.overrideSelector(selectEnabledIssueProviders, [provider]);
      store.refreshState();

      const task = createMockTask({
        id: 'task-new',
        title: 'New Task',
        projectId: 'project-1',
        issueId: undefined,
      });

      effects.autoCreateIssueOnTaskAdd$.subscribe();

      actions$.next(
        TaskSharedActions.addTask({
          task,
          workContextId: 'project-1',
          workContextType: WorkContextType.PROJECT,
          isAddToBacklog: false,
          isAddToBottom: false,
        }),
      );

      tick();

      expect(createIssueSpy).not.toHaveBeenCalled();

      adapterRegistry.unregister('PLAINSPACE');
    }));

    it('should not create issue when task has no projectId', fakeAsync(() => {
      const createIssueSpy = jasmine.createSpy('createIssue').and.resolveTo({
        issueId: 'new-issue-1',
        issueData: { summary: 'Test' },
      });
      const adapter = createMockAdapter({ createIssue: createIssueSpy });
      adapterRegistry.register('TEST_PROVIDER', adapter);

      const provider = createMockIssueProvider({
        id: 'provider-1',
        issueProviderKey: 'TEST_PROVIDER' as any,
        defaultProjectId: 'project-1',
        pluginConfig: { isAutoCreateIssues: true },
      } as any);

      store.overrideSelector(selectEnabledIssueProviders, [provider]);
      store.refreshState();

      const task = createMockTask({
        id: 'task-new',
        title: 'New Task',
        projectId: '' as any,
        issueId: undefined,
      });

      effects.autoCreateIssueOnTaskAdd$.subscribe();

      actions$.next(
        TaskSharedActions.addTask({
          task,
          workContextId: 'tag-1',
          workContextType: WorkContextType.TAG,
          isAddToBacklog: false,
          isAddToBottom: false,
        }),
      );

      tick();

      expect(createIssueSpy).not.toHaveBeenCalled();

      adapterRegistry.unregister('TEST_PROVIDER');
    }));

    it('should show snack on auto-create error and continue', fakeAsync(() => {
      const createIssueSpy = jasmine
        .createSpy('createIssue')
        .and.rejectWith(new Error('Create failed'));
      const adapter = createMockAdapter({ createIssue: createIssueSpy });
      adapterRegistry.register('TEST_PROVIDER', adapter);

      const provider = createMockIssueProvider({
        id: 'provider-1',
        issueProviderKey: 'TEST_PROVIDER' as any,
        defaultProjectId: 'project-1',
        pluginConfig: { isAutoCreateIssues: true },
      } as any);

      store.overrideSelector(selectEnabledIssueProviders, [provider]);
      store.refreshState();

      const cfg = createMockIssueProvider({
        id: 'provider-1',
        issueProviderKey: 'TEST_PROVIDER' as any,
      });
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(of(cfg));

      const task = createMockTask({
        id: 'task-new',
        title: 'New Task',
        projectId: 'project-1',
        issueId: undefined,
      });

      effects.autoCreateIssueOnTaskAdd$.subscribe();

      actions$.next(
        TaskSharedActions.addTask({
          task,
          workContextId: 'project-1',
          workContextType: WorkContextType.PROJECT,
          isAddToBacklog: false,
          isAddToBottom: false,
        }),
      );

      tick();

      expect(snackServiceSpy.open).toHaveBeenCalledWith(
        jasmine.objectContaining({ type: 'ERROR' }),
      );

      adapterRegistry.unregister('TEST_PROVIDER');
    }));

    it('should prefix title with issue number when provided', fakeAsync(() => {
      const createIssueSpy = jasmine.createSpy('createIssue').and.resolveTo({
        issueId: 'new-issue-1',
        issueNumber: 42,
        issueData: { summary: 'Test Task' },
      });
      const adapter = createMockAdapter({
        createIssue: createIssueSpy,
        getFieldMappings: jasmine.createSpy('getFieldMappings').and.returnValue([]),
        getSyncConfig: jasmine.createSpy('getSyncConfig').and.returnValue({}),
      });
      adapterRegistry.register('TEST_PROVIDER', adapter);

      const provider = createMockIssueProvider({
        id: 'provider-1',
        issueProviderKey: 'TEST_PROVIDER' as any,
        defaultProjectId: 'project-1',
        pluginConfig: { isAutoCreateIssues: true },
      } as any);

      store.overrideSelector(selectEnabledIssueProviders, [provider]);
      store.refreshState();

      const cfg = createMockIssueProvider({
        id: 'provider-1',
        issueProviderKey: 'TEST_PROVIDER' as any,
      });
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(of(cfg));

      const task = createMockTask({
        id: 'task-new',
        title: 'New Task',
        projectId: 'project-1',
        issueId: undefined,
      });

      // _pushInitialValues now re-fetches the task from the store
      taskServiceSpy.getByIdOnce$.and.returnValue(of(task));

      effects.autoCreateIssueOnTaskAdd$.subscribe();

      actions$.next(
        TaskSharedActions.addTask({
          task,
          workContextId: 'project-1',
          workContextType: WorkContextType.PROJECT,
          isAddToBacklog: false,
          isAddToBottom: false,
        }),
      );

      tick();

      expect(taskServiceSpy.update).toHaveBeenCalledWith(
        'task-new',
        jasmine.objectContaining({
          title: '#42 New Task',
        }),
      );

      adapterRegistry.unregister('TEST_PROVIDER');
    }));

    it('should push initial dueWithTime from short syntax and update issueLastUpdated', fakeAsync(() => {
      const dueTimestamp = 1774008000000;
      const createIssueSpy = jasmine.createSpy('createIssue').and.resolveTo({
        issueId: 'new-issue-1',
        issueNumber: undefined,
        issueData: { dtstart: null },
      });
      const adapter = createMockAdapter({
        createIssue: createIssueSpy,
        getFieldMappings: jasmine
          .createSpy('getFieldMappings')
          .and.returnValue([dueWithTimeFieldMapping]),
        getSyncConfig: jasmine.createSpy('getSyncConfig').and.returnValue({}),
        extractSyncValues: jasmine
          .createSpy('extractSyncValues')
          .and.returnValue({ dtstart: null }),
      });
      adapterRegistry.register('TEST_PROVIDER', adapter);

      const provider = createMockIssueProvider({
        id: 'provider-1',
        issueProviderKey: 'TEST_PROVIDER' as any,
        defaultProjectId: 'project-1',
        pluginConfig: { isAutoCreateIssues: true },
      } as any);

      store.overrideSelector(selectEnabledIssueProviders, [provider]);
      store.refreshState();

      const cfg = createMockIssueProvider({
        id: 'provider-1',
        issueProviderKey: 'TEST_PROVIDER' as any,
      });
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(of(cfg));

      const task = createMockTask({
        id: 'task-new',
        title: 'New Task',
        projectId: 'project-1',
        issueId: undefined,
      });

      // The re-fetched task from the store has dueWithTime set by short syntax
      const taskWithDueTime = createMockTask({
        ...task,
        dueWithTime: dueTimestamp,
      });
      taskServiceSpy.getByIdOnce$.and.returnValue(of(taskWithDueTime));

      effects.autoCreateIssueOnTaskAdd$.subscribe();

      actions$.next(
        TaskSharedActions.addTask({
          task,
          workContextId: 'project-1',
          workContextType: WorkContextType.PROJECT,
          isAddToBacklog: false,
          isAddToBottom: false,
        }),
      );

      tick();

      // Should have pushed initial values
      expect(adapter.pushChanges).toHaveBeenCalledWith(
        'new-issue-1',
        { dtstart: dueTimestamp },
        cfg,
      );

      // Should have updated issueLastSyncedValues AND issueLastUpdated
      const updateCalls = taskServiceSpy.update.calls.allArgs();
      const lastUpdateCall = updateCalls[updateCalls.length - 1];
      expect(lastUpdateCall[0]).toBe('task-new');
      expect(lastUpdateCall[1]).toEqual(
        jasmine.objectContaining({
          issueLastSyncedValues: { dtstart: dueTimestamp },
          issueLastUpdated: jasmine.any(Number),
        }),
      );

      adapterRegistry.unregister('TEST_PROVIDER');
    }));
  });
});
