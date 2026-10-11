import windowStateKeeper from 'electron-window-state';
import { App, BrowserWindow, BrowserWindowConstructorOptions, Menu } from 'electron';
import { errorHandlerWithFrontendInform } from './error-handler-with-frontend-inform';
import * as path from 'path';
import { pathToFileURL } from 'node:url';
import { IS_MAC } from './common.const';
import { assertSecureWebPreferences } from './web-preferences-guard';

let mainWin: BrowserWindow;

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

export const closeWinAndQuit = (quitApp: () => void): void => {
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.close();
  } else {
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
  if (mainWin) {
    errorHandlerWithFrontendInform('Main window already exists');
    return mainWin;
  }

  if (!IS_MAC) {
    Menu.setApplicationMenu(null);
  }

  const mainWindowState = windowStateKeeper({
    defaultWidth: 800,
    defaultHeight: 800,
  });

  const isScreenshotMode = process.env.SP_SCREENSHOT_MODE === '1';
  const webPreferences: BrowserWindowConstructorOptions['webPreferences'] = {
    scrollBounce: true,
    backgroundThrottling: false,
    webSecurity: true,
    preload: path.join(__dirname, 'preload.js'),
    nodeIntegration: false,
    contextIsolation: true,
    nodeIntegrationInSubFrames: false,
    enableBlinkFeatures: 'OverlayScrollbar',
    spellcheck: false,
  };

  assertSecureWebPreferences(webPreferences, 'main');

  mainWin = new BrowserWindow({
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: mainWindowState.width,
    height: mainWindowState.height,
    minHeight: 240,
    minWidth: 300,
    title: IS_DEV ? 'Super Prod. D' : 'Super Prod.',
    titleBarStyle: 'default', // استخدام شريط العنوان الافتراضي للنظام
    enableLargerThanScreen: isScreenshotMode,
    show: false,
    webPreferences,
    icon: ICONS_FOLDER + '/icon_256x256.png',
    transparent: false,
    frame: true, // تفعيل إطار النافذة وأزرار النظام
  });

  mainWindowState.manage(mainWin);

  const url = customUrl
    ? customUrl
    : IS_DEV
      ? 'http://localhost:4200'
      : pathToFileURL(path.join(__dirname, '../.tmp/angular-dist/browser/index.html'))
          .href;

  mainWin.loadURL(url).then(() => {
    if (IS_DEV) {
      mainWin.setTitle('Super Productivity D');
    }
  });

  mainWin.once('ready-to-show', () => {
    mainWin.show();
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

  return mainWin;
};
