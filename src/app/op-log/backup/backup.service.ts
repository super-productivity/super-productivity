import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { ImexViewService } from '../../imex/imex-meta/imex-view.service';
import { StateSnapshotService } from './state-snapshot.service';
import {
  ImportBackupRef,
  OperationLogStoreService,
} from '../persistence/operation-log-store.service';
import { generateClientId } from '../../core/util/generate-client-id';
import { Operation, OpType, ActionType } from '../core/operation.types';
import { CURRENT_SCHEMA_VERSION } from '../persistence/schema-migration.service';
import { uuidv7 } from '../../util/uuid-v7';
import { loadAllData } from '../../root-store/meta/load-all-data.action';
import { isDataRepairPossible } from '../validation/is-data-repair-possible.util';
import { recordCriticalErrorTime } from '../../util/critical-error-signal';
import { OpLog } from '../../core/log';
import {
  AppDataComplete,
  CROSS_MODEL_VERSION,
  AllModelConfig,
} from '../model/model-config';
import { CompleteBackup } from '../core/types/sync.types';
import { normalizeGlobalConfigStartOfNextDay } from '../../features/config/normalize-start-of-next-day-config';
import { extractEntityKeysFromState } from '../persistence/extract-entity-keys';
import { OperationWriteFlushService } from '../sync/operation-write-flush.service';
import { LockService } from '../sync/lock.service';
import { ConflictJournalService } from '../sync/conflict-journal.service';
import { LOCK_NAMES } from '../core/operation-log.const';
import { TaskTimeSyncService } from '../../features/tasks/task-time-sync.service';

/**
 * Service for handling backup import and export operations.
 *
 * This service provides:
 * - Complete backup loading (for export)
 * - Complete backup import (for restore/import)
 *
 * All operations persist to the operation log for sync consistency.
 */
@Injectable({
  providedIn: 'root',
})
export class BackupService {
  private _imexViewService = inject(ImexViewService);
  private _store = inject(Store);
  private _stateSnapshotService = inject(StateSnapshotService);
  private _opLogStore = inject(OperationLogStoreService);
  private _operationWriteFlushService = inject(OperationWriteFlushService);
  private _lockService = inject(LockService);
  private _conflictJournalService = inject(ConflictJournalService);
  private _taskTimeSyncService = inject(TaskTimeSyncService);

  /**
   * Loads a complete backup of all application data.
   * Used for error reporting and manual backup creation.
   *
   * @param includeArchives - If true, loads archive data from IndexedDB (slower but complete)
   * @returns CompleteBackup containing all model data
   */
  async loadCompleteBackup(
    includeArchives: boolean = false,
  ): Promise<CompleteBackup<AllModelConfig>> {
    const data = includeArchives
      ? await this._stateSnapshotService.getAllSyncModelDataFromStoreAsync()
      : this._stateSnapshotService.getAllSyncModelDataFromStore();

    return {
      timestamp: Date.now(),
      lastUpdate: Date.now(),
      crossModelVersion: CROSS_MODEL_VERSION,
      data: data as AppDataComplete,
    };
  }

