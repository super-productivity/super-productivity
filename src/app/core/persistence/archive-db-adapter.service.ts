import { inject, Injectable } from '@angular/core';
import { ArchiveModel } from '../../features/time-tracking/time-tracking.model';
import { ArchiveStoreService } from '../../op-log/persistence/archive-store.service';

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

  /**
   * Loads archiveYoung data from SUP_OPS IndexedDB.
   */
  async loadArchiveYoung(): Promise<ArchiveModel | undefined> {
    return this._archiveStore.loadArchiveYoung();
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
    return this._archiveStore.loadArchiveOld();
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
