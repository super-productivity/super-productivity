import { app, BrowserWindow, ipcMain, screen } from 'electron';
import { join } from 'path';
import { IPC } from './shared-with-frontend/ipc-events.const';
import { getWin } from './main-window';

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
      : `file://${join(__dirname, '../.tmp/angular-dist/browser/index.html')}`);

  // Pre-create the window on startup
  createQuickAddWindow();

  // Register IPC listeners
  ipcMain.on(IPC.QUICK_ADD_CLOSE, () => {
    hideQuickAddWindow(true);
  });

  ipcMain.on(IPC.QUICK_ADD_SUBMIT, (event, payload) => {
    // Forward the submit event to the main window
    try {
      const mainWin = getWin();
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.webContents.send(IPC.QUICK_ADD_SUBMIT_FORWARD, payload);
      }
    } catch (e) {
      console.error('Error forwarding quick-add task submission to main window:', e);
    }
  });
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
    },
  });

  const url = `${loadUrl}#/quick-add`;
  quickAddWin.loadURL(url);

  quickAddWin.on('closed', () => {
    quickAddWin = null;
  });

  // Prevent right clicks
  quickAddWin.webContents.on('context-menu', (e) => {
    e.preventDefault();
  });

  // Handle window focus loss - close/hide it
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
  console.log(
    '[QuickAdd HUD] showQuickAddWindow called. wasMainWinFocused:',
    wasMainWinFocused,
    'focusedWin:',
    activeWin ? activeWin.id : 'none (external app)',
  );

  // On macOS, ALWAYS hide the main window BEFORE showing the HUD.
  // Key insight: mainWin.hide() hides at the WINDOW level (orderOut:),
  // while app.hide() hides at the APP level. When quickAddWin.show()
  // re-activates the app, macOS restores app-level hidden windows but NOT
  // window-level hidden ones. So we must always call mainWin.hide() here,
  // even if isVisible() returns false (which happens after app.hide()).
  if (process.platform === 'darwin') {
    const mainWin = getWin();
    if (mainWin && !mainWin.isDestroyed()) {
      mainWinWasVisible = mainWin.isVisible() && !mainWin.isMinimized();
      console.log(
        '[QuickAdd HUD] Hiding main window before showing HUD. wasVisible:',
        mainWinWasVisible,
      );
      mainWin.hide();
    } else {
      mainWinWasVisible = false;
    }
  }

  if (quickAddWin) {
    // Re-center on the active screen / current cursor position screen
    const { x, y, width, height } = getActiveDisplayBounds();
    quickAddWin.setBounds({ width, height, x, y });

    // show() + focus() activates the app and gives keyboard input.
    // Since the main window is hidden above, it won't appear behind the HUD.
    quickAddWin.show();
    quickAddWin.focus();
  }
};

export const hideQuickAddWindow = (isProgrammatic = false): void => {
  console.log(
    '[QuickAdd HUD] hideQuickAddWindow called. isProgrammatic:',
    isProgrammatic,
    'wasMainWinFocused:',
    wasMainWinFocused,
    'mainWinWasVisible:',
    mainWinWasVisible,
  );
  if (quickAddWin && !quickAddWin.isDestroyed() && quickAddWin.isVisible()) {
    if (isProgrammatic) {
      isHidingProgrammatically = true;
    }

    quickAddWin.hide();

    if (process.platform === 'darwin') {
      const mainWin = getWin();

      // Restore the main window that we hid in showQuickAddWindow
      if (mainWinWasVisible && mainWin && !mainWin.isDestroyed()) {
        if (wasMainWinFocused) {
          // User had SP focused before — restore and focus it
          console.log('[QuickAdd HUD] Restoring main window with focus');
          mainWin.show();
        } else {
          // User was in an external app — restore main window in background
          // so macOS remembers it as visible, then app.hide() hides everything
          console.log('[QuickAdd HUD] Restoring main window inactive');
          mainWin.showInactive();
        }
      }

      if (!wasMainWinFocused) {
        // Return focus to the previously active external app
        console.log('[QuickAdd HUD] Calling app.hide() to return focus to external app');
        app.hide();
      }
    }

    isHidingProgrammatically = false;
  }
};
