import { initIpcInterfaces } from './ipc-handler';
import { initPluginOAuth } from './plugin-oauth';
import electronLog, { info, log, warn } from 'electron-log/main';
import { App, app, BrowserWindow, globalShortcut, ipcMain, powerMonitor } from 'electron';
import { join } from 'path';
import { initDebug } from './debug';
import electronDl from 'electron-dl';
import { IPC } from './shared-with-frontend/ipc-events.const';
import { initBackupAdapter } from './backup';
import { initLocalFileSyncAdapter } from './local-file-sync';
import { initFullScreenBlocker } from './full-screen-blocker';
import { CONFIG } from './CONFIG';
import { lazySetInterval } from './shared-with-frontend/lazy-set-interval';
import { initIndicator } from './indicator';
import { quitApp, showOrFocus } from './various-shared';
import { createWindow, getWin } from './main-window';
import { IdleTimeHandler } from './idle-time-handler';
import { destroyTaskWidget } from './task-widget/task-widget';
import {
  initializeProtocolHandling,
  processPendingProtocolUrls,
} from './protocol-handler';
import { getIsQuiting, setIsQuiting, setIsLocked } from './shared-state';
import { clearStaleLevelDbLocks } from './clear-stale-idb-locks';
import { evaluateGpuStartupGuard } from './gpu-startup-guard';
import * as fs from 'fs';

const ICONS_FOLDER = __dirname + '/assets/icons/';
const IS_MAC = process.platform === 'darwin';
// const DESKTOP_ENV = process.env.DESKTOP_SESSION;
// const IS_GNOME = DESKTOP_ENV === 'gnome' || DESKTOP_ENV === 'gnome-xorg';
const IS_DEV = process.env.NODE_ENV === 'DEV';

let isShowDevTools: boolean = IS_DEV;
let customUrl: string;
let isDisableTray = false;
let forceDarkTray = false;
let wasUserDataDirSet = false;

if (IS_DEV) {
  log('Starting in DEV Mode!!!');
}

const appIN: App = app;

let mainWin: BrowserWindow;
let idleTimeHandler: IdleTimeHandler;

