import windowStateKeeper from 'electron-window-state';
import {
  App,
  BrowserWindow,
  BrowserWindowConstructorOptions,
  ipcMain,
  Menu,
  MenuItemConstructorOptions,
  nativeTheme,
  shell,
} from 'electron';
import { errorHandlerWithFrontendInform } from './error-handler-with-frontend-inform';
import * as path from 'path';
import { join, normalize } from 'path';
import { IPC } from './shared-with-frontend/ipc-events.const';
import { readFileSync, stat } from 'fs';
import { error, log } from 'electron-log/main';
import { IS_MAC, IS_GNOME_DESKTOP } from './common.const';
import {
  destroyTaskWidget,
  getIsTaskWidgetAlwaysShow,
  hideTaskWidget,
  showTaskWidget,
} from './task-widget/task-widget';
import { ensureIndicator } from './indicator';
import { getIsMinimizeToTray, getIsQuiting, setIsQuiting } from './shared-state';
import { loadSimpleStoreAll } from './simple-store';
import { SimpleStoreKey } from './shared-with-frontend/simple-store.const';
import { markGpuStartupSuccess } from './gpu-startup-guard';

let mainWin: BrowserWindow;

/**
 * Returns theme-aware background color for titlebar overlay.
 * Semi-transparent to ensure window controls are always visible.
 */
const getTitleBarColor = (isDark: boolean): string => {
  // Dark: matches --bg (#131314) with 0% opacity (fully transparent)
  // Light: matches --bg (#f8f8f7) with 0% opacity (fully transparent)
  return isDark ? 'rgba(19, 19, 20, 0)' : 'rgba(248, 248, 247, 0)';
};

const mainWinModule: {
  win?: BrowserWindow;
  isAppReady: boolean;
} = {
  win: undefined,
  isAppReady: false,
};

export const getWin = (): BrowserWindow => {
  if (!mainWinModule.win) {
    throw new Error('No main window');
  }
  return mainWinModule.win;
};

export const getIsAppReady = (): boolean => {
  return mainWinModule.isAppReady;
};

