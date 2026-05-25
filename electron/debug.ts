'use strict';
import { log } from 'electron-log/main';
import { OpenDevToolsOptions, app, BrowserWindow } from 'electron';
import * as localShortcut from 'electron-localshortcut';
const isMacOS = process.platform === 'darwin';

const devToolsOptions: OpenDevToolsOptions = {
  mode: 'bottom',
};

// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
function toggleDevTools(win = BrowserWindow.getFocusedWindow()): void {
  if (win) {
    const { webContents } = win;
    if (webContents.isDevToolsOpened()) {
      webContents.closeDevTools();
    } else {
      webContents.openDevTools(devToolsOptions);
    }
  }
}

// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
function devTools(win = BrowserWindow.getFocusedWindow()): void {
  if (win) {
    toggleDevTools(win);
  }
}

// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
function openDevTools(win = BrowserWindow.getFocusedWindow()): void {
  if (win) {
    win.webContents.openDevTools(devToolsOptions);
  }
}

// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
function refresh(win = BrowserWindow.getFocusedWindow()): void {
  if (win) {
    win.webContents.reloadIgnoringCache();
  }
}

// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
function inspectElements(): void {
  const win = BrowserWindow.getFocusedWindow();
  const inspect = (): void => {
    // TODO check
    // win.devToolsWebContents.executeJavaScript('DevToolsAPI.enterInspectElementMode()');
  };

  if (win) {
    if (win.webContents.isDevToolsOpened()) {
      inspect();
    } else {
      win.webContents.once('devtools-opened', inspect);
      win.webContents.openDevTools();
    }
  }
}

// const addExtensionIfInstalled = (name, getPath) => {
//   const isExtensionInstalled = nameIN => {
//     return BrowserWindow.getDevToolsExtensions &&
//       {}.hasOwnProperty.call(BrowserWindow.getDevToolsExtensions(), nameIN);
//   };
//
//   try {
//     if (!isExtensionInstalled(name)) {
//       BrowserWindow.addDevToolsExtension(getPath(name));
//     }
//   } catch (_) {
//   }
// };

export const initDebug = (
  opts: {
    enabled?: boolean | null;
    showDevTools?: boolean;
    devToolsMode?: 'bottom' | 'left' | 'right' | 'undocked' | 'detach' | 'previous';
    mode?: string;
  },
  isAddReload: boolean,
): void => {
  opts = Object.assign(
    {
      enabled: null,
      showDevTools: true,
      ...devToolsOptions,
    },
    opts,
  );
  log(opts);

  if (opts.enabled === false) {
    return;
  }

  if (opts.devToolsMode !== 'previous' && opts.devToolsMode) {
    devToolsOptions.mode = opts.devToolsMode as
      | 'bottom'
      | 'left'
      | 'right'
      | 'undocked'
      | 'detach';
  }

  app.on('browser-window-created', (event, win) => {
    // Skip dev tools for task widget window
    if (win.title === 'Super Productivity Task Widget') {
      return;
    }

    if (opts.showDevTools) {
      win.webContents.once('devtools-opened', () => {
        // Workaround for https://github.com/electron/electron/issues/13095
        setImmediate(() => {
          win.focus();
        });
      });

      /// Workaround for https://github.com/electron/electron/issues/12438
      win.webContents.once('dom-ready', () => {
        openDevTools(win);
      });
    }
  });

  app.on('ready', () => {
    localShortcut.register('CmdOrCtrl+Shift+C', inspectElements);
    localShortcut.register(isMacOS ? 'Cmd+Alt+I' : 'Ctrl+Shift+I', devTools);
    localShortcut.register('F12', devTools);

    if (isAddReload) {
      localShortcut.register('CmdOrCtrl+R', refresh);
      localShortcut.register('F5', refresh);
    }
  });
};
