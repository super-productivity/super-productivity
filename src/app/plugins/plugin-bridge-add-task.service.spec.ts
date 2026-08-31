import { TestBed } from '@angular/core/testing';
import { Injector, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { PluginBridgeService } from './plugin-bridge.service';
import { TaskRepeatCfgService } from '../features/task-repeat-cfg/task-repeat-cfg.service';
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
import { Task, TaskCopy } from '../features/tasks/task.model';
import { PluginCreateTaskData } from '@super-productivity/plugin-api';
import { DEFAULT_GLOBAL_CONFIG } from '../features/config/default-global-config.const';
import EN_TRANSLATIONS from '../../assets/i18n/en.json';

// Covers the plugin API's subtask-creation branch, which hand-rolls task
// construction rather than going through TaskService.addSubTaskTo(). The
// short-syntax cases are the regression test for issue #7437 — Brain Dump (and
// any plugin using PluginAPI.addTask with a parentId) used to drop short-syntax
// time estimates from subtask titles, because addSubTask doesn't trigger
// ShortSyntaxEffects.
describe('PluginBridgeService.addTask() — subtask creation', () => {
  const setup = (
    isEnableDue: boolean,
    allTasks: Task[] = [{ id: 'parent-1' } as Task],
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
      'update',
    ]);
    taskServiceSpy.allTasks$ = of(allTasks);

    // 'p1' / 't1' exist so tests can pass projectId/tagIds without tripping
    // _validateTaskReferences.
    const projectServiceSpy = jasmine.createSpyObj('ProjectService', [], {
      list$: of([{ id: 'p1' }]),
    });
    const tagServiceSpy = jasmine.createSpyObj('TagService', [], {
      tags$: of([{ id: 't1' }]),
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
        { provide: TaskRepeatCfgService, useValue: {} },
        { provide: Store, useValue: storeSpy },
        { provide: TaskService, useValue: taskServiceSpy },
        { provide: ProjectService, useValue: projectServiceSpy },
        { provide: TagService, useValue: tagServiceSpy },
        {
          provide: WorkContextService,
          useValue: jasmine.createSpyObj('WorkContextService', [], {
            activeWorkContext$: of(null),
          }),
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
          useValue: {
            // Keep the params in the string so error assertions can see which
            // validation message was raised.
            instant: (key: string, params?: object) =>
              params ? `${key} ${JSON.stringify(params)}` : key,
          },
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

  // PluginCreateTaskData advertises dueDay, and TaskService.addSubTaskTo (used by
  // the local REST API) honours it — the plugin path used to drop it silently.
  it('passes dueDay through for subtasks', async () => {
    const { service, store, taskService } = setup(true);

    await service.addTask({
      title: 'a subtask',
      parentId: 'parent-1',
      dueDay: '2026-08-07',
    });

    const factoryCall = taskService.createNewTaskWithDefaults.calls.mostRecent();
    expect(factoryCall.args[0].additional?.dueDay).toBe('2026-08-07');

    const dispatched = store.dispatch.calls.mostRecent().args[0] as unknown as ReturnType<
      typeof addSubTask
    >;
    expect(dispatched.task.dueDay).toBe('2026-08-07');
  });

  it('normalises a null dueDay to undefined but still sets the key', async () => {
    const { service, taskService } = setup(true);

    await service.addTask({ title: 'a subtask', parentId: 'parent-1', dueDay: null });

    const { additional } =
      taskService.createNewTaskWithDefaults.calls.mostRecent().args[0];
    expect(additional?.dueDay).toBeUndefined();
    // Key presence is load-bearing: createNewTaskWithDefaults auto-assigns
    // today's date only while `'dueDay' in additional` is false, so dropping
    // the key would silently re-arm that for subtasks created from Today.
    expect('dueDay' in (additional ?? {})).toBeTrue();
  });

  // The task model is only two levels deep and the addSubTask reducer doesn't
  // check depth, so the guard has to live in validation — same as the local
  // REST API's INVALID_PARENT / "Cannot nest subtasks" rejection.
  it('rejects a parentId that is itself a subtask', async () => {
    const { service, store } = setup(true, [
      { id: 'parent-1' } as Task,
      { id: 'sub-1', parentId: 'parent-1' } as Task,
    ]);

    await expectAsync(
      service.addTask({ title: 'nested', parentId: 'sub-1' }),
    ).toBeRejectedWithError(/CANNOT_NEST_SUBTASKS/);

    expect(store.dispatch).not.toHaveBeenCalled();
  });

  // _validateTaskReferences wraps every individual error in VALIDATION_FAILED.
  // Without the {{errors}} placeholder ngx-translate drops the payload, and
  // every plugin API validation failure — missing project, missing tag, missing
  // parent, nested subtask — reaches the caller as one indistinguishable
  // string. Asserted against the real translation because the TranslateService
  // stub above interpolates unconditionally and would hide its absence.
  it('has a VALIDATION_FAILED string that interpolates the failed checks', () => {
    expect(EN_TRANSLATIONS.PLUGINS.VALIDATION_FAILED).toContain('{{errors}}');
  });

  // Relational fields reach the reducer as plain values, so `parentId` on an
  // update writes a task no parent lists in subTaskIds. The local REST API
  // refuses both fields on PATCH for the same reason.
  describe('updateTask() — relational fields', () => {
    (['parentId', 'subTaskIds'] as const).forEach((field) => {
      it(`rejects ${field} instead of applying it`, async () => {
        const { service, store } = setup(true);

        await expectAsync(
          service.updateTask('parent-1', {
            [field]: field === 'parentId' ? 'other-task' : ['a'],
          }),
        ).toBeRejectedWithError(/FIELD_NOT_UPDATABLE/);

        expect(store.dispatch).not.toHaveBeenCalled();
      });
    });

    it('still applies non-relational updates', async () => {
      const { service, taskService } = setup(true);

      await service.updateTask('parent-1', { title: 'renamed' });

      expect(taskService.update).toHaveBeenCalledWith('parent-1', {
        title: 'renamed',
      });
    });
  });

  // dueDay was advertised on PluginCreateTaskData for both branches but wired
  // into only one, and nothing failed until a user noticed. This block makes
  // that class of bug mechanical: the Record below is exhaustive over the type,
  // so adding a field forces a decision here, and the two tests prove each
  // 'forwarded' field actually reaches the task on both branches.
  describe('every advertised field is forwarded', () => {
    const FIELD_HANDLING: Record<
      keyof PluginCreateTaskData,
      'forwarded' | 'title' | 'structural' | 'parentInherited'
    > = {
      title: 'title',
      notes: 'forwarded',
      timeEstimate: 'forwarded',
      isDone: 'forwarded',
      dueDay: 'forwarded',
      projectId: 'forwarded',
      // Set on main tasks; the addSubTask reducer forces [] on subtasks.
      tagIds: 'parentInherited',
      // Selects the branch rather than being copied onto the task.
      parentId: 'structural',
    };

    const ALL_FIELDS: PluginCreateTaskData = {
      title: 'every field',
      notes: 'some notes',
      timeEstimate: 1234,
      isDone: true,
      dueDay: '2026-08-07',
      projectId: 'p1',
      tagIds: ['t1'],
    };

    const forwarded = (
      Object.keys(FIELD_HANDLING) as (keyof PluginCreateTaskData)[]
    ).filter((f) => FIELD_HANDLING[f] === 'forwarded');

    it('main-task branch forwards them to TaskService.add', async () => {
      const { service, taskService } = setup(true);

      await service.addTask({ ...ALL_FIELDS });

      const additional = taskService.add.calls.mostRecent().args[2] as Partial<TaskCopy>;
      forwarded.forEach((field) => {
        expect(additional[field as keyof TaskCopy])
          .withContext(`main task should forward "${field}"`)
          .toEqual(ALL_FIELDS[field] as never);
      });
      expect(additional.tagIds).toEqual(['t1']);
    });

    it('subtask branch forwards them, minus the parent-inherited ones', async () => {
      const { service, taskService } = setup(true);

      await service.addTask({ ...ALL_FIELDS, parentId: 'parent-1' });

      const { additional } =
        taskService.createNewTaskWithDefaults.calls.mostRecent().args[0];
      forwarded.forEach((field) => {
        expect(additional?.[field as keyof TaskCopy])
          .withContext(`subtask should forward "${field}"`)
          .toEqual(ALL_FIELDS[field] as never);
      });
      expect(additional?.tagIds).toEqual([]);
    });
  });
});