export const startApp = (): void => {
  // Initialize protocol handling (registers second-instance listener for URL forwarding)
  initializeProtocolHandling(IS_DEV, app, () => mainWin);

  // LOAD IPC STUFF
  initIpcInterfaces();

  electronLog.initialize();

  app.commandLine.appendSwitch('enable-speech-dispatcher');

  // work around for #4375
  // https://github.com/super-productivity/super-productivity/issues/4375#issuecomment-2883838113
  // https://github.com/electron/electron/issues/46538#issuecomment-2808806722
  app.commandLine.appendSwitch('gtk-version', '3');

  // Force X11 in Snap on Wayland sessions or when the gnome-42-2204 runtime
  // is missing. Chromium's Wayland EGL/GBM init can fail against the Mesa
  // shipped by gnome-42-2204 when the snap runtime's Mesa version drifts
  // out of sync with what Electron's Chromium expects, producing
  // "Failed to get system egl display" / "MESA-LOADER failed to open
  // dri_gbm.so" and a failed GPU process. The X11 ozone backend avoids the
  // failing Wayland EGL init path while keeping hardware acceleration — at
  // the cost of Wayland-native features (fractional scaling, per-monitor
  // HiDPI, native IME, client-side decorations). Override with
  // `--ozone-platform=wayland`.
  // IMPORTANT: must run before app.whenReady() — ozone platform is read
  // during Chromium init and cannot be changed after ready fires.
  const hasOzoneOverride = process.argv.some(
    (arg) => arg === '--ozone-platform' || arg.startsWith('--ozone-platform='),
  );
  if (process.platform === 'linux' && process.env.SNAP && !hasOzoneOverride) {
    const isWaylandSession =
      process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY;

    let isGnomePlatformMissing = false;
    try {
      const gnomePlatformPath = join(process.env.SNAP || '', 'gnome-platform');
      isGnomePlatformMissing =
        !fs.existsSync(gnomePlatformPath) ||
        fs.readdirSync(gnomePlatformPath).length === 0;
    } catch {
      isGnomePlatformMissing = true;
    }

    if (isWaylandSession || isGnomePlatformMissing) {
      app.commandLine.appendSwitch('ozone-platform', 'x11');
      log(
        `Snap: forcing X11 (wayland=${isWaylandSession}, gnomePlatformMissing=${isGnomePlatformMissing}, XDG_SESSION_TYPE=${process.env.XDG_SESSION_TYPE ?? 'unset'}, WAYLAND_DISPLAY=${process.env.WAYLAND_DISPLAY ? 'set' : 'unset'})`,
      );
    }
  }

  // NOTE: needs to be executed before everything else
  process.argv.forEach((val) => {
    if (val && val.includes('--disable-tray')) {
      isDisableTray = true;
      log('Disable tray icon');
    }

    if (val && val.includes('--force-dark-tray')) {
      forceDarkTray = true;
      log('Force dark mode for tray icon');
    }

    if (val && val.includes('--user-data-dir=')) {
      const customUserDir = val
        .replace('--user-data-dir=', '')
        .trim()
        .replace(/[\/\\]+$/, ''); // Remove trailing slashes
      log('Using custom directory for user data', customUserDir);
      app.setPath('userData', customUserDir);
      wasUserDataDirSet = true;
    }

    if (val && val.includes('--custom-url=')) {
      customUrl = val.replace('--custom-url=', '').trim();
      log('Using custom url', customUrl);
    }

    if (val && val.includes('--dev-tools')) {
      isShowDevTools = true;
    }
  });

  // TODO remove at one point in the future and only leave the directory setting part
  // Special handling for snaps, since default user folder will cause problems when updating
  if (
    !wasUserDataDirSet &&
    process.platform === 'linux' &&
    process.env.SNAP &&
    process.env.SNAP_USER_COMMON
  ) {
    // COPY LEGACY SNAP DATA TO COMMON DIRECTORY
    // -----------------------------------------
    const appName = app.getName();
    const commonDir = process.env.SNAP_USER_COMMON;
    const newPath = join(commonDir, '.config', appName);

    // SET COMMON DIRECTORY AS USER DATA DIRECTORY
    // -------------------------------------------
    // set userDa dir to common data to avoid the data being accessed by the update process
    app.setPath('userData', newPath);
    app.setAppLogsPath();
  }

  // Defense-in-depth against GPU init failures on confined Linux packages
  // (Snap Mesa ABI drift, missing DRI nodes under Flatpak, etc.) where the
  // main process stays alive but the GPU process crashes at init and the
  // window never renders. `--disable-gpu` avoids the hardware Mesa DRI
  // driver load path — which is the ABI-drift source on confined Snap.
  // Note: `--disable-gpu` does NOT guarantee "no GPU process" on Linux
  // (Chromium may still run a GPU process in SwiftShader or
  // DisplayCompositor mode), but those modes don't dlopen Mesa DRI
  // drivers, which is what matters for this bug. `--disable-software-
  // rasterizer` is added as belt-and-braces; the combined pair is what
  // Chromium's own GPU integration tests treat as "no GPU process."
  // `app.disableHardwareAcceleration()` only disables compositor accel
  // and leaves the failing GPU-process-init path active.
  //
  // `--ozone-platform=x11` is also stacked: on Chromium 140+/Electron 38+
  // the Wayland auto-detection can dlopen libgbm in browser-side init
  // before the GPU-process gate, so the flag pair alone is a false
  // negative on Flatpak+Wayland hosts. On Snap this is redundant with
  // the X11 widening block above, but appending twice is harmless (last
  // value wins in Chromium argv parsing).
  //
  // IMPORTANT: must stay after every `app.setPath('userData', ...)` call
  // above — the marker lives in userData.
  const gpuDecision = evaluateGpuStartupGuard(app.getPath('userData'));
  if (gpuDecision.disableGpu) {
    app.commandLine.appendSwitch('disable-gpu');
    app.commandLine.appendSwitch('disable-software-rasterizer');
    app.commandLine.appendSwitch('ozone-platform', 'x11');
    log(
      `Disabling GPU acceleration (reason: ${gpuDecision.reason}). ` +
        `Set SP_ENABLE_GPU=1 to force-enable on the next launch` +
        (gpuDecision.markerPath ? ` or delete ${gpuDecision.markerPath}.` : '.'),
    );
  }

  initDebug({ showDevTools: isShowDevTools }, IS_DEV);

  // NOTE: opening the folder crashes the mas build
  if (!IS_MAC) {
    electronDl({
      openFolderWhenDone: true,
      onCompleted: (file) => {
        if (mainWin) {
          mainWin.webContents.send(IPC.ANY_FILE_DOWNLOADED, file);
        }
      },
    });
  }

  // Allow invalid certificates for self-hosted services (Jira, GitLab, Redmine, etc.)
  // WARNING: This bypasses certificate validation for ALL URLs. Many users rely on
  // self-signed certificates for their self-hosted integrations, so removing this
  // would be a breaking change. The trade-off is reduced TLS security in exchange
  // for compatibility with self-hosted servers.
  appIN.on('certificate-error', (event, webContents, url, err, certificate, callback) => {
    warn(`Certificate error for ${url}: ${err}`);
    event.preventDefault();
    callback(true);
  });

  // APP EVENT LISTENERS
  // -------------------
  appIN.on('ready', () => {
    // Clear GPU cache when Electron version changes to prevent blank/black screens.
    // Stale GPU shader caches from old Electron versions cause rendering failures.
    // Pattern used by Obsidian's Flatpak wrapper.
    if (process.platform === 'linux') {
      const userDataPath = app.getPath('userData');
      const versionFile = join(userDataPath, '.electron-version');
      const currentVersion = process.versions.electron;
      try {
        let lastVersion = '';
        try {
          lastVersion = fs.readFileSync(versionFile, 'utf8').trim();
        } catch {
          // File doesn't exist on first run
        }
        if (lastVersion !== currentVersion) {
          const gpuCachePath = join(userDataPath, 'GPUCache');
          if (fs.existsSync(gpuCachePath)) {
            fs.rmSync(gpuCachePath, { recursive: true, force: true });
            log(
              `Cleared GPUCache after Electron upgrade (${lastVersion} -> ${currentVersion})`,
            );
          }
          fs.mkdirSync(userDataPath, { recursive: true });
          fs.writeFileSync(versionFile, currentVersion);
        }
      } catch (e) {
        log('Failed to check/clear GPU cache:', e);
      }
    }
  });

  appIN.on('ready', () => createMainWin());
  appIN.on('ready', () => initBackupAdapter());
  appIN.on('ready', () => initLocalFileSyncAdapter());
  appIN.on('ready', () => initFullScreenBlocker(IS_DEV));

  if (!isDisableTray) {
    appIN.on('ready', createIndicator);
  }

  appIN.on('activate', () => {
    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (mainWin === null) {
      createMainWin();
    } else {
      showApp();
    }
  });

  appIN.on('ready', () => {
    // Initialize idle time handler
    idleTimeHandler = new IdleTimeHandler();

    let suspendStart: number;
    // Prevent overlapping async idle checks.
    // lazySetInterval schedules the next tick regardless of whether the previous
    // check finished. Our idle detection on Wayland may spawn external commands
    // (gdbus/dbus-send/xprintidle/loginctl) which can take close to or longer than
    // the poll interval. Without this guard, multiple checks can run concurrently,
    // causing timeouts and subsequent 0ms readings, which looks like "only one
    // idle event was ever sent". This ensures at most one check runs at a time.
    let isCheckingIdle = false;
    const sendIdleMsgIfOverMin = (
      idleTime: number,
    ): { sent: boolean; reason?: string } => {
      // sometimes when starting a second instance we get here although we don't want to
      if (!mainWin) {
        info(
          'special case occurred when trackTimeFn is called even though, this is a second instance of the app',
        );
        return { sent: false, reason: 'no-window' };
      }

      if (getIsQuiting()) {
        return { sent: false, reason: 'quitting' };
      }

      if (idleTime <= CONFIG.MIN_IDLE_TIME) {
        return { sent: false, reason: 'below-threshold' };
      }

      mainWin.webContents.send(IPC.IDLE_TIME, idleTime);
      return { sent: true };
    };

    // --------IDLE HANDLING---------
    let consecutiveFailures = 0;
    // init time tracking interval
    log(
      `🚀 Starting idle time tracking (interval: ${CONFIG.IDLE_PING_INTERVAL}ms, threshold: ${CONFIG.MIN_IDLE_TIME}ms)`,
    );
    const stopIdleChecks: () => void = lazySetInterval(async (): Promise<void> => {
      // Skip if a previous check is still in flight
      if (isCheckingIdle) {
        return;
      }
      isCheckingIdle = true;
      const startTime = Date.now();
      try {
        const idleTime = await idleTimeHandler.getIdleTime();
        const checkDuration = Date.now() - startTime;

        consecutiveFailures = 0;
        const sendResult = sendIdleMsgIfOverMin(idleTime);
        const actionSummary = sendResult.sent
          ? 'sent'
          : `skipped:${sendResult.reason ?? 'unknown'}`;
        const logParts = [
          `idle=${idleTime}ms`,
          `method=${idleTimeHandler.currentMethod}`,
          `duration=${checkDuration}ms`,
          `threshold=${CONFIG.MIN_IDLE_TIME}ms`,
          `action=${actionSummary}`,
        ];
        electronLog.debug(`🕘 Idle check (${logParts.join(', ')})`);
      } catch (error) {
        consecutiveFailures += 1;
        log('💥 Error getting idle time, falling back to powerMonitor:', error);
        if (consecutiveFailures >= 3) {
          stopIdleChecks();
        }
      } finally {
        isCheckingIdle = false;
      }
    }, CONFIG.IDLE_PING_INTERVAL);
    // --------END IDLE HANDLING---------

    // Track whether window was visible before suspend/lock so we only
    // restore keyboard focus for windows that were actually in use.
    // Using showOrFocus() unconditionally would surface hidden/minimized
    // windows on every wake/unlock — a UX regression.
    let wasVisibleBeforeSuspend = false;

    powerMonitor.on('suspend', () => {
      log('powerMonitor: System suspend detected');
      wasVisibleBeforeSuspend = mainWin.isVisible() && !mainWin.isMinimized();
      setIsLocked(true);
      suspendStart = Date.now();
      mainWin.webContents.send(IPC.SUSPEND);
    });

    powerMonitor.on('lock-screen', () => {
      log('powerMonitor: Screen lock detected');
      wasVisibleBeforeSuspend = mainWin.isVisible() && !mainWin.isMinimized();
      setIsLocked(true);
      suspendStart = Date.now();
      mainWin.webContents.send(IPC.SUSPEND);
    });

    powerMonitor.on('resume', () => {
      const idleTime = Date.now() - suspendStart;
      log(`powerMonitor: System resume detected. Idle time: ${idleTime}ms`);
      setIsLocked(false);
      sendIdleMsgIfOverMin(idleTime);
      mainWin.webContents.send(IPC.RESUME);
      // Restore keyboard focus only if window was visible before suspend (electron#20464)
      if (wasVisibleBeforeSuspend) {
        showOrFocus(mainWin);
      }
    });

    powerMonitor.on('unlock-screen', () => {
      const idleTime = Date.now() - suspendStart;
      log(`powerMonitor: Screen unlock detected. Idle time: ${idleTime}ms`);
      setIsLocked(false);
      sendIdleMsgIfOverMin(idleTime);
      mainWin.webContents.send(IPC.RESUME);
      // Restore keyboard focus only if window was visible before lock (electron#20464)
      if (wasVisibleBeforeSuspend) {
        showOrFocus(mainWin);
      }
    });
  });

  appIN.on('will-quit', () => {
    // un-register all shortcuts.
    globalShortcut.unregisterAll();
    // Safe to remove IPC listeners here: all windows are closed and before-close
    // IPC flows (sync, finish-day) are guaranteed to have completed.
    ipcMain.removeAllListeners();
  });

  appIN.on('before-quit', (event) => {
    log('App before-quit: isQuiting=', getIsQuiting());
    if (!getIsQuiting()) {
      // Native quit path (Cmd+Q, Dock > Quit on macOS): app.quit() was called
      // by the OS without going through quitApp(), so isQuiting was never set.
      // Prevent the immediate quit and delegate to the window close handler,
      // which manages the before-close callback flow (sync, finish-day, etc.)
      // and sets isQuiting=true before re-quitting.
      event.preventDefault();
      const win = getWin();
      if (win && !win.isDestroyed()) {
        win.close();
      } else {
        // No window to close — set flag and re-trigger quit directly.
        setIsQuiting(true);
        app.quit();
      }
      return;
    }
    // isQuiting=true: all before-close IPC work is complete — safe to clean up.
    destroyTaskWidget();
    if (global.gc) {
      global.gc();
    }
  });

  appIN.on('window-all-closed', () => {
    log('Quit after all windows being closed');
    // Force quit the app
    app.quit();

    // If app doesn't quit within 2 seconds, force exit
    setTimeout(() => {
      log('Force exiting app as it did not quit properly');
      app.exit(0);
    }, 2000);
  });
  process.on('uncaughtException', (err) => {
    console.log(err);
    process.exit(333);
  });

  // AUTO-UPDATER
  // ------------
  // appIN.on('ready', () => {
  //  // init auto-updates
  //  log.info('INIT AUTO UPDATES');
  //  // log.info(autoUpdater.getFeedURL());
  //  autoUpdater.logger = log;
  //  autoUpdater.logger.transports.file.level = 'info';
  //  autoUpdater.checkForUpdatesAndNotify();
  // });
  //
  // autoUpdater.on('update-downloaded', (ev, info) => {
  //  log(ev);
  //  // Wait 5 seconds, then quit and install
  //  // In your application, you don't need to wait 5 seconds.
  //  // You could call autoUpdater.quitAndInstall(); immediately
  //  setTimeout(function() {
  //    autoUpdater.quitAndInstall();
  //  }, 5000)
  // });

  // HELPER FUNCTIONS
  // ----------------
  // eslint-disable-next-line prefer-arrow/prefer-arrow-functions
  function createIndicator(): void {
    initIndicator({
      app,
      showApp,
      quitApp,
      ICONS_FOLDER,
      forceDarkTray,
    });
  }

  // eslint-disable-next-line prefer-arrow/prefer-arrow-functions
  async function createMainWin(): Promise<void> {
    // Remove stale LevelDB LOCK files before the renderer opens IndexedDB.
    // Orphaned locks from unclean session shutdowns block the backing store open.
    await clearStaleLevelDbLocks(app.getPath('userData'));

    mainWin = await createWindow({
      app,
      IS_DEV,
      ICONS_FOLDER,
      quitApp,
      customUrl,
    });

    initPluginOAuth(mainWin);

    // Process any pending protocol URLs after window is created
    setTimeout(() => {
      processPendingProtocolUrls(mainWin);
    }, 1000);
  }

  // eslint-disable-next-line prefer-arrow/prefer-arrow-functions
  function showApp(): void {
    showOrFocus(mainWin);
  }

  // required for graceful closing
  // @see: https://github.com/electron/electron/issues/5708
  process.on('exit', () => {
    setTimeout(() => {
      log('Quit after process exit');
      app.quit();
    }, 100);
  });
};
