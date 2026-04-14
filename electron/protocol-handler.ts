import { App, BrowserWindow } from 'electron';
import { log } from 'electron-log/main';
import * as path from 'path';
import {
  flushPendingDesktopCommands,
  queueOrExecuteDesktopCommand,
} from './desktop-command-executor';
import {
  getProtocolUrlFromArgv,
  parseDesktopCommandFromArgv,
  parseDesktopCommandFromProtocolUrl,
} from './desktop-command-parser';
import { showOrFocus } from './various-shared';
import { getIsAppReady } from './main-window';

export const PROTOCOL_NAME = 'superproductivity';
export const PROTOCOL_PREFIX = `${PROTOCOL_NAME}://`;

export const processProtocolUrl = (url: string, mainWin: BrowserWindow | null): void => {
  log('Processing protocol URL:', url);
  const parsedResult = parseDesktopCommandFromProtocolUrl(url);
  if (parsedResult.kind === 'error') {
    log(parsedResult.error);
    return;
  }
  if (parsedResult.kind === 'none') {
    return;
  }

  queueOrExecuteDesktopCommand({
    command: parsedResult.command,
    getMainWindow: () => mainWin,
    isAppReady: getIsAppReady,
    showOrFocus,
  });
};

export const processPendingProtocolUrls = (mainWin: BrowserWindow): void => {
  flushPendingDesktopCommands({
    getMainWindow: () => mainWin,
    isAppReady: getIsAppReady,
    showOrFocus,
  });
};

const handleSecondInstanceInvocation = (
  commandLine: string[],
  getMainWindow: () => BrowserWindow | null,
): void => {
  const mainWin = getMainWindow();

  const parsedCliResult = parseDesktopCommandFromArgv(commandLine);
  if (parsedCliResult.kind === 'error') {
    log(parsedCliResult.error);
    return;
  }
  if (parsedCliResult.kind === 'command') {
    queueOrExecuteDesktopCommand({
      command: parsedCliResult.command,
      getMainWindow,
      isAppReady: getIsAppReady,
      showOrFocus,
    });
    return;
  }

  const url = getProtocolUrlFromArgv(commandLine);
  if (url) {
    processProtocolUrl(url, mainWin);
    return;
  }

  if (mainWin) {
    showOrFocus(mainWin);
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
    handleSecondInstanceInvocation(commandLine, getMainWindow);
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
