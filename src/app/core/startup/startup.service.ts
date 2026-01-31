import { effect, inject, Injectable } from '@angular/core';
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
import { IS_ELECTRON } from '../../app.constants';
import { Log } from '../log';
import { T } from '../../t.const';
import { OperationLogStoreService } from '../../op-log/persistence/operation-log-store.service';
import { LegacyPfDbService } from '../persistence/legacy-pf-db.service';
import { BannerId } from '../banner/banner.model';
import { isOnline$ } from '../../util/is-online';
import { LS } from '../persistence/storage-keys.const';
import { getDbDateStr } from '../../util/get-db-date-str';
import { DialogPleaseRateComponent } from '../../features/dialog-please-rate/dialog-please-rate.component';
import { map, take } from 'rxjs/operators';
import { combineLatest } from 'rxjs';
import { Store } from '@ngrx/store';
import { selectSyncConfig } from '../../features/config/store/global-config.reducer';
import { selectEnabledIssueProviders } from '../../features/issue/store/issue-provider.selectors';
import { LegacySyncProvider } from '../../imex/sync/legacy-sync-provider.model';
import { GlobalConfigState } from '../../features/config/global-config.model';
import { IPC } from '../../../../electron/shared-with-frontend/ipc-events.const';
import { IpcRendererEvent } from 'electron';
import { environment } from '../../../environments/environment';
import { TrackingReminderService } from '../../features/tracking-reminder/tracking-reminder.service';
import { CapacitorPlatformService } from '../platform/capacitor-platform.service';
import { alertDialog } from '../../util/native-dialogs';

const w = window as Window & { productivityTips?: string[][]; randomIndex?: number };

/** Delay before running deferred initialization tasks (plugins, storage checks, etc.) */
const DEFERRED_INIT_DELAY_MS = 1000;

@Injectable({
  providedIn: 'root',
})
export class StartupService {
  private _imexMetaService = inject(ImexViewService);
  private _translateService = inject(TranslateService);
  private _localBackupService = inject(LocalBackupService);
  private _globalConfigService = inject(GlobalConfigService);
  private _snackService = inject(SnackService);
  private _matDialog = inject(MatDialog);
  private _pluginService = inject(PluginService);
  private _syncWrapperService = inject(SyncWrapperService);
  private _bannerService = inject(BannerService);
  private _uiHelperService = inject(UiHelperService);
  private _chromeExtensionInterfaceService = inject(ChromeExtensionInterfaceService);
  private _projectService = inject(ProjectService);
  private _trackingReminderService = inject(TrackingReminderService);
  private _opLogStore = inject(OperationLogStoreService);
  private _legacyPfDb = inject(LegacyPfDbService);
  private _store = inject(Store);
  private _platformService = inject(CapacitorPlatformService);

  constructor() {
    // Initialize electron error handler in an effect
    if (IS_ELECTRON) {
      effect(() => {
        window.ea.on(IPC.ERROR, (ev: IpcRendererEvent, ...args: unknown[]) => {
          const data = args[0] as {
            error: unknown;
            stack: unknown;
            errorStr: string | unknown;
          };
          const errMsg =
            typeof data.errorStr === 'string' ? data.errorStr : ' INVALID ERROR MSG :( ';

          this._snackService.open({
            msg: errMsg,
            type: 'ERROR',
            isSkipTranslate: true,
          });
          Log.err(data);
        });
      });
    }
  }

