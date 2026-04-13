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
import { AppDataCompleteLegacy } from '../src/app/imex/sync/sync.model';

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

// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
function backupData(ev: IpcMainEvent, data: AppDataCompleteLegacy): void {
  if (!existsSync(BACKUP_DIR)) {
    mkdirSync(BACKUP_DIR);
  }
  const filePath = `${BACKUP_DIR}/${getDateStr()}.json`;

  try {
    const backup = JSON.stringify(data);
    writeFileSync(filePath, backup);
    cleanupOldBackups();
  } catch (e) {
    log('Error while backing up');
    error(e);
  }
}

// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
function getDateStr(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const MM = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const HH = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${yyyy}-${MM}-${dd}_${HH}${mm}${ss}`;
}

const KEEP_RECENT = 30;
const KEEP_DAILY_DAYS = 21;

// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
function cleanupOldBackups(): void {
  if (!existsSync(BACKUP_DIR)) {
    return;
  }

  try {
    const files = readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.json'));
    if (files.length <= KEEP_RECENT) {
      return;
    }

    const filesWithMtime = files.map((fileName) => {
      const filePath = path.join(BACKUP_DIR, fileName);
      return { fileName, filePath, mtime: statSync(filePath).mtime.getTime() };
    });

    // Sort newest first
    filesWithMtime.sort((a, b) => b.mtime - a.mtime);

    // Always keep the most recent backups
    const keep = new Set<string>();
    for (let i = 0; i < Math.min(KEEP_RECENT, filesWithMtime.length); i++) {
      keep.add(filesWithMtime[i].fileName);
    }

    // Keep the last backup of each day for the past N days
    const now = new Date();
    for (let d = 0; d < KEEP_DAILY_DAYS; d++) {
      const date = new Date(now);
      date.setDate(date.getDate() - d);
      const datePrefix = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

      // Find the latest backup for this day (already sorted newest first)
      const dayBackup = filesWithMtime.find((f) => f.fileName.startsWith(datePrefix));
      if (dayBackup) {
        keep.add(dayBackup.fileName);
      }
    }

    // Delete everything not in the keep set
    for (const file of filesWithMtime) {
      if (!keep.has(file.fileName)) {
        try {
          unlinkSync(file.filePath);
        } catch (e) {
          log(`Error deleting backup file ${file.fileName}`);
          error(e);
        }
      }
    }
  } catch (e) {
    log('Error during backup cleanup');
    error(e);
  }
}
