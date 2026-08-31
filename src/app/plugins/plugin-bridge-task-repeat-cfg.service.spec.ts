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
import { TaskRepeatCfgService } from '../features/task-repeat-cfg/task-repeat-cfg.service';
import { TaskRepeatCfg } from '../features/task-repeat-cfg/task-repeat-cfg.model';
import { Task } from '../features/tasks/task.model';
import { DEFAULT_GLOBAL_CONFIG } from '../features/config/default-global-config.const';
import { getDbDateStr } from '../util/get-db-date-str';

// Covers the plugin API's task-repeat-config methods, which delegate to
// TaskRepeatCfgService (the same single persistent action the "Repeat" dialog
// dispatches) after validating the target task / config. The default-derivation
// cases pin down dialog parity: title from the task, startDate anchored today,
// and the schedule-aware skipOverdue default from get-default-skip-overdue.ts.
describe('PluginBridgeService task repeat config methods', () => {
  const TASK = {
    id: 'task-1',
    title: 'Water the plants',
    projectId: 'p1',
    subTasks: [],
  } as unknown as Task;

  const setup = (
    taskInStore: unknown = TASK,
    existingCfg: TaskRepeatCfg | undefined = undefined,
  ): {
    service: PluginBridgeService;
    repeatCfgService: jasmine.SpyObj<TaskRepeatCfgService>;
  } => {
    const storeSpy = jasmine.createSpyObj('Store', ['select', 'dispatch']);
    storeSpy.select.and.returnValue(of(taskInStore));

    const taskServiceSpy = jasmine.createSpyObj('TaskService', ['add', 'update']);
    taskServiceSpy.allTasks$ = of([]);

    const repeatCfgServiceSpy = jasmine.createSpyObj('TaskRepeatCfgService', [
      'addTaskRepeatCfgToTask',
      'updateTaskRepeatCfg',
      'deleteTaskRepeatCfg',
      'getTaskRepeatCfgByIdAllowUndefined$',
    ]);
    repeatCfgServiceSpy.addTaskRepeatCfgToTask.and.returnValue('cfg-1');
    repeatCfgServiceSpy.getTaskRepeatCfgByIdAllowUndefined$.and.returnValue(
      of(existingCfg),
    );

    // 't1' exists so tests can pass tagIds without tripping
    // _validateTaskReferences.
    const projectServiceSpy = jasmine.createSpyObj('ProjectService', [], {
      list$: of([{ id: 'p1' }]),
    });
    const tagServiceSpy = jasmine.createSpyObj('TagService', [], {
      tags$: of([{ id: 't1' }]),
    });

    const globalConfigSpy = {
      cfg: signal(DEFAULT_GLOBAL_CONFIG),
    } as unknown as GlobalConfigService;

    TestBed.configureTestingModule({
      providers: [
        PluginBridgeService,
        { provide: Store, useValue: storeSpy },
        { provide: TaskService, useValue: taskServiceSpy },
        { provide: TaskRepeatCfgService, useValue: repeatCfgServiceSpy },
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
    const repeatCfgService = TestBed.inject(
      TaskRepeatCfgService,
    ) as jasmine.SpyObj<TaskRepeatCfgService>;

    return { service, repeatCfgService };
  };

  describe('addTaskRepeatCfg()', () => {
    it('creates a config with dialog defaults derived from the task', async () => {
      const { service, repeatCfgService } = setup();

      const cfgId = await service.addTaskRepeatCfg('task-1');

      expect(cfgId).toBe('cfg-1');
      expect(repeatCfgService.addTaskRepeatCfgToTask).toHaveBeenCalledWith(
        'task-1',
        'p1',
        jasmine.objectContaining({
          title: 'Water the plants',
          projectId: 'p1',
          startDate: getDbDateStr(),
          // DEFAULT quickSetting is DAILY → schedule-aware default is ON
          skipOverdue: true,
        }),
      );
    });

    it('honours explicit fields and keeps skipOverdue OFF for non-everyday schedules', async () => {
      const { service, repeatCfgService } = setup();

      await service.addTaskRepeatCfg('task-1', {
        title: 'Weekly watering',
        quickSetting: 'CUSTOM',
        repeatCycle: 'WEEKLY',
        monday: false,
        tuesday: false,
        wednesday: true,
        thursday: false,
        friday: false,
        saturday: false,
        sunday: false,
        startDate: '2030-01-01',
        startTime: '12:45',
        remindAt: 'AtStart',
      });

      expect(repeatCfgService.addTaskRepeatCfgToTask).toHaveBeenCalledWith(
        'task-1',
        'p1',
        jasmine.objectContaining({
          title: 'Weekly watering',
          quickSetting: 'CUSTOM',
          repeatCycle: 'WEEKLY',
          monday: false,
          wednesday: true,
          startDate: '2030-01-01',
          startTime: '12:45',
          remindAt: 'AtStart',
          skipOverdue: false,
        }),
      );
    });

    it('respects an explicit skipOverdue over the schedule-aware default', async () => {
      const { service, repeatCfgService } = setup();

      // Default schedule is the plain everyday one, whose derived default is ON
      await service.addTaskRepeatCfg('task-1', { skipOverdue: false });

      expect(repeatCfgService.addTaskRepeatCfgToTask).toHaveBeenCalledWith(
        'task-1',
        'p1',
        jasmine.objectContaining({ skipOverdue: false }),
      );
    });

    it('throws for an unknown task', async () => {
      // null (not undefined) — an explicit undefined would trigger the
      // default-parameter fallback to TASK
      const { service, repeatCfgService } = setup(null);

      await expectAsync(service.addTaskRepeatCfg('nope')).toBeRejectedWithError(
        /TASK_NOT_FOUND/,
      );
      expect(repeatCfgService.addTaskRepeatCfgToTask).not.toHaveBeenCalled();
    });

    it('rejects sub tasks', async () => {
      const { service, repeatCfgService } = setup({ ...TASK, parentId: 'parent-1' });

      await expectAsync(service.addTaskRepeatCfg('task-1')).toBeRejectedWithError(
        /Sub tasks cannot be made repeatable/,
      );
      expect(repeatCfgService.addTaskRepeatCfgToTask).not.toHaveBeenCalled();
    });

    it('rejects a task that already has a repeat config', async () => {
      const { service, repeatCfgService } = setup({ ...TASK, repeatCfgId: 'cfg-old' });

      await expectAsync(service.addTaskRepeatCfg('task-1')).toBeRejectedWithError(
        /already has a repeat config/,
      );
      expect(repeatCfgService.addTaskRepeatCfgToTask).not.toHaveBeenCalled();
    });

    it('rejects unknown tags', async () => {
      const { service, repeatCfgService } = setup();

      await expectAsync(
        service.addTaskRepeatCfg('task-1', { tagIds: ['nope'] }),
      ).toBeRejectedWithError(/TAGS_DO_NOT_EXIST/);
      expect(repeatCfgService.addTaskRepeatCfgToTask).not.toHaveBeenCalled();
    });
  });

  describe('updateTaskRepeatCfg()', () => {
    it('throws when the config does not exist', async () => {
      const { service, repeatCfgService } = setup(TASK, undefined);

      await expectAsync(
        service.updateTaskRepeatCfg('cfg-x', { startTime: '09:00' }),
      ).toBeRejectedWithError(/No task repeat config found/);
      expect(repeatCfgService.updateTaskRepeatCfg).not.toHaveBeenCalled();
    });

    it('passes changes through to the service', async () => {
      const { service, repeatCfgService } = setup(TASK, {
        id: 'cfg-1',
      } as TaskRepeatCfg);

      await service.updateTaskRepeatCfg('cfg-1', {
        startTime: '09:00',
        remindAt: 'm10',
      });

      expect(repeatCfgService.updateTaskRepeatCfg).toHaveBeenCalledWith(
        'cfg-1',
        jasmine.objectContaining({ startTime: '09:00', remindAt: 'm10' }),
      );
    });
  });

  describe('deleteTaskRepeatCfg()', () => {
    it('throws when the config does not exist', async () => {
      const { service, repeatCfgService } = setup(TASK, undefined);

      await expectAsync(service.deleteTaskRepeatCfg('cfg-x')).toBeRejectedWithError(
        /No task repeat config found/,
      );
      expect(repeatCfgService.deleteTaskRepeatCfg).not.toHaveBeenCalled();
    });

    it('delegates to the service when the config exists', async () => {
      const { service, repeatCfgService } = setup(TASK, {
        id: 'cfg-1',
      } as TaskRepeatCfg);

      await service.deleteTaskRepeatCfg('cfg-1');

      expect(repeatCfgService.deleteTaskRepeatCfg).toHaveBeenCalledWith('cfg-1');
    });
  });
});