  /**
   * Imports a complete backup, validating and repairing if needed.
   * Persists to operation log and updates NgRx store.
   *
   * @param data - The backup data to import
   * @param isSkipLegacyWarnings - If true, skip legacy data format warnings
   * @param isSkipReload - If true, don't reload the page after import
   * @param isForceConflict - If true, reload page after import
   * @param isSkipPreImportBackup - Keep an existing recovery backup in its
   *   single slot while restoring that exact backup.
   * @param requiredImportBackupId - Abort the destructive commit unless this
   *   backup still occupies the single recovery slot.
   */
  async importCompleteBackup(
    data: AppDataComplete | CompleteBackup<AllModelConfig>,
    isSkipLegacyWarnings: boolean = false,
    isSkipReload: boolean = false,
    isForceConflict: boolean = false,
    isSkipPreImportBackup: boolean = false,
    requiredImportBackupId?: string,
  ): Promise<void> {
    if (isSkipPreImportBackup !== (requiredImportBackupId !== undefined)) {
      throw new Error(
        'BackupService: Skipping the pre-import backup requires exactly one verified recovery backup ID.',
      );
    }
    try {
      this._imexViewService.setDataImportInProgress(true);

      // 1. Normalize backup structure
      let backupData: AppDataComplete;

      if ('crossModelVersion' in data && 'timestamp' in data && 'data' in data) {
        backupData = data.data;
      } else {
        backupData = data as AppDataComplete;
      }

      // 2. Migrate legacy backups (pre-v14) that have the old data shape
      const { isLegacyBackupData, migrateLegacyBackup } =
        await import('./migrate-legacy-backup');
      if (isLegacyBackupData(backupData as unknown as Record<string, unknown>)) {
        OpLog.normal(
          'BackupService: Detected legacy backup format, running migration...',
        );
        backupData = migrateLegacyBackup(
          backupData as unknown as Record<string, unknown>,
        );
      }

      const normalizedGlobalConfig = normalizeGlobalConfigStartOfNextDay(
        backupData.globalConfig,
      );
      if (normalizedGlobalConfig) {
        backupData = {
          ...backupData,
          globalConfig: normalizedGlobalConfig,
        };
      }

      // 3. Validate data
      const { validateFull } = await import('../validation/validation-fn');
      const validationResult = validateFull(backupData);
      let validatedData = backupData;

      if (!validationResult.isValid) {
        // Damaged backup data — hold off the rating prompt.
        recordCriticalErrorTime();
        // Try to repair
        OpLog.normal('BackupService: Validation failed, attempting repair...', {
          success: validationResult.typiaResult.success,
          errors:
            'errors' in validationResult.typiaResult
              ? validationResult.typiaResult.errors.length
              : 0,
          hasArchiveYoung: !!backupData.archiveYoung,
          hasArchiveOld: !!backupData.archiveOld,
        });
        if (isDataRepairPossible(backupData)) {
          const errors =
            'errors' in validationResult.typiaResult
              ? validationResult.typiaResult.errors
              : [];
          const { dataRepair } = await import('../validation/data-repair');
          validatedData = dataRepair(backupData, errors).data;
        } else {
          throw new Error('Data validation failed and repair not possible');
        }
      }

      // 4. Persist to operation log
      await this._operationWriteFlushService.flushPendingWrites();
      await this._lockService.request(LOCK_NAMES.OPERATION_LOG, async () => {
        await this._persistImportToOperationLog(
          validatedData,
          isSkipPreImportBackup,
          requiredImportBackupId,
        );

        // 4b. The conflict journal is a device-local side store describing
        // conflicts in the op history that was JUST replaced — every import
        // path (profile switch, JSON import, local-backup restore, SuperSync
        // restore) funnels through here, and without this the badge keeps its
        // pre-restore count and the review page lists entries from the
        // replaced dataset. Cleared INSIDE the op-log lock: a concurrent
        // (cross-tab) conflict resolution serializes on this lock, so its
        // fresh post-import journal entries cannot land before the clear and
        // be wiped. clearAll swallows its own errors (must not fail the import).
        await this._conflictJournalService.clearAll();

        // The imported full state replaces the live task totals. Any batch from
        // the pre-import state must not flush later onto that new baseline.
        this._taskTimeSyncService.clear();
      });

      // 4c. Reset all sync providers' lastServerSeq to 0.
      // After a backup import, the client must re-sync from the beginning to ensure
      // that any ops on the server (which may conflict with the backup) are properly
      // filtered by the local BACKUP_IMPORT operation.
      // Without this reset, the sync would start from the old seq and skip server ops,
      // meaning the BACKUP_IMPORT filter never runs and old ops are not filtered.
      this._resetAllLastServerSeqs();

      // 5. Dispatch to NgRx
      this._store.dispatch(loadAllData({ appDataComplete: validatedData }));

      this._imexViewService.setDataImportInProgress(false);

      // Only reload if explicitly requested (legacy behavior fallback)
      if (!isSkipReload && isForceConflict) {
        window.location.reload();
      }
    } catch (e) {
      this._imexViewService.setDataImportInProgress(false);
      throw e;
    }
  }

  /**
   * Captures a snapshot of the current state into the single-slot import backup
   * store, so it can be restored after a destructive state replacement (e.g. the
   * sync "Use Server Data" path, which clears local ops and replaces NgRx state).
   *
   * Mirrors the pre-import backup taken in `_persistImportToOperationLog`. Errors
   * propagate so the caller can abort the destructive operation rather than wipe
   * local data without a recovery point. Returns the backup's opaque ID plus its
   * display timestamp so the caller can verify that the single slot has not been
   * replaced by an unrelated write before restoring it. (#8107)
   */
  async captureImportBackup(): Promise<ImportBackupRef> {
    const currentState = await this._stateSnapshotService.getStateSnapshotAsync();
    return this._opLogStore.saveImportBackup(currentState);
  }

