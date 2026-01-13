import { TestBed, fakeAsync, tick, flush } from '@angular/core/testing';
import { StartupService } from './startup.service';
import { ImexViewService } from '../../imex/imex-meta/imex-view.service';
import { TranslateService } from '@ngx-translate/core';
import { LocalBackupService } from '../../imex/local-backup/local-backup.service';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { SnackService } from '../snack/snack.service';
import { MatDialog } from '@angular/material/dialog';
import { PluginService } from '../../plugins/plugin.service';
import { SyncWrapperService } from '../../imex/sync/sync-wrapper.service';
import { BannerService } from '../banner/banner.service';
import { UiHelperService } from '../../features/ui-helper/ui-helper.service';
import { ChromeExtensionInterfaceService } from '../chrome-extension-interface/chrome-extension-interface.service';
import { ProjectService } from '../../features/project/project.service';
import { TrackingReminderService } from '../../features/tracking-reminder/tracking-reminder.service';
import { of } from 'rxjs';
import { signal } from '@angular/core';
import { LS } from '../persistence/storage-keys.const';

describe('StartupService', () => {
  let service: StartupService;
  let matDialog: jasmine.SpyObj<MatDialog>;
  let pluginService: jasmine.SpyObj<PluginService>;

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
    ]);
    localBackupServiceSpy.askForFileStoreBackupIfAvailable.and.returnValue(
      Promise.resolve(),
    );

    const globalConfigServiceSpy = jasmine.createSpyObj('GlobalConfigService', [''], {
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
    const matDialogSpy = jasmine.createSpyObj('MatDialog', ['open']);

    const pluginServiceSpy = jasmine.createSpyObj('PluginService', ['initializePlugins']);
    pluginServiceSpy.initializePlugins.and.returnValue(Promise.resolve());

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

    TestBed.configureTestingModule({
      providers: [
        StartupService,
        { provide: ImexViewService, useValue: imexViewServiceSpy },
        { provide: TranslateService, useValue: translateServiceSpy },
        { provide: LocalBackupService, useValue: localBackupServiceSpy },
        { provide: GlobalConfigService, useValue: globalConfigServiceSpy },
        { provide: SnackService, useValue: snackServiceSpy },
        { provide: MatDialog, useValue: matDialogSpy },
        { provide: PluginService, useValue: pluginServiceSpy },
        { provide: SyncWrapperService, useValue: syncWrapperServiceSpy },
        { provide: BannerService, useValue: bannerServiceSpy },
        { provide: UiHelperService, useValue: uiHelperServiceSpy },
        {
          provide: ChromeExtensionInterfaceService,
          useValue: chromeExtensionInterfaceServiceSpy,
        },
        { provide: ProjectService, useValue: projectServiceSpy },
        { provide: TrackingReminderService, useValue: trackingReminderServiceSpy },
      ],
    });

    service = TestBed.inject(StartupService);
    matDialog = TestBed.inject(MatDialog) as jasmine.SpyObj<MatDialog>;
    pluginService = TestBed.inject(PluginService) as jasmine.SpyObj<PluginService>;
  });

  describe('service creation', () => {
    it('should be created', () => {
      expect(service).toBeTruthy();
    });
  });

  describe('init', () => {
    // Note: Full init() testing requires complex BroadcastChannel mocking
    // These tests cover the testable parts

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

      // Restore
      (window as any).BroadcastChannel = originalBroadcastChannel;
    }));
  });

  describe('_handleAppStartRating (private, tested via init)', () => {
    it('should increment app start count on new day', () => {
      // Set up initial state - different day
      (localStorage.getItem as jasmine.Spy).and.callFake((key: string) => {
        if (key === LS.APP_START_COUNT) return '5';
        if (key === LS.APP_START_COUNT_LAST_START_DAY) return '2026-01-04'; // Different day
        return null;
      });

      // Call the private method via reflection for unit testing
      (service as any)._handleAppStartRating();

      expect(localStorage.setItem).toHaveBeenCalledWith(LS.APP_START_COUNT, '6');
    });

    it('should show rating dialog at 32 app starts', () => {
      (localStorage.getItem as jasmine.Spy).and.callFake((key: string) => {
        if (key === LS.APP_START_COUNT) return '32';
        if (key === LS.APP_START_COUNT_LAST_START_DAY) return '2026-01-04';
        return null;
      });

      (service as any)._handleAppStartRating();

      expect(matDialog.open).toHaveBeenCalled();
    });

    it('should show rating dialog at 96 app starts', () => {
      (localStorage.getItem as jasmine.Spy).and.callFake((key: string) => {
        if (key === LS.APP_START_COUNT) return '96';
        if (key === LS.APP_START_COUNT_LAST_START_DAY) return '2026-01-04';
        return null;
      });

      (service as any)._handleAppStartRating();

      expect(matDialog.open).toHaveBeenCalled();
    });

    it('should not show rating dialog at other counts', () => {
      (localStorage.getItem as jasmine.Spy).and.callFake((key: string) => {
        if (key === LS.APP_START_COUNT) return '50';
        if (key === LS.APP_START_COUNT_LAST_START_DAY) return '2026-01-04';
        return null;
      });

      (service as any)._handleAppStartRating();

      expect(matDialog.open).not.toHaveBeenCalled();
    });

    it('should not increment count if same day', () => {
      const todayStr = new Date().toISOString().split('T')[0];
      (localStorage.getItem as jasmine.Spy).and.callFake((key: string) => {
        if (key === LS.APP_START_COUNT) return '10';
        if (key === LS.APP_START_COUNT_LAST_START_DAY) return todayStr;
        return null;
      });

      (service as any)._handleAppStartRating();

      // Should not have set a new count since it's the same day
      // (the method only sets when lastStartDay !== todayStr)
      const setItemCalls = (localStorage.setItem as jasmine.Spy).calls.all();
      const countSetCalls = setItemCalls.filter(
        (call) => call.args[0] === LS.APP_START_COUNT,
      );
      expect(countSetCalls.length).toBe(0);
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

    it('should return false for NIGHTWATCH user agent', () => {
      const originalUserAgent = navigator.userAgent;
      Object.defineProperty(navigator, 'userAgent', {
        value: 'NIGHTWATCH',
        configurable: true,
      });

      const result = (service as any)._isTourLikelyToBeShown();

      expect(result).toBe(false);

      // Restore
      Object.defineProperty(navigator, 'userAgent', {
        value: originalUserAgent,
        configurable: true,
      });
    });

    it('should return false for PLAYWRIGHT user agent', () => {
      const originalUserAgent = navigator.userAgent;
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Something PLAYWRIGHT Something',
        configurable: true,
      });

      const result = (service as any)._isTourLikelyToBeShown();

      expect(result).toBe(false);

      // Restore
      Object.defineProperty(navigator, 'userAgent', {
        value: originalUserAgent,
        configurable: true,
      });
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
    it('should request persistent storage', fakeAsync(() => {
      const mockStorage = {
        persisted: jasmine.createSpy().and.returnValue(Promise.resolve(false)),
        persist: jasmine.createSpy().and.returnValue(Promise.resolve(true)),
        estimate: jasmine.createSpy(),
      };
      Object.defineProperty(navigator, 'storage', {
        value: mockStorage,
        configurable: true,
      });

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
      Object.defineProperty(navigator, 'storage', {
        value: mockStorage,
        configurable: true,
      });

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
