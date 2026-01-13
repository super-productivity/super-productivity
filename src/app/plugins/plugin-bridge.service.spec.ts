// TODO: Fix plugin tests after stabilizing task model changes

/*
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { PluginBridgeService } from './plugin-bridge.service';
import { TaskService } from '../features/tasks/task.service';
import { ProjectService } from '../features/project/project.service';
import { TagService } from '../features/tag/tag.service';
import { WorkContextService } from '../features/work-context/work-context.service';
import { Store } from '@ngrx/store';
import { SnackService } from '../core/snack/snack.service';
import { NotifyService } from '../core/notify/notify.service';
import { PluginService } from './plugin.service';
import { Task, TaskCopy } from '../features/tasks/task.model';
import { Project, ProjectCopy } from '../features/project/project.model';
import { Tag, TagCopy } from '../features/tag/tag.model';
import { WorkContext, WorkContextCopy, WorkContextType } from '../features/work-context/work-context.model';
import { GlobalConfigService } from '../features/config/global-config.service';
import { PluginManifest, PluginHooks } from './plugin-api.model';
import { WorklogGrouping } from '../features/worklog/worklog.model';

describe('PluginBridgeService', () => {
  let service: PluginBridgeService;
  let taskService: jasmine.SpyObj<TaskService>;
  let projectService: jasmine.SpyObj<ProjectService>;
  let tagService: jasmine.SpyObj<TagService>;
  let workContextService: jasmine.SpyObj<WorkContextService>;
  let store: jasmine.SpyObj<Store>;
  let snackService: jasmine.SpyObj<SnackService>;
  let notifyService: jasmine.SpyObj<NotifyService>;
  let matDialog: jasmine.SpyObj<MatDialog>;
  let router: jasmine.SpyObj<Router>;
  let pluginService: jasmine.SpyObj<PluginService>;
  let globalConfigService: jasmine.SpyObj<GlobalConfigService>;

  const mockPluginId = 'test-plugin';
  const mockManifest: PluginManifest = {
    id: mockPluginId,
    name: 'Test Plugin',
    version: '1.0.0',
    manifestVersion: 1,
    minSupVersion: '1.0.0',
    description: 'Test Description',
    permissions: [],
    hooks: [PluginHooks.TASK_COMPLETE],
  };

  const mockTask: Task = {
    id: 'task-1',
    title: 'Test Task',
    notes: 'Test notes',
    projectId: 'project-1',
    tagIds: ['tag-1'],
    created: Date.now(),
    timeSpentOnDay: {},
    timeSpent: 0,
    timeEstimate: 0,
    isDone: false,
    doneOn: undefined,
    reminderId: undefined,
    parentId: undefined,
    attachments: [],
    issueId: undefined,
    issuePoints: undefined,
    issueType: undefined,
    issueAttachmentNr: undefined,
    issueLastUpdated: undefined,
    issueWasUpdated: false,
    subTaskIds: [],
    repeatCfgId: undefined,
    _hideSubTasksMode: 2,
  };

  const mockProject: Project = {
    id: 'project-1',
    title: 'Test Project',
    isArchived: false,
    isHiddenFromMenu: false,
    isEnableBacklog: false,
    backlogTaskIds: [],
    taskIds: ['task-1'],
    noteIds: [],
    workStart: {},
    workEnd: {},
    theme: {
      isAutoContrast: false,
      isDisableBackgroundTint: false,
      primary: '',
      huePrimary: '500',
      accent: '',
      hueAccent: '500',
      warn: '',
      hueWarn: '500',
      backgroundImageDark: null,
      backgroundImageLight: null,
    },
    advancedCfg: {
      worklogExportSettings: {
        roundWorkTimeTo: null,
        roundStartTimeTo: null,
        roundEndTimeTo: null,
        separateTasksBy: ', ',
        cols: [],
        groupBy: WorklogGrouping.WORKLOG,
      },
    },
  };

  const mockTag: Tag = {
    id: 'tag-1',
    title: 'Test Tag',
    color: '#000000',
    created: Date.now(),
    icon: null,
    taskIds: ['task-1'],
    advancedCfg: {
      worklogExportSettings: {
        roundWorkTimeTo: null,
        roundStartTimeTo: null,
        roundEndTimeTo: null,
        separateTasksBy: ', ',
        cols: [],
        groupBy: WorklogGrouping.WORKLOG,
      },
    },
    theme: {},
  };

  const mockWorkContext: WorkContext = {
    type: WorkContextType.PROJECT,
    id: 'project-1',
    title: 'Test Project',
    taskIds: ['task-1'],
    backlogTaskIds: [],
    noteIds: [],
    theme: mockProject.theme,
    advancedCfg: {
      worklogExportSettings: {
        roundWorkTimeTo: null,
        roundStartTimeTo: null,
        roundEndTimeTo: null,
        separateTasksBy: ', ',
        cols: [],
        groupBy: WorklogGrouping.WORKLOG,
      },
    },
    routerLink: '/project/project-1',
    isEnableBacklog: true,
    icon: null,
  };

  beforeEach(() => {
    const taskServiceSpy = jasmine.createSpyObj('TaskService', [
      'allTasks$',
      'getByIdOnce$',
      'update',
      'add',
      'getByIds$',
      'updateOrder',
    ]);
    const projectServiceSpy = jasmine.createSpyObj('ProjectService', [
      'list$',
      'getByIdOnce$',
      'update',
      'add',
    ]);
    const tagServiceSpy = jasmine.createSpyObj('TagService', [
      'getTags$',
      'getByIdOnce$',
      'update',
      'add',
    ]);
    const workContextServiceSpy = jasmine.createSpyObj('WorkContextService', [
      'activeWorkContext$',
    ]);
    const storeSpy = jasmine.createSpyObj('Store', ['select', 'dispatch']);
    const snackServiceSpy = jasmine.createSpyObj('SnackService', ['open']);
    const notifyServiceSpy = jasmine.createSpyObj('NotifyService', ['notify']);
    const matDialogSpy = jasmine.createSpyObj('MatDialog', ['open']);
    const routerSpy = jasmine.createSpyObj('Router', ['navigate']);
    const pluginServiceSpy = jasmine.createSpyObj('PluginService', [
      'updatePluginPersistedData',
    ]);
    const globalConfigServiceSpy = jasmine.createSpyObj('GlobalConfigService', [
      'theme$',
    ]);

    TestBed.configureTestingModule({
      providers: [
        PluginBridgeService,
        { provide: TaskService, useValue: taskServiceSpy },
        { provide: ProjectService, useValue: projectServiceSpy },
        { provide: TagService, useValue: tagServiceSpy },
        { provide: WorkContextService, useValue: workContextServiceSpy },
        { provide: Store, useValue: storeSpy },
        { provide: SnackService, useValue: snackServiceSpy },
        { provide: NotifyService, useValue: notifyServiceSpy },
        { provide: MatDialog, useValue: matDialogSpy },
        { provide: Router, useValue: routerSpy },
        { provide: PluginService, useValue: pluginServiceSpy },
        { provide: GlobalConfigService, useValue: globalConfigServiceSpy },
      ],
    });

    service = TestBed.inject(PluginBridgeService);
    taskService = TestBed.inject(TaskService) as jasmine.SpyObj<TaskService>;
    projectService = TestBed.inject(ProjectService) as jasmine.SpyObj<ProjectService>;
    tagService = TestBed.inject(TagService) as jasmine.SpyObj<TagService>;
    workContextService = TestBed.inject(
      WorkContextService,
    ) as jasmine.SpyObj<WorkContextService>;
    store = TestBed.inject(Store) as jasmine.SpyObj<Store>;
    snackService = TestBed.inject(SnackService) as jasmine.SpyObj<SnackService>;
    notifyService = TestBed.inject(NotifyService) as jasmine.SpyObj<NotifyService>;
    matDialog = TestBed.inject(MatDialog) as jasmine.SpyObj<MatDialog>;
    router = TestBed.inject(Router) as jasmine.SpyObj<Router>;
    pluginService = TestBed.inject(PluginService) as jasmine.SpyObj<PluginService>;
    globalConfigService = TestBed.inject(
      GlobalConfigService,
    ) as jasmine.SpyObj<GlobalConfigService>;

    // Setup default mock returns
    taskService.allTasks$ = of([mockTask]);
    projectService.list$ = of([mockProject]);
    tagService.getTags$ = of([mockTag]);
    workContextService.activeWorkContext$ = of(mockWorkContext);
    globalConfigService.theme$ = of({
      isDarkTheme: false,
      isAutoContrast: false,
    });
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('showSnack', () => {
    it('should show success snack', () => {
      service._setCurrentPlugin(mockPluginId, mockManifest);

      service.showSnack({ msg: 'Test message', type: 'SUCCESS' });

      expect(snackService.open).toHaveBeenCalled();
    });

    it('should show error snack', () => {
      service._setCurrentPlugin(mockPluginId, mockManifest);

      service.showSnack({ msg: 'Error message', type: 'ERROR' });

      expect(snackService.open).toHaveBeenCalled();
    });
  });

  describe('showNotification', () => {
    it('should show notification', () => {
      service._setCurrentPlugin(mockPluginId, mockManifest);

      service.showNotification({ title: 'Test', body: 'Test notification' });

      expect(notifyService.notify).toHaveBeenCalled();
    });

    it('should not show notification without current plugin', async () => {
      await expectAsync(
        service.showNotification({ title: 'Test', body: 'Test' }),
      ).toBeRejectedWithError('No active plugin');
    });
  });

  describe('showDialog', () => {
    it('should show dialog', () => {
      service._setCurrentPlugin(mockPluginId, mockManifest);
      matDialog.open.and.returnValue({
        afterClosed: () => of(undefined),
      } as any);

      service.showDialog({
        htmlContent: '<p>Test</p>',
        buttons: [
          {
            label: 'OK',
            onClick: jasmine.createSpy('onClick'),
          },
        ],
      });

      expect(matDialog.open).toHaveBeenCalled();
    });
  });

  describe('navigateToTask', () => {
    it('should navigate to task', () => {
      service._setCurrentPlugin(mockPluginId, mockManifest);

      service.navigateToTask('task-1');

      expect(router.navigate).toHaveBeenCalledWith(['/task', 'task-1']);
    });
  });

  describe('getTasks', () => {
    it('should return all tasks', async () => {
      service._setCurrentPlugin(mockPluginId, mockManifest);

      const tasks = await service.getTasks();

      expect(tasks).toEqual([mockTask]);
    });
  });

  describe('getTasksByIds', () => {
    it('should return tasks by ids', async () => {
      service._setCurrentPlugin(mockPluginId, mockManifest);
      taskService.getByIds$.and.returnValue(of([mockTask]));

      const tasks = await service.getTasksByIds(['task-1']);

      expect(taskService.getByIds$).toHaveBeenCalledWith(['task-1']);
      expect(tasks).toEqual([mockTask]);
    });
  });

  describe('getTagById', () => {
    it('should return tag by id', async () => {
      service._setCurrentPlugin(mockPluginId, mockManifest);
      tagService.getByIdOnce$.and.returnValue(of(mockTag));

      const tag = await service.getTagById('tag-1');

      expect(tagService.getByIdOnce$).toHaveBeenCalledWith('tag-1');
      expect(tag).toEqual(mockTag);
    });
  });

  describe('getCurrentProject', () => {
    it('should return current project when context is project', async () => {
      service._setCurrentPlugin(mockPluginId, mockManifest);
      projectService.getByIdOnce$.and.returnValue(of(mockProject));

      const project = await service.getCurrentProject();

      expect(project).toEqual(mockProject);
    });

    it('should return null when context is not project', async () => {
      service._setCurrentPlugin(mockPluginId, mockManifest);
      workContextService.activeWorkContext$ = of({
        ...mockWorkContext,
        type: WorkContextType.TAG,
      } as WorkContext);

      const project = await service.getCurrentProject();

      expect(project).toBeNull();
    });
  });

  describe('createTask', () => {
    it('should create task', async () => {
      service._setCurrentPlugin(mockPluginId, mockManifest);
      taskService.add.and.returnValue(of(mockTask));

      const task = await service.createTask({
        title: 'New Task',
        notes: 'New notes',
      });

      expect(taskService.add).toHaveBeenCalled();
      expect(task).toEqual(mockTask);
    });
  });

  describe('updateTask', () => {
    it('should update task', async () => {
      service._setCurrentPlugin(mockPluginId, mockManifest);
      taskService.getByIdOnce$.and.returnValue(of(mockTask));
      taskService.update.and.returnValue(of(mockTask));

      await service.updateTask('task-1', { title: 'Updated Task' });

      expect(taskService.update).toHaveBeenCalledWith(
        'task-1',
        jasmine.objectContaining({ title: 'Updated Task' }),
      );
    });
  });

  describe('reorderTasks', () => {
    it('should reorder tasks', async () => {
      service._setCurrentPlugin(mockPluginId, mockManifest);

      await service.reorderTasks(['task-2', 'task-1', 'task-3']);

      expect(taskService.updateOrder).toHaveBeenCalledWith(['task-2', 'task-1', 'task-3']);
    });

    it('should reject with invalid task ids', async () => {
      service._setCurrentPlugin(mockPluginId, mockManifest);

      await expectAsync(service.reorderTasks(null as any)).toBeRejected();
    });
  });

  describe('persistPluginData', () => {
    it('should persist plugin data', async () => {
      service._setCurrentPlugin(mockPluginId, mockManifest);
      pluginService.updatePluginPersistedData.and.returnValue(Promise.resolve());

      await service.persistPluginData({ key: 'value' });

      expect(pluginService.updatePluginPersistedData).toHaveBeenCalledWith(
        mockPluginId,
        { key: 'value' },
      );
    });
  });

  describe('getPersistedPluginData', () => {
    it('should get persisted plugin data from manifest', async () => {
      const manifestWithData = {
        ...mockManifest,
        persistedData: { key: 'value' },
      };
      service._setCurrentPlugin(mockPluginId, manifestWithData);

      const data = await service.getPersistedPluginData();

      expect(data).toEqual({ key: 'value' });
    });
  });

  describe('registerHeaderButton', () => {
    it('should register header button', () => {
      service._setCurrentPlugin(mockPluginId, mockManifest);

      service.registerHeaderButton({
        label: 'Test Button',
        icon: 'test-icon',
        onClick: jasmine.createSpy('onClick'),
      });

      const buttons = service.headerButtons$;
      buttons.subscribe((btns) => {
        expect(btns.length).toBe(1);
        expect(btns[0].pluginId).toBe(mockPluginId);
      });
    });
  });

  describe('registerMenuEntry', () => {
    it('should register menu entry', () => {
      service._setCurrentPlugin(mockPluginId, mockManifest);

      service.registerMenuEntry({
        label: 'Test Menu',
        onClick: jasmine.createSpy('onClick'),
      });

      const entries = service.menuEntries$;
      entries.subscribe((items) => {
        expect(items.length).toBe(1);
        expect(items[0].pluginId).toBe(mockPluginId);
      });
    });
  });

  describe('registerSidePanelButton', () => {
    it('should register side panel button', () => {
      service._setCurrentPlugin(mockPluginId, mockManifest);

      service.registerSidePanelButton({
        label: 'Test Panel',
        icon: 'test-icon',
        onClick: jasmine.createSpy('onClick'),
      });

      const buttons = service.sidePanelButtons$;
      buttons.subscribe((btns) => {
        expect(btns.length).toBe(1);
        expect(btns[0].pluginId).toBe(mockPluginId);
      });
    });
  });

  describe('registerShortcut', () => {
    it('should register shortcut', () => {
      service._setCurrentPlugin(mockPluginId, mockManifest);
      const action = jasmine.createSpy('action');

      service.registerShortcut({
        keys: 'ctrl+shift+x',
        label: 'Test Shortcut',
        action,
      });

      const shortcuts = service._getShortcutsForPlugin(mockPluginId);
      expect(shortcuts.length).toBe(1);
    });
  });

  describe('executeShortcut', () => {
    it('should execute registered shortcut', () => {
      service._setCurrentPlugin(mockPluginId, mockManifest);
      const action = jasmine.createSpy('action');

      service.registerShortcut({
        keys: 'ctrl+shift+x',
        label: 'Test Shortcut',
        action,
      });

      const result = service.executeShortcut('ctrl+shift+x');
      expect(result).toBe(true);
      expect(action).toHaveBeenCalled();
    });

    it('should return false for unregistered shortcut', () => {
      const result = service.executeShortcut('ctrl+shift+x');
      expect(result).toBe(false);
    });
  });

  describe('executeNodeScript', () => {
    it('should execute node script in electron environment', async () => {
      service._setCurrentPlugin(mockPluginId, mockManifest);
      (window as any).IS_ELECTRON = true;

      const result = await service.executeNodeScript({ script: 'console.log("test")' });

      expect(result).toBeDefined();
    });

    it('should reject if not in electron environment', async () => {
      service._setCurrentPlugin(mockPluginId, mockManifest);
      (window as any).IS_ELECTRON = false;

      const result = await service.executeNodeScript({ script: 'console.log("test")' });
      expect(result.success).toBe(false);
    });
  });

  describe('sendMessageToPlugin', () => {
    it('should send message to plugin', async () => {
      service._setCurrentPlugin(mockPluginId, mockManifest);

      await service.sendMessageToPlugin({ type: 'test', data: 'test data' });

      // Test completes without error
      expect(true).toBe(true);
    });
  });

  describe('openUrl', () => {
    it('should open URL in new window', () => {
      service._setCurrentPlugin(mockPluginId, mockManifest);
      spyOn(window, 'open');

      service.openUrl('https://test.com');

      expect(window.open).toHaveBeenCalledWith('https://test.com', '_blank');
    });
  });
});
*/

