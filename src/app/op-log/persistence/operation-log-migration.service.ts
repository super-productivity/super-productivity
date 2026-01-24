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
} from './dialog-legacy-migration/dialog-legacy-migration.component';
import { loadAllData } from '../../root-store/meta/load-all-data.action';
import { download } from '../../util/download';
import { validateFull } from '../validation/validation-fn';
import { isDataRepairPossible } from '../validation/is-data-repair-possible.util';
import { dataRepair } from '../validation/data-repair';
import { uuidv7 } from '../../util/uuid-v7';
import { ActionType, Operation, OpType } from '../core/operation.types';
import { CURRENT_SCHEMA_VERSION } from './schema-migration.service';
import { AppDataComplete } from '../model/model-config';

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
    // what to do with existing operations
    const hasLegacyData = await this.legacyPfDb.hasUsableEntityData();

    // No snapshot exists. Check if there are any operations in the log.
    const allOps = await this.opLogStore.getOpsAfterSeq(0);

    if (allOps.length > 0) {
      // Operations exist but no snapshot. Check if the first op is a Genesis/Migration op.
      const firstOp = allOps[0].op;
      if (firstOp.entityType === 'MIGRATION' || firstOp.entityType === 'RECOVERY') {
        // Valid Genesis exists - migration already happened but snapshot might have been lost
        OpLog.normal(
          'OperationLogMigrationService: Genesis operation found. Skipping migration.',
        );
        return;
      }

      // Operations exist without Genesis. Behavior depends on whether legacy data exists:
      if (hasLegacyData) {
        // Case 1: Legacy data exists - these are orphan ops captured during app init
        // before hydration. Clear them so migration can proceed cleanly.
        OpLog.warn(
          `OperationLogMigrationService: Found ${allOps.length} orphan operations. ` +
            `Clearing them before legacy migration.`,
        );
        await this.opLogStore.deleteOpsWhere(() => true);
      } else {
        // Case 2: No legacy data - these are legitimate user operations from a fresh
        // install. Let the hydrator replay them. No migration needed.
        OpLog.normal(
          `OperationLogMigrationService: Found ${allOps.length} operations (fresh install). ` +
            `Skipping migration - hydrator will replay them.`,
        );
        return;
      }
    }
    if (!hasLegacyData) {
      OpLog.normal('OperationLogMigrationService: No legacy data found. Starting fresh.');
      return;
    }

    // Acquire migration lock (prevent concurrent tab migrations)
    const lockAcquired = await this.legacyPfDb.acquireMigrationLock();
    if (!lockAcquired) {
      OpLog.warn(
        'OperationLogMigrationService: Migration lock held by another instance, skipping.',
      );
      return;
    }

    // Ensure translations are loaded before showing dialog
    await this._ensureTranslationsLoaded();

    // Show migration dialog and perform migration
    const dialogRef = this._showMigrationDialog();
    try {
      await this._createAutoBackup(dialogRef);
      await this._performMigration(dialogRef);
    } catch (error) {
      OpLog.err('OperationLogMigrationService: Migration failed:', error);
      dialogRef.componentInstance.error.set(
        'Migration failed. Your backup has been downloaded. Please restart or import the backup file.',
      );
      // Wait for user acknowledgment before throwing
      await firstValueFrom(dialogRef.afterClosed());
      throw error;
    } finally {
      await this.legacyPfDb.releaseMigrationLock();
      dialogRef.close();
    }
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

  private async _createAutoBackup(
    dialogRef: MatDialogRef<DialogLegacyMigrationComponent>,
  ): Promise<void> {
    this._setStatus(dialogRef, 'backup');

    const legacyData = await this.legacyPfDb.loadAllEntityData();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `sp-pre-migration-backup-${timestamp}.json`;

    await download(filename, JSON.stringify(legacyData));
    OpLog.normal(`OperationLogMigrationService: Backup created: ${filename}`);
  }

  private async _performMigration(
    dialogRef: MatDialogRef<DialogLegacyMigrationComponent>,
  ): Promise<void> {
    this._setStatus(dialogRef, 'migrating');

    // 1. Load data from legacy database
    const legacyData = await this.legacyPfDb.loadAllEntityData();

    // 2. Validate and repair if needed
    // Cast to any since LegacyAppData types don't match exactly with validation functions
    const validationResult = validateFull(legacyData as any);
    let dataToMigrate: AppDataComplete = legacyData as any;

    if (!validationResult.isValid) {
      OpLog.warn(
        'OperationLogMigrationService: Legacy data validation failed, attempting repair',
      );

      if (!isDataRepairPossible(legacyData as any)) {
        throw new Error('Legacy data is corrupted and cannot be repaired');
      }

      const errors =
        'errors' in validationResult.typiaResult
          ? validationResult.typiaResult.errors
          : [];
      dataToMigrate = dataRepair(legacyData as any, errors);

      // Re-validate after repair to ensure success
      const postRepairValidation = validateFull(dataToMigrate);
      if (!postRepairValidation.isValid) {
        throw new Error('Data repair failed - data still invalid after repair attempt');
      }

      OpLog.normal('OperationLogMigrationService: Data repair successful');
    }

    // 3. Get client ID (inherit from legacy or generate new)
    const meta = await this.legacyPfDb.loadMetaModel();
    const legacyClientId = await this.legacyPfDb.loadClientId();
    const clientId = legacyClientId || (await this.clientIdService.generateNewClientId());

    OpLog.normal(`OperationLogMigrationService: Using client ID: ${clientId}`);

    // 4. Create MIGRATION genesis operation
    const migrationOp: Operation = {
      id: uuidv7(),
      actionType: ActionType.MIGRATION_GENESIS_IMPORT,
      opType: OpType.Batch,
      entityType: 'MIGRATION',
      entityId: '*',
      payload: dataToMigrate,
      clientId,
      vectorClock: meta.vectorClock || { [clientId]: 1 },
      timestamp: Date.now(),
      schemaVersion: CURRENT_SCHEMA_VERSION,
    };

    // 5. Persist to operation log
    await this.opLogStore.append(migrationOp);
    const lastSeq = await this.opLogStore.getLastSeq();

    await this.opLogStore.saveStateCache({
      state: dataToMigrate,
      lastAppliedOpSeq: lastSeq,
      vectorClock: migrationOp.vectorClock,
      compactedAt: Date.now(),
      schemaVersion: CURRENT_SCHEMA_VERSION,
    });

    await this.opLogStore.setVectorClock(migrationOp.vectorClock);

    // 6. Dispatch to NgRx store
    this.store.dispatch(loadAllData({ appDataComplete: dataToMigrate }));

    this._setStatus(dialogRef, 'complete');
    OpLog.normal('OperationLogMigrationService: Migration complete');

    // Brief delay to show completion status
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  private _setStatus(
    dialogRef: MatDialogRef<DialogLegacyMigrationComponent>,
    status: MigrationStatus,
  ): void {
    dialogRef.componentInstance.status.set(status);
  }
}
