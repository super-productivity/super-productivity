import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { IssueLog } from '../../../core/log';
import { DateTimeFormatService } from '../../../core/date-time-format/date-time-format.service';
import { DEFAULT_DATE_INPUT_LOCALE } from '../../../core/date-time-format/date-input-locale';
import { provideMockActions } from '@ngrx/effects/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { of, Subject, throwError } from 'rxjs';
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
import { FieldMapping, IssueSyncPushError } from './issue-sync.model';
import { IssueSyncStateService } from './issue-sync-state.service';
import { IssueSyncAdapter } from './issue-sync-adapter.interface';
import { IssueProvider } from '../issue.model';
import { WorkContextType } from '../../work-context/work-context.model';
import { DeletedTaskIssueSidecarService } from './deleted-task-issue-sidecar.service';
import { DeletedTagTitlesSidecarService } from './deleted-tag-titles-sidecar.service';
import { PendingRemoteIssueDeleteService } from './pending-remote-issue-delete.service';
import { deleteTag } from '../../tag/store/tag.actions';
import { selectAllTasks, selectTaskEntities } from '../../tasks/store/task.selectors';
import { selectShortSyntaxConfig } from '../../config/store/global-config.reducer';
import { DEFAULT_GLOBAL_CONFIG } from '../../config/default-global-config.const';
import { selectAllTagsWithoutMyDay } from '../../tag/store/tag.reducer';
import { selectUnarchivedProjects } from '../../project/store/project.selectors';
import {
  REMOTE_ISSUE_DELETE_DEFER_MS,
  TASK_DELETE_UNDO_WINDOW_MS,
} from '../../../app.constants';

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

    taskServiceSpy = jasmine.createSpyObj('TaskService', [
      'getByIdOnce$',
      'update',
      'updateUi',
    ]);
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
      'deleteIssue',
    ]);

    TestBed.configureTestingModule({
      providers: [
        IssueTwoWaySyncEffects,
        provideMockActions(() => actions$),
        provideMockStore({
          selectors: [
            { selector: selectEnabledIssueProviders, value: [] },
            {
              selector: selectShortSyntaxConfig,
              value: DEFAULT_GLOBAL_CONFIG.shortSyntax,
            },
            { selector: selectAllTagsWithoutMyDay, value: [] },
            { selector: selectUnarchivedProjects, value: [] },
            { selector: selectTaskEntities, value: {} },
          ],
        }),
        { provide: LOCAL_ACTIONS, useValue: actions$ },
        {
          provide: DateTimeFormatService,
          useValue: { dateInputLocale: () => DEFAULT_DATE_INPUT_LOCALE },
        },
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

      expect(adapter.pushChanges).toHaveBeenCalled();

      adapterRegistry.unregister('TEST_PROVIDER');
    }));

    describe('a title typed with short syntax', () => {
      let adapter: ReturnType<typeof createMockAdapter>;

      const rename = (title: string, isIgnoreShortSyntax?: boolean): void => {
        const task = createMockTask({
          id: 'task-1',
          title,
          issueType: 'TEST_PROVIDER' as any,
          issueId: 'issue-1',
          issueProviderId: 'provider-1',
          issueLastSyncedValues: { summary: 'Old' },
        });
        taskServiceSpy.getByIdOnce$.and.returnValue(of(task));
        actions$.next(
          TaskSharedActions.updateTask({
            task: { id: 'task-1', changes: { title } },
            isIgnoreShortSyntax,
          }),
        );
      };

      beforeEach(() => {
        adapter = createMockAdapter({
          getFieldMappings: jasmine
            .createSpy('getFieldMappings')
            .and.returnValue([titleFieldMapping]),
          getSyncConfig: jasmine.createSpy('getSyncConfig').and.returnValue({}),
          fetchIssue: jasmine.createSpy('fetchIssue').and.resolveTo({ summary: 'Old' }),
          extractSyncValues: jasmine
            .createSpy('extractSyncValues')
            .and.returnValue({ summary: 'Old' }),
        });
        adapterRegistry.register('TEST_PROVIDER', adapter);
        issueProviderServiceSpy.getCfgOnce$.and.returnValue(
          of(createMockIssueProvider()),
        );
        effects.pushFieldsOnTaskUpdate$.subscribe();
      });

      afterEach(() => {
        adapterRegistry.unregister('TEST_PROVIDER');
      });

      it('is not pushed raw: the short-syntax update that follows pushes it cleaned', fakeAsync(() => {
        rename('Write report #work');
        tick();
        expect(adapter.pushChanges).not.toHaveBeenCalled();
      }));

      it('is pushed once, cleaned, by the short-syntax update that follows', fakeAsync(() => {
        rename('Write report #work');
        tick();
        const cleaned = createMockTask({
          id: 'task-1',
          title: 'Write report',
          issueType: 'TEST_PROVIDER' as any,
          issueId: 'issue-1',
          issueProviderId: 'provider-1',
          issueLastSyncedValues: { summary: 'Old' },
        });
        taskServiceSpy.getByIdOnce$.and.returnValue(of(cleaned));
        actions$.next(
          TaskSharedActions.applyShortSyntax({
            task: cleaned,
            taskChanges: { title: 'Write report' },
          }),
        );
        tick();
        expect(adapter.pushChanges).toHaveBeenCalledOnceWith(
          'issue-1',
          { summary: 'Write report' },
          jasmine.anything(),
        );
      }));

      it('is pushed as typed when the parse fails', fakeAsync(() => {
        // e.g. the date parser chunk can't load: the stream must keep pushing.
        spyOn(
          effects as unknown as { _parseShortSyntax: () => Promise<unknown> },
          '_parseShortSyntax',
        ).and.rejectWith(new Error('chunk load failed'));
        rename('Write report @tomorrow');
        tick();
        expect(adapter.pushChanges).toHaveBeenCalledOnceWith(
          'issue-1',
          { summary: 'Write report @tomorrow' },
          jasmine.anything(),
        );
      }));

      it('is pushed when short syntax leaves it as it is', fakeAsync(() => {
        rename('Write report');
        tick();
        expect(adapter.pushChanges).toHaveBeenCalledWith(
          'issue-1',
          { summary: 'Write report' },
          jasmine.anything(),
        );
      }));

      it('is pushed as typed when short syntax is turned off', fakeAsync(() => {
        store.overrideSelector(selectShortSyntaxConfig, {
          ...DEFAULT_GLOBAL_CONFIG.shortSyntax,
          isEnableTag: false,
          isEnableProject: false,
          isEnableDue: false,
        });
        store.refreshState();
        rename('Write report #work');
        tick();
        expect(adapter.pushChanges).toHaveBeenCalledWith(
          'issue-1',
          { summary: 'Write report #work' },
          jasmine.anything(),
        );
      }));

      it('is pushed as typed when short syntax is ignored', fakeAsync(() => {
        rename('Write report #work', true);
        tick();
        expect(adapter.pushChanges).toHaveBeenCalledWith(
          'issue-1',
          { summary: 'Write report #work' },
          jasmine.anything(),
        );
      }));
    });

    it("should not push isDone for a task finished as won't do", fakeAsync(() => {
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
        isDone: true,
        doneOn: 5,
        wontDoOn: 5,
      });

      taskServiceSpy.getByIdOnce$.and.returnValue(of(task));
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(of(createMockIssueProvider()));

      effects.pushFieldsOnTaskUpdate$.subscribe();

      actions$.next(
        TaskSharedActions.updateTask({
          task: { id: 'task-1', changes: { isDone: true, doneOn: 5, wontDoOn: 5 } },
        }),
      );

      tick();

      expect(adapter.pushChanges).not.toHaveBeenCalled();

      adapterRegistry.unregister('TEST_PROVIDER');
    }));

    // tasks linked before two-way sync existed (e.g. migrated Nextcloud Deck)
    // never got a baseline; the user's change must still reach the issue
    const baselessPushSetup = (
      remoteLastUpdated: number,
      taskOverrides: Partial<Task> = {},
      remoteStatus = 'NEEDS-ACTION',
    ): IssueSyncAdapter<unknown> => {
      const adapter = createMockAdapter({
        getFieldMappings: jasmine
          .createSpy('getFieldMappings')
          .and.returnValue([isDoneFieldMapping, titleFieldMapping]),
        extractSyncValues: jasmine
          .createSpy('extractSyncValues')
          .and.returnValue({ status: remoteStatus, summary: 'Remote' }),
        getIssueLastUpdated: () => remoteLastUpdated,
      });
      adapterRegistry.register('TEST_PROVIDER', adapter);
      const task = createMockTask({
        issueType: 'TEST_PROVIDER' as any,
        issueId: 'issue-1',
        issueProviderId: 'provider-1',
        issueLastUpdated: 1000,
        isDone: true,
        ...taskOverrides,
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
      adapterRegistry.unregister('TEST_PROVIDER');
      return adapter;
    };

    // an old task may miss remote edits that were never polled; those win
    it('should not push for a baseline-less task whose issue changed since', fakeAsync(() => {
      const adapter = baselessPushSetup(2000);

      expect(adapter.pushChanges).not.toHaveBeenCalled();
    }));

    // after a push the baseline only holds the pushed field; until a poll
    // seeds the rest, later pushes must keep the marker stale too
    it('should keep issueLastUpdated stale while the baseline is partial', fakeAsync(() => {
      baselessPushSetup(
        1000,
        { isDone: false, issueLastSyncedValues: { status: 'COMPLETED' } },
        'COMPLETED',
      );

      expect(taskServiceSpy.updateUi).toHaveBeenCalledWith('task-1', {
        issueLastSyncedValues: { status: 'NEEDS-ACTION' },
      });
    }));

    // CalDAV reports `note: undefined` for an empty description; a baseline
    // that went through JSON (sync) lacks the key, which is not "unseeded"
    it('should advance issueLastUpdated when an unseeded field has no value', fakeAsync(() => {
      const adapter = createMockAdapter({
        getFieldMappings: jasmine
          .createSpy('getFieldMappings')
          .and.returnValue([isDoneFieldMapping, titleFieldMapping]),
        extractSyncValues: jasmine
          .createSpy('extractSyncValues')
          .and.returnValue({ status: 'NEEDS-ACTION', summary: undefined }),
        getIssueLastUpdated: () => 3000,
      });
      adapterRegistry.register('TEST_PROVIDER', adapter);
      const task = createMockTask({
        issueType: 'TEST_PROVIDER' as any,
        issueId: 'issue-1',
        issueProviderId: 'provider-1',
        issueLastUpdated: 1000,
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

      expect(taskServiceSpy.updateUi).toHaveBeenCalledWith('task-1', {
        issueLastSyncedValues: { status: 'COMPLETED' },
        issueLastUpdated: 3000,
      });

      adapterRegistry.unregister('TEST_PROVIDER');
    }));

    it('should push for a task that has no baseline at all', fakeAsync(() => {
      const adapter = baselessPushSetup(1000);

      expect(adapter.pushChanges).toHaveBeenCalledWith(
        'issue-1',
        { status: 'COMPLETED' },
        jasmine.anything(),
      );
      // issueLastUpdated stays stale so the next poll refreshes the task, seeds
      // the full baseline and pulls remote edits made before this push
      expect(taskServiceSpy.updateUi).toHaveBeenCalledWith('task-1', {
        issueLastSyncedValues: { status: 'COMPLETED' },
      });
    }));

    // the second toggle is queued before the first push lands; it must compare
    // against the baseline that push wrote, not the stale snapshot
    it('should push a quick reopen after a pending done push', fakeAsync(() => {
      let remote = { status: 'NEEDS-ACTION', lastUpdated: 1000 };
      const adapter = createMockAdapter({
        getFieldMappings: jasmine
          .createSpy('getFieldMappings')
          .and.returnValue([isDoneFieldMapping]),
        fetchIssue: jasmine.createSpy('fetchIssue').and.callFake(async () => remote),
        pushChanges: jasmine
          .createSpy('pushChanges')
          .and.callFake(async (_id: string, changes: Record<string, unknown>) => {
            await new Promise((r) => setTimeout(r, 100));
            remote = { status: changes['status'] as string, lastUpdated: 2000 };
          }),
        extractSyncValues: jasmine
          .createSpy('extractSyncValues')
          .and.callFake((issue: Record<string, unknown>) => ({
            status: issue['status'],
          })),
        getIssueLastUpdated: (issue: Record<string, unknown>) =>
          issue['lastUpdated'] as number,
      });
      adapterRegistry.register('TEST_PROVIDER', adapter);
      let task = createMockTask({
        issueType: 'TEST_PROVIDER' as any,
        issueId: 'issue-1',
        issueProviderId: 'provider-1',
        issueLastUpdated: 1000,
        issueLastSyncedValues: { status: 'NEEDS-ACTION' },
        isDone: false,
      });
      taskServiceSpy.getByIdOnce$.and.callFake(() => of(task));
      taskServiceSpy.updateUi.and.callFake((_id: string, changes: Partial<Task>) => {
        task = { ...task, ...changes };
      });
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(of(createMockIssueProvider()));

      effects.pushFieldsOnTaskUpdate$.subscribe();
      task = { ...task, isDone: true };
      actions$.next(
        TaskSharedActions.updateTask({
          task: { id: 'task-1', changes: { isDone: true } },
        }),
      );
      // the done push is now in flight
      flushMicrotasks();
      task = { ...task, isDone: false };
      actions$.next(
        TaskSharedActions.updateTask({
          task: { id: 'task-1', changes: { isDone: false } },
        }),
      );
      tick(500);

      expect(
        (adapter.pushChanges as jasmine.Spy).calls.allArgs().map((a) => a[1]),
      ).toEqual([{ status: 'COMPLETED' }, { status: 'NEEDS-ACTION' }]);
      expect(remote.status).toBe('NEEDS-ACTION');

      adapterRegistry.unregister('TEST_PROVIDER');
    }));

    // a push of another field queued behind the done push must keep the
    // baseline that push wrote, not write the stale status back
    it('should keep both fields in the baseline after queued pushes', fakeAsync(() => {
      let remote: Record<string, unknown> = {
        status: 'NEEDS-ACTION',
        summary: 'Old',
        lastUpdated: 1000,
      };
      const adapter = createMockAdapter({
        getFieldMappings: jasmine
          .createSpy('getFieldMappings')
          .and.returnValue([isDoneFieldMapping, titleFieldMapping]),
        fetchIssue: jasmine.createSpy('fetchIssue').and.callFake(async () => remote),
        pushChanges: jasmine
          .createSpy('pushChanges')
          .and.callFake(async (_id: string, changes: Record<string, unknown>) => {
            await new Promise((r) => setTimeout(r, 100));
            remote = { ...remote, ...changes, lastUpdated: 2000 };
          }),
        extractSyncValues: jasmine
          .createSpy('extractSyncValues')
          .and.callFake((issue: Record<string, unknown>) => ({
            status: issue['status'],
            summary: issue['summary'],
          })),
        getIssueLastUpdated: (issue: Record<string, unknown>) =>
          issue['lastUpdated'] as number,
      });
      adapterRegistry.register('TEST_PROVIDER', adapter);
      let task = createMockTask({
        issueType: 'TEST_PROVIDER' as any,
        issueId: 'issue-1',
        issueProviderId: 'provider-1',
        issueLastUpdated: 1000,
        issueLastSyncedValues: { status: 'NEEDS-ACTION', summary: 'Old' },
        isDone: false,
        title: 'Old',
      });
      taskServiceSpy.getByIdOnce$.and.callFake(() => of(task));
      taskServiceSpy.updateUi.and.callFake((_id: string, changes: Partial<Task>) => {
        task = { ...task, ...changes };
      });
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(of(createMockIssueProvider()));

      effects.pushFieldsOnTaskUpdate$.subscribe();
      task = { ...task, isDone: true };
      actions$.next(
        TaskSharedActions.updateTask({
          task: { id: 'task-1', changes: { isDone: true } },
        }),
      );
      // the done push is now in flight
      flushMicrotasks();
      task = { ...task, title: 'New' };
      actions$.next(
        TaskSharedActions.updateTask({
          task: { id: 'task-1', changes: { title: 'New' } },
        }),
      );
      tick(500);

      expect(task.issueLastSyncedValues).toEqual({ status: 'COMPLETED', summary: 'New' });

      adapterRegistry.unregister('TEST_PROVIDER');
    }));

    it('should still skip a field missing from an existing baseline', fakeAsync(() => {
      const adapter = createMockAdapter({
        getFieldMappings: jasmine
          .createSpy('getFieldMappings')
          .and.returnValue([isDoneFieldMapping]),
        extractSyncValues: jasmine
          .createSpy('extractSyncValues')
          .and.returnValue({ status: 'NEEDS-ACTION' }),
      });
      adapterRegistry.register('TEST_PROVIDER', adapter);
      const task = createMockTask({
        issueType: 'TEST_PROVIDER' as any,
        issueId: 'issue-1',
        issueProviderId: 'provider-1',
        isDone: true,
        issueLastSyncedValues: {},
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

      const updateChanges = taskServiceSpy.updateUi.calls.mostRecent()
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
      const updateChanges = taskServiceSpy.updateUi.calls.mostRecent()
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
      const updateChanges = taskServiceSpy.updateUi.calls.mostRecent()
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

      const updateChanges = taskServiceSpy.updateUi.calls.mostRecent()
        .args[1] as Partial<Task>;
      expect(updateChanges.issueLastUpdated).toBe(999);

      adapterRegistry.unregister('TEST_PROVIDER');
    }));

    describe('the baseline write after a push (#11034)', () => {
      /**
       * Pushes `changes` for a task that starts as `taskBase`; the store holds
       * `taskBase` with `inStore` applied when the baseline is written.
       * The issue starts at the task's baseline. Returns the baseline write.
       */
      const push = (
        taskBase: Partial<Task>,
        changes: Partial<Task>,
        inStore: Partial<Task> = {},
        isSubscribed = false,
      ): Partial<Task> => {
        const task = createMockTask({
          id: 'task-1',
          issueType: 'TEST_PROVIDER' as any,
          issueId: 'issue-1',
          issueProviderId: 'provider-1',
          issueLastUpdated: 123,
          ...taskBase,
        });
        const adapter = createMockAdapter({
          getFieldMappings: jasmine
            .createSpy('getFieldMappings')
            .and.returnValue([titleFieldMapping, isDoneFieldMapping]),
          getSyncConfig: jasmine.createSpy('getSyncConfig').and.returnValue({}),
          fetchIssue: jasmine
            .createSpy('fetchIssue')
            .and.resolveTo({ ...task.issueLastSyncedValues }),
          extractSyncValues: jasmine
            .createSpy('extractSyncValues')
            .and.callFake((issue: { summary: unknown; status: unknown }) => ({
              summary: issue.summary,
              status: issue.status,
            })),
        });
        adapterRegistry.register('TEST_PROVIDER', adapter);
        taskServiceSpy.getByIdOnce$.and.returnValue(of(task));
        issueProviderServiceSpy.getCfgOnce$.and.returnValue(
          of(createMockIssueProvider()),
        );
        store.overrideSelector(selectTaskEntities, {
          ['task-1']: { ...task, ...inStore },
        });
        store.refreshState();

        if (!isSubscribed) {
          effects.pushFieldsOnTaskUpdate$.subscribe();
        }
        actions$.next(TaskSharedActions.updateTask({ task: { id: 'task-1', changes } }));
        tick();
        adapterRegistry.unregister('TEST_PROVIDER');
        return taskServiceSpy.updateUi.calls.mostRecent().args[1] as Partial<Task>;
      };

      const renamed: Partial<Task> = {
        title: 'New title',
        isDone: false,
        issueLastSyncedValues: { summary: 'Old title', status: 'NEEDS-ACTION' },
      };

      it('carries the pushed title, so title and baseline resolve together', fakeAsync(() => {
        const changes = push(renamed, { title: 'New title' });
        expect(changes.title).toBe('New title');
        expect(changes.issueLastSyncedValues).toEqual({
          summary: 'New title',
          status: 'NEEDS-ACTION',
        });
        expect('isDone' in changes).toBe(false);
      }));

      it('does not carry a title edited again during the push', fakeAsync(() => {
        const changes = push(renamed, { title: 'New title' }, { title: 'Edited again' });
        expect('title' in changes).toBe(false);
        expect(changes.issueLastSyncedValues!['summary']).toBe('New title');
      }));

      it('is one updateTaskUi, never an updateTask', fakeAsync(() => {
        push(renamed, { title: 'New title' });
        expect(taskServiceSpy.updateUi).toHaveBeenCalledTimes(1);
        expect(taskServiceSpy.update).not.toHaveBeenCalled();
      }));

      it('carries a pushed reopen and clears its completion date', fakeAsync(() => {
        const changes = push(
          {
            title: 'T',
            isDone: false,
            doneOn: undefined,
            issueLastSyncedValues: { summary: 'T', status: 'COMPLETED' },
          },
          { isDone: false },
        );
        expect(changes.isDone).toBe(false);
        expect('doneOn' in changes).toBe(true);
        expect(changes.doneOn).toBeUndefined();
        expect(changes.issueLastSyncedValues!['status']).toBe('NEEDS-ACTION');
      }));

      it('carries a pushed completion with its completion date', fakeAsync(() => {
        const changes = push(
          {
            title: 'T',
            isDone: true,
            doneOn: 1234,
            issueLastSyncedValues: { summary: 'T', status: 'NEEDS-ACTION' },
          },
          { isDone: true },
        );
        expect(changes.isDone).toBe(true);
        expect(changes.doneOn).toBe(1234);
      }));

      it('does not carry a done state undone during the push', fakeAsync(() => {
        const changes = push(
          {
            title: 'T',
            isDone: true,
            doneOn: 1234,
            issueLastSyncedValues: { summary: 'T', status: 'NEEDS-ACTION' },
          },
          { isDone: true },
          { isDone: false, doneOn: undefined },
        );
        expect('isDone' in changes).toBe(false);
        expect('doneOn' in changes).toBe(false);
      }));

      it("still pushes the user's next edit of the task", fakeAsync(() => {
        push(renamed, { title: 'New title' });
        const pushes = (): number => taskServiceSpy.updateUi.calls.count();
        expect(pushes()).toBe(1);

        push(
          {
            title: 'Newer title',
            isDone: false,
            issueLastSyncedValues: { summary: 'New title', status: 'NEEDS-ACTION' },
          },
          { title: 'Newer title' },
          {},
          true,
        );
        expect(pushes()).toBe(2);
        expect(taskServiceSpy.updateUi.calls.mostRecent().args[1].title).toBe(
          'Newer title',
        );
      }));
    });

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

    // Log history is exportable: an HTTP error carries the provider's URL.
    it('logs only the status of a failed push', fakeAsync(() => {
      const adapter = createMockAdapter({
        getFieldMappings: jasmine
          .createSpy('getFieldMappings')
          .and.returnValue([isDoneFieldMapping]),
        getSyncConfig: jasmine.createSpy('getSyncConfig').and.returnValue({}),
        fetchIssue: jasmine
          .createSpy('fetchIssue')
          .and.rejectWith(
            new HttpErrorResponse({ status: 500, url: 'https://private.example/api' }),
          ),
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
      const logSpy = spyOn(IssueLog, 'err');

      effects.pushFieldsOnTaskUpdate$.subscribe();
      actions$.next(
        TaskSharedActions.updateTask({
          task: { id: 'task-1', changes: { isDone: true } },
        }),
      );
      tick();

      expect(logSpy).toHaveBeenCalledOnceWith(jasmine.any(String), { status: 500 });
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

  // Release 1: pushes asked for by a poll (quiet) or Retry, and per-task state.
  describe('pending pushes and sync state', () => {
    let syncState: IssueSyncStateService;
    let adapter: IssueSyncAdapter<unknown>;
    const baseline = { status: 'NEEDS-ACTION', summary: 'Old' };
    const linkedTask = (overrides: Partial<Task> = {}): Task =>
      createMockTask({
        id: 'task-1',
        title: 'New',
        issueType: 'TEST_PROVIDER' as any,
        issueId: 'issue-1',
        issueProviderId: 'provider-1',
        issueLastSyncedValues: baseline,
        ...overrides,
      });

    beforeEach(() => {
      syncState = TestBed.inject(IssueSyncStateService);
      adapter = createMockAdapter({
        getFieldMappings: jasmine
          .createSpy('getFieldMappings')
          .and.returnValue([isDoneFieldMapping, titleFieldMapping]),
        fetchIssue: jasmine.createSpy('fetchIssue').and.resolveTo(baseline),
        extractSyncValues: jasmine
          .createSpy('extractSyncValues')
          .and.returnValue(baseline),
      });
      adapterRegistry.register('TEST_PROVIDER', adapter);
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(of(createMockIssueProvider()));
    });

    afterEach(() => adapterRegistry.unregister('TEST_PROVIDER'));

    it('pushes the fields that differ from their baseline on request', fakeAsync(() => {
      taskServiceSpy.getByIdOnce$.and.returnValue(of(linkedTask()));
      effects.pushFieldsOnTaskUpdate$.subscribe();

      syncState.requestPush('task-1', true);
      tick();

      expect(adapter.pushChanges).toHaveBeenCalledOnceWith(
        'issue-1',
        { summary: 'New' },
        jasmine.anything(),
      );
    }));

    it('retries a title kept literally even though short syntax would parse it', fakeAsync(() => {
      // Stored as typed (isIgnoreShortSyntax, e.g. the local REST API) and its
      // first push failed: no short-syntax update will ever push it.
      taskServiceSpy.getByIdOnce$.and.returnValue(of(linkedTask({ title: 'New #work' })));
      effects.pushFieldsOnTaskUpdate$.subscribe();

      syncState.requestPush('task-1', false);
      tick();

      expect(adapter.pushChanges).toHaveBeenCalledOnceWith(
        'issue-1',
        { summary: 'New #work' },
        jasmine.anything(),
      );
    }));

    it('sends a field once when two requests for it are queued', fakeAsync(() => {
      // Timer and focus polls can overlap, or Retry follows a poll: the second
      // request must see the baseline the first push stored.
      let current = linkedTask();
      let remote: Record<string, unknown> = { ...baseline };
      taskServiceSpy.getByIdOnce$.and.callFake(() => of(current));
      taskServiceSpy.updateUi.and.callFake((_id: string, changes: Partial<Task>) => {
        current = { ...current, ...changes } as Task;
      });
      (adapter.fetchIssue as jasmine.Spy).and.callFake(async () => remote);
      (adapter.extractSyncValues as jasmine.Spy).and.callFake(
        (issue: Record<string, unknown>) => issue,
      );
      (adapter.pushChanges as jasmine.Spy).and.callFake(
        async (_id: string, changes: Record<string, unknown>) => {
          remote = { ...remote, ...changes };
        },
      );
      effects.pushFieldsOnTaskUpdate$.subscribe();

      syncState.requestPush('task-1', true);
      syncState.requestPush('task-1', false);
      tick();

      expect(adapter.pushChanges).toHaveBeenCalledTimes(1);
      expect(current.issueLastSyncedValues).toEqual({ ...baseline, summary: 'New' });
    }));

    it('a second device whose edit already reached the provider sends nothing', fakeAsync(() => {
      // Both devices have the rename pending; the other one pushed first. The
      // fetch sees the provider already holds the value: provider-changed skip,
      // no write, baseline and marker untouched, so the next poll pulls the
      // same value and both converge.
      (adapter.fetchIssue as jasmine.Spy).and.resolveTo({ ...baseline, summary: 'New' });
      (adapter.extractSyncValues as jasmine.Spy).and.callFake(
        (issue: Record<string, unknown>) => issue,
      );
      taskServiceSpy.getByIdOnce$.and.returnValue(of(linkedTask()));
      effects.pushFieldsOnTaskUpdate$.subscribe();

      syncState.requestPush('task-1', true);
      tick();

      expect(adapter.pushChanges).not.toHaveBeenCalled();
      expect(taskServiceSpy.update).not.toHaveBeenCalled();
      expect(syncState.failures().has('task-1')).toBeFalse();
    }));

    it('requests nothing when no field is pending, and clears an old failure', fakeAsync(() => {
      taskServiceSpy.getByIdOnce$.and.returnValue(of(linkedTask({ title: 'Old' })));
      syncState.reportFailure('task-1', { text: 'offline' });
      effects.pushFieldsOnTaskUpdate$.subscribe();

      syncState.requestPush('task-1', false);
      tick();

      expect(adapter.fetchIssue).not.toHaveBeenCalled();
      expect(syncState.failures().has('task-1')).toBeFalse();
    }));

    it('a quiet push records its failure on the task without a snack', fakeAsync(() => {
      taskServiceSpy.getByIdOnce$.and.returnValue(of(linkedTask()));
      (adapter.pushChanges as jasmine.Spy).and.rejectWith(new Error('offline'));
      effects.pushFieldsOnTaskUpdate$.subscribe();

      syncState.requestPush('task-1', true);
      tick();

      expect(syncState.failures().get('task-1')).toEqual({ text: 'offline' });
      expect(snackServiceSpy.open).not.toHaveBeenCalled();
    }));

    it('Retry snacks a failure; a provider reason shows as its own message', fakeAsync(() => {
      taskServiceSpy.getByIdOnce$.and.returnValue(of(linkedTask()));
      (adapter.pushChanges as jasmine.Spy).and.rejectWith(
        new IssueSyncPushError('REASON_KEY'),
      );
      effects.pushFieldsOnTaskUpdate$.subscribe();

      syncState.requestPush('task-1', false);
      tick();

      expect(syncState.failures().get('task-1')).toEqual({ msgKey: 'REASON_KEY' });
      expect(snackServiceSpy.open).toHaveBeenCalledOnceWith({
        type: 'ERROR',
        msg: 'REASON_KEY',
      });
    }));

    it('a successful push clears the failure', fakeAsync(() => {
      taskServiceSpy.getByIdOnce$.and.returnValue(of(linkedTask()));
      syncState.reportFailure('task-1', { text: 'offline' });
      effects.pushFieldsOnTaskUpdate$.subscribe();

      actions$.next(
        TaskSharedActions.updateTask({
          task: { id: 'task-1', changes: { title: 'New' } },
        }),
      );
      tick();

      expect(adapter.pushChanges).toHaveBeenCalled();
      expect(syncState.failures().has('task-1')).toBeFalse();
    }));

    it('an expected skip stays quiet and leaves no failure', fakeAsync(() => {
      taskServiceSpy.getByIdOnce$.and.returnValue(of(linkedTask()));
      (adapter.pushChanges as jasmine.Spy).and.rejectWith({ isExpectedSyncSkip: true });
      syncState.reportFailure('task-1', { text: 'offline' });
      effects.pushFieldsOnTaskUpdate$.subscribe();

      syncState.requestPush('task-1', false);
      tick();

      expect(syncState.failures().has('task-1')).toBeFalse();
      expect(snackServiceSpy.open).not.toHaveBeenCalled();
    }));

    it("takes the new marker from the write's own answer instead of a re-fetch", fakeAsync(() => {
      // A re-fetch could already carry a collaborator's later change and mark
      // it as seen without pulling it.
      (adapter.pushChanges as jasmine.Spy).and.resolveTo({ marker: 42 });
      (adapter as { getIssueLastUpdated?: unknown }).getIssueLastUpdated = (
        issue: Record<string, unknown>,
      ) => (issue['marker'] as number) ?? 7;
      taskServiceSpy.getByIdOnce$.and.returnValue(of(linkedTask()));
      effects.pushFieldsOnTaskUpdate$.subscribe();

      syncState.requestPush('task-1', false);
      tick();

      expect(adapter.fetchIssue).toHaveBeenCalledTimes(1);
      expect(taskServiceSpy.updateUi).toHaveBeenCalledWith(
        'task-1',
        jasmine.objectContaining({ issueLastUpdated: 42 }),
      );
    }));

    // A handoff waits for this before handing the task off (#8648).
    describe('pushPending outcome', () => {
      const outcome = (): { value?: boolean } => {
        const result: { value?: boolean } = {};
        syncState.pushPending('task-1').then((isPushed) => (result.value = isPushed));
        return result;
      };

      it('resolves true once the pending fields are pushed', fakeAsync(() => {
        taskServiceSpy.getByIdOnce$.and.returnValue(of(linkedTask()));
        effects.pushFieldsOnTaskUpdate$.subscribe();

        const result = outcome();
        tick();

        expect(adapter.pushChanges).toHaveBeenCalledOnceWith(
          'issue-1',
          { summary: 'New' },
          jasmine.anything(),
        );
        expect(result.value).toBeTrue();
        // Quiet: the caller says why it stops.
        expect(snackServiceSpy.open).not.toHaveBeenCalled();
      }));

      it('resolves true when nothing is pending', fakeAsync(() => {
        taskServiceSpy.getByIdOnce$.and.returnValue(of(linkedTask({ title: 'Old' })));
        effects.pushFieldsOnTaskUpdate$.subscribe();

        const result = outcome();
        tick();

        expect(adapter.fetchIssue).not.toHaveBeenCalled();
        expect(result.value).toBeTrue();
      }));

      it('resolves false and records the failure when the push fails', fakeAsync(() => {
        taskServiceSpy.getByIdOnce$.and.returnValue(of(linkedTask()));
        (adapter.fetchIssue as jasmine.Spy).and.rejectWith(new Error('offline'));
        effects.pushFieldsOnTaskUpdate$.subscribe();

        const result = outcome();
        tick();

        expect(result.value).toBeFalse();
        expect(syncState.failures().get('task-1')).toEqual({ text: 'offline' });
        expect(snackServiceSpy.open).not.toHaveBeenCalled();
      }));

      it('resolves true for a task it would not push', fakeAsync(() => {
        taskServiceSpy.getByIdOnce$.and.returnValue(of(linkedTask()));
        syncState.setMissing(['task-1'], ['task-1']);
        effects.pushFieldsOnTaskUpdate$.subscribe();

        const result = outcome();
        tick();

        expect(adapter.fetchIssue).not.toHaveBeenCalled();
        expect(result.value).toBeTrue();
      }));

      it('waits for a push queued before it', fakeAsync(() => {
        let resolveFirst!: () => void;
        taskServiceSpy.getByIdOnce$.and.returnValue(of(linkedTask()));
        (adapter.fetchIssue as jasmine.Spy).and.returnValues(
          new Promise((resolve) => (resolveFirst = () => resolve(baseline))),
          Promise.resolve(baseline),
        );
        effects.pushFieldsOnTaskUpdate$.subscribe();

        actions$.next(
          TaskSharedActions.updateTask({
            task: { id: 'task-1', changes: { isDone: true } },
          }),
        );
        const result = outcome();
        tick();
        expect(result.value).toBeUndefined();

        resolveFirst();
        tick();
        expect(result.value).toBeTrue();
      }));
    });

    it('never pushes a task its provider no longer lists for me', fakeAsync(() => {
      taskServiceSpy.getByIdOnce$.and.returnValue(of(linkedTask()));
      syncState.setMissing(['task-1'], ['task-1']);
      effects.pushFieldsOnTaskUpdate$.subscribe();

      actions$.next(
        TaskSharedActions.updateTask({
          task: { id: 'task-1', changes: { title: 'New' } },
        }),
      );
      syncState.requestPush('task-1', false);
      tick();

      expect(adapter.fetchIssue).not.toHaveBeenCalled();
      expect(adapter.pushChanges).not.toHaveBeenCalled();
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

      tick(REMOTE_ISSUE_DELETE_DEFER_MS);

      expect(deleteIssueSpy).toHaveBeenCalledWith('issue-1', cfg);

      adapterRegistry.unregister('TEST_PROVIDER');
    }));

    it('should delete the Plainspace task through the registered Plainspace adapter', fakeAsync(() => {
      const deleteIssueSpy = TestBed.inject(PlainspaceSyncAdapterService)
        .deleteIssue as jasmine.Spy;
      deleteIssueSpy.and.resolveTo(undefined);
      const cfg = createMockIssueProvider();
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(of(cfg));

      const task = createMockTask({
        id: 'task-1',
        issueType: 'PLAINSPACE',
        issueId: 'ps-task-1',
        issueProviderId: 'provider-1',
        subTaskIds: [],
      }) as TaskWithSubTasks;
      (task as any).subTasks = [];

      effects.deleteIssueOnTaskDelete$.subscribe();
      actions$.next(TaskSharedActions.deleteTask({ task }));
      tick(REMOTE_ISSUE_DELETE_DEFER_MS);

      expect(deleteIssueSpy).toHaveBeenCalledWith('ps-task-1', cfg);
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

      tick(REMOTE_ISSUE_DELETE_DEFER_MS);

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

      tick(REMOTE_ISSUE_DELETE_DEFER_MS);

      expect(snackServiceSpy.open).not.toHaveBeenCalled();

      adapterRegistry.unregister('TEST_PROVIDER');
    }));
    it('should not call deleteIssue before the undo window has elapsed', fakeAsync(() => {
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
      }) as TaskWithSubTasks;
      (task as any).subTasks = [];

      effects.deleteIssueOnTaskDelete$.subscribe();

      actions$.next(TaskSharedActions.deleteTask({ task }));

      tick(TASK_DELETE_UNDO_WINDOW_MS);
      expect(deleteIssueSpy).not.toHaveBeenCalled();

      tick(REMOTE_ISSUE_DELETE_DEFER_MS - TASK_DELETE_UNDO_WINDOW_MS);
      expect(deleteIssueSpy).toHaveBeenCalledWith('issue-1', cfg);

      adapterRegistry.unregister('TEST_PROVIDER');
    }));

    it('should not call deleteIssue when the task is restored within the undo window (#10155)', fakeAsync(() => {
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
      }) as TaskWithSubTasks;
      (task as any).subTasks = [];

      effects.deleteIssueOnTaskDelete$.subscribe();

      actions$.next(TaskSharedActions.deleteTask({ task }));
      actions$.next(
        TaskSharedActions.restoreDeletedTask({
          task,
          tagTaskIdMap: {},
          deletedTaskEntities: {},
        }),
      );

      tick(REMOTE_ISSUE_DELETE_DEFER_MS * 2);

      expect(deleteIssueSpy).not.toHaveBeenCalled();

      adapterRegistry.unregister('TEST_PROVIDER');
    }));

    it('should not call deleteIssue when the task is restored from Recently deleted within the window', fakeAsync(() => {
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
      }) as TaskWithSubTasks;
      (task as any).subTasks = [];

      effects.deleteIssueOnTaskDelete$.subscribe();

      actions$.next(TaskSharedActions.deleteTask({ task }));
      actions$.next(TaskSharedActions.restoreTask({ task, subTasks: [] }));

      tick(REMOTE_ISSUE_DELETE_DEFER_MS * 2);

      expect(deleteIssueSpy).not.toHaveBeenCalled();

      adapterRegistry.unregister('TEST_PROVIDER');
    }));

    it('should not call deleteIssue when UNDO is clicked as the snack exits', fakeAsync(() => {
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
      }) as TaskWithSubTasks;
      (task as any).subTasks = [];

      effects.deleteIssueOnTaskDelete$.subscribe();

      actions$.next(TaskSharedActions.deleteTask({ task }));

      // snack debounce, enter animation fallback, exit animation
      tick(TASK_DELETE_UNDO_WINDOW_MS + 100 + 200 + 75);
      actions$.next(
        TaskSharedActions.restoreDeletedTask({
          task,
          tagTaskIdMap: {},
          deletedTaskEntities: {},
        }),
      );
      tick(REMOTE_ISSUE_DELETE_DEFER_MS);

      expect(deleteIssueSpy).not.toHaveBeenCalled();

      adapterRegistry.unregister('TEST_PROVIDER');
    }));

    it('should still call deleteIssue when a different task is restored', fakeAsync(() => {
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
      }) as TaskWithSubTasks;
      (task as any).subTasks = [];

      const otherTask = createMockTask({
        id: 'task-2',
        issueType: 'TEST_PROVIDER' as any,
        issueId: 'issue-2',
        issueProviderId: 'provider-1',
      }) as TaskWithSubTasks;
      (otherTask as any).subTasks = [];

      effects.deleteIssueOnTaskDelete$.subscribe();

      actions$.next(TaskSharedActions.deleteTask({ task }));
      actions$.next(
        TaskSharedActions.restoreDeletedTask({
          task: otherTask,
          tagTaskIdMap: {},
          deletedTaskEntities: {},
        }),
      );

      tick(REMOTE_ISSUE_DELETE_DEFER_MS);

      expect(deleteIssueSpy).toHaveBeenCalledWith('issue-1', cfg);

      adapterRegistry.unregister('TEST_PROVIDER');
    }));

    it('should overlap the undo windows of concurrent deletes rather than queue them', fakeAsync(() => {
      const deleteIssueSpy = jasmine.createSpy('deleteIssue').and.resolveTo(undefined);
      const adapter = createMockAdapter({ deleteIssue: deleteIssueSpy });
      adapterRegistry.register('TEST_PROVIDER', adapter);

      const cfg = createMockIssueProvider();
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(of(cfg));

      const mk = (id: string, issueId: string): TaskWithSubTasks => {
        const t = createMockTask({
          id,
          issueType: 'TEST_PROVIDER' as any,
          issueId,
          issueProviderId: 'provider-1',
        }) as TaskWithSubTasks;
        (t as any).subTasks = [];
        return t;
      };

      effects.deleteIssueOnTaskDelete$.subscribe();

      actions$.next(TaskSharedActions.deleteTask({ task: mk('task-1', 'issue-1') }));
      actions$.next(TaskSharedActions.deleteTask({ task: mk('task-2', 'issue-2') }));

      // One window, not two: concatMap would only have flushed the first.
      tick(REMOTE_ISSUE_DELETE_DEFER_MS);

      expect(deleteIssueSpy).toHaveBeenCalledTimes(2);
      expect(deleteIssueSpy).toHaveBeenCalledWith('issue-1', cfg);
      expect(deleteIssueSpy).toHaveBeenCalledWith('issue-2', cfg);

      adapterRegistry.unregister('TEST_PROVIDER');
    }));

    it('should keep other deferred deletes alive when a provider is removed inside the window', fakeAsync(() => {
      const deleteIssueSpy = jasmine.createSpy('deleteIssue').and.resolveTo(undefined);
      const adapter = createMockAdapter({ deleteIssue: deleteIssueSpy });
      adapterRegistry.register('TEST_PROVIDER', adapter);

      const cfg = createMockIssueProvider();
      issueProviderServiceSpy.getCfgOnce$.and.callFake(((issueProviderId: string) =>
        issueProviderId === 'removed-provider'
          ? throwError(() => new Error('No issueProvider found'))
          : of(cfg)) as any);

      const mk = (id: string, issueProviderId: string): TaskWithSubTasks => {
        const t = createMockTask({
          id,
          issueType: 'TEST_PROVIDER' as any,
          issueId: `issue-${id}`,
          issueProviderId,
        }) as TaskWithSubTasks;
        (t as any).subTasks = [];
        return t;
      };

      let isErrored = false;
      effects.deleteIssueOnTaskDelete$.subscribe({ error: () => (isErrored = true) });

      actions$.next(
        TaskSharedActions.deleteTask({ task: mk('task-1', 'removed-provider') }),
      );
      tick(100);
      actions$.next(TaskSharedActions.deleteTask({ task: mk('task-2', 'provider-1') }));

      tick(REMOTE_ISSUE_DELETE_DEFER_MS);

      expect(isErrored).toBe(false);
      expect(deleteIssueSpy).toHaveBeenCalledOnceWith('issue-task-2', cfg);

      adapterRegistry.unregister('TEST_PROVIDER');
    }));

    // A backlog poll inside the window skips these; each path out of the
    // window must release its issue, or it is never imported again.
    it('marks the issue pending until its deferred delete ends, however it ends', fakeAsync(() => {
      const deleteIssueSpy = jasmine.createSpy('deleteIssue').and.resolveTo(undefined);
      adapterRegistry.register(
        'TEST_PROVIDER',
        createMockAdapter({ deleteIssue: deleteIssueSpy }),
      );
      const cfg = createMockIssueProvider();
      issueProviderServiceSpy.getCfgOnce$.and.callFake(((issueProviderId: string) =>
        issueProviderId === 'removed-provider'
          ? throwError(() => new Error('No issueProvider found'))
          : of(cfg)) as any);
      const pending = TestBed.inject(PendingRemoteIssueDeleteService);
      const mk = (id: string, issueProviderId = 'provider-1'): TaskWithSubTasks => {
        const t = createMockTask({
          id,
          issueType: 'TEST_PROVIDER' as any,
          issueId: `issue-${id}`,
          issueProviderId,
        }) as TaskWithSubTasks;
        (t as any).subTasks = [];
        return t;
      };
      const deleted = mk('deleted');
      const undone = mk('undone');
      const failed = mk('failed', 'removed-provider');
      effects.deleteIssueOnTaskDelete$.subscribe();

      [deleted, undone, failed].forEach((task) =>
        actions$.next(TaskSharedActions.deleteTask({ task })),
      );
      expect(pending.has('provider-1', 'issue-deleted')).toBe(true);
      expect(pending.has('provider-1', 'issue-undone')).toBe(true);
      expect(pending.has('removed-provider', 'issue-failed')).toBe(true);

      actions$.next(TaskSharedActions.restoreTask({ task: undone, subTasks: [] }));
      expect(pending.has('provider-1', 'issue-undone')).toBe(false);
      expect(pending.has('provider-1', 'issue-deleted')).toBe(true);

      tick(REMOTE_ISSUE_DELETE_DEFER_MS);
      expect(deleteIssueSpy).toHaveBeenCalledOnceWith('issue-deleted', cfg);
      expect(pending.has('provider-1', 'issue-deleted')).toBe(false);
      expect(pending.has('removed-provider', 'issue-failed')).toBe(false);

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

    // Re-review finding: a poll between the bulk's deletes imported the items
    // still to come, as a delete inside the undo window did.
    it('keeps the issues still to delete pending, one by one', fakeAsync(() => {
      const resolvers: (() => void)[] = [];
      const deleteIssueSpy = jasmine
        .createSpy('deleteIssue')
        .and.callFake(() => new Promise<void>((res) => resolvers.push(res)));
      adapterRegistry.register(
        'TEST_PROVIDER',
        createMockAdapter({ deleteIssue: deleteIssueSpy }),
      );
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(of(createMockIssueProvider()));
      const pending = TestBed.inject(PendingRemoteIssueDeleteService);
      effects.deleteIssueOnBulkTaskDelete$.subscribe();

      deletedTaskIssueSidecar.set([
        { issueId: 'issue-1', issueType: 'TEST_PROVIDER', issueProviderId: 'provider-1' },
        { issueId: 'issue-2', issueType: 'TEST_PROVIDER', issueProviderId: 'provider-1' },
      ]);
      actions$.next(TaskSharedActions.deleteTasks({ taskIds: ['task-1', 'task-2'] }));
      tick();
      expect([...pending.issueIds('provider-1')]).toEqual(['issue-1', 'issue-2']);

      resolvers[0]();
      tick();
      expect([...pending.issueIds('provider-1')]).toEqual(['issue-2']);

      resolvers[1]();
      tick();
      expect(pending.issueIds('provider-1').size).toBe(0);

      adapterRegistry.unregister('TEST_PROVIDER');
    }));

    it('keeps handling bulk deletes after a provider removed mid-sequence', fakeAsync(() => {
      const deleteIssueSpy = jasmine.createSpy('deleteIssue').and.resolveTo(undefined);
      adapterRegistry.register(
        'TEST_PROVIDER',
        createMockAdapter({ deleteIssue: deleteIssueSpy }),
      );
      const cfg = createMockIssueProvider();
      issueProviderServiceSpy.getCfgOnce$.and.callFake(((issueProviderId: string) =>
        issueProviderId === 'removed-provider'
          ? throwError(() => new Error('No issueProvider found'))
          : of(cfg)) as any);
      const pending = TestBed.inject(PendingRemoteIssueDeleteService);
      effects.deleteIssueOnBulkTaskDelete$.subscribe();

      deletedTaskIssueSidecar.set([
        {
          issueId: 'issue-1',
          issueType: 'TEST_PROVIDER',
          issueProviderId: 'removed-provider',
        },
        { issueId: 'issue-2', issueType: 'TEST_PROVIDER', issueProviderId: 'provider-1' },
      ]);
      actions$.next(TaskSharedActions.deleteTasks({ taskIds: ['task-1', 'task-2'] }));
      tick();
      // The rest of the sequence still runs.
      expect(deleteIssueSpy).toHaveBeenCalledOnceWith('issue-2', cfg);
      expect(pending.issueIds('provider-1').size).toBe(0);
      expect(pending.issueIds('removed-provider').size).toBe(0);

      deletedTaskIssueSidecar.set([
        { issueId: 'issue-3', issueType: 'TEST_PROVIDER', issueProviderId: 'provider-1' },
      ]);
      actions$.next(TaskSharedActions.deleteTasks({ taskIds: ['task-3'] }));
      tick();
      expect(deleteIssueSpy).toHaveBeenCalledWith('issue-3', cfg);

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
    describe('CalDAV (#10098)', () => {
      const addTaskAction = (task: Task): ReturnType<typeof TaskSharedActions.addTask> =>
        TaskSharedActions.addTask({
          task,
          workContextId: 'project-1',
          workContextType: WorkContextType.PROJECT,
          isAddToBacklog: false,
          isAddToBottom: false,
        });

      const setup = (
        twoWaySync: Record<string, unknown> | undefined,
      ): { createIssueSpy: jasmine.Spy; caldavAdapter: IssueSyncAdapter<unknown> } => {
        const createIssueSpy = jasmine.createSpy('createIssue').and.resolveTo({
          issueId: 'sp-todo-task-new@super-productivity',
          issueData: { summary: 'New Task', etag_hash: 777 },
        });
        const caldavAdapter = createMockAdapter({
          createIssue: createIssueSpy,
          getIssueLastUpdated: (issue: Record<string, unknown>) =>
            issue['etag_hash'] as number,
        });
        adapterRegistry.register('CALDAV', caldavAdapter);
        const provider = createMockIssueProvider({
          defaultProjectId: 'project-1',
          twoWaySync,
        } as Partial<IssueProvider>);
        store.overrideSelector(selectEnabledIssueProviders, [provider]);
        store.refreshState();
        issueProviderServiceSpy.getCfgOnce$.and.returnValue(of(provider));
        return { createIssueSpy, caldavAdapter };
      };

      it('does not create a VTODO for a provider saved without the setting', fakeAsync(() => {
        const { createIssueSpy } = setup(undefined);
        effects.autoCreateIssueOnTaskAdd$.subscribe();

        actions$.next(addTaskAction(createMockTask({ id: 'task-new' })));
        tick();

        expect(createIssueSpy).not.toHaveBeenCalled();
      }));

      it('creates the VTODO with the task id and stores its ETag marker', fakeAsync(() => {
        const { createIssueSpy } = setup({ createOnServer: true });
        const task = createMockTask({ id: 'task-new', title: 'New Task' });
        taskServiceSpy.getByIdOnce$.and.returnValue(of(task));
        effects.autoCreateIssueOnTaskAdd$.subscribe();

        actions$.next(addTaskAction(task));
        tick();

        expect(createIssueSpy).toHaveBeenCalledWith('New Task', jasmine.anything(), {
          taskId: 'task-new',
        });
        // Date.now() here made the first poll compare it against the ETag hash
        // and flag every created task as remotely updated.
        expect(taskServiceSpy.update).toHaveBeenCalledWith(
          'task-new',
          jasmine.objectContaining({
            issueId: 'sp-todo-task-new@super-productivity',
            issueType: 'CALDAV',
            issueLastUpdated: 777,
          }),
        );
      }));

      it('keeps repeat instances local', fakeAsync(() => {
        const { createIssueSpy } = setup({ createOnServer: true });
        effects.autoCreateIssueOnTaskAdd$.subscribe();

        actions$.next(
          addTaskAction(
            createMockTask({ id: 'rpt_cfg1_2026-10-20', repeatCfgId: 'cfg1' }),
          ),
        );
        tick();

        expect(createIssueSpy).not.toHaveBeenCalled();
      }));

      // The add-task bar adds the task, then attaches its repeat
      it('keeps a task local whose repeat was attached after the add', fakeAsync(() => {
        const { createIssueSpy } = setup({ createOnServer: true });
        const task = createMockTask({ id: 'task-new', title: 'Water plants' });
        taskServiceSpy.getByIdOnce$.and.returnValue(of({ ...task, repeatCfgId: 'cfg1' }));
        effects.autoCreateIssueOnTaskAdd$.subscribe();

        actions$.next(addTaskAction(task));
        tick();

        expect(createIssueSpy).not.toHaveBeenCalled();
        expect(snackServiceSpy.open).not.toHaveBeenCalled();
      }));

      it('does not create a VTODO for a task deleted before the create', fakeAsync(() => {
        const { createIssueSpy } = setup({ createOnServer: true });
        // a missing task reads as undefined, though the signature says Task
        taskServiceSpy.getByIdOnce$.and.returnValue(of(undefined as unknown as Task));
        effects.autoCreateIssueOnTaskAdd$.subscribe();

        actions$.next(addTaskAction(createMockTask({ id: 'task-new' })));
        tick();

        expect(createIssueSpy).not.toHaveBeenCalled();
        expect(snackServiceSpy.open).not.toHaveBeenCalled();
      }));

      it('deletes the VTODO instead of linking a task deleted during the create', fakeAsync(() => {
        const { caldavAdapter } = setup({ createOnServer: true });
        const deleteIssueSpy = jasmine.createSpy('deleteIssue').and.resolveTo();
        caldavAdapter.deleteIssue = deleteIssueSpy;
        const task = createMockTask({ id: 'task-new', title: 'New Task' });
        let isDeleted = false;
        taskServiceSpy.getByIdOnce$.and.callFake(() =>
          of(isDeleted ? (undefined as unknown as Task) : task),
        );
        (caldavAdapter.createIssue as jasmine.Spy).and.callFake(async () => {
          isDeleted = true;
          return {
            issueId: 'sp-todo-task-new@super-productivity',
            issueData: { summary: 'New Task' },
          };
        });
        effects.autoCreateIssueOnTaskAdd$.subscribe();

        actions$.next(addTaskAction(task));
        tick();

        expect(taskServiceSpy.update).not.toHaveBeenCalled();
        expect(deleteIssueSpy).toHaveBeenCalledWith(
          'sp-todo-task-new@super-productivity',
          jasmine.anything(),
        );
        expect(snackServiceSpy.open).not.toHaveBeenCalled();
      }));

      it('keeps the created link when reading the marker back fails', fakeAsync(() => {
        const { caldavAdapter } = setup({ createOnServer: true });
        (caldavAdapter.getFieldMappings as jasmine.Spy).and.returnValue([
          isDoneFieldMapping,
        ]);
        (caldavAdapter.fetchIssue as jasmine.Spy).and.rejectWith(new Error('offline'));
        const task = createMockTask({ id: 'task-new', title: 'New Task', isDone: true });
        taskServiceSpy.getByIdOnce$.and.returnValue(of(task));
        effects.autoCreateIssueOnTaskAdd$.subscribe();

        actions$.next(addTaskAction(task));
        tick();

        expect(caldavAdapter.pushChanges).toHaveBeenCalled();
        expect(taskServiceSpy.update).toHaveBeenCalledWith(
          'task-new',
          jasmine.objectContaining({ issueId: 'sp-todo-task-new@super-productivity' }),
        );
        expect(snackServiceSpy.open).not.toHaveBeenCalled();
      }));

      it('reads the marker back after pushing initial values', fakeAsync(() => {
        const { caldavAdapter } = setup({ createOnServer: true });
        (caldavAdapter.getFieldMappings as jasmine.Spy).and.returnValue([
          isDoneFieldMapping,
        ]);
        (caldavAdapter.fetchIssue as jasmine.Spy).and.resolveTo({ etag_hash: 888 });
        const task = createMockTask({ id: 'task-new', title: 'New Task', isDone: true });
        taskServiceSpy.getByIdOnce$.and.returnValue(of(task));
        effects.autoCreateIssueOnTaskAdd$.subscribe();

        actions$.next(addTaskAction(task));
        tick();

        expect(caldavAdapter.pushChanges).toHaveBeenCalled();
        expect(taskServiceSpy.updateUi).toHaveBeenCalledWith(
          'task-new',
          jasmine.objectContaining({ issueLastUpdated: 888 }),
        );
      }));
    });

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

      expect(createIssueSpy).toHaveBeenCalledWith('New Task', cfg, {
        taskId: 'task-new',
      });
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

      expect(createIssueSpy).toHaveBeenCalledWith('New Task', cfg, {
        taskId: 'task-new',
      });
      expect(taskServiceSpy.update).toHaveBeenCalledWith(
        'task-new',
        jasmine.objectContaining({
          issueId: 'ps-issue-1',
          issueType: 'PLAINSPACE',
          issueProviderId: 'provider-1',
        }),
      );
    }));

    it("stores Plainspace's own updatedAt marker for a created issue, not the local clock", fakeAsync(() => {
      const updatedAt = '2026-10-20T10:00:00.000Z';
      const createIssueSpy = jasmine.createSpy('createIssue').and.resolveTo({
        issueId: 'ps-issue-1',
        issueData: { isDone: false, title: 'New Task', updatedAt },
      });
      adapterRegistry.register(
        'PLAINSPACE',
        createMockAdapter({
          createIssue: createIssueSpy,
          getIssueLastUpdated: (issue: Record<string, unknown>) =>
            new Date(issue['updatedAt'] as string).getTime(),
        }),
      );
      const provider = createMockIssueProvider({
        issueProviderKey: 'PLAINSPACE',
        defaultProjectId: 'project-1',
        spaceId: 'space-1',
        token: 'pat_x',
      } as Partial<IssueProvider>);
      store.overrideSelector(selectEnabledIssueProviders, [provider]);
      store.refreshState();
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(of(provider));
      const task = createMockTask({ id: 'task-new', title: 'New Task' });
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
        jasmine.objectContaining({ issueLastUpdated: new Date(updatedAt).getTime() }),
      );
    }));

    // #8790: moving a root task into a Plainspace-bound project shares it.
    describe('move-in (#8790)', () => {
      let createIssueSpy: jasmine.Spy;
      const plainspaceProvider = (): IssueProvider =>
        createMockIssueProvider({
          id: 'provider-1',
          issueProviderKey: 'PLAINSPACE',
          defaultProjectId: 'project-1',
          spaceId: 'space-1',
          token: 'pat_x',
        } as Partial<IssueProvider>);
      const movedTask = (overrides: Partial<Task> = {}): Task =>
        createMockTask({
          id: 'task-moved',
          title: 'Pack stove',
          projectId: 'project-1',
          issueId: undefined,
          ...overrides,
        });
      const move = (task: Task): void =>
        actions$.next(
          TaskSharedActions.moveToOtherProject({
            task: { ...task, projectId: 'inbox', subTasks: [] } as TaskWithSubTasks,
            targetProjectId: 'project-1',
          }),
        );

      beforeEach(() => {
        createIssueSpy = jasmine.createSpy('createIssue').and.resolveTo({
          issueId: 'ps-issue-1',
          issueData: { isDone: false, title: 'Pack stove', scheduledAt: null },
        });
        adapterRegistry.register(
          'PLAINSPACE',
          createMockAdapter({ createIssue: createIssueSpy }),
        );
        store.overrideSelector(selectEnabledIssueProviders, [plainspaceProvider()]);
        store.refreshState();
        issueProviderServiceSpy.getCfgOnce$.and.returnValue(of(plainspaceProvider()));
      });

      afterEach(() => adapterRegistry.unregister('PLAINSPACE'));

      it('creates and links the issue for a task moved into the bound project', fakeAsync(() => {
        const task = movedTask();
        taskServiceSpy.getByIdOnce$.and.returnValue(of(task));
        effects.autoCreateIssueOnTaskAdd$.subscribe();

        move(task);
        tick();

        // The title is not parsed again: it was typed before the move.
        expect(createIssueSpy).toHaveBeenCalledOnceWith(
          'Pack stove',
          jasmine.anything(),
          {
            taskId: 'task-moved',
          },
        );
        expect(taskServiceSpy.update).toHaveBeenCalledWith(
          'task-moved',
          jasmine.objectContaining({
            issueId: 'ps-issue-1',
            issueType: 'PLAINSPACE',
            issueProviderId: 'provider-1',
          }),
        );
      }));

      it('shares a task moved in by +Project short syntax', fakeAsync(() => {
        const task = movedTask({ title: 'Pack stove' });
        taskServiceSpy.getByIdOnce$.and.returnValue(of(task));
        effects.autoCreateIssueOnTaskAdd$.subscribe();

        actions$.next(
          TaskSharedActions.applyShortSyntax({
            task: { ...task, title: 'Pack stove +Camping', projectId: 'inbox' },
            taskChanges: { title: 'Pack stove' },
            targetProjectId: 'project-1',
          }),
        );
        tick();

        expect(createIssueSpy).toHaveBeenCalledOnceWith(
          'Pack stove',
          jasmine.anything(),
          {
            taskId: 'task-moved',
          },
        );
      }));

      describe('a task already finished', () => {
        let pushSpy: jasmine.Spy;
        beforeEach(() => {
          pushSpy = jasmine.createSpy('pushChanges').and.resolveTo();
          adapterRegistry.register(
            'PLAINSPACE',
            createMockAdapter({
              createIssue: createIssueSpy,
              getFieldMappings: jasmine
                .createSpy('getFieldMappings')
                .and.returnValue([isDoneFieldMapping]),
              pushChanges: pushSpy,
            }),
          );
        });

        it('pushes a completed task as done', fakeAsync(() => {
          const task = movedTask({ isDone: true, doneOn: 5 });
          taskServiceSpy.getByIdOnce$.and.returnValue(of(task));
          effects.autoCreateIssueOnTaskAdd$.subscribe();

          move(task);
          tick();

          expect(pushSpy).toHaveBeenCalledOnceWith(
            'ps-issue-1',
            { status: 'COMPLETED' },
            jasmine.anything(),
          );
        }));

        // Review finding: the move-in pushed `isDone`, so a task I won't do
        // was marked done for everyone.
        it("does not push a won't-do task as done", fakeAsync(() => {
          const task = movedTask({ isDone: true, doneOn: 5, wontDoOn: 5 });
          taskServiceSpy.getByIdOnce$.and.returnValue(of(task));
          effects.autoCreateIssueOnTaskAdd$.subscribe();

          move(task);
          tick();

          expect(createIssueSpy).toHaveBeenCalled();
          expect(pushSpy).not.toHaveBeenCalled();
        }));
      });
      // Review finding (R2-2): an older server declines the initial time;
      // the task was created and linked, so that is no failure.
      it('does not report an initial value the provider declines as a failed create', fakeAsync(() => {
        adapterRegistry.register(
          'PLAINSPACE',
          createMockAdapter({
            createIssue: createIssueSpy,
            getFieldMappings: jasmine
              .createSpy('getFieldMappings')
              .and.returnValue([dueWithTimeFieldMapping]),
            pushChanges: jasmine
              .createSpy('pushChanges')
              .and.rejectWith({ isExpectedSyncSkip: true }),
          }),
        );
        const task = movedTask({ dueWithTime: 1743508800000 });
        taskServiceSpy.getByIdOnce$.and.returnValue(of(task));
        effects.autoCreateIssueOnTaskAdd$.subscribe();

        move(task);
        tick();

        expect(taskServiceSpy.update).toHaveBeenCalledWith(
          'task-moved',
          jasmine.objectContaining({ issueId: 'ps-issue-1' }),
        );
        expect(snackServiceSpy.open).not.toHaveBeenCalled();
      }));

      it('ignores a move to the project the task is already in', fakeAsync(() => {
        const task = movedTask();
        taskServiceSpy.getByIdOnce$.and.returnValue(of(task));
        effects.autoCreateIssueOnTaskAdd$.subscribe();

        actions$.next(
          TaskSharedActions.moveToOtherProject({
            task: { ...task, subTasks: [] } as TaskWithSubTasks,
            targetProjectId: 'project-1',
          }),
        );
        tick();

        expect(createIssueSpy).not.toHaveBeenCalled();
      }));

      it('ignores short syntax that moves nothing', fakeAsync(() => {
        const task = movedTask();
        taskServiceSpy.getByIdOnce$.and.returnValue(of(task));
        effects.autoCreateIssueOnTaskAdd$.subscribe();

        actions$.next(
          TaskSharedActions.applyShortSyntax({ task, taskChanges: { title: 'x' } }),
        );
        tick();

        expect(createIssueSpy).not.toHaveBeenCalled();
      }));

      it('keeps the link of a task that is already linked', fakeAsync(() => {
        const task = movedTask({ issueId: 'other', issueType: 'PLAINSPACE' });
        taskServiceSpy.getByIdOnce$.and.returnValue(of(task));
        effects.autoCreateIssueOnTaskAdd$.subscribe();

        move(task);
        tick();

        expect(createIssueSpy).not.toHaveBeenCalled();
      }));

      it('skips a task that left the project again before its turn', fakeAsync(() => {
        const task = movedTask();
        taskServiceSpy.getByIdOnce$.and.returnValue(of({ ...task, projectId: 'inbox' }));
        effects.autoCreateIssueOnTaskAdd$.subscribe();

        move(task);
        tick();

        expect(createIssueSpy).not.toHaveBeenCalled();
      }));

      it('creates only once when a move follows an add whose create is in flight', fakeAsync(() => {
        const task = movedTask();
        let current: Task = task;
        taskServiceSpy.getByIdOnce$.and.callFake(() => of(current));
        taskServiceSpy.update.and.callFake((_id: string, changes: Partial<Task>) => {
          current = { ...current, ...changes };
        });
        effects.autoCreateIssueOnTaskAdd$.subscribe();

        actions$.next(
          TaskSharedActions.addTask({
            task,
            workContextId: 'project-1',
            workContextType: WorkContextType.PROJECT,
            isAddToBacklog: false,
            isAddToBottom: false,
            isIgnoreShortSyntax: true,
          }),
        );
        move(task);
        tick();

        expect(createIssueSpy).toHaveBeenCalledTimes(1);
      }));

      it('creates only once for a move and a +Project short syntax of the same task', fakeAsync(() => {
        const task = movedTask();
        let current: Task = task;
        taskServiceSpy.getByIdOnce$.and.callFake(() => of(current));
        taskServiceSpy.update.and.callFake((_id: string, changes: Partial<Task>) => {
          current = { ...current, ...changes };
        });
        effects.autoCreateIssueOnTaskAdd$.subscribe();

        move(task);
        actions$.next(
          TaskSharedActions.applyShortSyntax({
            task: { ...task, title: 'Pack stove +Camping', projectId: 'inbox' },
            taskChanges: { title: 'Pack stove' },
            targetProjectId: 'project-1',
          }),
        );
        tick();

        expect(createIssueSpy).toHaveBeenCalledTimes(1);
      }));

      it('does not move-in for providers other than Plainspace', fakeAsync(() => {
        const caldavCreate = jasmine.createSpy('createIssue').and.resolveTo({
          issueId: 'c-1',
          issueData: {},
        });
        adapterRegistry.register(
          'CALDAV',
          createMockAdapter({ createIssue: caldavCreate }),
        );
        const caldav = createMockIssueProvider({
          issueProviderKey: 'CALDAV',
          defaultProjectId: 'project-1',
          twoWaySync: { createOnServer: true },
        } as Partial<IssueProvider>);
        store.overrideSelector(selectEnabledIssueProviders, [caldav]);
        store.refreshState();
        const task = movedTask();
        taskServiceSpy.getByIdOnce$.and.returnValue(of(task));
        effects.autoCreateIssueOnTaskAdd$.subscribe();

        move(task);
        tick();

        expect(caldavCreate).not.toHaveBeenCalled();
        adapterRegistry.unregister('CALDAV');
      }));

      it('snacks a failed create and does not retry it', fakeAsync(() => {
        createIssueSpy.and.rejectWith(new Error('offline'));
        const task = movedTask();
        taskServiceSpy.getByIdOnce$.and.returnValue(of(task));
        effects.autoCreateIssueOnTaskAdd$.subscribe();

        move(task);
        tick();

        expect(createIssueSpy).toHaveBeenCalledTimes(1);
        expect(snackServiceSpy.open).toHaveBeenCalledWith(
          jasmine.objectContaining({ type: 'ERROR' }),
        );
        expect(taskServiceSpy.update).not.toHaveBeenCalled();
      }));
    });

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

      expect(createIssueSpy).toHaveBeenCalled();
      expect(snackServiceSpy.open).toHaveBeenCalledWith(
        jasmine.objectContaining({ type: 'ERROR' }),
      );

      adapterRegistry.unregister('TEST_PROVIDER');
    }));

    it('logs only the status of a failed auto-create', fakeAsync(() => {
      const adapter = createMockAdapter({
        createIssue: jasmine
          .createSpy('createIssue')
          .and.rejectWith(
            new HttpErrorResponse({ status: 500, url: 'https://private.example/api' }),
          ),
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
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(
        of(
          createMockIssueProvider({
            id: 'provider-1',
            issueProviderKey: 'TEST_PROVIDER' as any,
          }),
        ),
      );
      const task = createMockTask({
        id: 'task-new',
        title: 'New Task',
        projectId: 'project-1',
        issueId: undefined,
      });
      taskServiceSpy.getByIdOnce$.and.returnValue(of(task));
      const logSpy = spyOn(IssueLog, 'err');

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

      expect(logSpy).toHaveBeenCalledOnceWith(jasmine.any(String), { status: 500 });
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
      const updateCalls = taskServiceSpy.updateUi.calls.allArgs();
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

    describe('short-syntax title (#10024)', () => {
      let createIssueSpy: jasmine.Spy;
      let cfg: IssueProvider;

      const addTask = (task: Task, isIgnoreShortSyntax?: boolean): void => {
        actions$.next(
          TaskSharedActions.addTask({
            task,
            workContextId: 'project-1',
            workContextType: WorkContextType.PROJECT,
            isAddToBacklog: false,
            isAddToBottom: false,
            isIgnoreShortSyntax,
          }),
        );
      };

      beforeEach(() => {
        createIssueSpy = jasmine.createSpy('createIssue').and.resolveTo({
          issueId: 'new-issue-1',
          issueNumber: 42,
          issueData: {},
        });
        adapterRegistry.register(
          'TEST_PROVIDER',
          createMockAdapter({
            createIssue: createIssueSpy,
            getFieldMappings: jasmine.createSpy('getFieldMappings').and.returnValue([]),
            getSyncConfig: jasmine.createSpy('getSyncConfig').and.returnValue({}),
          }),
        );
        store.overrideSelector(selectEnabledIssueProviders, [
          createMockIssueProvider({
            id: 'provider-1',
            issueProviderKey: 'TEST_PROVIDER' as any,
            defaultProjectId: 'project-1',
            pluginConfig: { isAutoCreateIssues: true },
          } as any),
        ]);
        store.refreshState();
        cfg = createMockIssueProvider({
          id: 'provider-1',
          issueProviderKey: 'TEST_PROVIDER' as any,
        });
        issueProviderServiceSpy.getCfgOnce$.and.returnValue(of(cfg));
        effects.autoCreateIssueOnTaskAdd$.subscribe();
      });

      afterEach(() => {
        adapterRegistry.unregister('TEST_PROVIDER');
      });

      it('should create the issue and keep the local title without the tokens', fakeAsync(() => {
        const task = createMockTask({
          id: 'task-new',
          title: 'Write report #work',
          projectId: 'project-1',
          parentId: undefined,
          issueId: undefined,
        });
        // Short syntax has not landed yet when the request resolves.
        taskServiceSpy.getByIdOnce$.and.returnValue(of(task));

        addTask(task);
        tick();

        expect(createIssueSpy).toHaveBeenCalledWith('Write report', cfg, {
          taskId: 'task-new',
        });
        expect(taskServiceSpy.update).toHaveBeenCalledWith(
          'task-new',
          jasmine.objectContaining({ title: '#42 Write report' }),
        );
      }));

      it('should not create an issue when short syntax moves the task to another project', fakeAsync(() => {
        store.overrideSelector(selectUnarchivedProjects, [
          { id: 'project-2', title: 'Elsewhere' } as any,
        ]);
        store.refreshState();
        const task = createMockTask({
          id: 'task-new',
          title: 'Write report +Elsewhere',
          projectId: 'project-1',
        });
        taskServiceSpy.getByIdOnce$.and.returnValue(of(task));

        addTask(task);
        tick();

        expect(createIssueSpy).not.toHaveBeenCalled();
      }));

      it('should keep a title renamed while the request was in flight', fakeAsync(() => {
        const task = createMockTask({
          id: 'task-new',
          title: 'Write report #work',
          projectId: 'project-1',
          parentId: undefined,
          issueId: undefined,
        });
        taskServiceSpy.getByIdOnce$.and.returnValue(
          of({ ...task, title: 'Write the report' }),
        );

        addTask(task);
        tick();

        expect(taskServiceSpy.update).toHaveBeenCalledWith(
          'task-new',
          jasmine.objectContaining({ title: '#42 Write the report' }),
        );
      }));

      it('should use the raw title when short syntax is ignored', fakeAsync(() => {
        const task = createMockTask({
          id: 'task-new',
          title: 'Fix #hash handling',
          projectId: 'project-1',
          parentId: undefined,
          issueId: undefined,
        });
        taskServiceSpy.getByIdOnce$.and.returnValue(of(task));

        addTask(task, true);
        tick();

        expect(createIssueSpy).toHaveBeenCalledWith('Fix #hash handling', cfg, {
          taskId: 'task-new',
        });
        expect(taskServiceSpy.update).toHaveBeenCalledWith(
          'task-new',
          jasmine.objectContaining({ title: '#42 Fix #hash handling' }),
        );
      }));
    });
  });
});