/* eslint-disable @typescript-eslint/naming-convention */
// Active tests for setCounter fix (issue #5812)
import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { PluginBridgeService } from './plugin-bridge.service';
import { selectAllSimpleCounters } from '../features/simple-counter/store/simple-counter.reducer';
import {
  updateSimpleCounter,
  upsertSimpleCounter,
} from '../features/simple-counter/store/simple-counter.actions';
import {
  SimpleCounter,
  SimpleCounterType,
} from '../features/simple-counter/simple-counter.model';
import { EMPTY_SIMPLE_COUNTER } from '../features/simple-counter/simple-counter.const';
import { SnackService } from '../core/snack/snack.service';
import { NotifyService } from '../core/notify/notify.service';
import { MatDialog } from '@angular/material/dialog';
import { PluginHooksService } from './plugin-hooks';
import { TaskService } from '../features/tasks/task.service';
import { WorkContextService } from '../features/work-context/work-context.service';
import { ProjectService } from '../features/project/project.service';
import { TagService } from '../features/tag/tag.service';
import { PluginUserPersistenceService } from './plugin-user-persistence.service';
import { PluginConfigService } from './plugin-config.service';
import { TaskArchiveService } from '../features/archive/task-archive.service';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { SyncWrapperService } from '../imex/sync/sync-wrapper.service';

