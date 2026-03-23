import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { of, Subject } from 'rxjs';
import { IssueTwoWaySyncEffects } from './issue-two-way-sync.effects';
import { TaskService } from '../../tasks/task.service';
import { IssueProviderService } from '../issue-provider.service';
import { IssueSyncAdapterRegistryService } from './issue-sync-adapter-registry.service';
import { CaldavSyncAdapterService } from '../providers/caldav/caldav-sync-adapter.service';
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

describe('IssueTwoWaySyncEffects', () => {
  let effects: IssueTwoWaySyncEffects;
  let actions$: Subject<any>;
  let store: MockStore;
  let taskServiceSpy: jasmine.SpyObj<TaskService>;
  let issueProviderServiceSpy: jasmine.SpyObj<IssueProviderService>;
  let adapterRegistry: IssueSyncAdapterRegistryService;
  let snackServiceSpy: jasmine.SpyObj<SnackService>;
  let deletedTaskIssueSidecar: DeletedTaskIssueSidecarService;

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
        { provide: SnackService, useValue: snackServiceSpy },
      ],
    });

    effects = TestBed.inject(IssueTwoWaySyncEffects);
    store = TestBed.inject(MockStore);
    adapterRegistry = TestBed.inject(IssueSyncAdapterRegistryService);
    deletedTaskIssueSidecar = TestBed.inject(DeletedTaskIssueSidecarService);
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
