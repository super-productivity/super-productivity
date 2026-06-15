import { app, BrowserWindow, ipcMain, screen } from 'electron';
import { join, normalize } from 'path';
import { IPC } from './shared-with-frontend/ipc-events.const';
import { getWinSafe } from './main-window';
import { isAppOriginUrl } from './navigation-guard';

let quickAddWin: BrowserWindow | null = null;
let loadUrl: string | undefined;
let wasMainWinFocused = false;
let mainWinWasVisible = false;
let isHidingProgrammatically = false;

export const initQuickAddWindow = (isDev: boolean, appUrl: string | undefined): void => {
  loadUrl =
    appUrl ||
    (isDev
      ? 'http://localhost:4200'
      : `file://${normalize(join(__dirname, '../.tmp/angular-dist/browser/index.html'))}`);

  // Pre-create the window on startup
  createQuickAddWindow();

  // Register IPC listeners
  ipcMain.on(IPC.QUICK_ADD_CLOSE, () => {
    hideQuickAddWindow(true);
  });

  ipcMain.on(IPC.QUICK_ADD_SUBMIT, (event, payload) => {
    // Forward the submit event to the main window
    try {
      const mainWin = getWinSafe();
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.webContents.send(IPC.QUICK_ADD_SUBMIT_FORWARD, payload);
      }
    } catch (e) {
      console.error('Error forwarding quick-add task submission to main window:', e);
    }
  });
};

export const destroyQuickAddWindow = (): void => {
  ipcMain.removeAllListeners(IPC.QUICK_ADD_CLOSE);
  ipcMain.removeAllListeners(IPC.QUICK_ADD_SUBMIT);

  if (quickAddWin && !quickAddWin.isDestroyed()) {
    try {
      quickAddWin.destroy();
    } catch (e) {
      console.error('Error destroying quick-add window:', e);
    }
  }
  quickAddWin = null;
};

const getActiveDisplayBounds = (): {
  x: number;
  y: number;
  width: number;
  height: number;
} => {
  try {
    const cursorPoint = screen.getCursorScreenPoint();
    const activeDisplay = screen.getDisplayNearestPoint(cursorPoint);
    return activeDisplay.bounds;
  } catch (e) {
    console.error('Error getting cursor display, falling back to primary display:', e);
    return screen.getPrimaryDisplay().bounds;
  }
};

const createQuickAddWindow = (): void => {
  if (quickAddWin && !quickAddWin.isDestroyed()) return;

  const { x, y, width, height } = getActiveDisplayBounds();

  quickAddWin = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    closable: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      scrollBounce: false,
      backgroundThrottling: false,
      webSecurity: true,
      preload: join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      disableDialogs: true,
    },
  });

  const url = `${loadUrl}#/quick-add`;
  quickAddWin.loadURL(url);

  // Security: Navigation Guards
  quickAddWin.webContents.on('will-navigate', (ev, navUrl) => {
    if (loadUrl && isAppOriginUrl(navUrl, loadUrl)) return;
    ev.preventDefault();
  });
  quickAddWin.webContents.on('will-redirect', (ev, navUrl) => {
    if (loadUrl && isAppOriginUrl(navUrl, loadUrl)) return;
    ev.preventDefault();
  });
  quickAddWin.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });

  quickAddWin.on('closed', () => {
    quickAddWin = null;
  });

  // Prevent right clicks
  quickAddWin.webContents.on('context-menu', (e) => {
    e.preventDefault();
  });

  // Handle window focus loss - hide it
  quickAddWin.on('blur', () => {
    if (!isHidingProgrammatically) {
      hideQuickAddWindow(false);
    }
  });
};

export const showQuickAddWindow = (): void => {
  if (!quickAddWin || quickAddWin.isDestroyed()) {
    createQuickAddWindow();
  }

  // Track whether the main window was the focused app window before we opened.
  // On macOS, getFocusedWindow() returns null if a non-Electron app had focus.
  const activeWin = BrowserWindow.getFocusedWindow();
  wasMainWinFocused = !!activeWin && activeWin !== quickAddWin;

  // On macOS, hide the main window when an EXTERNAL app was focused.
  // When SP is already the focused app, the HUD's alwaysOnTop is enough —
  // the main window stays visible behind the overlay. No hiding needed.
  //
  // When an external app was focused, we MUST call mainWin.hide() to prevent
  // macOS from restoring the main window when show() re-activates the app.
  // We call hide() even if isVisible() is false, because after app.hide()
  // the window is only app-level hidden — re-activation would restore it.
  // Window-level hide (mainWin.hide → orderOut:) survives re-activation.
  if (process.platform === 'darwin') {
    const mainWin = getWinSafe();
    if (mainWin && !mainWin.isDestroyed()) {
      mainWinWasVisible = mainWin.isVisible() && !mainWin.isMinimized();
      if (!wasMainWinFocused) {
        mainWin.hide();
      }
    } else {
      mainWinWasVisible = false;
    }
  }

  if (quickAddWin) {
    // Re-center on the active screen / current cursor position screen
    const { x, y, width, height } = getActiveDisplayBounds();
    quickAddWin.setBounds({ width, height, x, y });

    // show() + focus() activates the app and gives keyboard input.
    // Since the main window is hidden above (when external app was focused),
    // it won't appear behind the HUD.
    quickAddWin.show();
    quickAddWin.focus();
  }
};

export const hideQuickAddWindow = (isProgrammatic = false): void => {
  if (quickAddWin && !quickAddWin.isDestroyed() && quickAddWin.isVisible()) {
    if (isProgrammatic) {
      isHidingProgrammatically = true;
    }

    quickAddWin.hide();

    if (process.platform === 'darwin') {
      const mainWin = getWinSafe();

      // Restore the main window that we hid in showQuickAddWindow
      if (mainWinWasVisible && mainWin && !mainWin.isDestroyed()) {
        if (wasMainWinFocused) {
          // User had SP focused before — restore and focus it
          mainWin.show();
        } else {
          // User was in an external app — restore main window in background
          // so macOS remembers it as visible, then app.hide() returns focus
          mainWin.showInactive();
        }
      }

      if (!wasMainWinFocused) {
        // Return focus to the previously active external app
        app.hide();
      }
    }

    isHidingProgrammatically = false;
  }
};
