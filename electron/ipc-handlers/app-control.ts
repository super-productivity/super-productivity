import { app, ipcMain, ProgressBarOptions } from 'electron';
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

export const initAppControlIpc = (): void => {
  ipcMain.on(IPC.SHUTDOWN_NOW, quitApp);
  ipcMain.on(IPC.EXIT, (ev, exitCode: number) => app.exit(exitCode));
  ipcMain.on(IPC.RELAUNCH, () => app.relaunch());
  ipcMain.on(IPC.OPEN_DEV_TOOLS, () => getWin().webContents.openDevTools());
  ipcMain.on(IPC.RELOAD_MAIN_WIN, () => getWin().reload());

  const updateSettings = async (ev: any, cfg: GlobalConfigState): Promise<void> => {
    setIsMinimizeToTray(cfg.misc.isMinimizeToTray);
    setIsTrayShowCurrentTask(cfg.misc.isTrayShowCurrentTask);
    setIsTrayShowCurrentCountdown(cfg.misc.isTrayShowCurrentCountdown);

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

  ipcMain.on(IPC.TOGGLE_FULLSCREEN, () => {
    const mainWin = getWin();
    if (mainWin) {
      mainWin.setFullScreen(!mainWin.isFullScreen());
    }
  });
};
