import { App, BrowserWindow } from 'electron';
import { log } from 'electron-log/main';
import * as path from 'path';
import { IPC } from './shared-with-frontend/ipc-events.const';
import { showOrFocus } from './various-shared';

export const PROTOCOL_NAME = 'superproductivity';
export const PROTOCOL_PREFIX = `${PROTOCOL_NAME}://`;

// Store pending URLs to process after window is ready
let pendingUrls: string[] = [];

export const processProtocolUrl = (url: string, mainWin: BrowserWindow | null): void => {
  log('Processing protocol URL:', url);

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
      default:
        log('Unknown protocol action:', action);
    }
  } catch (error) {
    log('Error processing protocol URL:', error);
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
      appInstance.setAsDefaultProtocolClient(PROTOCOL_NAME, process.execPath, [
        path.resolve(process.argv[1]),
      ]);
    }
  } else {
    appInstance.setAsDefaultProtocolClient(PROTOCOL_NAME);
  }

  // Handle protocol on Windows/Linux via second instance
  appInstance.on('second-instance', (event, commandLine) => {
    const mainWin = getMainWindow();

    // Someone tried to run a second instance, we should focus our window instead.
    if (mainWin) {
      showOrFocus(mainWin);
    }

    // Handle protocol url from second instance
    const url = commandLine.find((arg) => arg.startsWith(PROTOCOL_PREFIX));
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
      log('Protocol URL from command line:', val);
      // Process after app is ready
      appInstance.whenReady().then(() => {
        processProtocolUrl(val, getMainWindow());
      });
    }
  });
};
