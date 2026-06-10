import { IPC } from './shared-with-frontend/ipc-events.const';
import {
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
  unlinkSync,
} from 'fs';
import { error, log } from 'electron-log/main';
import { app, dialog, ipcMain } from 'electron';
import { getWin } from './main-window';
import { fileURLToPath, pathToFileURL } from 'url';
import { assertPathOutside } from './file-path-guard';
import { isPathSafeToOpen } from './shared-with-frontend/is-external-url-allowed';

// SECURITY: file-sync must never read/write/list inside the app's private dir,
// which holds settings/grants/db — touching it is a privilege-escalation
// primitive (e.g. forging the nodeExecution grant file). The path is
// renderer-supplied (untrusted plugin/XSS). Lazy getter — userData can be
// changed at startup (--user-data-dir, Snap). See file-path-guard.ts.
const getAppPrivateDir = (): string => app.getPath('userData');

export const initLocalFileSyncAdapter = (): void => {
  ipcMain.handle(
    IPC.READ_LOCAL_IMAGE_AS_DATA_URL,
    async (_, filePathOrUrl: string): Promise<string | null> => {
      try {
        // A theme background-image path is synced and thus attacker-controllable.
        // Reject UNC / remote file:// before touching the filesystem: fs.stat /
        // readFile on `\\host\share` (or `file://host/share`) opens an SMB
        // connection and leaks the user's NTLM hash — with no click, just by the
        // theme being active. See GHSA-hr87-735w-hfq3.
        if (!isPathSafeToOpen(filePathOrUrl)) {
          return null;
        }

        const normalized = filePathOrUrl.startsWith('file://')
          ? fileURLToPath(filePathOrUrl)
          : filePathOrUrl;

        // SECURITY: never inline a file from the app's private dir (the path is
        // renderer-supplied background-image config).
        assertPathOutside(getAppPrivateDir(), normalized);

        const ext = normalized.toLowerCase().split('.').pop() || '';

        const mimeTypeByExt: Record<string, string> = {
          png: 'image/png',
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          gif: 'image/gif',
          webp: 'image/webp',
          svg: 'image/svg+xml',
          bmp: 'image/bmp',
          avif: 'image/avif',
        };

        const mimeType = mimeTypeByExt[ext];

        // Reject unsupported file types before reading
        if (!mimeType) {
          return null;
        }

        const fs = await import('fs');

        const stat = await fs.promises.stat(normalized);

        const MAX_FILE_SIZE = 5 * 1024 * 1024;

        if (stat.size > MAX_FILE_SIZE) {
          throw new Error('Background image exceeds 5 MB limit');
        }

        const buffer = await fs.promises.readFile(normalized);

        return `data:${mimeType};base64,${buffer.toString('base64')}`;
      } catch (e) {
        error('Read local image as data URL failed', getSafeErrorMeta(e));
        return null;
      }
    },
  );

  ipcMain.handle(IPC.TO_FILE_URL, (_, filePath: string): string => {
    // SECURITY: the renderer hands us a path string from an OS file picker;
    // a plugin/XSS could call us directly with any string. The result is a
    // pure string conversion and not itself a capability, but the produced
    // file:// URL is later persisted as background-image config and fed to
    // READ_LOCAL_IMAGE_AS_DATA_URL. Mirroring that handler's deny — refuse
    // to mint a file:// URL pointing at the app's private dir — keeps the
    // two layers consistent and removes a path-laundering surface. Throw
    // (vs. returning Error) so the existing string-returning signature is
    // preserved; the legitimate caller passes paths from an OS picker, so
    // a reject only fires on abuse.
    assertPathOutside(getAppPrivateDir(), filePath);
    return pathToFileURL(filePath).href;
  });
  ipcMain.handle(
    IPC.FILE_SYNC_SAVE,
    (
      ev,
      {
        filePath,
        dataStr,
        localRev,
      }: {
        filePath: string;
        dataStr: string;
        localRev: string | null;
      },
    ): string | Error => {
      try {
        assertPathOutside(getAppPrivateDir(), filePath);
        log(IPC.FILE_SYNC_SAVE, {
          dataLength: dataStr.length,
          hasData: dataStr.length > 0,
        });

        // Atomic write: write to temp file first, then rename.
        // renameSync is atomic on ext4/APFS/NTFS, so a crash mid-write
        // won't corrupt the original file.
        const tempPath = filePath + '.tmp';
        writeFileSync(tempPath, dataStr);
        renameSync(tempPath, filePath);

        return getRev(filePath);
      } catch (e) {
        error('Local file sync save failed', getSafeErrorMeta(e));
        return createSafeIpcError(IPC.FILE_SYNC_SAVE, e);
      }
    },
  );

  ipcMain.handle(
    IPC.FILE_SYNC_LOAD,
    (
      ev,
      {
        filePath,
        localRev,
      }: {
        filePath: string;
        localRev: string | null;
      },
    ): { rev: string; dataStr: string | undefined } | Error => {
      try {
        assertPathOutside(getAppPrivateDir(), filePath);
        log(IPC.FILE_SYNC_LOAD, {
          hasLocalRev: !!localRev,
        });
        const dataStr = readFileSync(filePath, { encoding: 'utf-8' });
        log('Local file sync load completed', {
          dataLength: dataStr.length,
        });
        return {
          rev: getRev(filePath),
          dataStr,
        };
      } catch (e) {
        error('Local file sync load failed', getSafeErrorMeta(e));
        return createSafeIpcError(IPC.FILE_SYNC_LOAD, e);
      }
    },
  );

  ipcMain.handle(
    IPC.FILE_SYNC_REMOVE,
    (
      ev,
      {
        filePath,
      }: {
        filePath: string;
      },
    ): void | Error => {
      try {
        assertPathOutside(getAppPrivateDir(), filePath);
        log(IPC.FILE_SYNC_REMOVE);
        unlinkSync(filePath);
        return;
      } catch (e) {
        error('Local file sync remove failed', getSafeErrorMeta(e));
        return createSafeIpcError(IPC.FILE_SYNC_REMOVE, e);
      }
    },
  );

  ipcMain.handle(
    IPC.CHECK_DIR_EXISTS,
    (
      ev,
      {
        dirPath,
      }: {
        dirPath: string;
      },
    ): true | Error => {
      try {
        assertPathOutside(getAppPrivateDir(), dirPath);
        const dirEntries = readdirSync(dirPath);
        log(IPC.CHECK_DIR_EXISTS, {
          dirEntryCount: dirEntries.length,
        });
        return true;
      } catch (e) {
        error('Local file sync directory check failed', getSafeErrorMeta(e));
        if ((e as NodeJS.ErrnoException).code === 'EACCES') {
          log(
            'ERR: Permission denied. If running as a snap, ensure the "home" or "removable-media" interface is connected.',
          );
        }
        return createSafeIpcError(IPC.CHECK_DIR_EXISTS, e);
      }
    },
  );

  ipcMain.handle(
    IPC.FILE_SYNC_LIST_FILES,
    (
      ev,
      {
        dirPath,
      }: {
        dirPath: string;
      },
    ): string[] | Error => {
      try {
        assertPathOutside(getAppPrivateDir(), dirPath);
        return readdirSync(dirPath);
      } catch (e) {
        error('Local file sync list files failed', getSafeErrorMeta(e));
        if ((e as NodeJS.ErrnoException).code === 'EACCES') {
          log(
            'ERR: Permission denied. If running as a snap, ensure the "home" or "removable-media" interface is connected.',
          );
        }
        return createSafeIpcError(IPC.FILE_SYNC_LIST_FILES, e);
      }
    },
  );

  ipcMain.handle(IPC.PICK_DIRECTORY, async (): Promise<string | undefined> => {
    const { canceled, filePaths } = (await dialog.showOpenDialog(getWin(), {
      title: 'Select sync folder',
      buttonLabel: 'Select Folder',
      properties: [
        'openDirectory',
        'createDirectory',
        'promptToCreate',
        'dontAddToRecent',
      ],
    })) as unknown as { canceled: boolean; filePaths: string[] };
    if (canceled) {
      return undefined;
    } else {
      return filePaths[0];
    }
  });

  ipcMain.handle(
    IPC.SHOW_OPEN_DIALOG,
    async (
      _,
      options: {
        properties: string[];
        title?: string;
        defaultPath?: string;
        filters?: { name: string; extensions: string[] }[];
      },
    ): Promise<string[] | undefined> => {
      const { canceled, filePaths } = (await dialog.showOpenDialog(getWin(), {
        title: options.title || 'Select folder',
        buttonLabel: 'Select',
        properties: options.properties as any,
        defaultPath: options.defaultPath,
        filters: options.filters,
      })) as unknown as { canceled: boolean; filePaths: string[] };
      if (canceled) {
        return undefined;
      } else {
        return filePaths;
      }
    },
  );
};

const getRev = (filePath: string): string => {
  const fileStat = statSync(filePath);
  return fileStat.mtime.getTime().toString();
};

const getSafeErrorMeta = (
  e: unknown,
): {
  errorName: string;
  errorCode?: string | number;
} => {
  const errorName =
    e instanceof Error
      ? e.name
      : typeof e === 'object' && e !== null && 'name' in e && typeof e.name === 'string'
        ? e.name
        : 'UnknownError';
  const errorCode =
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    (typeof e.code === 'string' || typeof e.code === 'number')
      ? e.code
      : undefined;

  return errorCode === undefined ? { errorName } : { errorName, errorCode };
};

const createSafeIpcError = (operation: IPC, e: unknown): Error => {
  const { errorName, errorCode } = getSafeErrorMeta(e);
  const codeMessagePart = errorCode === undefined ? '' : ` (code: ${errorCode})`;
  const safeError = new Error(`${operation} failed: ${errorName}${codeMessagePart}`, {
    cause: { name: errorName, code: errorCode },
  }) as Error & { code?: string | number };
  safeError.name = errorName;
  if (errorCode !== undefined) {
    safeError.code = errorCode;
  }
  delete safeError.stack;

  return safeError;
};
