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
import { format } from 'url';
import { IPC } from './shared-with-frontend/ipc-events.const';
import { readFileSync, stat } from 'fs';
import { error, log } from 'electron-log/main';
import { IS_MAC } from './common.const';
import {
  destroyOverlayWindow,
  hideOverlayWindow,
  showOverlayWindow,
} from './overlay-indicator/overlay-indicator';
import { getIsMinimizeToTray, getIsQuiting, setIsQuiting } from './shared-state';
import { loadSimpleStoreAll } from './simple-store';
import { SimpleStoreKey } from './shared-with-frontend/simple-store.const';

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
  const isUseCustomWindowTitleBar =
    persistedIsUseCustomWindowTitleBar ?? legacyIsUseObsidianStyleHeader ?? true;
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
      webSecurity: false,
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

    callback({
      responseHeaders,
    });
  });

  mainWindowState.manage(mainWin);

  const url = customUrl
    ? customUrl
    : IS_DEV
      ? 'http://localhost:4200'
      : format({
          pathname: normalize(join(__dirname, '../.tmp/angular-dist/browser/index.html')),
          protocol: 'file:',
          slashes: true,
        });

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

// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
function initWinEventListeners(app: Electron.App): void {
  const openUrlInBrowser = (url: string): void => {
    // needed for mac; especially for jira urls we might have a host like this www.host.de//
    const urlObj = new URL(url);
    urlObj.pathname = urlObj.pathname.replace('//', '/');
    const wellFormedUrl = urlObj.toString();
    const wasOpened = shell.openExternal(wellFormedUrl);
    if (!wasOpened) {
      shell.openExternal(wellFormedUrl);
    }
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

  // Handle restore and show events to hide overlay
  mainWin.on('restore', () => {
    hideOverlayWindow();
  });

  mainWin.on('show', () => {
    hideOverlayWindow();
  });

  mainWin.on('focus', () => {
    hideOverlayWindow();
  });

  // Handle hide event to show overlay
  mainWin.on('hide', () => {
    showOverlayWindow();
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
    // Destroy overlay window before closing main window to ensure window-all-closed fires
    destroyOverlayWindow();
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
      // Destroy overlay window before closing main window
      destroyOverlayWindow();
      mainWin.close();
    }
  });

  mainWin.on('close', (event) => {
    // NOTE: this might not work if we run a second instance of the app
    log('close, isQuiting:', getIsQuiting());
    if (!getIsQuiting()) {
      event.preventDefault();
      if (getIsMinimizeToTray()) {
        mainWin.hide();
        showOverlayWindow();
        return;
      }

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
        event.preventDefault();
        mainWin.hide();
        showOverlayWindow();
      } else {
        // For regular minimize (not to tray), also show overlay
        showOverlayWindow();
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
