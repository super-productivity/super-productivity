import { app, ipcMain, IpcMainEvent } from 'electron';
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
import { isPathInsideDir } from './file-path-guard';
import {
  DEFAULT_MAX_BACKUP_FILES,
  selectBackupFilesToDelete,
} from './shared-with-frontend/backup-file-cleanup.util';

export const BACKUP_DIR = path.join(app.getPath('userData'), `backups`);

/**
 * Where a *virtualized* MSIX package's writes to BACKUP_DIR physically land, so
 * that Explorer (which runs outside the package and does not see the
 * redirection) can be pointed at them. We never write here, and never read
 * backup files from here on our own initiative — but `BACKUP_LOAD_DATA` below
 * does accept it as a second allow-listed read root, so it is not inert.
 * Only ever reached through `getBackupDirForDisplay()`, which verifies it.
 *
 * shortcut: the package family name is hardcoded and cannot be verified from
 * source — the appx config lives in the WIN_STORE_ELECTRON_BUILDER_YML secret,
 * so nothing in CI would notice it drifting. Drift degrades gracefully (the
 * probe fails and we show BACKUP_DIR). Upgrade path if it ever changes: derive
 * `<name>_<publisherHash>` from the WindowsApps segment of process.execPath.
 */
const BACKUP_DIR_WINSTORE = BACKUP_DIR.replace(
  'Roaming',
  `Local\\Packages\\53707johannesjo.SuperProductivity_ch45amy23cdv6\\LocalCache\\Roaming`,
);

/**
 * The backup location to *show* the user, which is not always the one we write
 * to: a virtualized MSIX package has its AppData writes redirected into the
 * package's private LocalCache. That redirection applies only to virtualized
 * packages and, since Windows 10 1903, is decided per file — so it cannot be
 * known statically. Assuming it always applies is what made #9209 the mirror
 * image of #995.
 *
 * shortcut: an install that flipped from virtualized to full-trust keeps a
 * stale LocalCache dir, which still wins the probe — the user would be shown
 * real but outdated backups. Accepted because restore reads BACKUP_DIR either
 * way, so only manual recovery is affected. Upgrade path if it gets reported:
 * probe for the newest filename in BACKUP_DIR (timestamps sort lexically)
 * rather than for the directory, which pins where the last write actually went.
 */
export const getBackupDirForDisplay = (): string =>
  process.windowsStore && existsSync(BACKUP_DIR_WINSTORE)
    ? BACKUP_DIR_WINSTORE
    : BACKUP_DIR;

// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
export function initBackupAdapter(): void {
  console.log('Saving backups to', BACKUP_DIR);
  log('Saving backups to', BACKUP_DIR);

  // BACKUP
  ipcMain.on(IPC.BACKUP, backupData);

  // IS_BACKUP_AVAILABLE
  ipcMain.handle(IPC.BACKUP_IS_AVAILABLE, (): LocalBackupMeta | false => {
    if (!existsSync(BACKUP_DIR)) {
      return false;
    }

    const files = readdirSync(BACKUP_DIR);
    if (!files.length) {
      return false;
    }
    const filesWithMeta: LocalBackupMeta[] = files.map(
      (fileName: string): LocalBackupMeta => ({
        name: fileName,
        path: path.join(BACKUP_DIR, fileName),
        folder: BACKUP_DIR,
        created: statSync(path.join(BACKUP_DIR, fileName)).mtime.getTime(),
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
  ipcMain.handle(IPC.BACKUP_LOAD_DATA, (ev, backupPath: string): string => {
    // `backupPath` comes from the renderer, which runs untrusted plugin code,
    // so it must be constrained to the backup directory. Otherwise any plugin
    // (or XSS payload) could read arbitrary files via window.ea.loadBackupData.
    // See GHSA-x937-wf3j-88q3. Both the regular and the Windows-Store backup
    // dirs are accepted; the legitimate caller only ever passes paths built
    // from BACKUP_DIR (see IPC.BACKUP_IS_AVAILABLE above).
    if (
      !isPathInsideDir(BACKUP_DIR, backupPath) &&
      !isPathInsideDir(BACKUP_DIR_WINSTORE, backupPath)
    ) {
      throw new Error('BACKUP_LOAD_DATA: refused path outside backup directory');
    }
    const resolved = path.resolve(backupPath);
    log('Reading backup file: ', resolved);
    return readFileSync(resolved, { encoding: 'utf8' });
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
function backupData(
  ev: IpcMainEvent,
  dataOrArgs: AppDataCompleteLegacy | BackupDataArgs,
): void {
  if (!existsSync(BACKUP_DIR)) {
    mkdirSync(BACKUP_DIR);
  }
  const filePath = `${BACKUP_DIR}/${getBackupTimestamp()}.json`;
  const data = isBackupDataArgs(dataOrArgs) ? dataOrArgs.data : dataOrArgs;
  const maxBackupFiles = isBackupDataArgs(dataOrArgs)
    ? dataOrArgs.maxBackupFiles
    : DEFAULT_MAX_BACKUP_FILES;

  try {
    const backup = JSON.stringify(data);
    writeFileSync(filePath, backup);
    cleanupOldBackups(maxBackupFiles);
  } catch (e) {
    log('Error while backing up');
    error(e);
  }
}

// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
function cleanupOldBackups(maxBackupFiles?: number | null): void {
  if (!existsSync(BACKUP_DIR)) {
    return;
  }

  try {
    const files = readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.json'));
    const filesWithMtime = files.map((fileName) => {
      const filePath = path.join(BACKUP_DIR, fileName);
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
