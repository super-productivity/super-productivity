import { inject, Injectable } from '@angular/core';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';
import { OperationLogStoreService } from './operation-log-store.service';
import { LanguageService } from '../../core/language/language.service';
import { OpLog } from '../../core/log';
import { LegacyPfDbService } from '../../core/persistence/legacy-pf-db.service';
import { ClientIdService } from '../../core/util/client-id.service';
import {
  DialogLegacyMigrationComponent,
  MigrationStatus,
  START_FRESH_RESULT,
} from './dialog-legacy-migration/dialog-legacy-migration.component';
import { loadAllData } from '../../root-store/meta/load-all-data.action';
import { download } from '../../util/download';
import { isDataRepairPossible } from '../validation/is-data-repair-possible.util';
import { recordCriticalErrorTime } from '../../util/critical-error-signal';
import { uuidv7 } from '../../util/uuid-v7';
import {
  ActionType,
  isGenesisEntityType,
  Operation,
  OpType,
} from '../core/operation.types';
import { SINGLETON_ENTITY_ID } from '../core/entity-registry';
import { CURRENT_SCHEMA_VERSION } from './schema-migration.service';
import { AppDataComplete, withDefaultModelSlices } from '../model/model-config';
import {
  MIGRATION_BACKUP_PREFIX,
  getBackupTimestamp,
} from '../../../../electron/shared-with-frontend/get-backup-timestamp';
import { LockService } from '../sync/lock.service';
import { LOCK_NAMES } from '../core/operation-log.const';
import { T } from '../../t.const';

/**
 * Service to check for valid operation log state during startup and migrate
 * legacy PFAPI data if found.
 *
 * Migration flow:
 * 1. Check if SUP_OPS already has valid state (state_cache or Genesis op)
 * 2. Check if legacy 'pf' database has usable data
 * 3. Show info dialog, create auto-backup, validate/repair, then migrate
 */
@Injectable({ providedIn: 'root' })
export class OperationLogMigrationService {
  private opLogStore = inject(OperationLogStoreService);
  private legacyPfDb = inject(LegacyPfDbService);
  private clientIdService = inject(ClientIdService);
  private matDialog = inject(MatDialog);
  private store = inject(Store);
  private languageService = inject(LanguageService);
  private translateService = inject(TranslateService);
  private lockService = inject(LockService);

