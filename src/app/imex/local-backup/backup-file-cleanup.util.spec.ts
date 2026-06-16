import {
  DEFAULT_MAX_BACKUP_FILES,
  normalizeBackupFileCountLimit,
  selectBackupFilesToDelete,
} from '../../../../electron/shared-with-frontend/backup-file-cleanup.util';

const makeBackup = (
  fileName: string,
  mtime: number,
): { fileName: string; mtime: number } => ({
  fileName,
  mtime,
});

describe('backup-file-cleanup.util', () => {
  describe('normalizeBackupFileCountLimit', () => {
    it('uses the desktop default when the value is missing or invalid', () => {
      expect(normalizeBackupFileCountLimit(undefined)).toBe(DEFAULT_MAX_BACKUP_FILES);
      expect(normalizeBackupFileCountLimit(null)).toBe(DEFAULT_MAX_BACKUP_FILES);
      expect(normalizeBackupFileCountLimit(Number.NaN)).toBe(DEFAULT_MAX_BACKUP_FILES);
    });

    it('clamps and floors configured limits', () => {
      expect(normalizeBackupFileCountLimit(-1)).toBe(1);
      expect(normalizeBackupFileCountLimit(2.9)).toBe(2);
      expect(normalizeBackupFileCountLimit(DEFAULT_MAX_BACKUP_FILES + 10)).toBe(
        DEFAULT_MAX_BACKUP_FILES,
      );
    });
  });

  describe('selectBackupFilesToDelete', () => {
    it('deletes the oldest files once a custom limit is exceeded', () => {
      const files = [
        makeBackup('2026-01-01_000000.json', 1),
        makeBackup('2026-01-01_000001.json', 2),
        makeBackup('2026-01-01_000002.json', 3),
        makeBackup('2026-01-01_000003.json', 4),
      ];

      expect(selectBackupFilesToDelete(files, 2).map((file) => file.fileName)).toEqual([
        '2026-01-01_000001.json',
        '2026-01-01_000000.json',
      ]);
    });

    it('keeps all files while the configured limit is not exceeded', () => {
      expect(
        selectBackupFilesToDelete([makeBackup('2026-01-01_000000.json', 1)], 2),
      ).toEqual([]);
    });

    it('uses the legacy desktop cleanup threshold for the default limit', () => {
      const now = new Date('2026-06-08T12:00:00');
      const files = Array.from({ length: 31 }, (_, i) =>
        makeBackup(`2026-04-01_${String(i).padStart(6, '0')}.json`, i),
      );

      expect(
        selectBackupFilesToDelete(files, DEFAULT_MAX_BACKUP_FILES, now).map(
          (file) => file.fileName,
        ),
      ).toEqual(['2026-04-01_000000.json']);
    });

    it('keeps recent and daily backups for the default desktop cleanup behavior', () => {
      const now = new Date('2026-06-08T12:00:00');
      const files = [
        makeBackup('2026-06-08_100000.json', 100),
        makeBackup('2026-06-07_100000.json', 90),
        makeBackup('2026-05-01_100000.json', -1),
        ...Array.from({ length: DEFAULT_MAX_BACKUP_FILES }, (_, i) =>
          makeBackup(`2026-04-01_${String(i).padStart(6, '0')}.json`, i),
        ),
      ];

      const toDelete = selectBackupFilesToDelete(files, DEFAULT_MAX_BACKUP_FILES, now);

      expect(toDelete.some((file) => file.fileName === '2026-06-08_100000.json')).toBe(
        false,
      );
      expect(toDelete.some((file) => file.fileName === '2026-06-07_100000.json')).toBe(
        false,
      );
      expect(toDelete.some((file) => file.fileName === '2026-05-01_100000.json')).toBe(
        true,
      );
    });
  });
});
