import { app, ipcMain } from 'electron';
import { IPC } from '../shared-with-frontend/ipc-events.const';
import { getBackupDirForDisplay } from '../backup';

export const initAppDataIpc = (): void => {
  ipcMain.handle(IPC.GET_PATH, (ev, name: string) => {
    return app.getPath(name as Parameters<typeof app.getPath>[0]);
  });

  ipcMain.handle(IPC.GET_BACKUP_PATH, () => getBackupDirForDisplay());
};