describe('PluginBridgeService - Counter Methods', () => {
  let service: PluginBridgeService;
  let store: MockStore;
  let dispatchSpy: jasmine.Spy;

  const mockExistingCounter: SimpleCounter = {
    ...EMPTY_SIMPLE_COUNTER,
    id: 'existing-counter',
    title: 'Existing Counter',
    isEnabled: true,
    type: SimpleCounterType.ClickCounter,
    countOnDay: { '2025-12-30': 5 },
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        PluginBridgeService,
        provideMockStore({
          selectors: [
            { selector: selectAllSimpleCounters, value: [mockExistingCounter] },
          ],
        }),
        { provide: SnackService, useValue: {} },
        { provide: NotifyService, useValue: {} },
        { provide: MatDialog, useValue: {} },
        { provide: PluginHooksService, useValue: {} },
        { provide: TaskService, useValue: {} },
        { provide: WorkContextService, useValue: {} },
        { provide: ProjectService, useValue: {} },
        { provide: TagService, useValue: {} },
        { provide: PluginUserPersistenceService, useValue: {} },
        { provide: PluginConfigService, useValue: {} },
        { provide: TaskArchiveService, useValue: {} },
        { provide: Router, useValue: {} },
        { provide: TranslateService, useValue: {} },
        { provide: SyncWrapperService, useValue: {} },
      ],
    });

    service = TestBed.inject(PluginBridgeService);
    store = TestBed.inject(MockStore);
    dispatchSpy = spyOn(store, 'dispatch').and.callThrough();
  });

  afterEach(() => {
    store.resetSelectors();
  });

  describe('setCounter', () => {
    it('should create a new counter with all mandatory fields when counter does not exist', async () => {
      // Arrange
      const counterId = 'new-counter';
      const value = 10;
      const today = new Date().toISOString().split('T')[0];

      // Act
      await service.setCounter(counterId, value);

      // Assert
      expect(dispatchSpy).toHaveBeenCalledTimes(1);
      const dispatchedAction = dispatchSpy.calls.mostRecent().args[0];
      expect(dispatchedAction.type).toBe(upsertSimpleCounter.type);

      const counter = dispatchedAction.simpleCounter;
      expect(counter.id).toBe(counterId);
      expect(counter.title).toBe(counterId);
      expect(counter.isEnabled).toBe(true);
      expect(counter.type).toBe(SimpleCounterType.ClickCounter);
      expect(counter.countOnDay[today]).toBe(value);
      // Verify EMPTY_SIMPLE_COUNTER spread is applied
      expect(counter.isOn).toBe(false);
      expect(counter.isTrackStreaks).toBe(true);
    });

    it('should update only countOnDay when counter already exists', async () => {
      // Arrange
      const counterId = 'existing-counter';
      const value = 15;
      const today = new Date().toISOString().split('T')[0];

      // Act
      await service.setCounter(counterId, value);

      // Assert
      expect(dispatchSpy).toHaveBeenCalledTimes(1);
      const dispatchedAction = dispatchSpy.calls.mostRecent().args[0];
      expect(dispatchedAction.type).toBe(updateSimpleCounter.type);

      const changes = dispatchedAction.simpleCounter.changes;
      expect(changes.countOnDay[today]).toBe(value);
      // Should preserve existing day values
      expect(changes.countOnDay['2025-12-30']).toBe(5);
    });

    it('should throw error for invalid counter key', async () => {
      await expectAsync(service.setCounter('invalid key!', 10)).toBeRejectedWithError(
        'Invalid counter key: must be alphanumeric with hyphens',
      );
    });

    it('should throw error for negative value', async () => {
      await expectAsync(service.setCounter('valid-key', -5)).toBeRejectedWithError(
        'Invalid counter value: must be a non-negative number',
      );
    });
  });

  describe('incrementCounter', () => {
    it('should increment existing counter value', async () => {
      // Arrange: existing counter has value 5 for 2025-12-30
      const today = new Date().toISOString().split('T')[0];
      store.overrideSelector(selectAllSimpleCounters, [
        { ...mockExistingCounter, countOnDay: { [today]: 5 } },
      ]);

      // Act
      const newValue = await service.incrementCounter('existing-counter', 3);

      // Assert
      expect(newValue).toBe(8);
    });

    it('should create counter when incrementing non-existent counter', async () => {
      // Act
      const newValue = await service.incrementCounter('new-counter', 5);

      // Assert
      expect(newValue).toBe(5);
      expect(dispatchSpy).toHaveBeenCalled();
      const dispatchedAction = dispatchSpy.calls.mostRecent().args[0];
      expect(dispatchedAction.type).toBe(upsertSimpleCounter.type);
    });

    it('should throw error for non-positive increment', async () => {
      await expectAsync(service.incrementCounter('valid-key', 0)).toBeRejectedWithError(
        'Invalid increment amount: must be a positive number',
      );
    });
  });

  describe('decrementCounter', () => {
    it('should decrement existing counter value', async () => {
      // Arrange
      const today = new Date().toISOString().split('T')[0];
      store.overrideSelector(selectAllSimpleCounters, [
        { ...mockExistingCounter, countOnDay: { [today]: 10 } },
      ]);

      // Act
      const newValue = await service.decrementCounter('existing-counter', 3);

      // Assert
      expect(newValue).toBe(7);
    });

    it('should not go below zero', async () => {
      // Arrange
      const today = new Date().toISOString().split('T')[0];
      store.overrideSelector(selectAllSimpleCounters, [
        { ...mockExistingCounter, countOnDay: { [today]: 2 } },
      ]);

      // Act
      const newValue = await service.decrementCounter('existing-counter', 10);

      // Assert
      expect(newValue).toBe(0);
    });

    it('should throw error for non-positive decrement', async () => {
      await expectAsync(service.decrementCounter('valid-key', -1)).toBeRejectedWithError(
        'Invalid decrement amount: must be a positive number',
      );
    });
  });
});
