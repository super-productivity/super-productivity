import { TestBed } from '@angular/core/testing';
import { Injector, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { PluginBridgeService } from './plugin-bridge.service';
import { TaskService } from '../features/tasks/task.service';
import { ProjectService } from '../features/project/project.service';
import { TagService } from '../features/tag/tag.service';
import { WorkContextService } from '../features/work-context/work-context.service';
import { SnackService } from '../core/snack/snack.service';
import { NotifyService } from '../core/notify/notify.service';
import { PluginHooksService } from './plugin-hooks';
import { PluginUserPersistenceService } from './plugin-user-persistence.service';
import { PluginConfigService } from './plugin-config.service';
import { TaskArchiveService } from '../features/archive/task-archive.service';
import { SyncWrapperService } from '../imex/sync/sync-wrapper.service';
import { GlobalThemeService } from '../core/theme/global-theme.service';
import { PluginIssueProviderRegistryService } from './issue-provider/plugin-issue-provider-registry.service';
import { IssueSyncAdapterRegistryService } from '../features/issue/two-way-sync/issue-sync-adapter-registry.service';
import { PluginHttpService } from './issue-provider/plugin-http.service';
import { DataInitService } from '../core/data-init/data-init.service';
import { GlobalConfigService } from '../features/config/global-config.service';
import { addSubTask } from '../features/tasks/store/task.actions';
import { Task } from '../features/tasks/task.model';
import { DEFAULT_GLOBAL_CONFIG } from '../features/config/default-global-config.const';

// Regression test for issue #7437 — Brain Dump (and any plugin using
// PluginAPI.addTask with a parentId) used to drop short-syntax time estimates
// from subtask titles, because addSubTask doesn't trigger ShortSyntaxEffects.
describe('PluginBridgeService.addTask() — subtask short-syntax (issue #7437)', () => {
  const setup = (
    isEnableDue: boolean,
  ): {
    service: PluginBridgeService;
    store: jasmine.SpyObj<Store>;
    taskService: jasmine.SpyObj<TaskService>;
  } => {
    const storeSpy = jasmine.createSpyObj('Store', ['select', 'dispatch']);
    const taskServiceSpy = jasmine.createSpyObj('TaskService', [
      'allTasks$',
      'createNewTaskWithDefaults',
      'add',
    ]);
    taskServiceSpy.allTasks$ = of([{ id: 'parent-1' } as Task]);

    const projectServiceSpy = jasmine.createSpyObj('ProjectService', [], {
      list$: of([]),
    });
    const tagServiceSpy = jasmine.createSpyObj('TagService', [], {
      tags$: of([]),
    });

    const cfgSignal = signal({
      ...DEFAULT_GLOBAL_CONFIG,
      shortSyntax: { ...DEFAULT_GLOBAL_CONFIG.shortSyntax, isEnableDue },
    });
    const globalConfigSpy = {
      cfg: cfgSignal,
    } as unknown as GlobalConfigService;

    TestBed.configureTestingModule({
      providers: [
        PluginBridgeService,
        { provide: Store, useValue: storeSpy },
        { provide: TaskService, useValue: taskServiceSpy },
        { provide: ProjectService, useValue: projectServiceSpy },
        { provide: TagService, useValue: tagServiceSpy },
        {
          provide: WorkContextService,
          useValue: jasmine.createSpyObj('WorkContextService', ['activeWorkContext$']),
        },
        {
          provide: SnackService,
          useValue: jasmine.createSpyObj('SnackService', ['open']),
        },
        {
          provide: NotifyService,
          useValue: jasmine.createSpyObj('NotifyService', ['notify']),
        },
        { provide: MatDialog, useValue: jasmine.createSpyObj('MatDialog', ['open']) },
        { provide: Router, useValue: jasmine.createSpyObj('Router', ['navigate']) },
        {
          provide: PluginHooksService,
          useValue: jasmine.createSpyObj('PluginHooksService', ['registerHook']),
        },
        {
          provide: PluginUserPersistenceService,
          useValue: jasmine.createSpyObj('PluginUserPersistenceService', ['get', 'set']),
        },
        {
          provide: PluginConfigService,
          useValue: jasmine.createSpyObj('PluginConfigService', ['get', 'set']),
        },
        {
          provide: TaskArchiveService,
          useValue: jasmine.createSpyObj('TaskArchiveService', ['getAll']),
        },
        {
          provide: TranslateService,
          useValue: { instant: (key: string) => key },
        },
        {
          provide: SyncWrapperService,
          useValue: jasmine.createSpyObj('SyncWrapperService', ['sync']),
        },
        Injector,
        { provide: GlobalThemeService, useValue: {} },
        { provide: PluginIssueProviderRegistryService, useValue: {} },
        { provide: IssueSyncAdapterRegistryService, useValue: {} },
        { provide: PluginHttpService, useValue: {} },
        { provide: DataInitService, useValue: { reInit: () => Promise.resolve() } },
        { provide: GlobalConfigService, useValue: globalConfigSpy },
      ],
    });

    const service = TestBed.inject(PluginBridgeService);
    const store = TestBed.inject(Store) as jasmine.SpyObj<Store>;
    const taskService = TestBed.inject(TaskService) as jasmine.SpyObj<TaskService>;

    taskService.createNewTaskWithDefaults.and.callFake(({ title, additional }) => {
      return {
        id: 'new-sub',
        title: title ?? '',
        ...additional,
      } as unknown as Task;
    });

    return { service, store, taskService };
  };

  it('parses "subtask1 15m" — strips the time token and sets timeEstimate', async () => {
    const { service, store, taskService } = setup(true);

    await service.addTask({
      title: 'subtask1 15m',
      parentId: 'parent-1',
    });

    const factoryCall = taskService.createNewTaskWithDefaults.calls.mostRecent();
    expect(factoryCall.args[0].title).toBe('subtask1');
    expect(factoryCall.args[0].additional?.timeEstimate).toBe(15 * 60 * 1000);

    const dispatched = store.dispatch.calls.mostRecent().args[0] as unknown as ReturnType<
      typeof addSubTask
    >;
    expect(dispatched.type).toBe(addSubTask.type);
    expect(dispatched.task.title).toBe('subtask1');
    expect(dispatched.task.timeEstimate).toBe(15 * 60 * 1000);
    expect(dispatched.parentId).toBe('parent-1');
  });

  it('leaves a non-time title untouched', async () => {
    const { service, taskService } = setup(true);

    await service.addTask({
      title: 'just a regular subtask',
      parentId: 'parent-1',
    });

    const factoryCall = taskService.createNewTaskWithDefaults.calls.mostRecent();
    expect(factoryCall.args[0].title).toBe('just a regular subtask');
    expect(factoryCall.args[0].additional?.timeEstimate).toBe(0);
  });

  it('skips parsing when shortSyntax.isEnableDue is false', async () => {
    const { service, taskService } = setup(false);

    await service.addTask({
      title: 'subtask1 15m',
      parentId: 'parent-1',
    });

    const factoryCall = taskService.createNewTaskWithDefaults.calls.mostRecent();
    expect(factoryCall.args[0].title).toBe('subtask1 15m');
    expect(factoryCall.args[0].additional?.timeEstimate).toBe(0);
  });
});
