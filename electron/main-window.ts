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
import { isExternalUrlSchemeAllowed } from './shared-with-frontend/is-external-url-allowed';
import { isLocalFileUrl, openLocalPath } from './open-url';
import { readFileSync, stat, writeFileSync } from 'fs';
import { error, log } from 'electron-log/main';
import { IS_MAC, IS_GNOME_WAYLAND } from './common.const';
import {
  destroyTaskWidget,
  getIsTaskWidgetAlwaysShow,
  getIsTaskWidgetUserForcedVisible,
  hideTaskWidget,
  showTaskWidget,
} from './task-widget/task-widget';
import { ensureIndicator } from './indicator';
import { getIsMinimizeToTray, getIsQuiting, setIsQuiting } from './shared-state';
import { loadSimpleStoreAll } from './simple-store';
import { SimpleStoreKey } from './shared-with-frontend/simple-store.const';
import { markGpuStartupSuccess } from './gpu-startup-guard';
import { isAppOriginUrl } from './navigation-guard';
import { applyJiraImageAuth } from './jira-image-auth';

let mainWin: BrowserWindow;

// The URL passed to `mainWin.loadURL()` — the single source of truth for
// "what is the app's own origin?". Read by the will-navigate / will-redirect
// guards in `initWinEventListeners`. Set in `createWindow`, before listeners
// are wired, so the guard never sees `undefined` at runtime.
let appLoadedUrl: string | undefined;

// Compact WCO band on Win/Linux. Native button width is OS-controlled
// (~138px total); only height is configurable. Lower values may be
// clamped to the OS minimum (~24–28px on Win11) — Electron silently
// floors instead of rejecting. Stays well clear of the vertical action
// strip which positions itself --bar-height (48px) down.
const WCO_HEIGHT = 24;

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

// How long the "quit requested" intent survives before auto-clearing.
// Long enough to cover normal before-close IPC (sync, finish-day prompt);
// short enough that if the user cancels finish-day and then clicks the
// window close button, they get their normal minimize-to-tray behavior
// rather than being re-prompted indefinitely.
const QUIT_REQUEST_TIMEOUT_MS = 5_000;

let isQuitRequested = false;
let quitRequestResetTimer: NodeJS.Timeout | undefined;

const getIsQuitRequested = (): boolean => isQuitRequested;

const setIsQuitRequested = (flag: boolean): void => {
  if (quitRequestResetTimer) clearTimeout(quitRequestResetTimer);
  isQuitRequested = flag;
  quitRequestResetTimer = flag
    ? setTimeout(() => {
        isQuitRequested = false;
        quitRequestResetTimer = undefined;
      }, QUIT_REQUEST_TIMEOUT_MS)
    : undefined;
};

