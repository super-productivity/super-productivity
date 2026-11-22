import type { BrowserWindow, Event, IpcMain } from 'electron';
import { log } from 'electron-log/main';
import { IPC } from './shared-with-frontend/ipc-events.const';

export const registerBeforeCloseHandlers = (
  ipc: Pick<IpcMain, 'on'>,
  win: Pick<BrowserWindow, 'on' | 'close' | 'isDestroyed' | 'webContents'>,
  shouldWaitForHolds: (event: Event, ids: string[]) => boolean,
  quitImmediately: () => void,
  prepareCloseAfterHolds: () => void,
): void => {
  let ids: string[] = [];

  ipc.on(IPC.REGISTER_BEFORE_CLOSE, (_event, { id }) => {
    ids.push(id);
  });
  ipc.on(IPC.UNREGISTER_BEFORE_CLOSE, (_event, { id }) => {
    ids = ids.filter((pendingId) => pendingId !== id);
  });
  ipc.on(IPC.BEFORE_CLOSE_DONE, (_event, { id }) => {
    ids = ids.filter((pendingId) => pendingId !== id);
    log(IPC.BEFORE_CLOSE_DONE, id, ids);
    if (ids.length === 0) {
      prepareCloseAfterHolds();
      win.close();
    } else if (!win.isDestroyed()) {
      // Save and sync wait until the remaining holds can no longer cancel quit.
      win.webContents.send(IPC.NOTIFY_ON_CLOSE, ids);
    }
  });

  win.on('close', (event) => {
    if (!shouldWaitForHolds(event, ids)) {
      return;
    }
    event.preventDefault();

    // A gone renderer never answers, so waiting for it would block quit.
    if (ids.length > 0 && !win.webContents.isCrashed()) {
      log('Actions to wait for ', ids);
      win.webContents.send(IPC.NOTIFY_ON_CLOSE, ids);
    } else {
      quitImmediately();
    }
  });
};
