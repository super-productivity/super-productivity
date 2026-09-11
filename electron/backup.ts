import { createSafeIpcError, getSafeErrorMeta } from './safe-ipc-error';
import { app, dialog, ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { randomBytes } from 'crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
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
import {
  getBackupTimestamp,
  isAutoBackupFilename,
} from './shared-with-frontend/get-backup-timestamp';
import { assertPathOutside, canonicalize, isPathInsideDir } from './file-path-guard';
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
 * Where automatic backups are written to and restored from: the folder the user
 * picked via `IPC.PICK_BACKUP_FOLDER`, or BACKUP_DIR while none is configured.
 * The picked path is main-owned (like the sync folder path, #8228) for two
 * reasons: the renderer runs untrusted plugin code and must not be able to
 * redirect backup writes, and the folder is device-specific so it must not
 * travel in the synced globalConfig.
 */
export const getBackupDir = async (): Promise<string> => {
  const all = await loadSimpleStoreAll();
  const raw = all[SimpleStoreKey.BACKUP_FOLDER_PATH];
  return typeof raw === 'string' && raw.length > 0 ? raw : BACKUP_DIR;
};

// Path-free (the offending path never goes back to the untrusted renderer) and
// distinct from PathNotAllowedError only in name, so the two pick-time refusals
// stay tellable apart in logs.
const folderNotWritable = (): Error => {
  const e = new Error('Backup folder is not writable');
  e.name = 'FolderNotWritableError';
  delete (e as { stack?: string }).stack;
  return e;
};

// Same shape as folderNotWritable: path-free, distinct only in name so the
// "your backup location went away" case stays tellable apart in logs.
const backupFolderGone = (): Error => {
  const e = new Error('Backup folder no longer exists');
  e.name = 'BackupFolderGoneError';
  delete (e as { stack?: string }).stack;
  return e;
};

/**
 * Prove the folder can actually be written to, at pick time, before it becomes
 * the backup folder.
 *
 * A probe write is what proves it: the folder can be listable and still refuse
 * writes, and `access()` answers a different question than "did a write work".
 */
const assertFolderWritable = (folder: string): void => {
  const probePath = path.join(
    folder,
    `.sp-backup-probe.${process.pid}.${randomBytes(8).toString('hex')}.tmp`,
  );
  try {
    writeFileSync(probePath, '');
  } catch (e) {
    error(e);
    throw folderNotWritable();
  }
  try {
    unlinkSync(probePath);
  } catch (e) {
    // Written but not removable is still a usable backup folder, and cleanup
    // only ever touches backup-shaped filenames, so this is worth a log and
    // nothing more.
    error(e);
  }
};

// Long enough that a temp file still in flight in another instance is never a
// candidate; short enough that leftovers do not sit in the user's folder.
const STALE_TMP_MAX_AGE_MS = 60 * 60 * 1000;

/**
 * Leftovers from this app's own interrupted writes: the `.tmp` a crash between
 * writeFileSync and renameSync leaves behind, and a probe file whose unlink
 * failed. Both are deliberately not backup-shaped, which keeps retention away
 * from them — and would also mean nothing ever removes them from a folder the
 * user picked for their own files. Matched on the exact names this file
 * produces, never a bare `.tmp`.
 */
const isOwnTmpFilename = (fileName: string): boolean =>
  /^\d{4}-\d{2}-\d{2}_\d{6}\.json\.\d+\.tmp$/.test(fileName) ||
  /^\.sp-backup-probe\.\d+\.[0-9a-f]{16}\.tmp$/.test(fileName);

const removeStaleTmpFiles = (backupDir: string, entries: string[]): void => {
  const tooOldBefore = Date.now() - STALE_TMP_MAX_AGE_MS;
  for (const fileName of entries.filter(isOwnTmpFilename)) {
    const filePath = path.join(backupDir, fileName);
    try {
      if (statSync(filePath).mtime.getTime() < tooOldBefore) {
        unlinkSync(filePath);
      }
    } catch (e) {
      log(`Error deleting stale temp file ${fileName}`);
      error(e);
    }
  }
};

const isRestorableBackupFilename = (backupDir: string, fileName: string): boolean =>
  isAutoBackupFilename(fileName) ||
  (backupDir === BACKUP_DIR && fileName.endsWith('.json'));

// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
export function initBackupAdapter(): void {
  void getBackupDir().then((backupDir) => {
    console.log('Saving backups to', backupDir);
    log('Saving backups to', backupDir);
  });

  // BACKUP
  ipcMain.handle(IPC.BACKUP, backupData);

  // IS_BACKUP_AVAILABLE: newest file only for the startup restore prompt.
  ipcMain.handle(IPC.BACKUP_IS_AVAILABLE, async (): Promise<LocalBackupMeta | false> => {
    const backupDir = await getBackupDir();
    const files = listBackupFiles(backupDir);
    log(
      'Available Backup Files: ',
      files.map((f) => f.path),
    );
    return files[0] ?? false;
  });

  // BACKUP_LIST: every file, newest first in the Settings backups list.
  ipcMain.handle(
    IPC.BACKUP_LIST,
    async (): Promise<LocalBackupMeta[]> => listBackupFiles(await getBackupDir()),
  );

  // RESTORE_BACKUP
  ipcMain.handle(
    IPC.BACKUP_LOAD_DATA,
    async (ev, backupPath: string): Promise<string> => {
      // `backupPath` comes from the renderer, which runs untrusted plugin code,
      // so it must be constrained to the backup directory. Otherwise any plugin
      // (or XSS payload) could read arbitrary files via window.ea.loadBackupData.
      // See GHSA-x937-wf3j-88q3. Only the live backup dir (the default one or a
      // user-picked one, which is main-owned and always outside userData, see
      // below) and its Windows-Store redirection are accepted; the legitimate
      // caller only ever passes paths built from the live backup dir (see
      // IPC.BACKUP_IS_AVAILABLE above), so a stale default-dir path is never
      // produced and allow-listing one would only widen the read surface.
      const backupDir = await getBackupDir();
      const isAllowedRoot =
        isPathInsideDir(backupDir, backupPath) ||
        // Same narrowing as getBackupDirForDisplay: the Store redirection is a
        // property of the package's own userData, so it can only ever apply
        // while the default dir is in use.
        (backupDir === BACKUP_DIR && isPathInsideDir(BACKUP_DIR_WINSTORE, backupPath));
      if (!isAllowedRoot) {
        throw new Error('BACKUP_LOAD_DATA: refused path outside backup directory');
      }
      if (!isRestorableBackupFilename(backupDir, path.basename(backupPath))) {
        throw new Error('BACKUP_LOAD_DATA: refused non-backup filename');
      }
      const resolved = path.resolve(backupPath);
      log('Reading backup file: ', resolved);
      return readFileSync(resolved, { encoding: 'utf8' });
    },
  );

  // PICK_BACKUP_FOLDER
  ipcMain.handle(IPC.PICK_BACKUP_FOLDER, async (): Promise<string | undefined> => {
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog(getWin(), {
        title: 'Select backup folder',
        buttonLabel: 'Select Folder',
        // Open where the backups currently are, so "which folder am I on now" and
        // "put it back to the default" are both reachable without hunting down a
        // hidden path inside userData.
        defaultPath: await getBackupDirForDisplay(),
        // No `promptToCreate`: on Windows it hands back a path the dialog did
        // not create, which assertFolderWritable then refuses — offering to
        // create a folder and calling it unusable a moment later. Both native
        // dialogs can create a folder on their own (`createDirectory` on macOS,
        // the New folder button on Windows), so nothing is lost.
        properties: ['openDirectory', 'createDirectory', 'dontAddToRecent'],
      });
      if (canceled || !filePaths[0]) {
        return undefined;
      }
      const picked = canonicalize(filePaths[0]);
      // Picking the default folder means "use the default again": it lives inside
      // userData, which the guard below refuses. On a virtualized Store package
      // the folder the user sees (and that getBackupDirForDisplay hands to the
      // picker above) is the LocalCache one, so that has to count as the default
      // too, or picking back the very path we displayed either gets refused or
      // pins a "custom" folder to LocalCache.
      if (
        picked === canonicalize(BACKUP_DIR) ||
        (process.windowsStore && picked === canonicalize(BACKUP_DIR_WINSTORE))
      ) {
        await saveSimpleStore(SimpleStoreKey.BACKUP_FOLDER_PATH, null);
        return picked;
      }
      // Keep the folder out of the app's private dir: it is written to on a timer
      // and, more importantly, whitelisted for reads by BACKUP_LOAD_DATA above,
      // which the renderer can call. Throws a path-free PathNotAllowedError.
      assertPathOutside(app.getPath('userData'), picked);
      assertFolderWritable(picked);
      await saveSimpleStore(SimpleStoreKey.BACKUP_FOLDER_PATH, picked);
      log('New backup folder picked');
      return picked;
    } catch (e) {
      error('PICK_BACKUP_FOLDER failed to validate picked folder', getSafeErrorMeta(e));
      throw createSafeIpcError(IPC.PICK_BACKUP_FOLDER, e);
    }
  });
}

/** All restorable backup files in backupDir, newest first. */
const listBackupFiles = (backupDir: string): LocalBackupMeta[] => {
  if (!existsSync(backupDir)) {
    return [];
  }
  const files: LocalBackupMeta[] = [];
  for (const name of readdirSync(backupDir)) {
    if (!isRestorableBackupFilename(backupDir, name)) {
      continue;
    }
    const filePath = path.join(backupDir, name);
    try {
      files.push({
        name,
        path: filePath,
        folder: backupDir,
        created: statSync(filePath).mtime.getTime(),
      });
    } catch (e) {
      // The retention cleanup may delete a file between readdir and stat.
      log(`Skipping unreadable backup file ${name}`);
    }
  }
  return files.sort((a, b) => b.created - a.created);
};

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
    if (!existsSync(backupDir)) {
      // A picked folder existed and was write-probed at pick time, so its
      // absence now means the location went away: a volume ejected, a share
      // unmounted, the folder deleted. Re-creating it would write backups onto
      // whatever filesystem sits under the mount point, where the user cannot
      // find them and where they are shadowed the moment the real location is
      // back — while every write "succeeds", so the last-backup time keeps
      // claiming they are protected. Only the default dir is created; it lives
      // in userData and is legitimately absent before the first backup.
      if (backupDir !== BACKUP_DIR) {
        throw backupFolderGone();
      }
      mkdirSync(backupDir);
    }
    const backup = JSON.stringify(data);
    const backupPath = path.join(backupDir, `${getBackupTimestamp()}.json`);
    const tmpPath = `${backupPath}.${process.pid}.tmp`;
    writeFileSync(tmpPath, backup);
    renameSync(tmpPath, backupPath);
    cleanupOldBackups(backupDir, maxBackupFiles);
  } catch (e) {
    error('Error while backing up', getSafeErrorMeta(e));
    throw createSafeIpcError(IPC.BACKUP, e);
  }
}

// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
function cleanupOldBackups(backupDir: string, maxBackupFiles?: number | null): void {
  if (!existsSync(backupDir)) {
    return;
  }

  try {
    const entries = readdirSync(backupDir);
    const filesWithMtime = listBackupFiles(backupDir)
      .filter((file) => isAutoBackupFilename(file.name))
      .map((file) => ({
        fileName: file.name,
        filePath: file.path,
        mtime: file.created,
      }));

    for (const file of selectBackupFilesToDelete(filesWithMtime, maxBackupFiles)) {
      try {
        unlinkSync(file.filePath);
      } catch (e) {
        log(`Error deleting backup file ${file.fileName}`);
        error(e);
      }
    }

    removeStaleTmpFiles(backupDir, entries);
  } catch (e) {
    log('Error during backup cleanup');
    error(e);
  }
}
