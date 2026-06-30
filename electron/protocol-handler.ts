import { App, BrowserWindow } from 'electron';
import { log } from 'electron-log/main';
import * as path from 'path';
import { IPC } from './shared-with-frontend/ipc-events.const';
import { showOrFocus } from './various-shared';
import { showQuickAddWindow } from './quick-add-window';

export const PROTOCOL_NAME = 'superproductivity';
export const PROTOCOL_PREFIX = `${PROTOCOL_NAME}://`;
export const QUICK_ADD_PROTOCOL_URL = `${PROTOCOL_PREFIX}quick-add`;

// Store pending URLs to process after window is ready
let pendingUrls: string[] = [];

export const processProtocolUrl = (url: string, mainWin: BrowserWindow | null): void => {
  // Redact query params before logging — OAuth code/state are credentials
  const redactedUrl = url.split('?')[0].split('#')[0];
  log('Processing protocol URL:', redactedUrl);

  // Only process after window is ready
  if (!mainWin || !mainWin.webContents) {
    log('Window not ready, deferring protocol URL processing');
    pendingUrls.push(url);

    // Process any pending protocol URLs after window is created
    setTimeout(() => {
      processPendingProtocolUrls(mainWin);
    }, 10000);
    return;
  }

  try {
    const urlObj = new URL(url);
    const action = urlObj.hostname;
    const pathParts = urlObj.pathname.split('/').filter(Boolean);

    log('Protocol action:', action);
    log('Protocol path parts:', pathParts);

    switch (action) {
      case 'oauth-callback':
        log('Received OAuth callback URL via app protocol');
        if (mainWin && mainWin.webContents) {
          mainWin.webContents.send(IPC.OAUTH_CALLBACK, { url });
          showOrFocus(mainWin);
        }
        break;
      case 'create-task':
        if (pathParts.length > 0) {
          const taskTitle = decodeURIComponent(pathParts[0]);
          log('Creating task with title:', taskTitle);

          // Send IPC message to create task
          if (mainWin && mainWin.webContents) {
            mainWin.webContents.send(IPC.ADD_TASK_FROM_APP_URI, { title: taskTitle });
          }
        }
        break;
      case 'task-toggle-start':
        // Send IPC message to toggle task start
        if (mainWin && mainWin.webContents) {
          mainWin.webContents.send(IPC.TASK_TOGGLE_START);
        }
        break;
      case 'quick-add':
        showQuickAddWindow();
        break;
      default:
        log('Unknown protocol action:', action);
    }
  } catch (error) {
    log('Error processing protocol URL:', error);
  }
};

const isQuickAddProtocolUrl = (url: string): boolean => {
  try {
    const urlObj = new URL(url);
    return urlObj.protocol === `${PROTOCOL_NAME}:` && urlObj.hostname === 'quick-add';
  } catch {
    return false;
  }
};

export const processPendingProtocolUrls = (mainWin: BrowserWindow): void => {
  if (pendingUrls.length > 0) {
    log(`Processing ${pendingUrls.length} pending protocol URLs`);
    const urls = [...pendingUrls];
    pendingUrls = [];
    urls.forEach((url) => processProtocolUrl(url, mainWin));
  }
};

export const initializeProtocolHandling = (
  IS_DEV: boolean,
  appInstance: App,
  getMainWindow: () => BrowserWindow | null,
): void => {
  // Register protocol handler
  if (IS_DEV && process.defaultApp) {
    if (process.argv.length >= 2) {
      const launchArgsForProtocol = [path.resolve(process.argv[1])];
      const userDataDirArg = process.argv.find((arg) =>
        arg.startsWith('--user-data-dir='),
      );
      if (userDataDirArg) {
        launchArgsForProtocol.push(userDataDirArg);
      }

      appInstance.setAsDefaultProtocolClient(PROTOCOL_NAME, process.execPath, [
        ...launchArgsForProtocol,
      ]);
    }
  } else {
    appInstance.setAsDefaultProtocolClient(PROTOCOL_NAME);
  }

  // Handle protocol on Windows/Linux via second instance
  appInstance.on('second-instance', (event, commandLine) => {
    const mainWin = getMainWindow();
    const url = commandLine.find((arg) => arg.startsWith(PROTOCOL_PREFIX));

    // Someone tried to run a second instance, we should focus our window instead.
    // Quick Add is intentionally exempt: focusing the main window steals focus from
    // the HUD and immediately closes it via the HUD window blur handler.
    if (mainWin && (!url || !isQuickAddProtocolUrl(url))) {
      showOrFocus(mainWin);
    }

    // Handle protocol url from second instance
    if (url) {
      processProtocolUrl(url, mainWin);
    }
  });

  // Handle protocol on macOS
  appInstance.on('open-url', (event, url) => {
    if (url.startsWith(PROTOCOL_PREFIX)) {
      event.preventDefault();
      processProtocolUrl(url, getMainWindow());
    }
  });

  // Handle protocol URL passed as command line argument for testing
  process.argv.forEach((val) => {
    if (val && val.startsWith(PROTOCOL_PREFIX)) {
      log('Protocol URL from command line:', val.split('?')[0].split('#')[0]);
      // Process after app is ready
      appInstance.whenReady().then(() => {
        processProtocolUrl(val, getMainWindow());
      });
    }
  });
};
