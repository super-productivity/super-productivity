/* eslint-disable @typescript-eslint/naming-convention */
// Active tests for setCounter fix (issue #5812)
import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { selectTaskByIdWithSubTaskData } from '../features/tasks/store/task.selectors';
import { of } from 'rxjs';
import { PluginBridgeService } from './plugin-bridge.service';
import { PluginShortcutCfg } from '@super-productivity/plugin-api';
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
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { PluginHooksService } from './plugin-hooks';
import { TaskService } from '../features/tasks/task.service';
import {
  DEFAULT_TASK,
  TaskReminderOptionId,
  TaskWithSubTasks,
} from '../features/tasks/task.model';
import { WorkContextService } from '../features/work-context/work-context.service';
import { ProjectService } from '../features/project/project.service';
import { TagService } from '../features/tag/tag.service';
import { TaskRepeatCfgService } from '../features/task-repeat-cfg/task-repeat-cfg.service';
import {
  TaskRepeatCfg,
  TaskRepeatCfgCopy,
} from '../features/task-repeat-cfg/task-repeat-cfg.model';
import { PluginUserPersistenceService } from './plugin-user-persistence.service';
import { PluginConfigService } from './plugin-config.service';
import { TaskArchiveService } from '../features/archive/task-archive.service';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { SyncWrapperService } from '../imex/sync/sync-wrapper.service';
import { GlobalThemeService } from '../core/theme/global-theme.service';
import { PluginIssueProviderRegistryService } from './issue-provider/plugin-issue-provider-registry.service';
import { IssueSyncAdapterRegistryService } from '../features/issue/two-way-sync/issue-sync-adapter-registry.service';
import { PluginHttpService } from './issue-provider/plugin-http.service';
import { getDbDateStr } from '../util/get-db-date-str';
import { DataInitService } from '../core/data-init/data-init.service';
import { GlobalConfigService } from '../features/config/global-config.service';
import { DEFAULT_GLOBAL_CONFIG } from '../features/config/default-global-config.const';
import { Log } from '../core/log';
import { updateGlobalConfigSection } from '../features/config/store/global-config.actions';
import { PluginDialogComponent } from './ui/plugin-dialog/plugin-dialog.component';
import { T } from '../t.const';
import { INBOX_PROJECT } from '../features/project/project.const';
import { Project } from '../features/project/project.model';
import { PluginManifest } from '@super-productivity/plugin-api';

