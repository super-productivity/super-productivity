import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { OperationLogStoreService } from './operation-log-store.service';
import { CURRENT_SCHEMA_VERSION } from './schema-migration.service';
import { LegacyPfDbService } from '../../core/persistence/legacy-pf-db.service';
import { ClientIdService } from '../../core/util/client-id.service';
import { loadAllData } from '../../root-store/meta/load-all-data.action';
import { Operation, OpType, ActionType } from '../core/operation.types';
import { uuidv7 } from '../../util/uuid-v7';
import { PENDING_OPERATION_EXPIRY_MS } from '../core/operation-log.const';
import { OpLog } from '../../core/log';
import { AppDataComplete } from '../model/model-config';

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

  /**
   * Attempts to recover from a corrupted or missing SUP_OPS database.
   * Recovery strategy:
   * 1. Try to load data from legacy 'pf' database (IndexedDB)
   * 2. If found, run genesis migration with that data
   * 3. If no legacy data, log error (user will need to sync or restore from backup)
   */
  async attemptRecovery(): Promise<void> {
    OpLog.normal('OperationLogRecoveryService: Attempting disaster recovery...');

    try {
      // 1. Try to load from legacy 'pf' database
      const hasLegacyData = await this.legacyPfDb.hasUsableEntityData();

      if (hasLegacyData) {
        OpLog.normal(
          'OperationLogRecoveryService: Found data in legacy database. Recovering...',
        );
        const legacyData = await this.legacyPfDb.loadAllEntityData();
        await this.recoverFromLegacyData(
          legacyData as unknown as Record<string, unknown>,
        );
        return;
      }

      // 2. No legacy data found
      // App will start with NgRx initial state (empty).
      // User can sync or import a backup to restore their data.
      OpLog.warn(
        'OperationLogRecoveryService: No legacy data found. ' +
          'If you have sync enabled, please trigger a sync to restore your data. ' +
          'Otherwise, you may need to restore from a backup.',
      );
    } catch (e) {
      OpLog.err('OperationLogRecoveryService: Recovery failed', e);
      // App will start with NgRx initial state (empty).
      // User can sync or restore from backup.
    }
  }

  /**
   * Recovers from legacy data by creating a new genesis snapshot.
   */
  async recoverFromLegacyData(legacyData: Record<string, unknown>): Promise<void> {
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
      entityId: '*',
      payload: legacyData,
      clientId: clientId,
      vectorClock: { [clientId]: 1 },
      timestamp: Date.now(),
      schemaVersion: CURRENT_SCHEMA_VERSION,
    };

    // Write recovery operation
    await this.opLogStore.append(recoveryOp);

    // Create state cache
    const lastSeq = await this.opLogStore.getLastSeq();
    await this.opLogStore.saveStateCache({
      state: legacyData,
      lastAppliedOpSeq: lastSeq,
      vectorClock: recoveryOp.vectorClock,
      compactedAt: Date.now(),
    });

    // Persist vector clock to IndexedDB store for immediate availability
    // Without this, getVectorClock() returns stale clock until cache is populated
    await this.opLogStore.setVectorClock(recoveryOp.vectorClock);

    // Dispatch to NgRx
    this.store.dispatch(loadAllData({ appDataComplete: legacyData as AppDataComplete }));

    OpLog.normal(
      'OperationLogRecoveryService: Recovery complete. Data restored from legacy database.',
    );
  }

  /**
   * Recovers from pending remote ops that were stored but not applied (crash recovery).
   * These ops are in the log and will be replayed during normal hydration, so we just
   * need to mark them as applied to prevent them appearing as orphaned.
   *
   * Operations pending for longer than PENDING_OPERATION_EXPIRY_MS are considered
   * stale (likely due to data corruption or repeated failures) and are rejected
   * instead of replayed.
   */
  async recoverPendingRemoteOps(): Promise<void> {
    const pendingOps = await this.opLogStore.getPendingRemoteOps();

    if (pendingOps.length === 0) {
      return;
    }

    const now = Date.now();
    const validOps = pendingOps.filter(
      (e) => now - e.appliedAt < PENDING_OPERATION_EXPIRY_MS,
    );
    const expiredOps = pendingOps.filter(
      (e) => now - e.appliedAt >= PENDING_OPERATION_EXPIRY_MS,
    );

    // Reject expired ops - they've been pending too long
    if (expiredOps.length > 0) {
      const expiredIds = expiredOps.map((e) => e.op.id);
      await this.opLogStore.markRejected(expiredIds);
      OpLog.warn(
        `OperationLogRecoveryService: Rejected ${expiredOps.length} expired pending remote ops ` +
          `(pending > ${PENDING_OPERATION_EXPIRY_MS / (60 * 60 * 1000)}h). ` +
          `Oldest was ${Math.round((now - Math.min(...expiredOps.map((e) => e.appliedAt))) / (60 * 60 * 1000))}h old.`,
      );
    }

    // Mark valid ops as applied - they'll be replayed during normal hydration
    if (validOps.length > 0) {
      const seqs = validOps.map((e) => e.seq);
      await this.opLogStore.markApplied(seqs);
      OpLog.warn(
        `OperationLogRecoveryService: Found ${validOps.length} pending remote ops from previous crash. ` +
          `Marking as applied (they will be replayed during hydration).`,
      );
    }

    OpLog.normal(
      `OperationLogRecoveryService: Recovered ${validOps.length} pending remote ops, ` +
        `rejected ${expiredOps.length} expired ops.`,
    );
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
