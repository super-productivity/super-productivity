/* eslint-disable @typescript-eslint/naming-convention */
// Active tests for setCounter fix (issue #5812)
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { of } from 'rxjs';
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
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { PluginHooksService } from './plugin-hooks';
import { TaskService } from '../features/tasks/task.service';
import { TaskFocusService } from '../features/tasks/task-focus.service';
import { DEFAULT_TASK, TaskWithSubTasks } from '../features/tasks/task.model';
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
        {
          provide: TaskFocusService,
          useValue: {
            focusedTaskId: signal<string | null>(focusedTask.id),
          },
        },
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
    taskService.getByIdOnce$.and.returnValue(
      of(undefined as unknown as TaskWithSubTasks),
    );
    const bound = service.createBoundMethods('iframe-plugin');

    await expectAsync(bound.getFocusedTask()).toBeResolvedTo(null);
    expect(taskService.getByIdOnce$).toHaveBeenCalledOnceWith(focusedTask.id);
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
        { provide: TaskFocusService, useValue: {} },
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

    it('rejects a repeatEvery out of range', async () => {
      await expectAsync(
        service.updateTaskRepeatCfg('repeat-cfg-1', { repeatEvery: 0 }),
      ).toBeRejectedWithError(T.PLUGINS.TASK_REPEAT_CFG_INVALID);
      expect(taskRepeatCfgServiceSpy.updateTaskRepeatCfg).not.toHaveBeenCalled();
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
});