export const createWindow = async ({
  IS_DEV,
  ICONS_FOLDER,
  quitApp,
  app,
  customUrl,
}: {
  IS_DEV: boolean;
  ICONS_FOLDER: string;
  quitApp: () => void;
  app: App;
  customUrl?: string;
}): Promise<BrowserWindow> => {
  // make sure the main window isn't already created
  if (mainWin) {
    errorHandlerWithFrontendInform('Main window already exists');
    return mainWin;
  }

  // workaround for https://github.com/electron/electron/issues/16521
  if (!IS_MAC) {
    Menu.setApplicationMenu(null);
  }

  const mainWindowState = windowStateKeeper({
    defaultWidth: 800,
    defaultHeight: 800,
  });

  const simpleStore = await loadSimpleStoreAll();
  const persistedIsUseCustomWindowTitleBar =
    simpleStore[SimpleStoreKey.IS_USE_CUSTOM_WINDOW_TITLE_BAR];
  const legacyIsUseObsidianStyleHeader =
    simpleStore[SimpleStoreKey.LEGACY_IS_USE_OBSIDIAN_STYLE_HEADER];
  const userPrefersCustomWindowTitleBar =
    persistedIsUseCustomWindowTitleBar ??
    legacyIsUseObsidianStyleHeader ??
    !IS_GNOME_DESKTOP;
  // GNOME + Wayland combinations can miss native controls when titleBarStyle is hidden.
  // Force native decorations on GNOME to keep window controls available.
  const isUseCustomWindowTitleBar = IS_GNOME_DESKTOP
    ? false
    : userPrefersCustomWindowTitleBar;
  const titleBarStyle: BrowserWindowConstructorOptions['titleBarStyle'] =
    isUseCustomWindowTitleBar || IS_MAC ? 'hidden' : 'default';
  // Determine initial symbol color based on system theme preference
  const initialSymbolColor = nativeTheme.shouldUseDarkColors ? '#fff' : '#000';
  const titleBarOverlay: BrowserWindowConstructorOptions['titleBarOverlay'] =
    isUseCustomWindowTitleBar && !IS_MAC
      ? {
          color: getTitleBarColor(nativeTheme.shouldUseDarkColors),
          symbolColor: initialSymbolColor,
          height: 44,
        }
      : undefined;

  mainWin = new BrowserWindow({
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: mainWindowState.width,
    height: mainWindowState.height,
    minHeight: 240,
    minWidth: 300,
    title: IS_DEV ? 'Super Productivity D' : 'Super Productivity',
    titleBarStyle,
    titleBarOverlay,
    show: false,
    webPreferences: {
      scrollBounce: true,
      backgroundThrottling: false,
      // CORS is handled at the session level via onBeforeSendHeaders (strips Origin)
      // and onHeadersReceived (injects Access-Control-Allow-* headers)
      webSecurity: true,
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      // make remote module work with those two settings
      contextIsolation: true,
      // Additional settings for better Linux/Wayland compatibility
      enableBlinkFeatures: 'OverlayScrollbar',
      // Disable spell checker to prevent connections to Google services (#5314)
      // This maintains our "offline-first with zero data collection" promise
      spellcheck: false,
    },
    icon: ICONS_FOLDER + '/icon_256x256.png',
    // Wayland compatibility: disable transparent/frameless features that can cause issues
    transparent: false,
    // frame: true,
  });

  // see: https://pratikpc.medium.com/bypassing-cors-with-electron-ab7eaf331605
  mainWin.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
    const { requestHeaders } = details;
    removeKeyInAnyCase(requestHeaders, 'Origin');
    removeKeyInAnyCase(requestHeaders, 'Referer');
    removeKeyInAnyCase(requestHeaders, 'Cookie');
    removeKeyInAnyCase(requestHeaders, 'sec-ch-ua');
    removeKeyInAnyCase(requestHeaders, 'sec-ch-ua-mobile');
    removeKeyInAnyCase(requestHeaders, 'sec-ch-ua-platform');
    removeKeyInAnyCase(requestHeaders, 'sec-fetch-dest');
    removeKeyInAnyCase(requestHeaders, 'sec-fetch-mode');
    removeKeyInAnyCase(requestHeaders, 'sec-fetch-site');
    removeKeyInAnyCase(requestHeaders, 'accept-encoding');
    removeKeyInAnyCase(requestHeaders, 'accept-language');
    removeKeyInAnyCase(requestHeaders, 'priority');
    removeKeyInAnyCase(requestHeaders, 'accept');

    // NOTE this is needed for GitHub api requests to work :(
    // office365 needs a User-Agent as well (#4677)
    if (
      ['github.com', 'office365.com', 'outlook.live.com'].includes(
        new URL(details.url).hostname,
      )
    ) {
      removeKeyInAnyCase(requestHeaders, 'User-Agent');
    }
    callback({ requestHeaders });
  });

  mainWin.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const { responseHeaders } = details;
    upsertKeyValue(responseHeaders, 'Access-Control-Allow-Origin', ['*']);
    upsertKeyValue(responseHeaders, 'Access-Control-Allow-Headers', ['*']);
    upsertKeyValue(responseHeaders, 'Access-Control-Allow-Methods', ['*']);

    // CORS preflight must return 2xx to pass the browser check. Stripping
    // the Origin header (above) can cause some servers to respond with a
    // non-200 status for OPTIONS, which the browser rejects even with the
    // injected CORS headers.
    const statusLine =
      details.method === 'OPTIONS' && details.statusCode >= 300
        ? 'HTTP/1.1 200 OK'
        : undefined;

    callback({
      responseHeaders,
      statusLine,
    });
  });

  // Deny unnecessary permissions (webcam, microphone, geolocation, etc.)
  // The app only needs notifications for desktop reminders
  const allowedPermissions = ['notifications'];
  mainWin.webContents.session.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      callback(allowedPermissions.includes(permission));
    },
  );
  mainWin.webContents.session.setPermissionCheckHandler((_webContents, permission) => {
    return allowedPermissions.includes(permission);
  });

  mainWindowState.manage(mainWin);

  const url = customUrl
    ? customUrl
    : IS_DEV
      ? 'http://localhost:4200'
      : `file://${normalize(join(__dirname, '../.tmp/angular-dist/browser/index.html'))}`;

  mainWin.loadURL(url).then(() => {
    // Set window title for dev mode
    if (IS_DEV) {
      mainWin.setTitle('Super Productivity D');
    }

    // load custom stylesheet if any
    const CSS_FILE_PATH = app.getPath('userData') + '/styles.css';
    stat(app.getPath('userData') + '/styles.css', (err) => {
      if (err) {
        log('No custom styles detected at ' + CSS_FILE_PATH);
      } else {
        log('Loading custom styles from ' + CSS_FILE_PATH);
        const styles = readFileSync(CSS_FILE_PATH, { encoding: 'utf8' });
        try {
          mainWin.webContents.insertCSS(styles);
          log('Custom styles loaded successfully');
        } catch (cssError) {
          error('Failed to load custom styles:', cssError);
        }
      }
    });
  });

  // show gracefully
  mainWin.once('ready-to-show', () => {
    mainWin.show();

    // Workaround for Windows phantom focus bug (electron#20464):
    // show() can silently fail to acquire keyboard focus after reboot.
    // blur() is not supported on Wayland and limited on macOS, so only
    // apply the blur+focus cycle on Windows.
    const IS_WINDOWS = process.platform === 'win32';
    setTimeout(() => {
      if (mainWin.isDestroyed()) return;
      if (IS_WINDOWS) {
        mainWin.blur();
      }
      mainWin.focus();
      if (!mainWin.webContents.isDestroyed()) {
        mainWin.webContents.focus();
      }
    }, 60);
  });

  initWinEventListeners(app);

  if (IS_MAC) {
    createMenu(quitApp);
  } else {
    mainWin.setMenu(null);
    mainWin.setMenuBarVisibility(false);
  }

  // update prop
  mainWinModule.win = mainWin;

  // listen for app ready
  ipcMain.on(IPC.APP_READY, () => {
    mainWinModule.isAppReady = true;
    // Signal the GPU startup guard that the full boot chain completed
    // (including Angular init) — not just that the compositor painted a
    // frame. This avoids clearing the crash counter on blank/broken
    // renderers that still fire `ready-to-show`.
    markGpuStartupSuccess();
  });

  // Register F11 key handler for fullscreen toggle
  mainWin.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      event.preventDefault();
      mainWin.setFullScreen(!mainWin.isFullScreen());
    }
  });

  // Notify renderer of fullscreen state changes (used for app border visibility)
  mainWin.on('enter-full-screen', () => {
    mainWin.webContents.send(IPC.ENTER_FULL_SCREEN);
  });
  mainWin.on('leave-full-screen', () => {
    mainWin.webContents.send(IPC.LEAVE_FULL_SCREEN);
  });
  mainWin.webContents.on('did-finish-load', () => {
    if (mainWin.isFullScreen()) {
      mainWin.webContents.send(IPC.ENTER_FULL_SCREEN);
    }
  });

  // Listen for theme changes to update title bar overlay color and symbol
  if (isUseCustomWindowTitleBar && !IS_MAC) {
    ipcMain.on(IPC.UPDATE_TITLE_BAR_DARK_MODE, (ev, isDarkMode: boolean) => {
      try {
        const symbolColor = isDarkMode ? '#fff' : '#000';
        mainWin.setTitleBarOverlay({
          color: getTitleBarColor(isDarkMode),
          symbolColor,
          height: 44,
        });
      } catch (e) {
        // setTitleBarOverlay may not be available on all platforms
        log('Failed to update title bar overlay:', e);
      }
    });
  }

  return mainWin;
};