describe('PluginBridgeService - Counter Methods', () => {
  let service: PluginBridgeService;
  let store: MockStore;
  let dispatchSpy: jasmine.Spy;
  let dataInitService: jasmine.SpyObj<DataInitService>;

  const mockExistingCounter: SimpleCounter = {
    ...EMPTY_SIMPLE_COUNTER,
    id: 'existing-counter',
    title: 'Existing Counter',
    isEnabled: true,
    type: SimpleCounterType.ClickCounter,
    countOnDay: { '2025-12-30': 5 },
  };

  beforeEach(() => {
    const dataInitServiceSpy = jasmine.createSpyObj('DataInitService', ['reInit']);
    dataInitServiceSpy.reInit.and.resolveTo();

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
        {
          provide: PluginHooksService,
          useValue: jasmine.createSpyObj('PluginHooksService', ['unregisterPluginHooks']),
        },
        { provide: TaskService, useValue: {} },
        // activeWorkContext$ must be a real Observable — the constructor
        // reads it via toSignal() at construction time.
        { provide: WorkContextService, useValue: { activeWorkContext$: of(null) } },
        { provide: ProjectService, useValue: {} },
        { provide: TagService, useValue: {} },
        { provide: TaskRepeatCfgService, useValue: {} },
        { provide: PluginUserPersistenceService, useValue: {} },
        { provide: PluginConfigService, useValue: {} },
        { provide: TaskArchiveService, useValue: {} },
        { provide: Router, useValue: {} },
        { provide: TranslateService, useValue: {} },
        { provide: SyncWrapperService, useValue: {} },
        { provide: GlobalThemeService, useValue: {} },
        {
          provide: PluginIssueProviderRegistryService,
          useValue: jasmine.createSpyObj('PluginIssueProviderRegistryService', [
            'getRegisteredKey',
            'unregister',
          ]),
        },
        {
          provide: IssueSyncAdapterRegistryService,
          useValue: jasmine.createSpyObj('IssueSyncAdapterRegistryService', [
            'unregister',
          ]),
        },
        { provide: PluginHttpService, useValue: {} },
        { provide: DataInitService, useValue: dataInitServiceSpy },
      ],
    });

    service = TestBed.inject(PluginBridgeService);
    store = TestBed.inject(MockStore);
    dataInitService = TestBed.inject(DataInitService) as jasmine.SpyObj<DataInitService>;
    dispatchSpy = spyOn(store, 'dispatch').and.callThrough();
  });

  afterEach(() => {
    store?.resetSelectors();
  });

  describe('setCounter', () => {
    it('should create a new counter with all mandatory fields when counter does not exist', async () => {
      // Arrange
      const counterId = 'new-counter';
      const value = 10;
      const today = getDbDateStr();

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
      const today = getDbDateStr();

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
      // Arrange: existing counter has value 5 for today
      const today = getDbDateStr();
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
      const today = getDbDateStr();
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
      const today = getDbDateStr();
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

  describe('config handler', () => {
    it('should return false for hasConfigHandler when no handler is registered', () => {
      expect(service.hasConfigHandler('unknown-plugin')).toBe(false);
    });

    it('should return true for hasConfigHandler after registering a handler', () => {
      (service as any)._configHandlers.set('test-plugin', () => {});
      expect(service.hasConfigHandler('test-plugin')).toBe(true);
    });

    it('should invoke the registered config handler', () => {
      const handler = jasmine.createSpy('configHandler');
      (service as any)._configHandlers.set('test-plugin', handler);

      service.invokeConfigHandler('test-plugin');

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should not throw when invoking handler for unregistered plugin', () => {
      expect(() => service.invokeConfigHandler('unknown-plugin')).not.toThrow();
    });

    it('should remove config handler on cleanup', () => {
      (service as any)._configHandlers.set('test-plugin', () => {});
      expect(service.hasConfigHandler('test-plugin')).toBe(true);

      service.unregisterPluginHooks('test-plugin');

      expect(service.hasConfigHandler('test-plugin')).toBe(false);
    });
  });

  describe('shortcuts', () => {
    const shortcut = (
      pluginId: string,
      id: string,
      label: string,
    ): PluginShortcutCfg => ({
      pluginId,
      id,
      label,
      onExec: () => {},
    });

    it('replaces an existing shortcut when the same id is registered again', () => {
      const bound = service.createBoundMethods('test-plugin');

      bound.registerShortcut(shortcut('test-plugin', 'rule-1', 'Old label'));
      bound.registerShortcut(shortcut('test-plugin', 'rule-1', 'New label'));

      expect(service.shortcuts().length).toBe(1);
      expect(service.shortcuts()[0].label).toBe('New label');
    });

    it('keeps shortcuts of other plugins with the same id', () => {
      service
        .createBoundMethods('test-plugin')
        .registerShortcut(shortcut('test-plugin', 'rule-1', 'Mine'));
      service
        .createBoundMethods('other-plugin')
        .registerShortcut(shortcut('other-plugin', 'rule-1', 'Theirs'));

      expect(service.shortcuts().length).toBe(2);
    });

    it('unregisters a single shortcut of a plugin', () => {
      const bound = service.createBoundMethods('test-plugin');
      bound.registerShortcut(shortcut('test-plugin', 'rule-1', 'One'));
      bound.registerShortcut(shortcut('test-plugin', 'rule-2', 'Two'));

      bound.unregisterShortcut('rule-1');

      expect(service.shortcuts().map((s) => s.id)).toEqual(['rule-2']);
    });

    it('does not unregister the same id of another plugin', () => {
      service
        .createBoundMethods('test-plugin')
        .registerShortcut(shortcut('test-plugin', 'rule-1', 'Mine'));

      service.createBoundMethods('other-plugin').unregisterShortcut('rule-1');

      expect(service.shortcuts().length).toBe(1);
    });
  });

  describe('reInitData', () => {
    it('should delegate to DataInitService.reInit', async () => {
      await service.reInitData();

      expect(dataInitService.reInit).toHaveBeenCalledTimes(1);
    });
  });
});

describe('PluginBridgeService - dispatchAction privacy (#7619)', () => {
  let service: PluginBridgeService;
  let store: MockStore;
  let translateService: jasmine.SpyObj<TranslateService>;

  beforeEach(() => {
    translateService = jasmine.createSpyObj<TranslateService>('TranslateService', [
      'instant',
    ]);
    translateService.instant.and.returnValue('Action type is not allowed');

    TestBed.configureTestingModule({
      providers: [
        PluginBridgeService,
        provideMockStore(),
        { provide: SnackService, useValue: {} },
        { provide: NotifyService, useValue: {} },
        { provide: MatDialog, useValue: {} },
        { provide: PluginHooksService, useValue: {} },
        { provide: TaskService, useValue: {} },
        { provide: WorkContextService, useValue: { activeWorkContext$: of(null) } },
        { provide: ProjectService, useValue: {} },
        { provide: TagService, useValue: {} },
        { provide: TaskRepeatCfgService, useValue: {} },
        { provide: PluginUserPersistenceService, useValue: {} },
        { provide: PluginConfigService, useValue: {} },
        { provide: TaskArchiveService, useValue: {} },
        { provide: Router, useValue: {} },
        { provide: TranslateService, useValue: translateService },
        { provide: SyncWrapperService, useValue: {} },
        { provide: GlobalThemeService, useValue: {} },
        { provide: PluginIssueProviderRegistryService, useValue: {} },
        { provide: IssueSyncAdapterRegistryService, useValue: {} },
        { provide: PluginHttpService, useValue: {} },
        { provide: DataInitService, useValue: {} },
      ],
    });

    service = TestBed.inject(PluginBridgeService);
    store = TestBed.inject(MockStore);
    spyOn(store, 'dispatch');
    Log.clearLogHistory();
  });

  afterEach(() => Log.clearLogHistory());

  // Exercises the REAL bridge (not a mock) — the wrapper PluginAPI fix is
  // bypassed if the bridge itself logs the action payload. See rule #9.
  it('does not write the dispatched action payload to the exportable log', () => {
    const SECRET = 'sync-secret-token-abcdef-13579';
    const bound = service.createBoundMethods('test-plugin');

    bound.dispatchAction({
      type: updateGlobalConfigSection.type,
      sectionKey: 'sync',
      sectionCfg: { privateCfg: { encryptKey: SECRET } },
    } as unknown as { type: string; [key: string]: unknown });

    expect(Log.exportLogHistory()).not.toContain(SECRET);
  });

  it('still records the action type for diagnostics', () => {
    const bound = service.createBoundMethods('test-plugin');

    bound.dispatchAction({ type: updateGlobalConfigSection.type } as {
      type: string;
      [key: string]: unknown;
    });

    expect(Log.exportLogHistory()).toContain(updateGlobalConfigSection.type);
  });

  it('uses the English placeholder contract for rejected action types', () => {
    const bound = service.createBoundMethods('test-plugin');
    const type = '[Forbidden] Test Action';

    expect(() => bound.dispatchAction({ type })).toThrowError(
      'Action type is not allowed',
    );
    expect(translateService.instant).toHaveBeenCalledOnceWith(
      T.PLUGINS.ACTION_TYPE_NOT_ALLOWED,
      { type },
    );
  });
});

describe('PluginBridgeService - iframe task selection methods', () => {
  const focusedTask = {
    ...DEFAULT_TASK,
    id: 'focused-task',
    title: 'Focused Task',
    projectId: 'INBOX_PROJECT',
  };
  const selectedTask: TaskWithSubTasks = {
    ...DEFAULT_TASK,
    id: 'selected-task',
    title: 'Selected Task',
    projectId: 'INBOX_PROJECT',
    subTasks: [],
  };

  let service: PluginBridgeService;
  let taskService: jasmine.SpyObj<TaskService>;
  let taskEl: HTMLElement | null = null;
  let activeElementStubbed = false;

  // getFocusedTask() reads the DOM, so a focused <task> has to actually exist.
  // activeElement is stubbed rather than set via el.focus() — headless Chrome
  // only updates it when the test iframe has window focus, which is not
  // guaranteed inside a large suite (same pattern as task-shortcut.service.spec).
  const focusTaskEl = (taskId: string): void => {
    taskEl = document.createElement('task');
    taskEl.setAttribute('data-task-id', taskId);
    document.body.appendChild(taskEl);
    Object.defineProperty(document, 'activeElement', {
      configurable: true,
      get: () => taskEl,
    });
    activeElementStubbed = true;
  };

  afterEach(() => {
    taskEl?.remove();
    taskEl = null;
    if (activeElementStubbed) {
      delete (document as unknown as { activeElement?: unknown }).activeElement;
      activeElementStubbed = false;
    }
  });

  beforeEach(() => {
    taskService = jasmine.createSpyObj<TaskService>('TaskService', ['getByIdOnce$'], {
      allTasks$: of([]),
      selectedTask$: of(selectedTask),
    });
    taskService.getByIdOnce$.and.returnValue(of(focusedTask));

    TestBed.configureTestingModule({
      providers: [
        PluginBridgeService,
        provideMockStore(),
        { provide: SnackService, useValue: {} },
        { provide: NotifyService, useValue: {} },
        { provide: MatDialog, useValue: {} },
        { provide: PluginHooksService, useValue: {} },
        { provide: TaskService, useValue: taskService },
        { provide: WorkContextService, useValue: { activeWorkContext$: of(null) } },
        { provide: ProjectService, useValue: {} },
        { provide: TagService, useValue: {} },
        { provide: TaskRepeatCfgService, useValue: {} },
        { provide: PluginUserPersistenceService, useValue: {} },
        { provide: PluginConfigService, useValue: {} },
        { provide: TaskArchiveService, useValue: {} },
        { provide: Router, useValue: {} },
        { provide: TranslateService, useValue: {} },
        { provide: SyncWrapperService, useValue: {} },
        { provide: GlobalThemeService, useValue: {} },
        { provide: PluginIssueProviderRegistryService, useValue: {} },
        { provide: IssueSyncAdapterRegistryService, useValue: {} },
        { provide: PluginHttpService, useValue: {} },
        { provide: DataInitService, useValue: {} },
      ],
    });

    service = TestBed.inject(PluginBridgeService);
  });

  it('exposes selected and focused task readers on iframe bound methods', async () => {
    focusTaskEl(focusedTask.id);
    const bound = service.createBoundMethods('iframe-plugin');

    const selectedResult = await bound.getSelectedTask();
    const selectedTaskWithoutSubTasks = Object.fromEntries(
      Object.entries(selectedTask).filter(([key]) => key !== 'subTasks'),
    ) as typeof selectedResult;
    expect(selectedResult).toEqual(selectedTaskWithoutSubTasks);
    expect((selectedResult as { subTasks?: unknown } | null)?.subTasks).toBeUndefined();
    await expectAsync(bound.getFocusedTask()).toBeResolvedTo(focusedTask);
    expect(taskService.getByIdOnce$).toHaveBeenCalledOnceWith(focusedTask.id);
  });

  it('returns null for stale focused task ids', async () => {
    focusTaskEl(focusedTask.id);
    taskService.getByIdOnce$.and.returnValue(
      of(undefined as unknown as TaskWithSubTasks),
    );
    const bound = service.createBoundMethods('iframe-plugin');

    await expectAsync(bound.getFocusedTask()).toBeResolvedTo(null);
    expect(taskService.getByIdOnce$).toHaveBeenCalledOnceWith(focusedTask.id);
  });

  // Focus tracking can keep pointing at a task that no longer holds focus after
  // a view change; acting on it would mutate the wrong task (#8851).
  it('returns null when no task row is focused', async () => {
    const bound = service.createBoundMethods('iframe-plugin');

    await expectAsync(bound.getFocusedTask()).toBeResolvedTo(null);
    expect(taskService.getByIdOnce$).not.toHaveBeenCalled();
  });
});

// #9946: deleteTask is the one live entry point that can hand an unknown id to
// TaskService.remove(). The selector used to answer with a truthy id-less stub,
// so this guard did nothing and the delete wiped every top-level task.
describe('PluginBridgeService - deleteTask() with an unknown id', () => {
  let service: PluginBridgeService;
  let taskService: jasmine.SpyObj<TaskService>;
  let store: MockStore;

  beforeEach(() => {
    taskService = jasmine.createSpyObj<TaskService>('TaskService', ['remove'], {
      allTasks$: of([]),
      selectedTask$: of(null),
    });

    TestBed.configureTestingModule({
      providers: [
        PluginBridgeService,
        provideMockStore(),
        { provide: SnackService, useValue: {} },
        { provide: NotifyService, useValue: {} },
        { provide: MatDialog, useValue: {} },
        { provide: PluginHooksService, useValue: {} },
        { provide: TaskService, useValue: taskService },
        { provide: WorkContextService, useValue: { activeWorkContext$: of(null) } },
        { provide: ProjectService, useValue: {} },
        { provide: TagService, useValue: {} },
        { provide: PluginUserPersistenceService, useValue: {} },
        { provide: PluginConfigService, useValue: {} },
        { provide: TaskArchiveService, useValue: {} },
        { provide: Router, useValue: {} },
        { provide: TranslateService, useValue: { instant: () => 'Task not found' } },
        { provide: SyncWrapperService, useValue: {} },
        { provide: GlobalThemeService, useValue: {} },
        { provide: PluginIssueProviderRegistryService, useValue: {} },
        { provide: IssueSyncAdapterRegistryService, useValue: {} },
        { provide: PluginHttpService, useValue: {} },
        { provide: DataInitService, useValue: {} },
      ],
    });

    service = TestBed.inject(PluginBridgeService);
    store = TestBed.inject(MockStore);
  });

  it('throws and removes nothing', async () => {
    store.overrideSelector(selectTaskByIdWithSubTaskData, undefined);

    await expectAsync(service.deleteTask('NO_SUCH_TASK')).toBeRejected();
    expect(taskService.remove).not.toHaveBeenCalled();
  });
});

describe('PluginBridgeService - request()', () => {
  let service: PluginBridgeService;
  let pluginHttpService: jasmine.SpyObj<PluginHttpService>;
  let requestSpy: jasmine.Spy;

  beforeEach(() => {
    requestSpy = jasmine.createSpy('request').and.resolveTo({ ok: true });
    pluginHttpService = jasmine.createSpyObj<PluginHttpService>('PluginHttpService', [
      'createHttpHelper',
    ]);
    pluginHttpService.createHttpHelper.and.returnValue({
      request: requestSpy,
    } as any);

    TestBed.configureTestingModule({
      providers: [
        PluginBridgeService,
        provideMockStore(),
        { provide: SnackService, useValue: {} },
        { provide: NotifyService, useValue: {} },
        { provide: MatDialog, useValue: {} },
        { provide: PluginHooksService, useValue: {} },
        { provide: TaskService, useValue: {} },
        { provide: WorkContextService, useValue: { activeWorkContext$: of(null) } },
        { provide: ProjectService, useValue: {} },
        { provide: TagService, useValue: {} },
        { provide: TaskRepeatCfgService, useValue: {} },
        { provide: PluginUserPersistenceService, useValue: {} },
        { provide: PluginConfigService, useValue: {} },
        { provide: TaskArchiveService, useValue: {} },
        { provide: Router, useValue: {} },
        { provide: TranslateService, useValue: {} },
        { provide: SyncWrapperService, useValue: {} },
        { provide: GlobalThemeService, useValue: {} },
        { provide: PluginIssueProviderRegistryService, useValue: {} },
        { provide: IssueSyncAdapterRegistryService, useValue: {} },
        { provide: PluginHttpService, useValue: pluginHttpService },
        { provide: DataInitService, useValue: {} },
      ],
    });

    service = TestBed.inject(PluginBridgeService);
  });

  const boundFor = (
    allowedHosts?: string[],
    permissions: string[] = ['http'],
  ): { request: <T>(url: string, options?: unknown) => Promise<T> } =>
    service.createBoundMethods('test-plugin', {
      allowedHosts,
      permissions,
    } as any) as any;

  it('routes generic host HTTP requests through PluginHttpService without host auth injection', async () => {
    const bound = boundFor(['example.test']);
    const options = {
      method: 'POST',
      headers: { Authorization: 'Bearer plugin-token' },
      body: { hours: '1.50' },
      timeout: 15000,
    };

    const result = await bound.request<{ ok: boolean }>(
      'https://example.test/timesheet/entries.json',
      options,
    );

    expect(result).toEqual({ ok: true });
    expect(pluginHttpService.createHttpHelper).toHaveBeenCalledTimes(1);
    const getHeaders = pluginHttpService.createHttpHelper.calls.mostRecent().args[0] as
      | (() => Record<string, string>)
      | (() => Promise<Record<string, string>>);
    await expectAsync(Promise.resolve(getHeaders())).toBeResolvedTo({});
    expect(requestSpy).toHaveBeenCalledOnceWith(
      'POST',
      'https://example.test/timesheet/entries.json',
      { hours: '1.50' },
      {
        params: undefined,
        headers: { Authorization: 'Bearer plugin-token' },
        timeout: 15000,
        responseType: undefined,
      },
    );
  });

  it('is fail-closed: rejects when the plugin lacks the "http" permission', async () => {
    // Host is declared, but the http capability is not granted -> blocked before
    // the host check (network egress is an explicit, opt-in capability).
    const bound = boundFor(['example.test'], []);
    await expectAsync(bound.request('https://example.test/x')).toBeRejectedWithError(
      /does not declare the "http" permission/,
    );
    expect(pluginHttpService.createHttpHelper).not.toHaveBeenCalled();
  });

  it('rejects a request to a host not in the manifest allowedHosts', async () => {
    const bound = boundFor(['example.test']);
    await expectAsync(bound.request('https://evil.test/steal')).toBeRejectedWithError(
      /not in the plugin's declared allowedHosts/,
    );
    expect(pluginHttpService.createHttpHelper).not.toHaveBeenCalled();
  });

  it('is fail-closed: rejects when the plugin declares no allowedHosts', async () => {
    const bound = boundFor(undefined);
    await expectAsync(bound.request('https://example.test/x')).toBeRejectedWithError(
      /declares no "allowedHosts"/,
    );
    expect(pluginHttpService.createHttpHelper).not.toHaveBeenCalled();
  });

  it('is fail-closed: rejects when allowedHosts is empty', async () => {
    const bound = boundFor([]);
    await expectAsync(bound.request('https://example.test/x')).toBeRejectedWithError(
      /declares no "allowedHosts"/,
    );
    expect(pluginHttpService.createHttpHelper).not.toHaveBeenCalled();
  });

  it('matches hosts case-insensitively and tolerates a trailing dot', async () => {
    const bound = boundFor(['Example.Test']);
    await bound.request('https://example.test./x');
    expect(requestSpy).toHaveBeenCalled();
  });

  it('resolves the real host from userinfo tricks (blocks https://allowed@evil)', async () => {
    const bound = boundFor(['example.test']);
    await expectAsync(
      bound.request('https://example.test@evil.test/x'),
    ).toBeRejectedWithError(/"evil\.test" is blocked/);
    expect(pluginHttpService.createHttpHelper).not.toHaveBeenCalled();
  });
});

describe('PluginBridgeService - openDialog', () => {
  let service: PluginBridgeService;
  let matDialog: jasmine.SpyObj<MatDialog>;

  beforeEach(() => {
    matDialog = jasmine.createSpyObj('MatDialog', ['open']);

    TestBed.configureTestingModule({
      providers: [
        PluginBridgeService,
        provideMockStore(),
        { provide: SnackService, useValue: {} },
        { provide: NotifyService, useValue: {} },
        { provide: MatDialog, useValue: matDialog },
        { provide: PluginHooksService, useValue: {} },
        { provide: TaskService, useValue: {} },
        { provide: WorkContextService, useValue: { activeWorkContext$: of(null) } },
        { provide: ProjectService, useValue: {} },
        { provide: TagService, useValue: {} },
        { provide: TaskRepeatCfgService, useValue: {} },
        { provide: PluginUserPersistenceService, useValue: {} },
        { provide: PluginConfigService, useValue: {} },
        { provide: TaskArchiveService, useValue: {} },
        { provide: Router, useValue: {} },
        { provide: TranslateService, useValue: {} },
        { provide: SyncWrapperService, useValue: {} },
        { provide: GlobalThemeService, useValue: {} },
        { provide: PluginIssueProviderRegistryService, useValue: {} },
        { provide: IssueSyncAdapterRegistryService, useValue: {} },
        { provide: PluginHttpService, useValue: {} },
        { provide: DataInitService, useValue: {} },
      ],
    });

    service = TestBed.inject(PluginBridgeService);
  });

  it('resolves with the dialog close result', async () => {
    matDialog.open.and.returnValue({
      afterClosed: () => of('Confirm'),
    } as unknown as MatDialogRef<PluginDialogComponent>);

    const dialogCfg = {
      htmlContent: '<p>Continue?</p>',
      buttons: [{ label: 'Confirm' }],
    };

    const result = await service.openDialog(dialogCfg);

    expect(result).toBe('Confirm');
    expect(matDialog.open).toHaveBeenCalledOnceWith(
      PluginDialogComponent,
      jasmine.objectContaining({
        data: dialogCfg,
        autoFocus: true,
        restoreFocus: true,
        disableClose: false,
        closeOnNavigation: false,
      }),
    );
  });

  it('resolves with undefined when the dialog is dismissed', async () => {
    matDialog.open.and.returnValue({
      afterClosed: () => of(undefined),
    } as unknown as MatDialogRef<PluginDialogComponent>);

    const result = await service.openDialog({
      htmlContent: '<p>Continue?</p>',
    });

    expect(result).toBeUndefined();
  });
});

describe('PluginBridgeService - nodeExecution grant tokens', () => {
  let service: PluginBridgeService;
  let originalElectronApi: typeof window.ea | undefined;
  let pluginExecNodeScriptSpy: jasmine.Spy;
  let clearConsentSpy: jasmine.Spy;
  let consumePluginNodeExecutionApiSpy: jasmine.Spy;

  beforeEach(() => {
    originalElectronApi = window.ea;
    pluginExecNodeScriptSpy = jasmine.createSpy('pluginExecNodeScript');
    clearConsentSpy = jasmine.createSpy('clearConsent').and.resolveTo(undefined);
    consumePluginNodeExecutionApiSpy = jasmine
      .createSpy('consumePluginNodeExecutionApi')
      .and.returnValue({
        requestGrant: jasmine.createSpy('requestGrant'),
        executeScript: pluginExecNodeScriptSpy,
        revokeGrant: jasmine.createSpy('revokeGrant'),
        clearConsent: clearConsentSpy,
      });
    window.ea = {
      ...(window.ea ?? {}),
      consumePluginNodeExecutionApi: consumePluginNodeExecutionApiSpy,
    } as typeof window.ea;

    TestBed.configureTestingModule({
      providers: [
        PluginBridgeService,
        provideMockStore(),
        { provide: SnackService, useValue: {} },
        { provide: NotifyService, useValue: {} },
        { provide: MatDialog, useValue: {} },
        { provide: PluginHooksService, useValue: {} },
        { provide: TaskService, useValue: {} },
        { provide: WorkContextService, useValue: { activeWorkContext$: of(null) } },
        { provide: ProjectService, useValue: {} },
        { provide: TagService, useValue: {} },
        { provide: TaskRepeatCfgService, useValue: {} },
        { provide: PluginUserPersistenceService, useValue: {} },
        { provide: PluginConfigService, useValue: {} },
        { provide: TaskArchiveService, useValue: {} },
        { provide: Router, useValue: {} },
        {
          provide: TranslateService,
          useValue: { instant: (key: string): string => key },
        },
        { provide: SyncWrapperService, useValue: {} },
        { provide: GlobalThemeService, useValue: {} },
        { provide: PluginIssueProviderRegistryService, useValue: {} },
        { provide: IssueSyncAdapterRegistryService, useValue: {} },
        { provide: PluginHttpService, useValue: {} },
        { provide: DataInitService, useValue: {} },
      ],
    });

    service = TestBed.inject(PluginBridgeService);
  });

  afterEach(() => {
    window.ea = originalElectronApi as typeof window.ea;
  });

  it('stores and revokes nodeExecution grant tokens internally', () => {
    expect(consumePluginNodeExecutionApiSpy).toHaveBeenCalledTimes(1);

    service.setNodeExecutionGrantToken('node-plugin', 'token-1');

    expect(service.hasNodeExecutionGrantToken('node-plugin')).toBeTrue();
    expect(service.getNodeExecutionGrantToken('node-plugin')).toBe('token-1');
    expect(service.revokeNodeExecutionGrantToken('node-plugin')).toBe('token-1');
    expect(service.hasNodeExecutionGrantToken('node-plugin')).toBeFalse();
  });

  it('clearNodeExecutionConsent drops the local token and asks main to clear consent', async () => {
    service.setNodeExecutionGrantToken('node-plugin', 'token-1');
    expect(service.hasNodeExecutionGrantToken('node-plugin')).toBeTrue();

    await service.clearNodeExecutionConsent('node-plugin');

    expect(service.hasNodeExecutionGrantToken('node-plugin')).toBeFalse();
    expect(clearConsentSpy).toHaveBeenCalledOnceWith('node-plugin');
  });

  it('does not call Electron node execution in a web runtime', async () => {
    service.setNodeExecutionGrantToken('node-plugin', 'token-1');
    const bound = service.createBoundMethods('node-plugin', {
      id: 'node-plugin',
      name: 'Node Plugin',
      manifestVersion: 1,
      version: '1.0.0',
      minSupVersion: '1.0.0',
      permissions: ['nodeExecution'],
      hooks: [],
    });

    const result = await bound.executeNodeScript({ script: 'return true' });

    expect(result).toEqual({
      success: false,
      error: T.PLUGINS.NODE_ONLY_DESKTOP,
    });
    expect(pluginExecNodeScriptSpy).not.toHaveBeenCalled();
  });

  it('passes the stored grant token to Electron node execution', async () => {
    const runtime = service as unknown as { _isElectronRuntime: () => boolean };
    spyOn(runtime, '_isElectronRuntime').and.returnValue(true);
    const request = { script: 'return 42' };
    const electronResult = { success: true, result: 42 };
    pluginExecNodeScriptSpy.and.resolveTo(electronResult);
    service.setNodeExecutionGrantToken('node-plugin', 'token-1');
    const bound = service.createBoundMethods('node-plugin', {
      id: 'node-plugin',
      name: 'Node Plugin',
      manifestVersion: 1,
      version: '1.0.0',
      minSupVersion: '1.0.0',
      permissions: ['nodeExecution'],
      hooks: [],
    });

    await expectAsync(bound.executeNodeScript(request)).toBeResolvedTo(electronResult);
    expect(pluginExecNodeScriptSpy).toHaveBeenCalledOnceWith(
      'node-plugin',
      'token-1',
      request,
    );
  });
});

describe('PluginBridgeService - getAppState credential redaction', () => {
  let service: PluginBridgeService;
  let store: MockStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        PluginBridgeService,
        provideMockStore(),
        { provide: SnackService, useValue: {} },
        { provide: NotifyService, useValue: {} },
        { provide: MatDialog, useValue: {} },
        { provide: PluginHooksService, useValue: {} },
        { provide: TaskService, useValue: {} },
        { provide: WorkContextService, useValue: { activeWorkContext$: of(null) } },
        { provide: ProjectService, useValue: {} },
        { provide: TagService, useValue: {} },
        { provide: TaskRepeatCfgService, useValue: {} },
        { provide: PluginUserPersistenceService, useValue: {} },
        { provide: PluginConfigService, useValue: {} },
        { provide: TaskArchiveService, useValue: {} },
        { provide: Router, useValue: {} },
        { provide: TranslateService, useValue: {} },
        { provide: SyncWrapperService, useValue: {} },
        { provide: GlobalThemeService, useValue: {} },
        { provide: PluginIssueProviderRegistryService, useValue: {} },
        { provide: IssueSyncAdapterRegistryService, useValue: {} },
        { provide: PluginHttpService, useValue: {} },
        { provide: DataInitService, useValue: {} },
      ],
    });

    service = TestBed.inject(PluginBridgeService);
    store = TestBed.inject(MockStore);
  });

  it('drops sync, misc.unsplashApiKey, and project.issueIntegrationCfgs', async () => {
    store.setState({
      tasks: { entities: {}, ids: [] },
      projects: {
        entities: {
          'p-1': {
            id: 'p-1',
            title: 'Work',
            issueIntegrationCfgs: {
              JIRA: { password: 'JIRA-PWD' },
              GITLAB: { token: 'GITLAB-TOKEN' },
            },
          },
        },
        ids: ['p-1'],
      },
      tag: { entities: {}, ids: [] },
      note: { entities: {}, ids: [], todayOrder: [] },
      taskRepeatCfg: { entities: {}, ids: [] },
      simpleCounter: { entities: {}, ids: [] },
      globalConfig: {
        misc: { isDarkMode: false, unsplashApiKey: 'UNSPLASH-KEY' },
        sync: {
          encryptKey: 'ENCRYPT-KEY',
          webDav: { password: 'WEBDAV-PWD' },
        },
      },
    });

    const snapshot = await service.getAppState();
    const json = JSON.stringify(snapshot);

    // Sentinels from the seeded credential surfaces must not appear anywhere.
    expect(json).not.toContain('JIRA-PWD');
    expect(json).not.toContain('GITLAB-TOKEN');
    expect(json).not.toContain('UNSPLASH-KEY');
    expect(json).not.toContain('ENCRYPT-KEY');
    expect(json).not.toContain('WEBDAV-PWD');

    expect(snapshot.globalConfig.sync).toBeUndefined();
    expect((snapshot.globalConfig.misc as Record<string, unknown>).unsplashApiKey).toBe(
      undefined,
    );
    expect(
      (snapshot.projects['p-1'] as Record<string, unknown>).issueIntegrationCfgs,
    ).toBe(undefined);

    // Non-sensitive data still flows through.
    expect(snapshot.projects['p-1'].title).toBe('Work');
    expect((snapshot.globalConfig.misc as Record<string, unknown>).isDarkMode).toBe(
      false,
    );
  });
});

