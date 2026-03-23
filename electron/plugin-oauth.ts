import { BrowserWindow, ipcMain } from 'electron';
import { IPC } from './shared-with-frontend/ipc-events.const';
import { log } from 'electron-log/main';

const OAUTH_REDIRECT_PREFIX = 'super-productivity://oauth';

export const initPluginOAuth = (mainWin: BrowserWindow): void => {
  ipcMain.on(IPC.PLUGIN_OAUTH_START, (_ev: unknown, { url }: { url: string }) => {
    log('Plugin OAuth: Opening auth window');

    const authWin = new BrowserWindow({
      width: 600,
      height: 700,
      parent: mainWin,
      modal: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });

    let handled = false;

    const closeAuthWin = (): void => {
      if (!authWin.isDestroyed()) {
        authWin.close();
      }
    };

    const handleRedirectUrl = (redirectUrl: string): boolean => {
      if (!redirectUrl.startsWith(OAUTH_REDIRECT_PREFIX)) {
        return false;
      }
      if (handled) {
        return true;
      }
      handled = true;

      const parsed = new URL(redirectUrl);
      const code = parsed.searchParams.get('code');
      const error = parsed.searchParams.get('error');
      const state = parsed.searchParams.get('state');
      mainWin.webContents.send(IPC.PLUGIN_OAUTH_CB, { code, error, state });
      closeAuthWin();
      return true;
    };

    authWin.webContents.on('will-redirect', (details) => {
      if (handleRedirectUrl(details.url)) {
        details.preventDefault();
      }
    });

    authWin.webContents.on('will-navigate', (details) => {
      if (handleRedirectUrl(details.url)) {
        details.preventDefault();
      }
    });

    authWin.on('closed', () => {
      if (!handled) {
        mainWin.webContents.send(IPC.PLUGIN_OAUTH_CB, {
          error: 'window_closed',
        });
      }
    });

    // Validate URL protocol before loading to prevent file:// or javascript: abuse
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') {
        log('Plugin OAuth: Rejected non-https auth URL:', parsed.protocol);
        mainWin.webContents.send(IPC.PLUGIN_OAUTH_CB, {
          error: 'invalid_auth_url',
        });
        closeAuthWin();
        return;
      }
    } catch {
      mainWin.webContents.send(IPC.PLUGIN_OAUTH_CB, {
        error: 'invalid_auth_url',
      });
      closeAuthWin();
      return;
    }

    authWin.loadURL(url);
  });
};