  async init(): Promise<void> {
    // Skip single instance check for native mobile apps and Electron
    if (!this._platformService.isNative && !IS_ELECTRON) {
      const isSingle = await this._checkIsSingleInstance();
      if (!isSingle) {
        this._showMultiInstanceBlocker();
        return;
      }
    }

    this._initBackups();
    this._requestPersistence();

    // deferred init
    window.setTimeout(async () => {
      this._trackingReminderService.init();
      this._checkAvailableStorage();
      this._initOfflineBanner();

      const miscCfg = this._globalConfigService.misc();
      if (miscCfg?.isShowProductivityTipLonger && !this._isTourLikelyToBeShown()) {
        if (w.productivityTips && w.randomIndex !== undefined) {
          this._snackService.open({
            ico: 'lightbulb',
            config: {
              duration: 16000,
            },
            msg:
              '<strong>' +
              w.productivityTips[w.randomIndex][0] +
              ':</strong> ' +
              w.productivityTips[w.randomIndex][1],
          });
        }
      }

      this._handleAppStartRating();
      await this._initPlugins();
    }, DEFERRED_INIT_DELAY_MS);

    if (IS_ELECTRON) {
      window.ea.informAboutAppReady();
      this._uiHelperService.initElectron();

      window.ea.on(IPC.TRANSFER_SETTINGS_REQUESTED, () => {
        window.ea.sendAppSettingsToElectron(
          this._globalConfigService.cfg() as GlobalConfigState,
        );
      });
    } else {
      // WEB VERSION
      window.addEventListener('beforeunload', (e) => {
        const gCfg = this._globalConfigService.cfg();
        if (!gCfg) {
          throw new Error();
        }
        if (
          gCfg.misc.isConfirmBeforeExit ||
          this._syncWrapperService.isSyncInProgressSync()
        ) {
          e.preventDefault();
          e.returnValue = '';
        }
      });

      // Chrome extension only works in web browser, not native mobile apps
      if (!this._platformService.isNative) {
        this._chromeExtensionInterfaceService.init();
      }
    }
  }

  private async _initBackups(): Promise<void> {
    // if completely fresh instance check for local backups
    // Local backups are available on Electron and native mobile (iOS/Android)
    if (IS_ELECTRON || this._platformService.isNative) {
      const stateCache = await this._opLogStore.loadStateCache();
      // If no state cache exists, check if this is truly a fresh instance
      // or if there's legacy v16 data waiting to be migrated
      if (!stateCache) {
        // Check for legacy data - if it exists, don't show restore dialog
        // The migration service will handle the legacy data
        let hasLegacyData = false;
        try {
          hasLegacyData = await this._legacyPfDb.hasUsableEntityData();
        } catch (e) {
          // If legacy check fails, it means the database exists but can't be read
          // The migration service will handle this error properly
          Log.warn('StartupService: Legacy data check failed, skipping backup prompt', e);
          hasLegacyData = true; // Assume there might be data, don't show backup dialog
        }

        // Only offer to restore from backup if this is truly a fresh install
        // (no state cache AND no legacy data)
        if (!hasLegacyData) {
          await this._localBackupService.askForFileStoreBackupIfAvailable();
        }
      }
      // trigger backup init after
      this._localBackupService.init();
    }
  }

