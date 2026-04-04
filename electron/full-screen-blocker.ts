import { BrowserWindow, ipcMain } from 'electron';
import { IPC } from './shared-with-frontend/ipc-events.const';
import { TakeABreakConfig } from '../src/app/features/config/global-config.model';
import { join, normalize } from 'path';

export const initFullScreenBlocker = (IS_DEV: boolean): void => {
  let isFullScreenWindowOpen = false;
  ipcMain.on(
    IPC.FULL_SCREEN_BLOCKER,
    (
      ipcEvent,
      { msg, takeABreakCfg }: { msg: string; takeABreakCfg: TakeABreakConfig },
    ): void => {
      if (isFullScreenWindowOpen) {
        return;
      }
      let isClosable = false;
      const win = new BrowserWindow({
        title: msg,
        fullscreen: true,
        alwaysOnTop: true,
        transparent: true,
        skipTaskbar: true,
        frame: false,
      });
      const randomImgUrl = takeABreakCfg.motivationalImgs?.length
        ? takeABreakCfg.motivationalImgs[
            Math.floor(Math.random() * takeABreakCfg.motivationalImgs.length)
          ]
        : '';

      win.setAlwaysOnTop(true, 'floating');
      win.setVisibleOnAllWorkspaces(true);
      win.setFullScreenable(false);
      isFullScreenWindowOpen = true;
      win.loadURL(
        `file://${normalize(
          join(
            __dirname,
            IS_DEV
              ? '../src/static/break-reminder-overlay.html'
              : '../dist/static/break-reminder-overlay.html',
          ),
        )}` +
          `#msg=${encodeURI(msg)}&img=${encodeURI(randomImgUrl)}&time=${
            takeABreakCfg.timedFullScreenBlockerDuration
          }`,
      );
      const closeTimeout = setTimeout(() => {
        isClosable = true;
        win.close();
      }, takeABreakCfg.timedFullScreenBlockerDuration || 5000);

      win.on('close', (evI) => {
        if (isClosable) {
          if (closeTimeout) {
            clearTimeout(closeTimeout);
          }
          isFullScreenWindowOpen = false;
        } else {
          evI.preventDefault();
        }
      });

      win.on('closed', () => {
        // Clean up references
        isFullScreenWindowOpen = false;
        if (closeTimeout) {
          clearTimeout(closeTimeout);
        }
      });
    },
  );
};
