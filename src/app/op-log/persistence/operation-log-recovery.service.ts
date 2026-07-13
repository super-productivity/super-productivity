import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { OperationLogStoreService } from './operation-log-store.service';
import { CURRENT_SCHEMA_VERSION } from './schema-migration.service';
import { LegacyPfDbService } from '../../core/persistence/legacy-pf-db.service';
import { ClientIdService } from '../../core/util/client-id.service';
import { loadAllData } from '../../root-store/meta/load-all-data.action';
import {
  Operation,
  OperationLogEntry,
  OpType,
  ActionType,
} from '../core/operation.types';
import { SINGLETON_ENTITY_ID } from '../core/entity-registry';
import { uuidv7 } from '../../util/uuid-v7';
import { OpLog } from '../../core/log';
import { AppDataComplete } from '../model/model-config';
import { ValidateStateService } from '../validation/validate-state.service';
import { LockService } from '../sync/lock.service';
import { LOCK_NAMES } from '../core/operation-log.const';

/**
 * Handles crash recovery and data restoration for the operation log system.
 *
 * Responsibilities:
 * - Recovering from corrupted/missing SUP_OPS database
 * - Loading data from legacy 'pf' database
 * - Recovering pending remote ops from crashed syncs
 *
 * This service is used by OperationLogHydratorService during startup
 * when normal hydration fails or pending ops need recovery.
 */
@Injectable({ providedIn: 'root' })
export class OperationLogRecoveryService {
  private store = inject(Store);
  private opLogStore = inject(OperationLogStoreService);
  private legacyPfDb = inject(LegacyPfDbService);
  private clientIdService = inject(ClientIdService);
  private validateStateService = inject(ValidateStateService);
  private lockService = inject(LockService);

  /**
   * Attempts to recover from a corrupted or missing SUP_OPS database.
   * Recovery strategy:
   * 1. Prove SUP_OPS has neither a snapshot nor operations
   * 2. Try to load data from legacy 'pf' database (IndexedDB)
   * 3. If found, run genesis migration with that data
   * 4. If no legacy data, log error (user will need to sync or restore from backup)
   *
   * Inspection and recovery errors intentionally propagate. Treating an
   * unreadable SUP_OPS database as empty could overwrite newer data with a stale
   * legacy copy and then advance the snapshot past the healthy operation log.
   */
  async attemptRecovery(): Promise<void> {
    OpLog.normal('OperationLogRecoveryService: Attempting disaster recovery...');
    await this.lockService.request(LOCK_NAMES.OPERATION_LOG, () =>
      this._attemptRecoveryWhileLocked(),
    );
  }

  private async _attemptRecoveryWhileLocked(): Promise<void> {
    const [stateCache, lastSeq] = await Promise.all([
      this.opLogStore.loadStateCache(),
      this.opLogStore.getLastSeq(),
    ]);

    if (stateCache !== null && stateCache !== undefined) {
      throw new Error('Refusing legacy recovery because a SUP_OPS snapshot still exists');
    }
    if (lastSeq > 0) {
      throw new Error(
        'Refusing legacy recovery because the SUP_OPS operation log is not empty',
      );
    }

    const hasLegacyData = await this.legacyPfDb.hasUsableEntityData();

    if (hasLegacyData) {
      OpLog.normal(
        'OperationLogRecoveryService: Found data in legacy database. Recovering...',
      );
      const legacyData = await this.legacyPfDb.loadAllEntityData();
      await this.recoverFromLegacyData(legacyData as unknown as Record<string, unknown>);
      return;
    }

    // No legacy data found. App will start with NgRx initial state (empty).
    // User can sync or import a backup to restore their data.
    OpLog.warn(
      'OperationLogRecoveryService: No legacy data found. ' +
        'If you have sync enabled, please trigger a sync to restore your data. ' +
        'Otherwise, you may need to restore from a backup.',
    );
  }

