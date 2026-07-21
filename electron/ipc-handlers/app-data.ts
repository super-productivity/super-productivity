import { app, ipcMain } from 'electron';
import { existsSync } from 'fs';
import { IPC } from '../shared-with-frontend/ipc-events.const';
import { BACKUP_DIR, BACKUP_DIR_WINSTORE } from '../backup';

export const initAppDataIpc = (): void => {
  ipcMain.handle(IPC.GET_PATH, (ev, name: string) => {
    return app.getPath(name as Parameters<typeof app.getPath>[0]);
  });

  // The path shown in Settings is the one the user has to find in Explorer, which
  // is not necessarily the one we write to: under MSIX virtualization writes to
  // AppData\Roaming land in the package's private LocalCache instead. Whether that
  // happens depends on the package's trust level and the Windows version (since
  // Windows 10 1903 it is even decided per file), so we cannot know it statically —
  // assuming it always applies is what made #9209 the mirror image of #995. Probe
  // instead, and fall back to the path we actually write to.
  ipcMain.handle(IPC.GET_BACKUP_PATH, () =>
    process?.windowsStore && existsSync(BACKUP_DIR_WINSTORE)
      ? BACKUP_DIR_WINSTORE
      : BACKUP_DIR,
  );
};
