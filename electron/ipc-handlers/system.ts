import { app, dialog, ipcMain, shell } from 'electron';
import { IPC } from '../shared-with-frontend/ipc-events.const';
import {
  isExternalUrlSchemeAllowed,
  isPathSafeToOpen,
} from '../shared-with-frontend/is-external-url-allowed';
import { getWin } from '../main-window';

export const initSystemIpc = (): void => {
  ipcMain.on(IPC.OPEN_PATH, (ev, path: string) => {
    // Block UNC / network paths and remote file:// URLs: shell.openPath would
    // resolve \\host\share (and file://host/share) to an SMB connection and leak
    // the user's NTLM hash. FILE-type task-attachment paths are synced and thus
    // attacker-controllable. See GHSA-hr87-735w-hfq3.
    if (!isPathSafeToOpen(path)) {
      return;
    }
    shell.openPath(path);
  });
  ipcMain.on(IPC.OPEN_EXTERNAL, (ev, url: string) => {
    // Defense in depth: never hand an unsafe scheme to the OS handler, even if
    // the renderer-side guard is bypassed. See GHSA-hr87-735w-hfq3.
    if (!isExternalUrlSchemeAllowed(url)) {
      return;
    }
    shell.openExternal(url);
  });

  ipcMain.on(
    IPC.SHOW_EMOJI_PANEL,
    () => app.isEmojiPanelSupported() && app.showEmojiPanel(),
  );

  ipcMain.handle(IPC.SAVE_FILE_DIALOG, async (ev, { filename, data }) => {
    const result = await dialog.showSaveDialog(getWin(), {
      defaultPath: filename,
      filters: [
        { name: 'JSON Files', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (!result.canceled && result.filePath) {
      const fs = await import('fs');
      await fs.promises.writeFile(result.filePath, data, 'utf-8');
      return { success: true, path: result.filePath };
    }
    return { success: false };
  });

  ipcMain.handle(IPC.SHARE_NATIVE, async () => {
    // Desktop platforms use the share dialog instead of native share
    // This allows for more flexibility and better UX with social media options
    return { success: false, error: 'Native share not available on desktop' };
  });
};