  /**
   * Checks if the operation log is in a valid state and migrates legacy data if found.
   *
   * Returns early if:
   * - A state cache (snapshot) exists - system is properly initialized
   * - A Genesis or Recovery operation exists - migration was already done
   *
   * Clears orphan operations if found (operations without a Genesis).
   * Migrates legacy PFAPI data if found and no valid state exists.
   */
  async checkAndMigrate(): Promise<void> {
    // Check if there's a state cache (snapshot) - this indicates proper initialization
    const snapshot = await this.opLogStore.loadStateCache();
    if (snapshot) {
      return;
    }

    // Check for legacy PFAPI data FIRST - we need to know this before deciding
    // what to do with existing operations.
    // CRITICAL: hasUsableEntityData() now throws on database access errors
    // to prevent silent data loss.
    let hasLegacyData: boolean;
    try {
      hasLegacyData = await this.legacyPfDb.hasUsableEntityData();
    } catch (e) {
      // Database exists but can't be read - this is a critical error!
      // Show error dialog and don't proceed with a "fresh start" which would lose data.
      OpLog.err('OperationLogMigrationService: Failed to check legacy data:', e);

      // Ensure translations are loaded before showing error dialog
      await this._ensureTranslationsLoaded();

      const dialogRef = this._showMigrationDialog();
      dialogRef.componentInstance.error.set(
        `Failed to read your existing data. Your data may still exist but cannot be accessed. ` +
          `Please restart the app or try clearing your browser cache and reloading. ` +
          `If the problem persists, please report this issue. ` +
          `Error: ${e instanceof Error ? e.message : String(e)}`,
      );
      // Wait for user acknowledgment
      await firstValueFrom(dialogRef.afterClosed());
      throw e;
    }

    let migrationLockAcquired = false;
    let startFreshRequested = false;
    let migrationError: unknown;
    let dialogRef: MatDialogRef<DialogLegacyMigrationComponent> | undefined;
    try {
      const migrationCompleted = await this.lockService.request(
        LOCK_NAMES.OPERATION_LOG,
        async () => {
          // Re-read both replay anchors after acquiring the barrier. Capture writes
          // queued behind this lock must land after the genesis snapshot frontier.
          const lockedSnapshot = await this.opLogStore.loadStateCache();
          if (lockedSnapshot) {
            return false;
          }

          // Only the first row decides; a full-log read here would decode
          // every op on every boot (#9921).
          const firstEntry = await this.opLogStore.getFirstOpEntry();
          if (firstEntry) {
            if (isGenesisEntityType(firstEntry.op.entityType)) {
              OpLog.normal(
                'OperationLogMigrationService: Genesis operation found. Skipping migration.',
              );
              return false;
            }

            if (hasLegacyData) {
              const orphanCount = await this.opLogStore.countOps();
              OpLog.warn(
                `OperationLogMigrationService: Found ${orphanCount} orphan operations. ` +
                  `Clearing them before legacy migration.`,
              );
              await this.opLogStore.clearAllOperations();
            } else {
              OpLog.normal(
                'OperationLogMigrationService: Found existing operations (fresh install). ' +
                  'Skipping migration - hydrator will replay them.',
              );
              return false;
            }
          }
          if (!hasLegacyData) {
            OpLog.normal(
              'OperationLogMigrationService: No legacy data found. Starting fresh.',
            );
            return false;
          }

          migrationLockAcquired = await this.legacyPfDb.acquireMigrationLock();
          if (!migrationLockAcquired) {
            OpLog.warn(
              'OperationLogMigrationService: Migration lock held by another instance, skipping.',
            );
            return false;
          }

          await this._ensureTranslationsLoaded();
          dialogRef = this._showMigrationDialog();
          await this._createAutoBackup(dialogRef);
          await this._performMigration(dialogRef);
          return true;
        },
      );

      if (migrationCompleted && dialogRef) {
        this._setStatus(dialogRef, 'complete');
        OpLog.normal('OperationLogMigrationService: Migration complete');

        // Brief delay to show completion status. Keep this cosmetic wait outside
        // the operation-log barrier so queued capture writes can proceed.
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch (error) {
      OpLog.err('OperationLogMigrationService: Migration failed:', error);
      migrationError = error;
      if (dialogRef) {
        dialogRef.componentInstance.error.set(
          this.translateService.instant(T.MIGRATE.E_MIGRATION_FAILED_MSG),
        );
        // Always offered here: starting fresh keeps the legacy database, so
        // there is no copy to lose and nothing to gate on (#9770). Not offered
        // on the "cannot be read" path above, where the marker write would fail
        // for the same reason the read did.
        dialogRef.componentInstance.canStartFresh.set(true);
        // Wait for user acknowledgment before throwing
        const dialogResult = await firstValueFrom(dialogRef.afterClosed());
        if (dialogResult === START_FRESH_RESULT) {
          startFreshRequested = true;
        }
      }
      if (!startFreshRequested) {
        throw error;
      }
      // Otherwise the marker is written after the finally block, so the
      // migration lock is released and the dialog is closed first.
    } finally {
      if (migrationLockAcquired) {
        await this.legacyPfDb.releaseMigrationLock();
      }
      dialogRef?.close();
    }

    if (startFreshRequested) {
      await this._skipLegacyData(migrationError);
    }
  }

  /**
   * Records the user's choice to start without the legacy data, then returns so
   * this same boot continues into the ordinary empty-store path.
   *
   * Nothing is deleted: the `pf` database stays exactly as it is, and the marker
   * only stops migration and recovery from picking it up again. That is what
   * makes this safe to offer unconditionally — there is no "is the backup really
   * on disk?" precondition to get wrong, and a mis-click costs the user nothing.
   *
   * No reload either: `hasUsableEntityData()` already reports false from here
   * on, so simply returning lets the hydrator boot the empty store now.
   */
  private async _skipLegacyData(originalError: unknown): Promise<void> {
    if (await this.legacyPfDb.markMigrationSkipped()) {
      OpLog.normal(
        'OperationLogMigrationService: Legacy data skipped on user request. ' +
          'The pf database is untouched and can still be imported from the backup.',
      );
      return;
    }

    // The marker did not stick, so the next boot would land right back on this
    // dialog. Escalate exactly as an acknowledged failure does — no data was
    // touched, so this is no worse than not offering the option at all.
    OpLog.err('OperationLogMigrationService: Could not record the skip marker.');
    throw originalError;
  }

  /**
   * Ensures translations are loaded before showing the migration dialog.
   * Detects the browser language and preloads the corresponding translation file.
   * This prevents the dialog from showing untranslated keys (e.g., "MIGRATE.DIALOG_TITLE").
   */
  private async _ensureTranslationsLoaded(): Promise<void> {
    try {
      // Detect appropriate language (browser language or default)
      const lng = this.languageService.detect();

      // Load translations synchronously before proceeding
      await firstValueFrom(this.translateService.use(lng));

      OpLog.normal(`OperationLogMigrationService: Translations loaded (${lng})`);
    } catch (error) {
      OpLog.warn('OperationLogMigrationService: Failed to load translations:', error);
      // Continue anyway - dialog will show translation keys as fallback
    }
  }

  private _showMigrationDialog(): MatDialogRef<DialogLegacyMigrationComponent> {
    return this.matDialog.open(DialogLegacyMigrationComponent, {
      disableClose: true, // Prevent closing via escape or backdrop click
      width: '400px',
    });
  }

  /**
   * Downloads the pre-migration backup, best-effort.
   *
   * Deliberately does not try to prove the file landed: `download()` resolves
   * on cancellation too, and the plain browser/Electron path (an anchor click)
   * reports nothing either way. Nothing depends on the answer — the legacy
   * database survives a failed migration now — so the failure message says
   * where to look rather than claiming the copy exists.
   */
  private async _createAutoBackup(
    dialogRef: MatDialogRef<DialogLegacyMigrationComponent>,
  ): Promise<void> {
    this._setStatus(dialogRef, 'backup');

    const legacyData = await this.legacyPfDb.loadAllEntityData();
    const filename = `${MIGRATION_BACKUP_PREFIX}_${getBackupTimestamp()}.json`;

    await download(filename, JSON.stringify(legacyData));
    OpLog.normal(`OperationLogMigrationService: Backup downloaded: ${filename}`);
  }

  private async _performMigration(
    dialogRef: MatDialogRef<DialogLegacyMigrationComponent>,
  ): Promise<void> {
    this._setStatus(dialogRef, 'migrating');

    // 1. Load data from legacy database, adding defaults for the model slices
    // that database is too old to contain (#9770).
    const rawLegacyData = await this.legacyPfDb.loadAllEntityData();

    // Guard the RAW data, and guard it BEFORE the fill rather than only when
    // validation fails: withDefaultModelSlices() makes even an empty database
    // validate, so a check on the failure branch would simply never run for a
    // legacy database that has lost its task/project state — and that database
    // would migrate silently to an all-defaults empty store whose genesis
    // snapshot then shadows it forever.
    if (!isDataRepairPossible(rawLegacyData as unknown as AppDataComplete)) {
      throw new Error('Legacy data is corrupted and cannot be repaired');
    }

    const legacyData = withDefaultModelSlices(rawLegacyData);

    // 2. Validate and repair if needed
    const { validateFull } = await import('../validation/validation-fn');
    const validationResult = validateFull(legacyData);
    let dataToMigrate: AppDataComplete = legacyData;

    if (!validationResult.isValid) {
      // Damaged legacy data on migration — hold off the rating prompt.
      recordCriticalErrorTime();
      OpLog.warn(
        'OperationLogMigrationService: Legacy data validation failed, attempting repair',
      );

      const errors =
        'errors' in validationResult.typiaResult
          ? validationResult.typiaResult.errors
          : [];
      const { dataRepair } = await import('../validation/data-repair');
      dataToMigrate = dataRepair(legacyData, errors).data;

      // Re-validate after repair to ensure success
      const postRepairValidation = validateFull(dataToMigrate);
      if (!postRepairValidation.isValid) {
        throw new Error('Data repair failed - data still invalid after repair attempt');
      }

      OpLog.normal('OperationLogMigrationService: Data repair successful');
    }

    // 3. Get client ID (inherit from legacy or resolve via ClientIdService).
    // The genesis op's clientId MUST come from the legacy PFAPI `CLIENT_ID`
    // key, because meta.vectorClock below is keyed by that same identity.
    // getOrGenerateClientId() is the fallback only when `CLIENT_ID` is absent:
    // it resolves whatever id this device already has (e.g. pf `__client_id_`)
    // and generates a fresh one only when no id exists anywhere.
    const meta = await this.legacyPfDb.loadMetaModel();
    const legacyClientId = await this.legacyPfDb.loadClientId();
    const clientId =
      legacyClientId ?? (await this.clientIdService.getOrGenerateClientId());

    // Persist the legacy client ID into SUP_OPS so loadClientId() finds it.
    // Without this, a brand new ID is generated on next write, doubling IDs.
    if (legacyClientId) {
      await this.clientIdService.persistClientId(legacyClientId);
    }

    // Log only a short suffix — the literal clientId keys the vector clock and
    // log history is user-exportable (CLAUDE.md sync rule 9).
    OpLog.normal('OperationLogMigrationService: Resolved client ID', {
      clientIdSuffix: clientId.slice(-3),
    });

    // 4. Create MIGRATION genesis operation
    const migrationOp: Operation = {
      id: uuidv7(),
      actionType: ActionType.MIGRATION_GENESIS_IMPORT,
      opType: OpType.Batch,
      entityType: 'MIGRATION',
      entityId: SINGLETON_ENTITY_ID,
      payload: dataToMigrate,
      clientId,
      vectorClock: meta.vectorClock || { [clientId]: 1 },
      timestamp: Date.now(),
      schemaVersion: CURRENT_SCHEMA_VERSION,
    };

    // 5. Persist the genesis operation, its exact snapshot frontier, and the
    // working clock in one transaction. There is no post-append interval where
    // a later tab write can be skipped by the snapshot frontier or have its
    // clock advancement overwritten by a follow-up migration write.
    await this.opLogStore.appendOperationAndSnapshot(migrationOp, 'local', {
      state: dataToMigrate,
      vectorClock: migrationOp.vectorClock,
      compactedAt: Date.now(),
      schemaVersion: CURRENT_SCHEMA_VERSION,
    });

    // 6. Dispatch to NgRx store
    this.store.dispatch(loadAllData({ appDataComplete: dataToMigrate }));
  }

  private _setStatus(
    dialogRef: MatDialogRef<DialogLegacyMigrationComponent>,
    status: MigrationStatus,
  ): void {
    dialogRef.componentInstance.status.set(status);
  }
}
