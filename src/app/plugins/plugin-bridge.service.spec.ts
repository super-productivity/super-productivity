/* eslint-disable @typescript-eslint/naming-convention */
// Active tests for setCounter fix (issue #5812)
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
import { GlobalThemeService } from '../core/theme/global-theme.service';
import { PluginIssueProviderRegistryService } from './issue-provider/plugin-issue-provider-registry.service';
import { IssueSyncAdapterRegistryService } from '../features/issue/two-way-sync/issue-sync-adapter-registry.service';
import { PluginHttpService } from './issue-provider/plugin-http.service';
import { getDbDateStr } from '../util/get-db-date-str';
import { DataInitService } from '../core/data-init/data-init.service';
import { Log } from '../core/log';
import { updateGlobalConfigSection } from '../features/config/store/global-config.actions';

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
