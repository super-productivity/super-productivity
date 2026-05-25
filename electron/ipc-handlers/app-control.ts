import { app, ipcMain, ProgressBarOptions } from 'electron';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { IPC } from '../shared-with-frontend/ipc-events.const';
import { getWin } from '../main-window';
import { quitApp, showOrFocus } from '../various-shared';
import {
  getIsLocked,
  setIsMinimizeToTray,
  setIsTrayShowCurrentTask,
  setIsTrayShowCurrentCountdown,
} from '../shared-state';
import { lockscreen } from '../lockscreen';
import { errorHandlerWithFrontendInform } from '../error-handler-with-frontend-inform';
import { GlobalConfigState } from '../../src/app/features/config/global-config.model';
import { saveSimpleStore } from '../simple-store';
import { SimpleStoreKey } from '../shared-with-frontend/simple-store.const';
import { updateLocalRestApiConfig } from '../local-rest-api';

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
    setIsTrayShowCurrentTask(!!cfg.misc.isTrayShowCurrentTask);
    setIsTrayShowCurrentCountdown(!!cfg.misc.isTrayShowCurrentCountdown);
    updateLocalRestApiConfig(cfg);

    if (cfg.misc.isUseCustomWindowTitleBar !== undefined) {
      await saveSimpleStore(
        SimpleStoreKey.IS_USE_CUSTOM_WINDOW_TITLE_BAR,
        cfg.misc.isUseCustomWindowTitleBar,
      );
    }
  };

  ipcMain.on(IPC.TRANSFER_SETTINGS_TO_ELECTRON, updateSettings);
  ipcMain.on(IPC.UPDATE_SETTINGS, updateSettings);

  ipcMain.on(IPC.SHOW_OR_FOCUS, () => {
    const mainWin = getWin();
    showOrFocus(mainWin);
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
