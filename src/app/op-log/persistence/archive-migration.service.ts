import { inject, Injectable } from '@angular/core';
import { ArchiveStoreService } from './archive-store.service';
import { LegacyPfDbService } from '../../core/persistence/legacy-pf-db.service';
import { Log } from '../../core/log';
import { ArchiveModel } from '../../features/time-tracking/time-tracking.model';

/**
 * Service for migrating archive data from the legacy 'pf' database to SUP_OPS.
 *
 * This is a one-time migration that runs during app startup:
 * 1. Checks if archives already exist in SUP_OPS (skip if yes)
 * 2. Loads archives from legacy 'pf' database
 * 3. Writes them to SUP_OPS
 *
 * The legacy 'pf' database is kept for fallback/recovery purposes.
 */
@Injectable({
  providedIn: 'root',
})
export class ArchiveMigrationService {
  private _archiveStore = inject(ArchiveStoreService);
  private _legacyPfDb = inject(LegacyPfDbService);

  /**
   * Migrates archive data from legacy 'pf' database to SUP_OPS if needed.
   * This is idempotent - if archives already exist in SUP_OPS, it does nothing.
   *
   * @returns true if migration was performed, false if skipped
   */
  async migrateArchivesIfNeeded(): Promise<boolean> {
    // Check if archives already exist in SUP_OPS
    const [hasYoung, hasOld] = await Promise.all([
      this._archiveStore.hasArchiveYoung(),
      this._archiveStore.hasArchiveOld(),
    ]);

    if (hasYoung && hasOld) {
      Log.log(
        'ArchiveMigrationService: Archives already exist in SUP_OPS, skipping migration',
      );
      return false;
    }

    // Check if legacy database has archive data
    const legacyDbExists = await this._legacyPfDb.databaseExists();
    if (!legacyDbExists) {
      Log.log('ArchiveMigrationService: No legacy database found, skipping migration');
      return false;
    }

    // Load archives from legacy database
    const [legacyYoung, legacyOld] = await Promise.all([
      this._legacyPfDb.loadArchiveYoung(),
      this._legacyPfDb.loadArchiveOld(),
    ]);

    // Migrate archiveYoung if it has data and doesn't exist in SUP_OPS
    if (!hasYoung && this._hasArchiveData(legacyYoung)) {
      Log.log('ArchiveMigrationService: Migrating archiveYoung to SUP_OPS');
      await this._archiveStore.saveArchiveYoung(legacyYoung);
    }

    // Migrate archiveOld if it has data and doesn't exist in SUP_OPS
    if (!hasOld && this._hasArchiveData(legacyOld)) {
      Log.log('ArchiveMigrationService: Migrating archiveOld to SUP_OPS');
      await this._archiveStore.saveArchiveOld(legacyOld);
    }

    Log.log('ArchiveMigrationService: Archive migration complete');
    return true;
  }

  /**
   * Checks if an archive has meaningful data worth migrating.
   */
  private _hasArchiveData(archive: ArchiveModel): boolean {
    if (!archive) return false;

    // Check for tasks
    const hasTaskData = !!(
      archive.task &&
      archive.task.ids &&
      archive.task.ids.length > 0
    );

    // Check for time tracking data
    const hasTimeTrackingData = !!(
      archive.timeTracking &&
      (Object.keys(archive.timeTracking.project || {}).length > 0 ||
        Object.keys(archive.timeTracking.tag || {}).length > 0)
    );

    return hasTaskData || hasTimeTrackingData;
  }
}
