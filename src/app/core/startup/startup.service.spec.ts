import { TestBed, fakeAsync, tick, flush } from '@angular/core/testing';
import { StartupService } from './startup.service';
import { ImexViewService } from '../../imex/imex-meta/imex-view.service';
import { TranslateService } from '@ngx-translate/core';
import { LocalBackupService } from '../../imex/local-backup/local-backup.service';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { SnackService } from '../snack/snack.service';
import { PluginService } from '../../plugins/plugin.service';
import { SyncWrapperService } from '../../imex/sync/sync-wrapper.service';
import { BannerService } from '../banner/banner.service';
import { UiHelperService } from '../../features/ui-helper/ui-helper.service';
import { ChromeExtensionInterfaceService } from '../chrome-extension-interface/chrome-extension-interface.service';
import { ProjectService } from '../../features/project/project.service';
import { TrackingReminderService } from '../../features/tracking-reminder/tracking-reminder.service';
import { LegacyPfDbService } from '../persistence/legacy-pf-db.service';
import { OperationLogStoreService } from '../../op-log/persistence/operation-log-store.service';
import { LegacySupDbService } from '../persistence/legacy-sup-db.service';
import { DataInitStateService } from '../data-init/data-init-state.service';
import { CustomThemeService } from '../theme/custom-theme.service';
import { of } from 'rxjs';
import { signal } from '@angular/core';
import { LS } from '../persistence/storage-keys.const';
import { T } from '../../t.const';
import { provideMockStore } from '@ngrx/store/testing';
import { selectSyncConfig } from '../../features/config/store/global-config.reducer';
import { selectEnabledIssueProviders } from '../../features/issue/store/issue-provider.selectors';
import { RatePromptService } from '../../features/dialog-please-rate/rate-prompt.service';
import { JiraElectronBridgeService } from '../../features/issue/providers/jira/jira-electron-bridge.service';