  /**
   * Restores the import backup snapshot saved by `captureImportBackup()` (or
   * before a backup import) — if one exists. Returns false when there is nothing
   * to restore. Used by the post-replace "Undo" affordance.
   *
   * The backup state is read before `importCompleteBackup` runs. This recovery
   * path skips the normal pre-import snapshot so the original remains durable
   * until the destructive import has fully succeeded.
   *
   * @param expectedBackup - When provided, only restore if the stored backup
   *   still carries this opaque backup ID. The slot is shared with the backup-
   *   import flow, so an intervening import (or a second "Use Server Data")
   *   would overwrite it; restoring that wrong snapshot is silent data loss.
   */
  async restoreImportBackup(expectedBackup?: ImportBackupRef): Promise<boolean> {
    const backup = await this._opLogStore.loadImportBackup();
    if (!backup) {
      return false;
    }
    if (expectedBackup && backup.backupId !== expectedBackup.backupId) {
      OpLog.warn(
        'BackupService: Import backup was superseded since capture; skipping restore to avoid restoring the wrong snapshot.',
      );
      return false;
    }
    await this.importCompleteBackup(
      backup.state as AppDataComplete,
      true, // isSkipLegacyWarnings
      true, // isSkipReload - loadAllData updates state live
      true, // isForceConflict
      true, // keep this exact recovery backup until the full restore succeeds
      backup.backupId,
    );
    // Retire the restored slot only if it still has the same opaque identity.
    // The import path or another tab may have created a newer safety backup
    // while the async restore ran; that newer backup must survive. (#8107)
    await this._opLogStore.clearImportBackup(backup.backupId);
    return true;
  }

  private async _persistImportToOperationLog(
    importedData: AppDataComplete,
    isSkipPreImportBackup: boolean,
    requiredImportBackupId?: string,
  ): Promise<void> {
    OpLog.normal('BackupService: Persisting import to operation log...');

    // 1. Backup current state before clearing operations. If this fails we
    // throw — the caller unconditionally replaces NgRx + archives + sync seqs
    // after this method returns, so silently skipping the destructive write
    // would leave the device in a hybrid state (imported NgRx/archives, old
    // op-log) that is worse than either outcome.
    if (!isSkipPreImportBackup) {
      try {
        const currentState = await this._stateSnapshotService.getStateSnapshotAsync();
        OpLog.normal('BackupService: Backing up current state before import...');
        await this._opLogStore.saveImportBackup(currentState);
      } catch (e) {
        // `message` is intentionally omitted: log history is user-exportable
        // (CLAUDE.md sync rule 9), and a future validator/IDB error type could
        // interpolate user content into its message. Log the error `name` only.
        OpLog.warn('BackupService: Failed to backup state before import:', {
          name: (e as Error | undefined)?.name,
        });
        throw new Error(
          'BackupService: Pre-import backup failed; aborting import to preserve local state.',
        );
      }
    }

    // Mint a fresh clientId for the new sync baseline. It is pure here —
    // persisted only inside runDestructiveStateReplacement's atomic SUP_OPS
    // transaction, which also clears the ClientIdService cache. On a throw the
    // tx aborts and the prior id stands.
    const clientId = generateClientId();
    const newClock = { [clientId]: 1 };
    const opId = uuidv7();
    // IMPORTANT: Uses OpType.BackupImport which maps to reason='recovery' on the server.
    // This allows backup imports to succeed even when a SYNC_IMPORT already exists.
    // See server validation at sync.routes.ts:703-733
    const op: Operation = {
      id: opId,
      actionType: ActionType.LOAD_ALL_DATA,
      opType: OpType.BackupImport,
      entityType: 'ALL',
      entityId: opId,
      payload: importedData,
      clientId,
      vectorClock: newClock,
      timestamp: Date.now(),
      schemaVersion: CURRENT_SCHEMA_VERSION,
      syncImportReason: 'BACKUP_RESTORE',
    };

    // Issue #7709: replace OPS + state_cache + vector_clock + clientId
    // atomically so an interrupt during backup-restore can't leave the device
    // in the `isWhollyFreshClient + meaningful store data` state that triggers
    // the multi-device data-loss chain.
    OpLog.normal('BackupService: Replacing op-log + state cache atomically');
    await this._opLogStore.runDestructiveStateReplacement({
      syncImportOp: op,
      snapshotEntityKeys: extractEntityKeysFromState(importedData),
      archiveYoung: importedData.archiveYoung,
      archiveOld: importedData.archiveOld,
      requiredImportBackupId,
    });

    OpLog.normal('BackupService: Import persisted to operation log.');
  }

  /**
   * Resets all sync providers' lastServerSeq to 0 in localStorage.
   *
   * After a backup import, the client must re-sync from the beginning to ensure
   * that server ops are properly filtered by the local BACKUP_IMPORT operation.
   * Without this reset, the sync downloads from the old seq, skipping server ops,
   * so the BACKUP_IMPORT filter never runs.
   *
   * We clear all keys matching the SuperSync prefix to handle any active provider.
   */
  private _resetAllLastServerSeqs(): void {
    const PREFIX = 'super_sync_last_server_seq_';
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(PREFIX)) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
    if (keysToRemove.length > 0) {
      OpLog.normal(
        `BackupService: Reset ${keysToRemove.length} lastServerSeq(s) to 0 after backup import.`,
      );
    }
  }
}
