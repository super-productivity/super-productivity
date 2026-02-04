import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { ImexViewService } from '../../imex/imex-meta/imex-view.service';
import { StateSnapshotService } from './state-snapshot.service';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { VectorClockService } from '../sync/vector-clock.service';
import { ClientIdService } from '../../core/util/client-id.service';
import { Operation, OpType, ActionType } from '../core/operation.types';
import { CURRENT_SCHEMA_VERSION } from '../persistence/schema-migration.service';
import { incrementVectorClock } from '../../core/util/vector-clock';
import { uuidv7 } from '../../util/uuid-v7';
import { loadAllData } from '../../root-store/meta/load-all-data.action';
import { validateFull } from '../validation/validation-fn';
import { dataRepair } from '../validation/data-repair';
import { isDataRepairPossible } from '../validation/is-data-repair-possible.util';
import { OpLog } from '../../core/log';
import {
  AppDataComplete,
  CROSS_MODEL_VERSION,
  AllModelConfig,
} from '../model/model-config';
import { CompleteBackup } from '../core/types/sync.types';
import { ArchiveDbAdapter } from '../../core/persistence/archive-db-adapter.service';
import { ArchiveModel } from '../../features/archive/archive.model';
import { isLegacyBackupData, migrateLegacyBackup } from './migrate-legacy-backup';

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
  private _vectorClockService = inject(VectorClockService);
  private _clientIdService = inject(ClientIdService);
  private _archiveDbAdapter = inject(ArchiveDbAdapter);

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
   * @param isForceConflict - If true, generate new client ID and reset vector clock
   */
  async importCompleteBackup(
    data: AppDataComplete | CompleteBackup<AllModelConfig>,
    isSkipLegacyWarnings: boolean = false,
    isSkipReload: boolean = false,
    isForceConflict: boolean = false,
  ): Promise<void> {
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
      if (isLegacyBackupData(backupData as unknown as Record<string, unknown>)) {
        OpLog.normal(
          'BackupService: Detected legacy backup format, running migration...',
        );
        backupData = migrateLegacyBackup(
          backupData as unknown as Record<string, unknown>,
        );
      }

      // 3. Validate data
      const validationResult = validateFull(backupData);
      let validatedData = backupData;

      if (!validationResult.isValid) {
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
          validatedData = dataRepair(backupData, errors);
        } else {
          throw new Error('Data validation failed and repair not possible');
        }
      }

      // 4. Persist to operation log
      await this._persistImportToOperationLog(validatedData, isForceConflict);

      // 5. Dispatch to NgRx
      this._store.dispatch(loadAllData({ appDataComplete: validatedData }));

      // 6. Write archive data to IndexedDB
      // ArchiveOperationHandler._handleLoadAllData() skips local imports (isRemote=false),
      // so we must write archive data here for local backup imports.
      await this._writeArchivesToIndexedDB(validatedData);

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

  private async _persistImportToOperationLog(
    importedData: AppDataComplete,
    isForceConflict: boolean,
  ): Promise<void> {
    OpLog.normal('BackupService: Persisting import to operation log...');

    // 1. Backup current state before clearing operations
    let backupSucceeded = true;
    try {
      const existingStateCache = await this._opLogStore.loadStateCache();
      if (existingStateCache?.state) {
        OpLog.normal('BackupService: Backing up current state before import...');
        await this._opLogStore.saveImportBackup(existingStateCache.state);
      }
    } catch (e) {
      OpLog.warn('BackupService: Failed to backup state before import:', e);
      backupSucceeded = false;
    }

    // 2. Clear all old operations to prevent IndexedDB bloat
    if (backupSucceeded) {
      OpLog.normal('BackupService: Clearing old operations before import...');
      await this._opLogStore.clearAllOperations();
    }

    let clientId: string;
    if (isForceConflict) {
      clientId = await this._clientIdService.generateNewClientId();
    } else {
      const loadedClientId = await this._clientIdService.loadClientId();
      clientId = loadedClientId ?? (await this._clientIdService.generateNewClientId());
    }

    const currentClock = await this._vectorClockService.getCurrentVectorClock();
    const newClock = isForceConflict
      ? { [clientId]: 2 }
      : incrementVectorClock(currentClock, clientId);

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
    };

    await this._opLogStore.append(op, 'local');
    const lastSeq = await this._opLogStore.getLastSeq();

    await this._opLogStore.saveStateCache({
      state: importedData,
      lastAppliedOpSeq: lastSeq,
      vectorClock: newClock,
      compactedAt: Date.now(),
      schemaVersion: CURRENT_SCHEMA_VERSION,
    });

    OpLog.normal('BackupService: Import persisted to operation log.');
  }

  /**
   * Writes archive data from the imported backup to IndexedDB.
   *
   * This is necessary because ArchiveOperationHandler._handleLoadAllData() only
   * processes remote operations (isRemote=true). For local backup imports, the
   * archive data would otherwise never be persisted to IndexedDB.
   */
  private async _writeArchivesToIndexedDB(data: AppDataComplete): Promise<void> {
    const archiveYoung = (data as { archiveYoung?: ArchiveModel }).archiveYoung;
    const archiveOld = (data as { archiveOld?: ArchiveModel }).archiveOld;

    // Check for both undefined AND null since backup might have null values
    if (archiveYoung != null) {
      await this._archiveDbAdapter.saveArchiveYoung(archiveYoung);
    }

    if (archiveOld != null) {
      await this._archiveDbAdapter.saveArchiveOld(archiveOld);
    }
  }
}