  private async _checkIsSingleInstance(): Promise<boolean> {
    const channel = new BroadcastChannel('superProductivityTab');
    let isAnotherInstanceActive = false;
    let resolved = false;

    // 1. Listen for other instances saying "I'm here!"
    const checkListener = (msg: MessageEvent): void => {
      if (msg.data === 'alreadyOpenElsewhere') {
        isAnotherInstanceActive = true;
        resolved = true;
      }
    };
    channel.addEventListener('message', checkListener);

    // 2. Ask "Is anyone here?"
    channel.postMessage('newTabOpened');

    // 3. Wait for response with early exit - reduced from 150ms to 50ms
    // BroadcastChannel is synchronous within the same origin, so 50ms is sufficient
    await new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        if (resolved) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 10);
      setTimeout(() => {
        clearInterval(checkInterval);
        resolve();
      }, 50);
    });

    channel.removeEventListener('message', checkListener);

    if (isAnotherInstanceActive) {
      return false;
    }

    // 4. If we are the only one, start listening for new tabs to warn them
    channel.addEventListener('message', (msg) => {
      if (msg.data === 'newTabOpened') {
        channel.postMessage('alreadyOpenElsewhere');
      }
    });

    return true;
  }

  private _showMultiInstanceBlocker(): void {
    const msg =
      'Super Productivity is already running in another tab. Please close this tab or the other one.';
    const style =
      'display: flex; align-items: center; justify-content: center; height: 100vh; text-align: center; font-family: sans-serif; padding: 2rem;';
    document.body.innerHTML = `
      <div style="${style}">
        <div>
          <h1>App is already open</h1>
          <p>${msg}</p>
        </div>
      </div>
    `;
  }

  private _isTourLikelyToBeShown(): boolean {
    if (localStorage.getItem(LS.IS_SKIP_TOUR)) {
      return false;
    }
    const ua = navigator.userAgent;
    if (ua === 'NIGHTWATCH' || ua.includes('PLAYWRIGHT')) {
      return false;
    }
    const projectList = this._projectService.list();
    return !projectList || projectList.length <= 2;
  }

  private _initOfflineBanner(): void {
    const needsInternet$ = combineLatest([
      this._store.select(selectSyncConfig),
      this._store.select(selectEnabledIssueProviders),
    ]).pipe(
      map(([syncConfig, enabledIssueProviders]) => {
        const hasCloudSync =
          syncConfig.syncProvider !== null &&
          syncConfig.syncProvider !== LegacySyncProvider.LocalFile;
        const hasIssueProviders = enabledIssueProviders.length > 0;
        return hasCloudSync || hasIssueProviders;
      }),
    );

    combineLatest([isOnline$, needsInternet$]).subscribe(([isOnline, needsInternet]) => {
      if (!isOnline && needsInternet) {
        this._bannerService.open({
          id: BannerId.Offline,
          ico: 'cloud_off',
          msg: T.APP.B_OFFLINE,
        });
      } else {
        this._bannerService.dismissAll(BannerId.Offline);
      }
    });
  }

  private _requestPersistence(): void {
    if (navigator.storage) {
      // try to avoid data-loss
      Promise.all([navigator.storage.persisted()])
        .then(([persisted]) => {
          if (!persisted) {
            return navigator.storage.persist().then((granted) => {
              if (granted) {
                Log.log('Persistent store granted');
              }
              // NOTE: we never show this warning for native mobile apps, because persistence is always granted
              else if (!this._platformService.isNative) {
                const msg = T.GLOBAL_SNACK.PERSISTENCE_DISALLOWED;
                Log.warn('Persistence not allowed');
                this._snackService.open({ msg });
              }
            });
          } else {
            Log.log('Persistence already allowed');
            return;
          }
        })
        .catch((e) => {
          Log.log(e);
          const err = e && e.toString ? e.toString() : 'UNKNOWN';
          const msg = T.GLOBAL_SNACK.PERSISTENCE_ERROR;
          this._snackService.open({
            type: 'ERROR',
            msg,
            translateParams: {
              err,
            },
          });
        });
    }
  }

  private _checkAvailableStorage(): void {
    if (environment.production) {
      if ('storage' in navigator && 'estimate' in navigator.storage) {
        navigator.storage.estimate().then(({ usage, quota }) => {
          const u = usage || 0;
          const q = quota || 0;

          const percentUsed = Math.round((u / q) * 100);
          const usageInMib = Math.round(u / (1024 * 1024));
          const quotaInMib = Math.round(q / (1024 * 1024));
          const details = `${usageInMib} out of ${quotaInMib} MiB used (${percentUsed}%)`;
          Log.log(details);
          if (quotaInMib - usageInMib <= 333) {
            alertDialog(
              `There is only very little disk space available (${
                quotaInMib - usageInMib
              }mb). This might affect how the app is running.`,
            );
          }
        });
      }
    }
  }

  private _handleAppStartRating(): void {
    const appStarts = +(localStorage.getItem(LS.APP_START_COUNT) || 0);
    const lastStartDay = localStorage.getItem(LS.APP_START_COUNT_LAST_START_DAY);
    const todayStr = getDbDateStr();
    if (appStarts === 32 || appStarts === 96) {
      this._matDialog.open(DialogPleaseRateComponent);
      localStorage.setItem(LS.APP_START_COUNT, (appStarts + 1).toString());
    }
    if (lastStartDay !== todayStr) {
      localStorage.setItem(LS.APP_START_COUNT, (appStarts + 1).toString());
      localStorage.setItem(LS.APP_START_COUNT_LAST_START_DAY, todayStr);
    }
  }

  private async _initPlugins(): Promise<void> {
    // Initialize plugin system
    try {
      // Wait for sync to complete before initializing plugins to avoid DB lock conflicts
      await this._syncWrapperService.afterCurrentSyncDoneOrSyncDisabled$
        .pipe(take(1))
        .toPromise();
      await this._pluginService.initializePlugins();
      Log.log('Plugin system initialized after sync completed');
    } catch (error) {
      Log.err('Failed to initialize plugin system:', error);
    }
  }
}
