import { Injectable } from '@angular/core';
import { OpLog } from '../../core/log';

/**
 * Reason for creating a pre-migration backup.
 * Used to track why a clean slate operation was triggered.
 */
export type PreMigrationReason = 'ENCRYPTION_CHANGE' | 'MANUAL';

/**
 * PLACEHOLDER: Service for creating pre-migration backups before clean slate operations.
 *
 * ## TODO
 * This service will capture the current application state before destructive operations
 * like encryption password changes or full imports. For now, it's a no-op placeholder.
 *
 * Future implementation should:
 * - Save current state to import_backup store
 * - Include vector clock and metadata
 * - Provide recovery UI
 */
@Injectable({
  providedIn: 'root',
})
export class PreMigrationBackupService {
  /**
   * PLACEHOLDER: Creates a pre-migration backup.
   * Currently does nothing - to be implemented.
   */
  async createPreMigrationBackup(reason: PreMigrationReason): Promise<void> {
    OpLog.normal('[PreMigrationBackup] PLACEHOLDER - backup not implemented', { reason });
    // TODO: Implement backup creation
  }

  /**
   * PLACEHOLDER: Checks if a pre-migration backup exists.
   */
  async hasPreMigrationBackup(): Promise<boolean> {
    return false;
  }

  /**
   * PLACEHOLDER: Clears the pre-migration backup.
   */
  async clearPreMigrationBackup(): Promise<void> {
    OpLog.normal('[PreMigrationBackup] PLACEHOLDER - clear not implemented');
  }
}
