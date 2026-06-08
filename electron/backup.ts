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
import {
  DEFAULT_MAX_BACKUP_FILES,
  selectBackupFilesToDelete,
} from './shared-with-frontend/backup-file-cleanup.util';

export const BACKUP_DIR = path.join(app.getPath('userData'), `backups`);
export const BACKUP_DIR_WINSTORE = BACKUP_DIR.replace(
  'Roaming',
  `Local\\Packages\\53707johannesjo.SuperProductivity_ch45amy23cdv6\\LocalCache\\Roaming`,
);

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
    log('Reading backup file: ', backupPath);
    return readFileSync(backupPath, { encoding: 'utf8' });
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