// isMaximized() can return an incorrect value after hide() — this is a known issue on certain platforms/configurations (electron#27838).
// to ensure maximized window state is restored reliably across all platforms, we manually track maximized state before hiding
let wasMaximizedBeforeHide: boolean = false;
export const getWasMaximizedBeforeHide = (): boolean => wasMaximizedBeforeHide;
export const setWasMaximizedBeforeHide = (value: boolean): void => {
  wasMaximizedBeforeHide = value;
};

// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
function initWinEventListeners(app: Electron.App): void {
  const openUrlInBrowser = (url: string): void => {
    // needed for mac; especially for jira urls we might have a host like this www.host.de//
    const urlObj = new URL(url);
    urlObj.pathname = urlObj.pathname.replace('//', '/');
    const wellFormedUrl = urlObj.toString();
    // shell.openExternal returns Promise<void>; surface the failure reason instead
    // of silently swallowing it (e.g. when xdg-open / Flatpak portal rejects the URI).
    shell.openExternal(wellFormedUrl).catch((err) => {
      error('Failed to open external URL via shell.openExternal:', err);
    });
  };

  // open new window links in browser
  mainWin.webContents.on('will-navigate', (ev, url) => {
    if (!url.includes('localhost')) {
      ev.preventDefault();
      openUrlInBrowser(url);
    }
  });
  mainWin.webContents.setWindowOpenHandler((details) => {
    openUrlInBrowser(details.url);
    return { action: 'deny' };
  });

  // TODO refactor quitting mess
  appCloseHandler(app);
  appMinimizeHandler(app);

  // Handle restore and show events to hide task widget
  mainWin.on('restore', () => {
    if (!getIsTaskWidgetAlwaysShow()) {
      hideTaskWidget();
    }
  });

  mainWin.on('show', () => {
    if (!getIsTaskWidgetAlwaysShow()) {
      hideTaskWidget();
    }
  });

  mainWin.on('focus', () => {
    if (mainWin.isVisible() && !mainWin.isMinimized() && !getIsTaskWidgetAlwaysShow()) {
      hideTaskWidget();
    }
  });

  // Handle hide event to show task widget
  mainWin.on('hide', () => {
    showTaskWidget();
  });

  // Handle maximize and unmaximize events to change wasMaximizedBeforeHide flag accordingly
  mainWin.on('maximize', () => {
    setWasMaximizedBeforeHide(true);
  });

  mainWin.on('unmaximize', () => {
    setWasMaximizedBeforeHide(false);
  });
}

// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
function createMenu(quitApp: () => void): void {
  // Create application menu to enable copy & pasting on MacOS
  const menuTpl: MenuItemConstructorOptions[] = [
    {
      label: 'Application',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        {
          label: 'Quit',
          accelerator: 'CmdOrCtrl+Q',
          click: quitApp,
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
  ];

  // we need to set a menu to get copy & paste working for mac os x
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTpl));
}

// TODO this is ugly as f+ck
const appCloseHandler = (app: App): void => {
  let ids: string[] = [];

  const _quitApp = (): void => {
    setIsQuiting(true);
    // Destroy task widget before closing main window to ensure window-all-closed fires
    destroyTaskWidget();
    mainWin.close();
  };

  ipcMain.on(IPC.REGISTER_BEFORE_CLOSE, (ev, { id }) => {
    ids.push(id);
  });
  ipcMain.on(IPC.UNREGISTER_BEFORE_CLOSE, (ev, { id }) => {
    ids = ids.filter((idIn) => idIn !== id);
  });
  ipcMain.on(IPC.BEFORE_CLOSE_DONE, (ev, { id }) => {
    ids = ids.filter((idIn) => idIn !== id);
    log(IPC.BEFORE_CLOSE_DONE, id, ids);
    if (ids.length === 0) {
      // Destroy task widget before closing main window
      destroyTaskWidget();
      mainWin.close();
    }
  });

  mainWin.on('close', (event) => {
    // NOTE: this might not work if we run a second instance of the app
    log('close event: isQuiting=', getIsQuiting(), 'pendingBeforeCloseIds=', ids);
    if (!getIsQuiting()) {
      if (getIsMinimizeToTray()) {
        const indicator = ensureIndicator();
        if (indicator) {
          event.preventDefault();
          setWasMaximizedBeforeHide(mainWin.isMaximized());
          mainWin.hide();
          showTaskWidget();
          return;
        }
      }

      event.preventDefault();

      if (ids.length > 0) {
        log('Actions to wait for ', ids);
        mainWin.webContents.send(IPC.NOTIFY_ON_CLOSE, ids);
      } else {
        _quitApp();
      }
    }
  });

  mainWin.on('closed', () => {
    // Dereference the window object
    mainWin = null;
    mainWinModule.win = null;
  });

  mainWin.webContents.on('render-process-gone', (event, detailed) => {
    log('!crashed, reason: ' + detailed.reason + ', exitCode = ' + detailed.exitCode);
    if (detailed.reason == 'crashed') {
      process.exit(detailed.exitCode);
      // relaunch app
      // app.relaunch({ args: process.argv.slice(1).concat(['--relaunch']) });
      // app.exit(0);
    }
  });
};

const appMinimizeHandler = (app: App): void => {
  if (!getIsQuiting()) {
    // TODO find reason for the typing error
    // @ts-ignore
    mainWin.on('minimize', (event: Event) => {
      if (getIsMinimizeToTray()) {
        const indicator = ensureIndicator();
        if (!indicator) {
          return;
        }
        event.preventDefault();
        setWasMaximizedBeforeHide(mainWin.isMaximized());
        mainWin.hide();
        showTaskWidget();
      } else {
        // For regular minimize (not to tray), also show task widget
        showTaskWidget();
        if (IS_MAC) {
          app.dock?.show();
        }
      }
    });
  }
};

const upsertKeyValue = <T extends Record<string, any> | undefined>(
  obj: T,
  keyToChange: string,
  value: string[],
): T => {
  if (!obj) return obj;
  const keyToChangeLower = keyToChange.toLowerCase();
  for (const key of Object.keys(obj)) {
    if (key.toLowerCase() === keyToChangeLower) {
      // Reassign old key
      (obj as any)[key] = value;
      // Done
      return obj;
    }
  }
  // Insert at end instead
  (obj as any)[keyToChange] = value;
  return obj;
};

const removeKeyInAnyCase = <T extends Record<string, any> | undefined>(
  obj: T,
  keyToRemove: string,
): T => {
  if (!obj) return obj;
  const keyToRemoveLower = keyToRemove.toLowerCase();
  for (const key of Object.keys(obj)) {
    if (key.toLowerCase() === keyToRemoveLower) {
      delete (obj as any)[key];
      return obj;
    }
  }
  return obj;
};
