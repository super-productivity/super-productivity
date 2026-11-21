import { inject, Injectable } from '@angular/core';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- grandfathered layer-boundary debt
import { ArchiveModel } from '../../features/time-tracking/time-tracking.model';
import { ArchiveStoreService } from '../../op-log/persistence/archive-store.service';

// Issue #7487: a malformed archive blob (missing/null `task` or `timeTracking`) on disk
// crashes every reader of `archive.task.entities` / `archive.timeTracking.tag`. Repair
// at the read boundary. `undefined` (nothing in DB) is preserved so callers' existing
// `|| DEFAULT_ARCHIVE` fallbacks keep working.
const normalizeArchiveModel = (
  archive: ArchiveModel | undefined,
): ArchiveModel | undefined => {
  if (!archive) return archive;
  const isTaskValid =
    !!archive.task && Array.isArray(archive.task.ids) && !!archive.task.entities;
  const isTimeTrackingValid =
    !!archive.timeTracking &&
    !!archive.timeTracking.project &&
    !!archive.timeTracking.tag;
  if (isTaskValid && isTimeTrackingValid) return archive;
  return {
    ...archive,
    task: isTaskValid ? archive.task : { ids: [], entities: {} },
    timeTracking: isTimeTrackingValid ? archive.timeTracking : { project: {}, tag: {} },
  };
};

/**
 * Adapter for archive storage operations.
 *
 * ## Purpose
 *
 * This service provides a clean interface for archive persistence operations
 * (archiveYoung, archiveOld). It delegates to ArchiveStoreService which
 * stores archives in the SUP_OPS IndexedDB database.
 *
 * ## Usage
 *
 * Used by `ArchiveOperationHandler` for:
 * - `_handleFlushYoungToOld()`: Reading/writing archiveYoung and archiveOld
 * - `_handleLoadAllData()`: Writing archive data from SYNC_IMPORT/BACKUP_IMPORT
 *
 * @see src/app/op-log/apply/archive-operation-handler.service.ts
 */
@Injectable({
  providedIn: 'root',
})
export class ArchiveDbAdapter {
  private _archiveStore = inject(ArchiveStoreService);

  /** Сохраняет нормализацию для sync и сообщает, подменяла ли она задачи. */
  async loadArchivesForSnapshot(): Promise<{
    archiveYoung: ArchiveModel | undefined;
    archiveOld: ArchiveModel | undefined;
    taskDataUnmodified: boolean;
  }> {
    const [rawYoung, rawOld] = await Promise.all([
      this._archiveStore.loadArchiveYoung(),
      this._archiveStore.loadArchiveOld(),
    ]);
    // Only an undefined payload is ambiguous: hasArchive* reads the whole row,
    // so avoid cloning each populated archive a second time just to check it exists.
    const [hasYoung, hasOld] = await Promise.all([
      rawYoung === undefined ? this._archiveStore.hasArchiveYoung() : true,
      rawOld === undefined ? this._archiveStore.hasArchiveOld() : true,
    ]);
    const archiveYoung = normalizeArchiveModel(rawYoung);
    const archiveOld = normalizeArchiveModel(rawOld);
    const unchanged = (
      raw: ArchiveModel | undefined,
      normalized: ArchiveModel | undefined,
      exists: boolean,
    ): boolean => (raw === undefined ? !exists : !!raw && raw.task === normalized?.task);
    return {
      archiveYoung,
      archiveOld,
      taskDataUnmodified:
        unchanged(rawYoung, archiveYoung, hasYoung) &&
        unchanged(rawOld, archiveOld, hasOld),
    };
  }

  /**
   * Loads archiveYoung data from SUP_OPS IndexedDB.
   */
  async loadArchiveYoung(): Promise<ArchiveModel | undefined> {
    return normalizeArchiveModel(await this._archiveStore.loadArchiveYoung());
  }

  /**
   * Saves archiveYoung data to SUP_OPS IndexedDB.
   */
  async saveArchiveYoung(data: ArchiveModel): Promise<void> {
    return this._archiveStore.saveArchiveYoung(data);
  }

  /**
   * Loads archiveOld data from SUP_OPS IndexedDB.
   */
  async loadArchiveOld(): Promise<ArchiveModel | undefined> {
    return normalizeArchiveModel(await this._archiveStore.loadArchiveOld());
  }

  /**
   * Saves archiveOld data to SUP_OPS IndexedDB.
   */
  async saveArchiveOld(data: ArchiveModel): Promise<void> {
    return this._archiveStore.saveArchiveOld(data);
  }

  /**
   * Atomically saves both archiveYoung and archiveOld in a single transaction.
   *
   * This ensures that either both writes succeed or neither does, preventing
   * data loss if a failure occurs between the two writes (e.g., during flush
   * from young to old).
   */
  async saveArchivesAtomic(
    archiveYoung: ArchiveModel,
    archiveOld: ArchiveModel,
  ): Promise<void> {
    return this._archiveStore.saveArchivesAtomic(archiveYoung, archiveOld);
  }
}
