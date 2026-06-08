export interface BackupFileCleanupMeta {
  fileName: string;
  mtime: number;
}

export const KEEP_RECENT_BACKUP_FILES = 30;
export const KEEP_DAILY_BACKUP_DAYS = 21;
export const DEFAULT_MAX_BACKUP_FILES = KEEP_RECENT_BACKUP_FILES + KEEP_DAILY_BACKUP_DAYS;
export const MIN_BACKUP_FILES = 1;
export const MAX_BACKUP_FILES = DEFAULT_MAX_BACKUP_FILES;

export const normalizeBackupFileCountLimit = (maxBackupFiles?: number | null): number => {
  if (typeof maxBackupFiles !== 'number' || !Number.isFinite(maxBackupFiles)) {
    return DEFAULT_MAX_BACKUP_FILES;
  }
  return Math.min(
    MAX_BACKUP_FILES,
    Math.max(MIN_BACKUP_FILES, Math.floor(maxBackupFiles)),
  );
};

export const selectBackupFilesToDelete = <T extends BackupFileCleanupMeta>(
  files: T[],
  maxBackupFiles?: number | null,
  now: Date = new Date(),
): T[] => {
  const limit = normalizeBackupFileCountLimit(maxBackupFiles);

  const newestFirst = [...files].sort(
    (a, b) => b.mtime - a.mtime || b.fileName.localeCompare(a.fileName),
  );

  if (limit < DEFAULT_MAX_BACKUP_FILES) {
    if (newestFirst.length <= limit) {
      return [];
    }
    const keep = new Set(newestFirst.slice(0, limit).map((file) => file.fileName));
    return newestFirst.filter((file) => !keep.has(file.fileName));
  }

  if (newestFirst.length <= KEEP_RECENT_BACKUP_FILES) {
    return [];
  }

  const keep = new Set<string>();

  for (let i = 0; i < Math.min(KEEP_RECENT_BACKUP_FILES, newestFirst.length); i++) {
    keep.add(newestFirst[i].fileName);
  }

  for (let d = 0; d < KEEP_DAILY_BACKUP_DAYS; d++) {
    const date = new Date(now);
    date.setDate(date.getDate() - d);
    const datePrefix = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

    const dayBackup = newestFirst.find((file) => file.fileName.startsWith(datePrefix));
    if (dayBackup) {
      keep.add(dayBackup.fileName);
    }
  }

  return newestFirst.filter((file) => !keep.has(file.fileName));
};
