import { BrowserWindow, ipcMain, screen } from 'electron';
import { join } from 'path';
import { IPC } from './shared-with-frontend/ipc-events.const';
import { getWin } from './main-window';

let quickAddWin: BrowserWindow | null = null;
let loadUrl: string | undefined;

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
    hideQuickAddWindow();
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
    hideQuickAddWindow();
  });
};

const createQuickAddWindow = (): void => {
  if (quickAddWin && !quickAddWin.isDestroyed()) return;

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  const width = 640;
  const height = 450;
  const x = Math.round((screenWidth - width) / 2);
  const y = Math.round((screenHeight - height) / 3); // Upper third

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
    hideQuickAddWindow();
  });
};

export const showQuickAddWindow = (): void => {
  if (!quickAddWin || quickAddWin.isDestroyed()) {
    createQuickAddWindow();
  }

  if (quickAddWin) {
    // Re-center on the active screen / current cursor position screen if desired,
    // or just show in center of primary screen.
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
    const width = 640;
    const height = 450;
    quickAddWin.setBounds({
      width,
      height,
      x: Math.round((screenWidth - width) / 2),
      y: Math.round((screenHeight - height) / 3),
    });

    quickAddWin.show();
    quickAddWin.focus();
  }
};

export const hideQuickAddWindow = (): void => {
  if (quickAddWin && !quickAddWin.isDestroyed() && quickAddWin.isVisible()) {
    quickAddWin.hide();
  }
};