  /**
   * Recovers from legacy data by creating a new genesis snapshot.
   */
  async recoverFromLegacyData(legacyData: Record<string, unknown>): Promise<void> {
    // Refuse to import legacy data that doesn't validate. Importing corrupted
    // legacy data would just propagate the corruption into SUP_OPS and the next
    // hydration would fail validation in turn.
    const validationResult = await this.validateStateService.validateState(legacyData);
    if (!validationResult.isValid) {
      OpLog.err('OperationLogRecoveryService: Refusing to import invalid legacy data', {
        typiaErrorCount: validationResult.typiaErrors.length,
        crossModelError: validationResult.crossModelError,
      });
      throw new Error(
        `Legacy recovery data validation failed (${validationResult.typiaErrors.length} typia errors` +
          `${validationResult.crossModelError ? `, cross-model: ${validationResult.crossModelError}` : ''})`,
      );
    }

    const clientId = await this.clientIdService.loadClientId();
    if (!clientId) {
      throw new Error('Failed to load clientId - cannot create recovery operation');
    }

    // Create recovery operation
    const recoveryOp: Operation = {
      id: uuidv7(),
      actionType: ActionType.RECOVERY_DATA_IMPORT,
      opType: OpType.Batch,
      entityType: 'RECOVERY',
      entityId: SINGLETON_ENTITY_ID,
      payload: legacyData,
      clientId: clientId,
      vectorClock: { [clientId]: 1 },
      timestamp: Date.now(),
      schemaVersion: CURRENT_SCHEMA_VERSION,
    };

    await this.opLogStore.appendRecoveryOperationAndSnapshot(recoveryOp, legacyData);

    // Dispatch to NgRx
    this.store.dispatch(loadAllData({ appDataComplete: legacyData as AppDataComplete }));

    OpLog.normal(
      'OperationLogRecoveryService: Recovery complete. Data restored from legacy database.',
    );
  }

  /**
   * Recovers from pending remote ops that were stored but not applied (crash recovery).
   * The crash point is unknowable, so this method only returns the quarantine.
   * Hydration replays the rows, persists their reducer outcome, and only then
   * retries archive work; sync stays blocked until that recovery succeeds.
   */
  async recoverPendingRemoteOps(): Promise<OperationLogEntry[]> {
    const recoveredLegacyFailures =
      await this.opLogStore.recoverLegacyTerminalRemoteFailures();
    if (recoveredLegacyFailures > 0) {
      OpLog.warn(
        `OperationLogRecoveryService: Re-quarantined ${recoveredLegacyFailures} legacy terminal remote failure(s).`,
      );
    }
    const pendingOps = await this.opLogStore.getPendingRemoteOps();

    if (pendingOps.length === 0) {
      return [];
    }

    // Do not checkpoint these rows yet. A crash can occur before reducer
    // dispatch, during a partially successful bulk dispatch, or immediately
    // after it. Hydration must replay the reducers and durably partition their
    // successes/failures before any archive-only retry can start.
    OpLog.warn(
      `OperationLogRecoveryService: Found ${pendingOps.length} pending remote ops from previous crash. ` +
        'Reducers will be replayed before archive recovery.',
    );
    return pendingOps;
  }

  /**
   * Cleans up corrupt operations that have missing or invalid entityId.
   * These operations cause infinite rejection loops during sync because:
   * 1. They get rejected with CONFLICT_CONCURRENT
   * 2. The rejection handler tries to resolve by creating merged ops
   * 3. The new ops also have invalid entityId and get rejected again
   *
   * By marking these ops as rejected upfront, we break the infinite loop.
   */
  async cleanupCorruptOps(): Promise<void> {
    const unsyncedOps = await this.opLogStore.getUnsynced();

    if (unsyncedOps.length === 0) {
      return;
    }

    // Find ops with missing or invalid entityId (excluding bulk 'ALL' operations)
    const corruptOps = unsyncedOps.filter((entry) => {
      const op = entry.op;
      // Bulk operations with entityType 'ALL' don't need entityId
      if (op.entityType === 'ALL') {
        return false;
      }
      // Check for missing or invalid entityId
      return !op.entityId || typeof op.entityId !== 'string';
    });

    if (corruptOps.length === 0) {
      return;
    }

    const corruptIds = corruptOps.map((e) => e.op.id);
    await this.opLogStore.markRejected(corruptIds);

    OpLog.warn(
      `OperationLogRecoveryService: Rejected ${corruptOps.length} corrupt ops with invalid entityId. ` +
        `Entity types: ${[...new Set(corruptOps.map((e) => e.op.entityType))].join(', ')}`,
    );
  }
}
