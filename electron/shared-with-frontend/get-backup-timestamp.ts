export const BACKUP_FILENAME_PREFIX = 'sp-backup';
export const BACKUP_FILENAME_PREFIX_ANONYMIZED = 'sp-backup-anonymized';
export const MIGRATION_BACKUP_PREFIX = 'sp-pre-migration-backup';

/**
 * Generates a timestamp string in format: YYYY-MM-DD_HHmmss
 * Used for backup file naming in both Electron (main process) and Angular (renderer).
 * Shared utility to ensure consistent backup filename formatting across all platforms and contexts (automatic backups and manual downloads).
 *
 * @returns Timestamp string in format YYYY-MM-DD_HHmmss (e.g., '2025-04-05_143022')
 */
export const getBackupTimestamp = (): string => {
  const now = new Date();
  const yyyy = now.getFullYear();
  const MM = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const HH = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${yyyy}-${MM}-${dd}_${HH}${mm}${ss}`;
};