describe('PluginBridgeService - deleteProject', () => {
  let service: PluginBridgeService;
  let projectServiceSpy: jasmine.SpyObj<ProjectService>;

  const mockProject = { id: 'project-1', title: 'Work' } as Project;

  beforeEach(() => {
    projectServiceSpy = jasmine.createSpyObj('ProjectService', [
      'getByIdOnce$',
      'remove',
    ]);
    projectServiceSpy.getByIdOnce$.and.returnValue(of(mockProject));
    projectServiceSpy.remove.and.resolveTo();

    TestBed.configureTestingModule({
      providers: [
        PluginBridgeService,
        provideMockStore(),
        { provide: SnackService, useValue: {} },
        { provide: NotifyService, useValue: {} },
        { provide: MatDialog, useValue: {} },
        { provide: PluginHooksService, useValue: {} },
        { provide: TaskService, useValue: {} },
        { provide: WorkContextService, useValue: { activeWorkContext$: of(null) } },
        { provide: ProjectService, useValue: projectServiceSpy },
        { provide: TagService, useValue: {} },
        { provide: TaskRepeatCfgService, useValue: {} },
        { provide: PluginUserPersistenceService, useValue: {} },
        { provide: PluginConfigService, useValue: {} },
        { provide: TaskArchiveService, useValue: {} },
        { provide: Router, useValue: {} },
        {
          provide: TranslateService,
          useValue: { instant: (key: string): string => key },
        },
        { provide: SyncWrapperService, useValue: {} },
        { provide: GlobalThemeService, useValue: {} },
        { provide: PluginIssueProviderRegistryService, useValue: {} },
        { provide: IssueSyncAdapterRegistryService, useValue: {} },
        { provide: PluginHttpService, useValue: {} },
        { provide: DataInitService, useValue: {} },
      ],
    });

    service = TestBed.inject(PluginBridgeService);
  });

  it('deletes via ProjectService so the cascade stays in one place', async () => {
    await service.deleteProject('project-1', ['deleteProject']);

    expect(projectServiceSpy.remove).toHaveBeenCalledOnceWith(mockProject);
  });

  it('refuses to delete the Inbox', async () => {
    await expectAsync(
      service.deleteProject(INBOX_PROJECT.id, ['deleteProject']),
    ).toBeRejectedWithError(T.PLUGINS.CANNOT_DELETE_INBOX);

    expect(projectServiceSpy.remove).not.toHaveBeenCalled();
  });

  it('throws for an unknown project instead of removing nothing silently', async () => {
    projectServiceSpy.getByIdOnce$.and.returnValue(of(undefined as unknown as Project));

    await expectAsync(
      service.deleteProject('does-not-exist', ['deleteProject']),
    ).toBeRejectedWithError(T.PLUGINS.PROJECT_NOT_FOUND);

    expect(projectServiceSpy.remove).not.toHaveBeenCalled();
  });

  it('rejects a plugin that does not declare the deleteProject permission', async () => {
    await expectAsync(service.deleteProject('project-1')).toBeRejectedWithError(
      /does not declare the "deleteProject" permission/,
    );

    expect(projectServiceSpy.remove).not.toHaveBeenCalled();
  });

  it('passes the manifest permissions through the bound method', async () => {
    const granted = service.createBoundMethods('plugin-a', {
      permissions: ['deleteProject'],
    } as PluginManifest);
    await granted.deleteProject('project-1');

    expect(projectServiceSpy.remove).toHaveBeenCalledOnceWith(mockProject);

    // Same call shape, manifest without the capability: the bridge must still refuse,
    // which is what keeps iframe plugins (routed through boundMethods) gated.
    const ungranted = service.createBoundMethods('plugin-b', {
      permissions: [],
    } as unknown as PluginManifest);

    await expectAsync(ungranted.deleteProject('project-1')).toBeRejectedWithError(
      /does not declare the "deleteProject" permission/,
    );
  });
});

