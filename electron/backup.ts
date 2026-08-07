import { app, dialog, ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { IPC } from './shared-with-frontend/ipc-events.const';
import { LocalBackupMeta } from '../src/app/imex/local-backup/local-backup.model';
import * as path from 'path';
import { error, log } from 'electron-log/main';
import type { AppDataCompleteLegacy } from '../src/app/imex/sync/sync.model';
import type { AppDataComplete } from '../src/app/op-log/model/model-config';
import { getBackupTimestamp } from './shared-with-frontend/get-backup-timestamp';
import { assertPathOutside, isPathInsideDir } from './file-path-guard';
import {
  DEFAULT_MAX_BACKUP_FILES,
  selectBackupFilesToDelete,
} from './shared-with-frontend/backup-file-cleanup.util';
import { SimpleStoreKey } from './shared-with-frontend/simple-store.const';
import { loadSimpleStoreAll, saveSimpleStore } from './simple-store';
import { getWin } from './main-window';

export const BACKUP_DIR = path.join(app.getPath('userData'), `backups`);

/**
 * Where a virtualized MSIX package's writes to BACKUP_DIR physically land, so
 * Explorer (which runs outside the package and sees no redirection) can be
 * pointed at them. Display-oriented but not inert: `BACKUP_LOAD_DATA` below
 * also accepts it as an allow-listed read root.
 *
 * shortcut: the package family name is hardcoded and nothing in CI would notice
 * it drifting (the appx config lives in the WIN_STORE_ELECTRON_BUILDER_YML
 * secret); drift just fails the probe and we show BACKUP_DIR. Verified against
 * the shipped v18.15.1 appx on 2026-07-21 — it is `<Identity Name>_<PublisherId>`,
 * PublisherId being base32(SHA-256(UTF-16LE Publisher)[0..8]), so any release
 * artifact re-checks it without a Windows machine.
 */
const BACKUP_DIR_WINSTORE = BACKUP_DIR.replace(
  'Roaming',
  `Local\\Packages\\53707johannesjo.SuperProductivity_ch45amy23cdv6\\LocalCache\\Roaming`,
);

/**
 * The backup location to *show* the user, which is not always the one we write
 * to. Redirection applies only to virtualized packages and, since Windows 10
 * 1903, is decided per file — it cannot be known statically, and assuming it
 * always applies is what made #9209 the mirror image of #995.
 *
 * shortcut: an install that flipped from virtualized to full-trust keeps a
 * stale LocalCache dir that still wins the probe, showing real but outdated
 * backups. Accepted — restore reads BACKUP_DIR either way, so only manual
 * recovery is affected. Upgrade path: probe for the newest filename in
 * BACKUP_DIR (timestamps sort lexically) instead of for the directory.
 */
export const getBackupDirForDisplay = async (): Promise<string> => {
  const backupDir = await getBackupDir();
  // Redirection is a property of the package's own virtualized userData, so it
  // can only ever apply to the default dir — a folder the user picked lives
  // outside the package and is written exactly where it says.
  return backupDir === BACKUP_DIR &&
    process.windowsStore &&
    existsSync(BACKUP_DIR_WINSTORE)
    ? BACKUP_DIR_WINSTORE
    : backupDir;
};

/**
 * The folder the user picked via `IPC.PICK_BACKUP_FOLDER`, or null while none is
 * configured. Main-owned (like the sync folder path, #8228) for two reasons: the
 * renderer runs untrusted plugin code and must not be able to redirect backup
 * writes, and the folder is device-specific so it must not travel in the synced
 * globalConfig.
 */
const getCustomBackupDir = async (): Promise<string | null> => {
  const all = await loadSimpleStoreAll();
  const raw = all[SimpleStoreKey.BACKUP_FOLDER_PATH];
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
};

/** Where automatic backups are written to and restored from. */
export const getBackupDir = async (): Promise<string> =>
  (await getCustomBackupDir()) ?? BACKUP_DIR;

// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
export function initBackupAdapter(): void {
  getBackupDir().then((backupDir) => {
    console.log('Saving backups to', backupDir);
    log('Saving backups to', backupDir);
  });

  // BACKUP
  ipcMain.handle(IPC.BACKUP, backupData);

  // IS_BACKUP_AVAILABLE
  ipcMain.handle(IPC.BACKUP_IS_AVAILABLE, async (): Promise<LocalBackupMeta | false> => {
    const backupDir = await getBackupDir();
    if (!existsSync(backupDir)) {
      return false;
    }

    const files = readdirSync(backupDir);
    if (!files.length) {
      return false;
    }
    const filesWithMeta: LocalBackupMeta[] = files.map(
      (fileName: string): LocalBackupMeta => ({
        name: fileName,
        path: path.join(backupDir, fileName),
        folder: backupDir,
        created: statSync(path.join(backupDir, fileName)).mtime.getTime(),
      }),
    );

    filesWithMeta.sort((a: LocalBackupMeta, b: LocalBackupMeta) => a.created - b.created);
    log(
      'Avilable Backup Files: ',
      filesWithMeta?.map && filesWithMeta.map((f) => f.path),
    );
    return filesWithMeta.reverse()[0];
  });

  // RESTORE_BACKUP
  ipcMain.handle(
    IPC.BACKUP_LOAD_DATA,
    async (ev, backupPath: string): Promise<string> => {
      // `backupPath` comes from the renderer, which runs untrusted plugin code,
      // so it must be constrained to the backup directory. Otherwise any plugin
      // (or XSS payload) could read arbitrary files via window.ea.loadBackupData.
      // See GHSA-x937-wf3j-88q3. The regular, the Windows-Store and the
      // user-picked backup dirs are accepted (the latter is main-owned and always
      // outside userData, see below); the legitimate caller only ever passes paths
      // built from the live backup dir (see IPC.BACKUP_IS_AVAILABLE above).
      const backupDir = await getBackupDir();
      if (
        !isPathInsideDir(backupDir, backupPath) &&
        !isPathInsideDir(BACKUP_DIR, backupPath) &&
        !isPathInsideDir(BACKUP_DIR_WINSTORE, backupPath)
      ) {
        throw new Error('BACKUP_LOAD_DATA: refused path outside backup directory');
      }
      const resolved = path.resolve(backupPath);
      log('Reading backup file: ', resolved);
      return readFileSync(resolved, { encoding: 'utf8' });
    },
  );

  // PICK_BACKUP_FOLDER
  ipcMain.handle(IPC.PICK_BACKUP_FOLDER, async (): Promise<string | undefined> => {
    const { canceled, filePaths } = await dialog.showOpenDialog(getWin(), {
      title: 'Select backup folder',
      buttonLabel: 'Select Folder',
      properties: ['openDirectory', 'createDirectory', 'dontAddToRecent'],
    });
    if (canceled || !filePaths[0]) {
      return undefined;
    }
    const picked = path.resolve(filePaths[0]);
    // Picking the default folder means "use the default again" — it lives
    // inside userData, which the guard below refuses.
    if (picked === path.resolve(BACKUP_DIR)) {
      await saveSimpleStore(SimpleStoreKey.BACKUP_FOLDER_PATH, null);
      return picked;
    }
    // Keep the folder out of the app's private dir: it is written to on a timer
    // and, more importantly, whitelisted for reads by BACKUP_LOAD_DATA above,
    // which the renderer can call. Throws a path-free PathNotAllowedError.
    assertPathOutside(app.getPath('userData'), picked);
    await saveSimpleStore(SimpleStoreKey.BACKUP_FOLDER_PATH, picked);
    log('New backup folder picked');
    return picked;
  });
}

interface BackupDataArgs {
  data: AppDataCompleteLegacy | AppDataComplete;
  maxBackupFiles?: number | null;
}

const isBackupDataArgs = (arg: unknown): arg is BackupDataArgs =>
  !!arg &&
  typeof arg === 'object' &&
  'data' in arg &&
  typeof (arg as { data?: unknown }).data === 'object';

// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
async function backupData(
  ev: IpcMainInvokeEvent,
  dataOrArgs: AppDataCompleteLegacy | BackupDataArgs,
): Promise<void> {
  const backupDir = await getBackupDir();
  const data = isBackupDataArgs(dataOrArgs) ? dataOrArgs.data : dataOrArgs;
  const maxBackupFiles = isBackupDataArgs(dataOrArgs)
    ? dataOrArgs.maxBackupFiles
    : DEFAULT_MAX_BACKUP_FILES;

  try {
    // Inside the try because a picked folder can be gone by now (removed
    // drive, deleted folder) — that must be logged like a failed write, not
    // rejected back into the renderer's backup interval.
    if (!existsSync(backupDir)) {
      mkdirSync(backupDir, { recursive: true });
    }
    const backup = JSON.stringify(data);
    writeFileSync(`${backupDir}/${getBackupTimestamp()}.json`, backup);
    cleanupOldBackups(backupDir, maxBackupFiles);
  } catch (e) {
    log('Error while backing up');
    error(e);
  }
}

// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
function cleanupOldBackups(backupDir: string, maxBackupFiles?: number | null): void {
  if (!existsSync(backupDir)) {
    return;
  }

  try {
    const files = readdirSync(backupDir).filter((f) => f.endsWith('.json'));
    const filesWithMtime = files.map((fileName) => {
      const filePath = path.join(backupDir, fileName);
      return { fileName, filePath, mtime: statSync(filePath).mtime.getTime() };
    });

    for (const file of selectBackupFilesToDelete(filesWithMtime, maxBackupFiles)) {
      try {
        unlinkSync(file.filePath);
      } catch (e) {
        log(`Error deleting backup file ${file.fileName}`);
        error(e);
      }
    }
  } catch (e) {
    log('Error during backup cleanup');
    error(e);
  }
}