export const closeWinAndQuit = (quitApp: () => void): void => {
  if (mainWin && !mainWin.isDestroyed()) {
    // Ensure the close handler takes the real close path (not the minimize-to-tray
    // hide branch) so the before-close IPC flow (sync, finish-day) completes.
    setIsQuitRequested(true);
    mainWin.close();
  } else {
    // No window to drive the IPC flow through — quit directly. No flag
    // needed: the close handler that reads it cannot run without a window.
    quitApp();
  }
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
    !IS_GNOME_WAYLAND;
  // GNOME + Wayland can't render the Window-Controls-Overlay when titleBarStyle
  // is 'hidden', leaving the window with no min/max/close controls. Force native
  // decorations only for that combination; GNOME-on-X11 and every other desktop
  // honor the user's preference. Keep in sync with global-theme.service.ts.
  const isUseCustomWindowTitleBar = IS_GNOME_WAYLAND
    ? false
    : userPrefersCustomWindowTitleBar;
  // On macOS use 'hiddenInset' so AppKit positions the traffic lights at the
  // standard inset other native apps use (Notes, Mail, VS Code) instead of
  // crowding the top-left corner. Other platforms keep the existing logic.
  const titleBarStyle: BrowserWindowConstructorOptions['titleBarStyle'] = IS_MAC
    ? 'hiddenInset'
    : isUseCustomWindowTitleBar
      ? 'hidden'
      : 'default';
  // Determine initial symbol color based on system theme preference
  const initialSymbolColor = nativeTheme.shouldUseDarkColors ? '#fff' : '#000';
  const titleBarOverlay: BrowserWindowConstructorOptions['titleBarOverlay'] =
    isUseCustomWindowTitleBar && !IS_MAC
      ? {
          color: getTitleBarColor(nativeTheme.shouldUseDarkColors),
          symbolColor: initialSymbolColor,
          height: WCO_HEIGHT,
        }
      : undefined;

  // The store-screenshot pipeline forces a fixed 1280×800 window so the
  // PNG dimensions match what the Mac App Store accepts (2560×1600 @2x).
  // On laptop displays, menu bar + dock leave less than 800pt available
  // below the menu bar, so by default macOS clamps `setBounds(800)` down
  // to the available area and the captured PNG ends up 20–40 px short of
  // the required height. Setting `enableLargerThanScreen` lets the
  // window keep its configured 800pt outer height regardless. Gated on
  // the env var the screenshot fixture sets so normal users still get
  // the default screen-clamping behavior.
  const isScreenshotMode = process.env.SP_SCREENSHOT_MODE === '1';
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
    enableLargerThanScreen: isScreenshotMode,
    show: false,
    webPreferences: {
      scrollBounce: true,
      backgroundThrottling: false,
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
    applyJiraImageAuth(details.url, requestHeaders, details.resourceType);
    callback({ requestHeaders });
  });

  mainWin.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const { responseHeaders } = details;
    upsertKeyValue(responseHeaders, 'Access-Control-Allow-Origin', ['*']);
    upsertKeyValue(responseHeaders, 'Access-Control-Allow-Headers', ['*']);
    upsertKeyValue(responseHeaders, 'Access-Control-Allow-Methods', ['*']);

    // CORS preflight must return 2xx to pass the browser check. Force all
    // OPTIONS responses to 200 OK unconditionally: some servers reject
    // preflights with 401 (auth required, < 300) or 405 (>= 300), both of
    // which the browser rejects even with the injected CORS headers.
    const statusLine = details.method === 'OPTIONS' ? 'HTTP/1.1 200 OK' : undefined;

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
  setWasMaximizedBeforeHide(mainWin.isMaximized());

  // Fix for #7276: electron-window-state saves state in its `closed` handler,
  // which calls win.isMaximized() on an already-hidden window (tray/shortcut
  // hide → quit). electron#27838 makes isMaximized() return false in that
  // case, so the persisted state loses the maximized flag. will-quit is the
  // only process-level hook guaranteed to fire after every window `closed`
  // event, so the library's write has always completed by the time we patch.
  app.once('will-quit', () => {
    if (!getWasMaximizedBeforeHide()) return;
    const file = path.join(app.getPath('userData'), 'window-state.json');
    try {
      const state = JSON.parse(readFileSync(file, 'utf8'));
      if (!state || typeof state !== 'object' || Array.isArray(state)) return;
      if (state.isMaximized === true) return;
      state.isMaximized = true;
      writeFileSync(file, JSON.stringify(state));
    } catch (err) {
      error('Failed to patch window-state.json for maximized flag:', err);
    }
  });

  const url = customUrl
    ? customUrl
    : IS_DEV
      ? 'http://localhost:4200'
      : `file://${normalize(join(__dirname, '../.tmp/angular-dist/browser/index.html'))}`;

  // Capture the loaded URL so the navigation guard (initWinEventListeners →
  // will-navigate) can compare against the actual app origin, not a derived
  // guess. Any URL change here automatically tightens the guard.
  appLoadedUrl = url;

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
          height: WCO_HEIGHT,
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
    // Defense in depth: never hand an unsafe scheme to the OS handler, even if
    // a renderer-side guard is bypassed (e.g. a link click that falls through
    // to navigation rather than the explicit openExternalUrl IPC). The blocked
    // schemes are OS protocol handlers / UNC paths. See GHSA-hr87-735w-hfq3.
    if (!isExternalUrlSchemeAllowed(url)) {
      error('Refused to open URL with disallowed scheme via openExternal');
      return;
    }
    // A local file: URL (a folder/file linked from a task) must open via
    // openPath, not openExternal: openExternal percent-encodes the path and
    // Windows' ShellExecute then can't resolve non-ASCII names or spaces.
    // See openLocalPath / issue #8695.
    if (isLocalFileUrl(url)) {
      openLocalPath(url);
      return;
    }
    // needed for mac; especially for jira urls we might have a host like this www.host.de//
    const urlObj = new URL(url);
    urlObj.pathname = urlObj.pathname.replace('//', '/');
    const wellFormedUrl = urlObj.toString();
    // shell.openExternal returns Promise<void>; surface the failure to the
    // renderer (snack via IPC.ERROR) so users on sandboxed packagings
    // (Flatpak without OpenURI portal, etc.) see why nothing happened.
    shell.openExternal(wellFormedUrl).catch((err) => {
      error('Failed to open external URL via shell.openExternal:', err);
      // Best-effort renderer notification — guard against the case where the
      // frontend isn't ready (e.g. during shutdown or pre-load), in which
      // case errorHandlerWithFrontendInform throws synchronously.
      try {
        errorHandlerWithFrontendInform(
          'Could not open the link in your browser. Copy the URL manually if available.',
          err,
        );
      } catch (informErr) {
        error('Could not surface open-external failure to renderer:', informErr);
      }
    });
  };

  // Compare the navigation target against the URL the app actually loaded
  // (captured at loadURL time in createWindow). Anything else is treated as
  // external and routed through the scheme-guarded `openUrlInBrowser`.
  //
  // The main window has Node integration via the preload bridge (`window.ea`).
  // Allowing in-window navigation to ANY other origin — including
  // http://127.0.0.1:<any-port> — would expose that bridge to whatever page
  // happens to be served there (a malicious local web server, a sibling
  // electron app, etc.). The previous host-only check accepted those.
  //
  // Hash-only changes do NOT fire will-navigate, so this never fires for
  // the app's own hash routes (HashLocationStrategy in src/main.ts).
  const guardNavigation = (
    ev: { preventDefault: () => void },
    url: string,
    eventLabel: string,
  ): void => {
    if (appLoadedUrl && isAppOriginUrl(url, appLoadedUrl)) return;
    ev.preventDefault();
    log(`Blocked in-window navigation (${eventLabel})`);
    openUrlInBrowser(url);
  };

  mainWin.webContents.on('will-navigate', (ev, url) => {
    guardNavigation(ev, url, 'will-navigate');
  });
  // Defense in depth: a same-origin navigation could redirect to a different
  // origin server-side. Re-run the same check on the redirect target so a
  // ‘302 → http://127.0.0.1:1337’ cannot land the bridge on an attacker page.
  mainWin.webContents.on('will-redirect', (ev, url) => {
    guardNavigation(ev, url, 'will-redirect');
  });
  mainWin.webContents.setWindowOpenHandler((details) => {
    openUrlInBrowser(details.url);
    return { action: 'deny' };
  });
  // Defense in depth: setWindowOpenHandler already denies, so this should
  // never fire. If a future code path ever enables window creation, destroy
  // the spawned window rather than letting it inherit the preload bridge.
  mainWin.webContents.on('did-create-window', (childWin) => {
    error('did-create-window fired despite deny handler — destroying child');
    try {
      childWin.destroy();
    } catch (e) {
      error('Failed to destroy unexpected child window:', e);
    }
  });

  // TODO refactor quitting mess
  appCloseHandler(app);
  appMinimizeHandler(app);

  // Handle restore and show events to hide task widget. `getIsTaskWidgetUserForcedVisible()`
  // keeps the widget up when the user explicitly revealed it via the global shortcut.
  mainWin.on('restore', () => {
    if (!getIsTaskWidgetAlwaysShow() && !getIsTaskWidgetUserForcedVisible()) {
      hideTaskWidget();
    }
  });

  mainWin.on('show', () => {
    if (!getIsTaskWidgetAlwaysShow() && !getIsTaskWidgetUserForcedVisible()) {
      hideTaskWidget();
    }
  });

  mainWin.on('focus', () => {
    if (
      mainWin.isVisible() &&
      !mainWin.isMinimized() &&
      !getIsTaskWidgetAlwaysShow() &&
      !getIsTaskWidgetUserForcedVisible()
    ) {
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
      label: 'Super Productivity',
      submenu: [
        { role: 'about', label: 'About Super Productivity' },
        { type: 'separator' },
        { role: 'hide', label: 'Hide Super Productivity' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        {
          label: 'Quit',
          accelerator: 'CmdOrCtrl+Q',
          click: () => closeWinAndQuit(quitApp),
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
      if (getIsMinimizeToTray() && !getIsQuitRequested()) {
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
    // Clear any pending reset timer so it doesn't keep the event loop alive
    // after the window is gone.
    setIsQuitRequested(false);

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