describe('PluginBridgeService - Task Repeat Cfg Methods', () => {
  let service: PluginBridgeService;
  let taskRepeatCfgServiceSpy: jasmine.SpyObj<TaskRepeatCfgService>;
  let taskServiceMock: { getByIdOnce$: jasmine.Spy };

  const TASK = {
    ...DEFAULT_TASK,
    id: 'task-1',
    title: 'Water the plants',
    projectId: 'project-1',
    tagIds: ['tag-1'],
    timeEstimate: 900000,
    notes: 'the big one on the balcony',
    dueDay: '2026-03-02',
  };

  const lastCfg = (): TaskRepeatCfgCopy =>
    taskRepeatCfgServiceSpy.addTaskRepeatCfgToTask.calls.mostRecent()
      .args[2] as TaskRepeatCfgCopy;

  beforeEach(() => {
    taskRepeatCfgServiceSpy = jasmine.createSpyObj('TaskRepeatCfgService', [
      'addTaskRepeatCfgToTask',
      'updateTaskRepeatCfg',
      'deleteTaskRepeatCfg',
      'getTaskRepeatCfgByIdAllowUndefined$',
    ]);
    taskRepeatCfgServiceSpy.addTaskRepeatCfgToTask.and.returnValue('repeat-cfg-1');
    taskServiceMock = { getByIdOnce$: jasmine.createSpy('getByIdOnce$') };
    taskServiceMock.getByIdOnce$.and.returnValue(of(TASK));

    TestBed.configureTestingModule({
      providers: [
        PluginBridgeService,
        provideMockStore(),
        { provide: SnackService, useValue: {} },
        { provide: NotifyService, useValue: {} },
        { provide: MatDialog, useValue: {} },
        { provide: PluginHooksService, useValue: {} },
        { provide: TaskService, useValue: taskServiceMock },
        { provide: WorkContextService, useValue: { activeWorkContext$: of(null) } },
        { provide: ProjectService, useValue: {} },
        { provide: TagService, useValue: {} },
        { provide: TaskRepeatCfgService, useValue: taskRepeatCfgServiceSpy },
        {
          provide: GlobalConfigService,
          useValue: { cfg: () => DEFAULT_GLOBAL_CONFIG },
        },
        { provide: PluginUserPersistenceService, useValue: {} },
        { provide: PluginConfigService, useValue: {} },
        { provide: TaskArchiveService, useValue: {} },
        { provide: Router, useValue: {} },
        { provide: TranslateService, useValue: { instant: (key: string) => key } },
        { provide: SyncWrapperService, useValue: {} },
        { provide: GlobalThemeService, useValue: {} },
        { provide: PluginIssueProviderRegistryService, useValue: {} },
        { provide: IssueSyncAdapterRegistryService, useValue: {} },
        { provide: PluginHttpService, useValue: {} },
        { provide: DataInitService, useValue: {} },
      ],
    });

    service = TestBed.inject(PluginBridgeService);
  });

  describe('addTaskRepeatCfg', () => {
    it('repeats daily when the caller passes no cfg', async () => {
      const id = await service.addTaskRepeatCfg('task-1');

      expect(id).toBe('repeat-cfg-1');
      const cfg = lastCfg();
      expect(cfg.repeatCycle).toBe('DAILY');
      expect(cfg.repeatEvery).toBe(1);
      expect(cfg.quickSetting).toBe('CUSTOM');
      // Same seed the dialog's Daily preset gets.
      expect(cfg.skipOverdue).toBeTrue();
    });

    it('inherits project, title, tags, notes and estimate from the task', async () => {
      const id = await service.addTaskRepeatCfg('task-1', {
        repeatCycle: 'WEEKLY',
        monday: true,
      });

      expect(id).toBe('repeat-cfg-1');
      const [taskId, projectId] =
        taskRepeatCfgServiceSpy.addTaskRepeatCfgToTask.calls.mostRecent().args;
      expect(taskId).toBe('task-1');
      expect(projectId).toBe('project-1');
      expect(lastCfg().title).toBe('Water the plants');
      expect(lastCfg().tagIds).toEqual(['tag-1']);
      expect(lastCfg().notes).toBe('the big one on the balcony');
      expect(lastCfg().defaultEstimate).toBe(900000);
    });

    it('stores CUSTOM and does not inherit the Mon-Fri default mask', async () => {
      await service.addTaskRepeatCfg('task-1', {
        repeatCycle: 'WEEKLY',
        saturday: true,
      });

      const cfg = lastCfg();
      expect(cfg.quickSetting).toBe('CUSTOM');
      expect(cfg.saturday).toBeTrue();
      expect(cfg.monday).toBeFalse();
      expect(cfg.tuesday).toBeFalse();
      expect(cfg.wednesday).toBeFalse();
      expect(cfg.thursday).toBeFalse();
      expect(cfg.friday).toBeFalse();
      expect(cfg.sunday).toBeFalse();
    });

    it('seeds startDate from the task, so nothing anchors to 1970', async () => {
      await service.addTaskRepeatCfg('task-1', {
        repeatCycle: 'MONTHLY',
      });
      expect(lastCfg().startDate).toBe('2026-03-02');

      await service.addTaskRepeatCfg('task-1', {
        repeatCycle: 'MONTHLY',
        startDate: '2026-04-15',
      });
      expect(lastCfg().startDate).toBe('2026-04-15');
    });

    it('seeds remindAt when a startTime is given, otherwise leaves it unset', async () => {
      await service.addTaskRepeatCfg('task-1', {
        repeatCycle: 'DAILY',
        startTime: '09:00',
      });
      expect(lastCfg().remindAt).toBe(
        DEFAULT_GLOBAL_CONFIG.reminder.defaultTaskRemindOption,
      );

      await service.addTaskRepeatCfg('task-1', { repeatCycle: 'DAILY' });
      expect(lastCfg().remindAt).toBeUndefined();
    });

    it('turns skipOverdue on for every-day only', async () => {
      await service.addTaskRepeatCfg('task-1', {
        repeatCycle: 'DAILY',
        repeatEvery: 1,
      });
      expect(lastCfg().skipOverdue).toBeTrue();

      await service.addTaskRepeatCfg('task-1', {
        repeatCycle: 'WEEKLY',
        monday: true,
      });
      expect(lastCfg().skipOverdue).toBeFalse();

      await service.addTaskRepeatCfg('task-1', {
        repeatCycle: 'DAILY',
        repeatEvery: 3,
      });
      expect(lastCfg().skipOverdue).toBeFalse();
    });

    it('ignores an undefined required field instead of storing it', async () => {
      await service.addTaskRepeatCfg('task-1', {
        repeatCycle: 'DAILY',
        repeatEvery: undefined,
        isPaused: undefined,
      });

      expect(lastCfg().repeatEvery).toBe(1);
      expect(lastCfg().isPaused).toBeFalse();
    });

    it('rejects a weekly config with no weekday, which would never fire', async () => {
      await expectAsync(
        service.addTaskRepeatCfg('task-1', { repeatCycle: 'WEEKLY' }),
      ).toBeRejectedWithError(T.PLUGINS.TASK_REPEAT_CFG_INVALID);
      expect(taskRepeatCfgServiceSpy.addTaskRepeatCfgToTask).not.toHaveBeenCalled();
    });

    it('rejects a repeatEvery the dialog form would not accept', async () => {
      await expectAsync(
        service.addTaskRepeatCfg('task-1', { repeatCycle: 'DAILY', repeatEvery: 0 }),
      ).toBeRejectedWithError(T.PLUGINS.TASK_REPEAT_CFG_INVALID);
      await expectAsync(
        service.addTaskRepeatCfg('task-1', { repeatCycle: 'DAILY', repeatEvery: 1001 }),
      ).toBeRejectedWithError(T.PLUGINS.TASK_REPEAT_CFG_INVALID);
      expect(taskRepeatCfgServiceSpy.addTaskRepeatCfgToTask).not.toHaveBeenCalled();
    });

    it('rejects an unknown task', async () => {
      taskServiceMock.getByIdOnce$.and.returnValue(of(undefined));
      await expectAsync(service.addTaskRepeatCfg('nope')).toBeRejectedWithError(
        T.PLUGINS.TASK_NOT_FOUND,
      );
      expect(taskRepeatCfgServiceSpy.addTaskRepeatCfgToTask).not.toHaveBeenCalled();
    });

    it('rejects a subtask, which the UI cannot make repeat either', async () => {
      taskServiceMock.getByIdOnce$.and.returnValue(of({ ...TASK, parentId: 'parent-1' }));
      await expectAsync(service.addTaskRepeatCfg('task-1')).toBeRejectedWithError(
        T.PLUGINS.TASK_CANNOT_REPEAT,
      );
      expect(taskRepeatCfgServiceSpy.addTaskRepeatCfgToTask).not.toHaveBeenCalled();
    });

    it('rejects an issue task', async () => {
      taskServiceMock.getByIdOnce$.and.returnValue(of({ ...TASK, issueId: 'JIRA-1' }));
      await expectAsync(service.addTaskRepeatCfg('task-1')).toBeRejectedWithError(
        T.PLUGINS.TASK_CANNOT_REPEAT,
      );
    });

    it('rejects a task that already repeats, rather than orphaning its config', async () => {
      taskServiceMock.getByIdOnce$.and.returnValue(
        of({ ...TASK, repeatCfgId: 'repeat-cfg-0' }),
      );
      await expectAsync(service.addTaskRepeatCfg('task-1')).toBeRejectedWithError(
        T.PLUGINS.TASK_ALREADY_REPEATING,
      );
      expect(taskRepeatCfgServiceSpy.addTaskRepeatCfgToTask).not.toHaveBeenCalled();
    });
  });

  describe('updateTaskRepeatCfg', () => {
    beforeEach(() => {
      taskRepeatCfgServiceSpy.getTaskRepeatCfgByIdAllowUndefined$.and.returnValue(
        of({ id: 'repeat-cfg-1' } as unknown as TaskRepeatCfg),
      );
    });

    it('updates without asking to update existing task instances', async () => {
      await service.updateTaskRepeatCfg('repeat-cfg-1', { isPaused: true });

      expect(taskRepeatCfgServiceSpy.updateTaskRepeatCfg).toHaveBeenCalledOnceWith(
        'repeat-cfg-1',
        { isPaused: true },
        false,
      );
    });

    it('drops app-owned fields instead of letting them re-key the entity', async () => {
      await service.updateTaskRepeatCfg('repeat-cfg-1', {
        isPaused: true,
        id: 'other-id',
        projectId: 'other-project',
        quickSetting: 'MONTHLY_LAST_DAY',
      } as never);

      expect(taskRepeatCfgServiceSpy.updateTaskRepeatCfg).toHaveBeenCalledOnceWith(
        'repeat-cfg-1',
        { isPaused: true },
        false,
      );
    });

    it('seeds remindAt when a startTime lands on a config that has none', async () => {
      await service.updateTaskRepeatCfg('repeat-cfg-1', { startTime: '09:00' });

      expect(taskRepeatCfgServiceSpy.updateTaskRepeatCfg).toHaveBeenCalledOnceWith(
        'repeat-cfg-1',
        {
          startTime: '09:00',
          remindAt: DEFAULT_GLOBAL_CONFIG.reminder.defaultTaskRemindOption,
        },
        false,
      );
    });

    it('leaves an existing remindAt alone when the startTime changes', async () => {
      taskRepeatCfgServiceSpy.getTaskRepeatCfgByIdAllowUndefined$.and.returnValue(
        of({
          id: 'repeat-cfg-1',
          remindAt: TaskReminderOptionId.m15,
        } as unknown as TaskRepeatCfg),
      );

      await service.updateTaskRepeatCfg('repeat-cfg-1', { startTime: '10:00' });

      expect(taskRepeatCfgServiceSpy.updateTaskRepeatCfg).toHaveBeenCalledOnceWith(
        'repeat-cfg-1',
        { startTime: '10:00' },
        false,
      );
    });

    it('does not touch remindAt for an update that sets no startTime', async () => {
      await service.updateTaskRepeatCfg('repeat-cfg-1', { repeatEvery: 3 });
      expect(taskRepeatCfgServiceSpy.updateTaskRepeatCfg).toHaveBeenCalledOnceWith(
        'repeat-cfg-1',
        { repeatEvery: 3 },
        false,
      );

      taskRepeatCfgServiceSpy.updateTaskRepeatCfg.calls.reset();
      await service.updateTaskRepeatCfg('repeat-cfg-1', { startTime: undefined });
      expect(taskRepeatCfgServiceSpy.updateTaskRepeatCfg).toHaveBeenCalledOnceWith(
        'repeat-cfg-1',
        { startTime: undefined },
        false,
      );
    });

    it('treats an undefined required field as absent, not as a clear', async () => {
      await service.updateTaskRepeatCfg('repeat-cfg-1', {
        isPaused: true,
        repeatEvery: undefined,
        repeatCycle: undefined,
        title: undefined,
        tagIds: undefined,
      });

      const changes = taskRepeatCfgServiceSpy.updateTaskRepeatCfg.calls.mostRecent()
        .args[1] as Record<string, unknown>;
      expect(changes.isPaused).toBeTrue();
      expect('repeatEvery' in changes).toBeFalse();
      expect('repeatCycle' in changes).toBeFalse();
      expect('title' in changes).toBeFalse();
      expect('tagIds' in changes).toBeFalse();
    });

    it('still clears the optional fields a plugin may legitimately drop', async () => {
      await service.updateTaskRepeatCfg('repeat-cfg-1', {
        notes: undefined,
        defaultEstimate: undefined,
        startDate: undefined,
        startTime: undefined,
        monthlyWeekOfMonth: undefined,
        monthlyWeekday: undefined,
        monthlyLastDay: undefined,
      });

      const changes = taskRepeatCfgServiceSpy.updateTaskRepeatCfg.calls.mostRecent()
        .args[1] as Record<string, unknown>;
      for (const field of [
        'notes',
        'defaultEstimate',
        'startDate',
        'startTime',
        'monthlyWeekOfMonth',
        'monthlyWeekday',
        'monthlyLastDay',
      ]) {
        expect(field in changes).toBeTrue();
        expect(changes[field]).toBeUndefined();
      }
    });

    it('clears a title through null, the value the model allows', async () => {
      await service.updateTaskRepeatCfg('repeat-cfg-1', { title: null });

      expect(taskRepeatCfgServiceSpy.updateTaskRepeatCfg).toHaveBeenCalledOnceWith(
        'repeat-cfg-1',
        { title: null },
        false,
      );
    });

    it('rejects a repeatEvery out of range', async () => {
      await expectAsync(
        service.updateTaskRepeatCfg('repeat-cfg-1', { repeatEvery: 0 }),
      ).toBeRejectedWithError(T.PLUGINS.TASK_REPEAT_CFG_INVALID);
      expect(taskRepeatCfgServiceSpy.updateTaskRepeatCfg).not.toHaveBeenCalled();
    });

    it('rejects a switch to weekly on a config that has no weekday', async () => {
      taskRepeatCfgServiceSpy.getTaskRepeatCfgByIdAllowUndefined$.and.returnValue(
        of({
          id: 'repeat-cfg-1',
          quickSetting: 'CUSTOM',
          repeatCycle: 'DAILY',
          monday: false,
          tuesday: false,
          wednesday: false,
          thursday: false,
          friday: false,
          saturday: false,
          sunday: false,
        } as unknown as TaskRepeatCfg),
      );

      await expectAsync(
        service.updateTaskRepeatCfg('repeat-cfg-1', { repeatCycle: 'WEEKLY' }),
      ).toBeRejectedWithError(T.PLUGINS.TASK_REPEAT_CFG_INVALID);
      expect(taskRepeatCfgServiceSpy.updateTaskRepeatCfg).not.toHaveBeenCalled();
    });

    it('rejects clearing the last remaining weekday of a weekly config', async () => {
      taskRepeatCfgServiceSpy.getTaskRepeatCfgByIdAllowUndefined$.and.returnValue(
        of({
          id: 'repeat-cfg-1',
          quickSetting: 'CUSTOM',
          repeatCycle: 'WEEKLY',
          monday: true,
        } as unknown as TaskRepeatCfg),
      );

      await expectAsync(
        service.updateTaskRepeatCfg('repeat-cfg-1', { monday: false }),
      ).toBeRejectedWithError(T.PLUGINS.TASK_REPEAT_CFG_INVALID);
      expect(taskRepeatCfgServiceSpy.updateTaskRepeatCfg).not.toHaveBeenCalled();
    });

    it('accepts clearing a weekday while another one remains', async () => {
      taskRepeatCfgServiceSpy.getTaskRepeatCfgByIdAllowUndefined$.and.returnValue(
        of({
          id: 'repeat-cfg-1',
          quickSetting: 'CUSTOM',
          repeatCycle: 'WEEKLY',
          monday: true,
          friday: true,
        } as unknown as TaskRepeatCfg),
      );

      await service.updateTaskRepeatCfg('repeat-cfg-1', { monday: false });

      expect(taskRepeatCfgServiceSpy.updateTaskRepeatCfg).toHaveBeenCalledOnceWith(
        'repeat-cfg-1',
        { monday: false },
        false,
      );
    });

    it('rejects an unknown config', async () => {
      taskRepeatCfgServiceSpy.getTaskRepeatCfgByIdAllowUndefined$.and.returnValue(
        of(undefined),
      );

      await expectAsync(
        service.updateTaskRepeatCfg('nope', { isPaused: true }),
      ).toBeRejectedWithError(T.PLUGINS.TASK_REPEAT_CFG_NOT_FOUND);
      expect(taskRepeatCfgServiceSpy.updateTaskRepeatCfg).not.toHaveBeenCalled();
    });
  });

  describe('deleteTaskRepeatCfg', () => {
    beforeEach(() => {
      taskRepeatCfgServiceSpy.getTaskRepeatCfgByIdAllowUndefined$.and.returnValue(
        of({ id: 'repeat-cfg-1' } as unknown as TaskRepeatCfg),
      );
    });

    it('deletes via the shared action, which also detaches the tasks it created', async () => {
      await service.deleteTaskRepeatCfg('repeat-cfg-1', ['deleteTaskRepeatCfg']);

      expect(taskRepeatCfgServiceSpy.deleteTaskRepeatCfg).toHaveBeenCalledOnceWith(
        'repeat-cfg-1',
      );
    });

    it('rejects an unknown config instead of dispatching a no-op delete', async () => {
      taskRepeatCfgServiceSpy.getTaskRepeatCfgByIdAllowUndefined$.and.returnValue(
        of(undefined),
      );

      await expectAsync(
        service.deleteTaskRepeatCfg('nope', ['deleteTaskRepeatCfg']),
      ).toBeRejectedWithError(T.PLUGINS.TASK_REPEAT_CFG_NOT_FOUND);
      expect(taskRepeatCfgServiceSpy.deleteTaskRepeatCfg).not.toHaveBeenCalled();
    });

    it('rejects a plugin that does not declare the deleteTaskRepeatCfg permission', async () => {
      await expectAsync(
        service.deleteTaskRepeatCfg('repeat-cfg-1'),
      ).toBeRejectedWithError(/does not declare the "deleteTaskRepeatCfg" permission/);
      expect(taskRepeatCfgServiceSpy.deleteTaskRepeatCfg).not.toHaveBeenCalled();
    });

    it('passes the manifest permissions through the bound method', async () => {
      const granted = service.createBoundMethods('plugin-a', {
        permissions: ['deleteTaskRepeatCfg'],
      } as PluginManifest);
      await granted.deleteTaskRepeatCfg('repeat-cfg-1');

      expect(taskRepeatCfgServiceSpy.deleteTaskRepeatCfg).toHaveBeenCalledOnceWith(
        'repeat-cfg-1',
      );

      // Same call shape, manifest without the capability: the bridge must still
      // refuse, which is what keeps iframe plugins (routed through boundMethods) gated.
      const ungranted = service.createBoundMethods('plugin-b', {
        permissions: [],
      } as unknown as PluginManifest);

      await expectAsync(
        ungranted.deleteTaskRepeatCfg('repeat-cfg-1'),
      ).toBeRejectedWithError(/does not declare the "deleteTaskRepeatCfg" permission/);
    });
  });
});
