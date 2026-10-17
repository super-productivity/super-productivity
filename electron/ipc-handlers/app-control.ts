import { app, ipcMain, ProgressBarOptions } from 'electron';
import { existsSync } from 'fs';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { dirname, isAbsolute, join } from 'path';
import { IPC } from '../shared-with-frontend/ipc-events.const';
import { getWin } from '../main-window';
import { raiseForReminder, quitApp, showOrFocus } from '../various-shared';
import {
  getIsLocked,
  setIsMinimizeToTray,
  setIsTrayShowCurrentTask,
  setIsTrayShowCurrentCountdown,
} from '../shared-state';
import { refreshIndicator } from '../indicator';
import { lockscreen } from '../lockscreen';
import { errorHandlerWithFrontendInform } from '../error-handler-with-frontend-inform';
import { GlobalConfigState } from '../../src/app/features/config/global-config.model';
import { saveSimpleStore } from '../simple-store';
import { SimpleStoreKey } from '../shared-with-frontend/simple-store.const';
import {
  getDistChannel,
  LOGIN_ITEM_CHANNELS,
} from '../shared-with-frontend/get-dist-channel';

// On Linux, packaged builds ship a shell wrapper (`superproductivity`) next
// to the Electron ELF (`superproductivity-bin`) that injects
// `--ozone-platform=x11` on Snap+Wayland — see tools/afterPack.js. A raw
// app.relaunch() re-runs process.execPath, which is the renamed ELF, so
// the wrapper is bypassed and Snap+Wayland launches would re-crash after
// relaunch. Point execPath at the sibling wrapper when it's present.
const getRelaunchExecPath = (): string | undefined => {
  if (process.platform !== 'linux') return undefined;
  const wrapperPath = join(dirname(process.execPath), 'superproductivity');
  return existsSync(wrapperPath) ? wrapperPath : undefined;
};

const getLinuxAutostartPath = (): string => {
  const configHome = process.env.XDG_CONFIG_HOME;
  return join(
    configHome && isAbsolute(configHome)
      ? configHome
      : join(app.getPath('home'), '.config'),
    'autostart',
    'superproductivity.desktop',
  );
};

const getOpenAtLogin = async (): Promise<boolean> => {
  const distChannel = getDistChannel();
  if (!distChannel || !LOGIN_ITEM_CHANNELS.includes(distChannel)) {
    return false;
  }
  if (distChannel.startsWith('linux-')) {
    try {
      const entry = await readFile(getLinuxAutostartPath(), 'utf8');
      return !/^[ \t]*(Hidden[ \t]*=[ \t]*true|X-GNOME-Autostart-enabled[ \t]*=[ \t]*false)[ \t]*\r?$/m.test(
        entry,
      );
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }
      throw err;
    }
  }
  return app.getLoginItemSettings().openAtLogin;
};

export const initAppControlIpc = (): void => {
  ipcMain.on(IPC.SHUTDOWN_NOW, quitApp);
  ipcMain.on(IPC.EXIT, (ev, exitCode: number) => app.exit(exitCode));
  ipcMain.on(IPC.RELAUNCH, () => {
    const execPath = getRelaunchExecPath();
    app.relaunch(execPath ? { execPath } : undefined);
  });
  ipcMain.on(IPC.OPEN_DEV_TOOLS, () => getWin().webContents.openDevTools());
  ipcMain.on(IPC.RELOAD_MAIN_WIN, () => getWin().reload());

  const updateSettings = async (ev: any, cfg: GlobalConfigState): Promise<void> => {
    setIsMinimizeToTray(cfg.misc.isMinimizeToTray);
    setIsTrayShowCurrentTask(
      cfg.tasks?.isTrayShowCurrent ?? !!cfg.misc.isTrayShowCurrentTask,
    );
    setIsTrayShowCurrentCountdown(!!cfg.misc.isTrayShowCurrentCountdown);
    refreshIndicator();

    if (cfg.misc.isUseCustomWindowTitleBar !== undefined) {
      await saveSimpleStore(
        SimpleStoreKey.IS_USE_CUSTOM_WINDOW_TITLE_BAR,
        cfg.misc.isUseCustomWindowTitleBar,
      );
    }
  };

  ipcMain.on(IPC.TRANSFER_SETTINGS_TO_ELECTRON, updateSettings);
  ipcMain.on(IPC.UPDATE_SETTINGS, updateSettings);

  // Start on system startup (#5572) is this device's OS login item, read and
  // written directly, never synced: a synced value would apply on every desktop.
  ipcMain.handle(IPC.GET_OPEN_AT_LOGIN, getOpenAtLogin);
  ipcMain.handle(IPC.SET_OPEN_AT_LOGIN, async (ev, isOpenAtLogin: unknown) => {
    const distChannel = getDistChannel();
    if (!distChannel || !LOGIN_ITEM_CHANNELS.includes(distChannel)) {
      return false;
    }
    if (distChannel.startsWith('linux-')) {
      const entryPath = getLinuxAutostartPath();
      if (isOpenAtLogin === true) {
        // AppImage's execPath is inside a temporary mount. Native packages must
        // use the sibling launcher installed by afterPack, just like relaunch.
        const executable = (
          process.env.APPIMAGE ||
          getRelaunchExecPath() ||
          process.execPath
        )
          // Desktop Entry string escaping is applied before Exec quoting.
          .replace(/\\/g, '\\\\\\\\')
          .replace(/(["`$])/g, '\\\\$1')
          .replace(/%/g, '%%')
          .replace(/\n/g, '\\n')
          .replace(/\r/g, '\\r')
          .replace(/\t/g, '\\t');
        await mkdir(dirname(entryPath), { recursive: true });
        await writeFile(
          entryPath,
          `[Desktop Entry]\nType=Application\nName=Super Productivity\nExec="${executable}"\nTerminal=false\n`,
          'utf8',
        );
      } else {
        await rm(entryPath, { force: true });
      }
    } else {
      app.setLoginItemSettings({ openAtLogin: isOpenAtLogin === true });
    }
    // Report the actual state, including an OS refusal or an external change.
    return getOpenAtLogin();
  });

  ipcMain.on(IPC.SHOW_OR_FOCUS, (ev, opts?: { isReminder?: boolean }) => {
    const mainWin = getWin();
    if (opts?.isReminder) {
      raiseForReminder(mainWin);
    } else {
      showOrFocus(mainWin);
    }
  });

  ipcMain.on(IPC.LOCK_SCREEN, () => {
    if (getIsLocked()) {
      return;
    }

    try {
      lockscreen();
    } catch (e) {
      errorHandlerWithFrontendInform(e);
    }
  });

  ipcMain.on(IPC.SET_PROGRESS_BAR, (ev, { progress, progressBarMode }) => {
    const mainWin = getWin();
    if (mainWin) {
      if (progressBarMode === 'none') {
        mainWin.setProgressBar(-1);
      } else {
        mainWin.setProgressBar(Math.min(Math.max(progress, 0), 1), {
          mode: progressBarMode as ProgressBarOptions['mode'],
        });
      }
    }
  });

  ipcMain.on(IPC.FLASH_FRAME, (ev) => {
    const mainWin = getWin();
    if (mainWin) {
      mainWin.flashFrame(false);
      mainWin.flashFrame(true);

      mainWin.once('focus', () => {
        mainWin.flashFrame(false);
      });
    }
  });
};
