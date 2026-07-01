import { App, BrowserWindow } from 'electron';
import { log } from 'electron-log/main';
import * as path from 'path';
import { IPC } from './shared-with-frontend/ipc-events.const';
import { showOrFocus, toggleWindowVisibility } from './various-shared';

export const PROTOCOL_NAME = 'superproductivity';
export const PROTOCOL_PREFIX = `${PROTOCOL_NAME}://`;

// Store pending URLs to process after window is ready
let pendingUrls: string[] = [];

// When the app is COLD-LAUNCHED by `superproductivity://toggle-visibility` (it was not
// already running), the freshly-created window must just be SHOWN — never toggled, which
// would immediately hide the window the launch was meant to reveal (#7114). The cold-start
// argv scan sets this one-shot flag instead of routing that URL through the toggle, and the
// window-ready drain (processPendingProtocolUrls) consumes it with a single showOrFocus.
let coldStartShowPending = false;

/**
 * Parse the action (host) of a `superproductivity://` URL, or `null` if it is
 * missing/unparseable. Used by the `second-instance` handler to special-case actions
 * whose behavior the generic pre-focus would otherwise break.
 */
export const getProtocolAction = (url: string | undefined): string | null => {
  if (!url) {
    return null;
  }
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
};

export const processProtocolUrl = (url: string, mainWin: BrowserWindow | null): void => {
  // Log only the scheme + action host. The query/fragment carry OAuth credentials and the
  // path carries user content (e.g. a create-task title); the log is exportable, so neither
  // may be written to it.
  log('Processing protocol URL:', `${PROTOCOL_PREFIX}${getProtocolAction(url) ?? ''}`);

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
    // Log the count only — path parts can hold user content (e.g. a create-task title).
    log('Protocol path part count:', pathParts.length);

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
          // Don't log the title — the log is exportable and must not contain user content.
          log('Creating task from protocol URL');

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
      case 'plainspace-connect':
        // Bounce-back from the plainspace.org connect flow ("Open Super
        // Productivity"): just surface the window. The user pastes the token
        // they copied there; no payload to forward.
        if (mainWin && mainWin.webContents) {
          showOrFocus(mainWin);
        }
        break;
      // The following three mirror the `globalShowHide` / `globalAddNote` / `globalAddTask`
      // global shortcuts. On Wayland the compositor owns global hotkeys, so users bind keys
      // to `xdg-open superproductivity://<action>` instead (#7114).
      case 'toggle-visibility':
        toggleWindowVisibility(mainWin);
        break;
      case 'add-note':
        showOrFocus(mainWin);
        mainWin.webContents.send(IPC.ADD_NOTE);
        break;
      case 'add-task':
        showOrFocus(mainWin);
        mainWin.webContents.send(IPC.SHOW_ADD_TASK_BAR);
        break;
      default:
        log('Unknown protocol action:', action);
    }
  } catch (error) {
    log('Error processing protocol URL:', error);
  }
};

export const processPendingProtocolUrls = (mainWin: BrowserWindow): void => {
  if (coldStartShowPending) {
    coldStartShowPending = false;
    // Cold-start toggle-visibility: show the window (works even if start-minimized-to-tray
    // left it hidden) instead of toggling it back off.
    showOrFocus(mainWin);
  }
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

    // A second launch should normally bring our window to front. But `toggle-visibility`
    // must observe the *pre-press* window state — pre-focusing here would make the toggle
    // always read "visible" and hide the window the user actually asked to show (#7114),
    // so let that action manage visibility itself.
    if (mainWin && getProtocolAction(url) !== 'toggle-visibility') {
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
      log(
        'Protocol URL from command line:',
        `${PROTOCOL_PREFIX}${getProtocolAction(val) ?? ''}`,
      );
      // A toggle-visibility that cold-launched the app must SHOW the new window, not toggle
      // it (see coldStartShowPending) — running the normal toggle would hide the window the
      // user just asked to see (#7114). Flag it for the window-ready drain instead.
      if (getProtocolAction(val) === 'toggle-visibility') {
        coldStartShowPending = true;
        return;
      }
      // Process after app is ready
      appInstance.whenReady().then(() => {
        processProtocolUrl(val, getMainWindow());
      });
    }
  });
};