describe('StartupService', () => {
  let service: StartupService;
  let pluginService: jasmine.SpyObj<PluginService>;
  let ratePromptService: jasmine.SpyObj<RatePromptService>;
  let jiraElectronBridge: jasmine.SpyObj<JiraElectronBridgeService>;

  beforeEach(() => {
    // Mock localStorage
    const localStorageMock: { [key: string]: string } = {};
    spyOn(localStorage, 'getItem').and.callFake(
      (key: string) => localStorageMock[key] || null,
    );
    spyOn(localStorage, 'setItem').and.callFake(
      (key: string, value: string) => (localStorageMock[key] = value),
    );

    // Create spies for all dependencies
    const imexViewServiceSpy = jasmine.createSpyObj('ImexViewService', ['init']);
    const translateServiceSpy = jasmine.createSpyObj('TranslateService', ['instant']);

    const localBackupServiceSpy = jasmine.createSpyObj('LocalBackupService', [
      'askForFileStoreBackupIfAvailable',
      'init',
      'restoreBackupStr',
    ]);
    localBackupServiceSpy.restoreBackupStr.and.resolveTo(true);
    localBackupServiceSpy.askForFileStoreBackupIfAvailable.and.returnValue(
      Promise.resolve(),
    );

    const globalConfig = {
      misc: {
        isConfirmBeforeExit: false,
        defaultProjectId: null,
        isShowProductivityTipLonger: false,
      },
    };
    const globalConfigServiceSpy = jasmine.createSpyObj('GlobalConfigService', [''], {
      cfg$: of(globalConfig),
      cfg: signal({
        misc: {
          isConfirmBeforeExit: false,
          defaultProjectId: null,
          isShowProductivityTipLonger: false,
        },
      }),
      misc: signal({
        isShowProductivityTipLonger: false,
      }),
    });

    const snackServiceSpy = jasmine.createSpyObj('SnackService', ['open']);
    const ratePromptServiceSpy = jasmine.createSpyObj('RatePromptService', ['init']);

    const pluginServiceSpy = jasmine.createSpyObj('PluginService', ['initializePlugins']);
    pluginServiceSpy.initializePlugins.and.returnValue(Promise.resolve());
    const jiraElectronBridgeSpy = jasmine.createSpyObj('JiraElectronBridgeService', [
      'initialize',
    ]);

    const syncWrapperServiceSpy = jasmine.createSpyObj('SyncWrapperService', [
      'isSyncInProgressSync',
    ]);
    syncWrapperServiceSpy.isSyncInProgressSync.and.returnValue(false);
    syncWrapperServiceSpy.afterCurrentSyncDoneOrSyncDisabled$ = of(undefined);

    const bannerServiceSpy = jasmine.createSpyObj('BannerService', [
      'open',
      'dismissAll',
    ]);

    const uiHelperServiceSpy = jasmine.createSpyObj('UiHelperService', ['initElectron']);

    const chromeExtensionInterfaceServiceSpy = jasmine.createSpyObj(
      'ChromeExtensionInterfaceService',
      ['init'],
    );

    const projectServiceSpy = jasmine.createSpyObj('ProjectService', [''], {
      list: signal([{ id: 'project-1' }, { id: 'project-2' }, { id: 'project-3' }]),
    });

    const trackingReminderServiceSpy = jasmine.createSpyObj('TrackingReminderService', [
      'init',
    ]);

    const legacyPfDbServiceSpy = jasmine.createSpyObj('LegacyPfDbService', [
      'hasUsableEntityData',
    ]);
    // Default: no legacy data (fresh install)
    legacyPfDbServiceSpy.hasUsableEntityData.and.returnValue(Promise.resolve(false));

    const legacySupDbServiceSpy = jasmine.createSpyObj('LegacySupDbService', [
      'loadUnmigratedData',
    ]);
    // Default: no v12-or-older data on this device
    legacySupDbServiceSpy.loadUnmigratedData.and.resolveTo(null);

    const dataInitStateServiceSpy = {
      isAllDataLoadedInitially$: of(true),
    };

    const customThemeServiceSpy = jasmine.createSpyObj('CustomThemeService', [
      'applyActiveTheme',
    ]);
    customThemeServiceSpy.applyActiveTheme.and.resolveTo(undefined);

    TestBed.configureTestingModule({
      providers: [
        StartupService,
        { provide: ImexViewService, useValue: imexViewServiceSpy },
        { provide: TranslateService, useValue: translateServiceSpy },
        { provide: LocalBackupService, useValue: localBackupServiceSpy },
        { provide: GlobalConfigService, useValue: globalConfigServiceSpy },
        { provide: SnackService, useValue: snackServiceSpy },
        { provide: RatePromptService, useValue: ratePromptServiceSpy },
        { provide: PluginService, useValue: pluginServiceSpy },
        { provide: JiraElectronBridgeService, useValue: jiraElectronBridgeSpy },
        { provide: SyncWrapperService, useValue: syncWrapperServiceSpy },
        { provide: BannerService, useValue: bannerServiceSpy },
        { provide: UiHelperService, useValue: uiHelperServiceSpy },
        {
          provide: ChromeExtensionInterfaceService,
          useValue: chromeExtensionInterfaceServiceSpy,
        },
        { provide: ProjectService, useValue: projectServiceSpy },
        { provide: TrackingReminderService, useValue: trackingReminderServiceSpy },
        { provide: LegacyPfDbService, useValue: legacyPfDbServiceSpy },
        { provide: LegacySupDbService, useValue: legacySupDbServiceSpy },
        { provide: DataInitStateService, useValue: dataInitStateServiceSpy },
        { provide: CustomThemeService, useValue: customThemeServiceSpy },
        provideMockStore({
          selectors: [
            { selector: selectSyncConfig, value: { syncProvider: null } },
            { selector: selectEnabledIssueProviders, value: [] },
          ],
        }),
      ],
    });

    service = TestBed.inject(StartupService);
    pluginService = TestBed.inject(PluginService) as jasmine.SpyObj<PluginService>;
    ratePromptService = TestBed.inject(
      RatePromptService,
    ) as jasmine.SpyObj<RatePromptService>;
    jiraElectronBridge = TestBed.inject(
      JiraElectronBridgeService,
    ) as jasmine.SpyObj<JiraElectronBridgeService>;
  });

  describe('init', () => {
    // Note: Full init() testing requires complex BroadcastChannel mocking
    // These tests cover the testable parts

    it('claims the Jira Electron capability before deferred plugin initialization', () => {
      expect(jiraElectronBridge.initialize).toHaveBeenCalledOnceWith();
      expect(pluginService.initializePlugins).not.toHaveBeenCalled();
    });

    it('should check for stray backups during initialization', fakeAsync(() => {
      // Mock BroadcastChannel to prevent multi-instance blocking
      const mockChannel = {
        postMessage: jasmine.createSpy(),
        addEventListener: jasmine.createSpy(),
        removeEventListener: jasmine.createSpy(),
        close: jasmine.createSpy(),
      };
      const originalBroadcastChannel = (window as any).BroadcastChannel;
      (window as any).BroadcastChannel = jasmine
        .createSpy('BroadcastChannel')
        .and.returnValue(mockChannel);

      service.init();
      tick(200); // Wait for single instance check

      flush();

      // Deferred init hands the rating prompt off to RatePromptService.
      expect(ratePromptService.init).toHaveBeenCalled();

      // Restore
      (window as any).BroadcastChannel = originalBroadcastChannel;
    }));

    it('should transfer current settings to Electron when requested', () => {
      const originalEaDescriptor = Object.getOwnPropertyDescriptor(window, 'ea');
      const electronApi = {
        sendAppSettingsToElectron: jasmine.createSpy('sendAppSettingsToElectron'),
      } as unknown as typeof window.ea;

      Object.defineProperty(window, 'ea', {
        value: electronApi,
        configurable: true,
        writable: true,
      });

      try {
        (
          service as unknown as {
            _sendCurrentSettingsToElectronAfterDataLoad: () => void;
          }
        )._sendCurrentSettingsToElectronAfterDataLoad();

        expect(electronApi.sendAppSettingsToElectron).toHaveBeenCalledWith(
          jasmine.objectContaining({
            misc: jasmine.objectContaining({
              isConfirmBeforeExit: false,
              isShowProductivityTipLonger: false,
            }),
          }),
        );
      } finally {
        if (originalEaDescriptor) {
          Object.defineProperty(window, 'ea', originalEaDescriptor);
        } else {
          delete (window as Partial<Window>).ea;
        }
      }
    });
  });

  // Regression guard for #4137/#7345: v11.1.0–v12.0.1 shipped with local
  // backups never initialised, so a later data loss had nothing to restore.
  describe('local backup initialisation', () => {
    let localBackupService: jasmine.SpyObj<LocalBackupService>;
    let opLogStore: jasmine.SpyObj<OperationLogStoreService>;

    beforeEach(() => {
      localBackupService = TestBed.inject(
        LocalBackupService,
      ) as jasmine.SpyObj<LocalBackupService>;
      opLogStore = jasmine.createSpyObj('OperationLogStoreService', [
        'loadStateCache',
        'getLastSeq',
        'isRawRebuildIncomplete',
        'loadRawRebuildRecovery',
      ]);
      opLogStore.isRawRebuildIncomplete.and.resolveTo(false);
      opLogStore.loadRawRebuildRecovery.and.resolveTo(null);
      Object.assign(service as object, {
        _opLogStore: opLogStore,
        _platformService: { isNative: true },
      });
    });

    it('should initialise local backups on startup for existing data', fakeAsync(() => {
      opLogStore.getLastSeq.and.resolveTo(1);

      service.init();
      flush();

      expect(localBackupService.init).toHaveBeenCalledTimes(1);
      expect(localBackupService.askForFileStoreBackupIfAvailable).not.toHaveBeenCalled();
    }));

    it('should offer a backup restore and then initialise backups on a blank store', fakeAsync(() => {
      opLogStore.loadStateCache.and.resolveTo(null);
      opLogStore.getLastSeq.and.resolveTo(0);

      service.init();
      flush();

      expect(localBackupService.askForFileStoreBackupIfAvailable).toHaveBeenCalled();
      expect(localBackupService.init).toHaveBeenCalledTimes(1);
    }));
  });

  // #7345: v12-or-older data that v17+ no longer migrates on its own.
  describe('pre-v13 data on a blank start', () => {
    const PRE_V13_DATA = {
      task: { ids: ['t1'], entities: { t1: { id: 't1', title: 'Old task' } } },
      project: { ids: ['p1'], entities: { p1: { id: 'p1' } } },
      taskArchive: { ids: ['a1'], entities: { a1: { id: 'a1' } } },
    };
    let localBackupService: jasmine.SpyObj<LocalBackupService>;
    let legacySupDb: jasmine.SpyObj<LegacySupDbService>;
    let opLogStore: jasmine.SpyObj<OperationLogStoreService>;
    let confirmSpy: jasmine.Spy;
    let translateService: jasmine.SpyObj<TranslateService>;

    const initBackups = (): Promise<void> =>
      (service as unknown as { _initBackups: () => Promise<void> })._initBackups();

    beforeEach(() => {
      localBackupService = TestBed.inject(
        LocalBackupService,
      ) as jasmine.SpyObj<LocalBackupService>;
      legacySupDb = TestBed.inject(
        LegacySupDbService,
      ) as jasmine.SpyObj<LegacySupDbService>;
      legacySupDb.loadUnmigratedData.and.resolveTo(PRE_V13_DATA);
      translateService = TestBed.inject(
        TranslateService,
      ) as jasmine.SpyObj<TranslateService>;
      opLogStore = jasmine.createSpyObj('OperationLogStoreService', [
        'loadStateCache',
        'getLastSeq',
      ]);
      opLogStore.loadStateCache.and.resolveTo(null);
      opLogStore.getLastSeq.and.resolveTo(0);
      Object.assign(service as object, {
        _opLogStore: opLogStore,
        _platformService: { isNative: true },
      });
      // window.confirm is a global spy installed by the test setup.
      confirmSpy = window.confirm as jasmine.Spy;
      // Keep download() from creating object URLs in the test browser.
      spyOn(URL, 'createObjectURL').and.returnValue('blob:test');
      spyOn(URL, 'revokeObjectURL');
    });

    it('should import the data through the backup restore once confirmed', async () => {
      confirmSpy.and.returnValue(true);

      await initBackups();

      expect(confirmSpy).toHaveBeenCalledTimes(1);
      // Active plus archived tasks, so an archive-only profile isn't "0 tasks".
      expect(translateService.instant).toHaveBeenCalledWith(
        T.MIGRATE.C_IMPORT_PRE_V13_DATA,
        { tasks: 2, projects: 1 },
      );
      expect(localBackupService.restoreBackupStr).toHaveBeenCalledOnceWith(
        JSON.stringify(PRE_V13_DATA),
      );
      expect(localBackupService.askForFileStoreBackupIfAvailable).not.toHaveBeenCalled();
      expect(localBackupService.init).toHaveBeenCalledTimes(1);
    });

    it('should leave the data alone and fall back to the backup prompt when declined', async () => {
      confirmSpy.and.returnValue(false);

      await initBackups();

      expect(localBackupService.restoreBackupStr).not.toHaveBeenCalled();
      expect(localBackupService.askForFileStoreBackupIfAvailable).toHaveBeenCalled();
    });

    it('should fall back to the backup prompt when the import fails', async () => {
      confirmSpy.and.returnValue(true);
      localBackupService.restoreBackupStr.and.resolveTo(false);

      await initBackups();

      expect(localBackupService.askForFileStoreBackupIfAvailable).toHaveBeenCalled();
    });

    it('should offer it on the web too, without starting local backups', async () => {
      Object.assign(service as object, { _platformService: { isNative: false } });
      confirmSpy.and.returnValue(true);

      await initBackups();

      expect(localBackupService.restoreBackupStr).toHaveBeenCalled();
      expect(localBackupService.askForFileStoreBackupIfAvailable).not.toHaveBeenCalled();
      expect(localBackupService.init).not.toHaveBeenCalled();
    });

    it('should not look for it when the store holds data', async () => {
      opLogStore.loadStateCache.and.resolveTo({} as never);

      await initBackups();

      expect(legacySupDb.loadUnmigratedData).not.toHaveBeenCalled();
      expect(confirmSpy).not.toHaveBeenCalled();
    });

    it('should not read the state snapshot when the op-log holds operations', async () => {
      opLogStore.getLastSeq.and.resolveTo(5);

      await initBackups();

      expect(opLogStore.loadStateCache).not.toHaveBeenCalled();
      expect(legacySupDb.loadUnmigratedData).not.toHaveBeenCalled();
      expect(localBackupService.askForFileStoreBackupIfAvailable).not.toHaveBeenCalled();
    });

    it('should not look for it while v13–v16 pf data awaits migration', async () => {
      const legacyPfDb = TestBed.inject(
        LegacyPfDbService,
      ) as jasmine.SpyObj<LegacyPfDbService>;
      legacyPfDb.hasUsableEntityData.and.resolveTo(true);

      await initBackups();

      expect(legacySupDb.loadUnmigratedData).not.toHaveBeenCalled();
    });

    it('should stay silent when no such data exists', async () => {
      legacySupDb.loadUnmigratedData.and.resolveTo(null);

      await initBackups();

      expect(confirmSpy).not.toHaveBeenCalled();
      expect(localBackupService.askForFileStoreBackupIfAvailable).toHaveBeenCalled();
    });
  });

  describe('raw rebuild recovery', () => {
    const callRecoveryCheck = async (): Promise<void> => {
      await (
        service as unknown as {
          _offerInterruptedRebuildRecoveryIfNeeded: () => Promise<void>;
        }
      )._offerInterruptedRebuildRecoveryIfNeeded();
    };

    it('should re-offer Undo after reload when a completed recovery token exists', async () => {
      const opLogStore = jasmine.createSpyObj('OperationLogStoreService', [
        'isRawRebuildIncomplete',
        'loadRawRebuildRecovery',
      ]);
      opLogStore.isRawRebuildIncomplete.and.resolveTo(false);
      opLogStore.loadRawRebuildRecovery.and.resolveTo({
        backupId: 'backup-4242',
        backupSavedAt: 4242,
        completedAt: 5000,
      });
      const syncService = jasmine.createSpyObj('OperationLogSyncService', [
        'offerInterruptedRebuildRecovery',
      ]);
      syncService.offerInterruptedRebuildRecovery.and.resolveTo();
      Object.assign(service as object, {
        _opLogStore: opLogStore,
        _injector: { get: () => syncService },
      });

      await callRecoveryCheck();

      expect(syncService.offerInterruptedRebuildRecovery).toHaveBeenCalled();
    });

    it('should not instantiate sync recovery when no marker exists', async () => {
      const opLogStore = jasmine.createSpyObj('OperationLogStoreService', [
        'isRawRebuildIncomplete',
        'loadRawRebuildRecovery',
      ]);
      opLogStore.isRawRebuildIncomplete.and.resolveTo(false);
      opLogStore.loadRawRebuildRecovery.and.resolveTo(null);
      const get = jasmine.createSpy('get');
      Object.assign(service as object, {
        _opLogStore: opLogStore,
        _injector: { get },
      });

      await callRecoveryCheck();

      expect(get).not.toHaveBeenCalled();
    });
  });

  describe('_isTourLikelyToBeShown (private)', () => {
    it('should return false if IS_SKIP_TOUR is set', () => {
      (localStorage.getItem as jasmine.Spy).and.callFake((key: string) => {
        if (key === LS.IS_SKIP_TOUR) return 'true';
        return null;
      });

      const result = (service as any)._isTourLikelyToBeShown();

      expect(result).toBe(false);
    });

    // Spy on the prototype getter rather than defining an own property on
    // `navigator`: an own property survives the test and shadows the prototype
    // getter for every later spec that spies on it.
    it('should return false for NIGHTWATCH user agent', () => {
      spyOnProperty(Navigator.prototype, 'userAgent', 'get').and.returnValue(
        'NIGHTWATCH',
      );

      const result = (service as any)._isTourLikelyToBeShown();

      expect(result).toBe(false);
    });

    it('should return false for PLAYWRIGHT user agent', () => {
      spyOnProperty(Navigator.prototype, 'userAgent', 'get').and.returnValue(
        'Something PLAYWRIGHT Something',
      );

      const result = (service as any)._isTourLikelyToBeShown();

      expect(result).toBe(false);
    });

    it('should return false when more than 2 projects exist', () => {
      // projectService.list returns signal with 3 projects in setup
      const result = (service as any)._isTourLikelyToBeShown();

      expect(result).toBe(false);
    });
  });

  describe('_initPlugins (private)', () => {
    it('should initialize plugins after sync completes', async () => {
      await (service as any)._initPlugins();

      expect(pluginService.initializePlugins).toHaveBeenCalled();
    });

    it('should handle plugin initialization errors gracefully', async () => {
      pluginService.initializePlugins.and.returnValue(
        Promise.reject(new Error('Plugin init failed')),
      );

      // Should not throw
      await expectAsync((service as any)._initPlugins()).toBeResolved();
    });
  });

  describe('_requestPersistence (private)', () => {
    // Same reason as the user-agent stub above: defining `storage` on
    // `navigator` itself leaks the mock into every later spec in the run.
    const stubStorage = (storage: unknown): void => {
      spyOnProperty(Navigator.prototype, 'storage', 'get').and.returnValue(
        storage as StorageManager,
      );
    };

    it('should request persistent storage', fakeAsync(() => {
      const mockStorage = {
        persisted: jasmine.createSpy().and.returnValue(Promise.resolve(false)),
        persist: jasmine.createSpy().and.returnValue(Promise.resolve(true)),
        estimate: jasmine.createSpy(),
      };
      stubStorage(mockStorage);

      (service as any)._requestPersistence();
      tick();

      expect(mockStorage.persisted).toHaveBeenCalled();
      expect(mockStorage.persist).toHaveBeenCalled();

      flush();
    }));

    it('should not request persistence if already persisted', fakeAsync(() => {
      const mockStorage = {
        persisted: jasmine.createSpy().and.returnValue(Promise.resolve(true)),
        persist: jasmine.createSpy(),
        estimate: jasmine.createSpy(),
      };
      stubStorage(mockStorage);

      (service as any)._requestPersistence();
      tick();

      expect(mockStorage.persisted).toHaveBeenCalled();
      expect(mockStorage.persist).not.toHaveBeenCalled();

      flush();
    }));
  });

  describe('_initOfflineBanner (private)', () => {
    // Note: This requires mocking isOnline$ which is complex
    // Basic test to ensure the method can be called
    it('should set up offline banner subscription', () => {
      expect(() => (service as any)._initOfflineBanner()).not.toThrow();
    });
  });
});
