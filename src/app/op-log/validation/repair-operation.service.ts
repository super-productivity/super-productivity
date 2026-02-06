import { Injectable, inject } from '@angular/core';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import {
  Operation,
  OpType,
  RepairPayload,
  RepairSummary,
  ActionType,
} from '../core/operation.types';
import { uuidv7 } from '../../util/uuid-v7';
import {
  incrementVectorClock,
  selectProtectedClientIds,
} from '../../core/util/vector-clock';
import { LockService } from '../sync/lock.service';
import { T } from '../../t.const';
import { OpLog } from '../../core/log';
import { VectorClockService } from '../sync/vector-clock.service';
import { CURRENT_SCHEMA_VERSION } from '../persistence/schema-migration.service';
import { devError } from '../../util/dev-error';
import { TranslateService } from '@ngx-translate/core';
import { LOCK_NAMES } from '../core/operation-log.const';
import { alertDialog } from '../../util/native-dialogs';

/**
 * Service responsible for creating REPAIR operations.
 * When validation fails and data is repaired, this service creates a REPAIR operation
 * containing the full repaired state and a summary of what was fixed.
 * REPAIR operations behave like SyncImport - they replace the entire state atomically.
 */
@Injectable({
  providedIn: 'root',
})
export class RepairOperationService {
  private opLogStore = inject(OperationLogStoreService);
  private lockService = inject(LockService);
  private translateService = inject(TranslateService);
  private vectorClockService = inject(VectorClockService);

  /**
   * Creates a REPAIR operation with the repaired state and saves it to the operation log.
   * Also updates the state cache to the repaired state for faster future hydration.
   *
   * @param repairedState - The fully repaired application state
   * @param repairSummary - Summary of what was repaired (counts by category)
   * @param clientId - The client ID for the operation (passed by caller to avoid circular dependency)
   * @param options.skipLock - If true, skip acquiring sp_op_log lock. Use when caller already holds the lock.
   * @returns The sequence number of the created operation
   */
  async createRepairOperation(
    repairedState: unknown,
    repairSummary: RepairSummary,
    clientId: string,
    options?: { skipLock?: boolean },
  ): Promise<number> {
    if (!clientId) {
      throw new Error('clientId is required - cannot create repair operation');
    }

    const payload: RepairPayload = {
      appDataComplete: repairedState,
      repairSummary,
    };

    let seq: number = 0;

    const doCreateOperation = async (): Promise<void> => {
      const currentClock = await this.vectorClockService.getCurrentVectorClock();
      const newClock = incrementVectorClock(currentClock, clientId);

      const op: Operation = {
        id: uuidv7(),
        actionType: ActionType.REPAIR_AUTO,
        opType: OpType.Repair,
        entityType: 'ALL',
        payload,
        clientId,
        vectorClock: newClock,
        timestamp: Date.now(),
        schemaVersion: CURRENT_SCHEMA_VERSION,
      };

      // 1. Append REPAIR operation to log and update vector clock atomically
      seq = await this.opLogStore.appendWithVectorClockUpdate(op, 'local');

      // 2. Protect all vector clock keys from pruning
      const protectedIds = selectProtectedClientIds(newClock);
      await this.opLogStore.setProtectedClientIds(protectedIds);

      // 3. Save state cache with repaired state for fast hydration
      // Note: vector clock is already updated in step 1, so we omit it here
      await this.opLogStore.saveStateCache({
        state: repairedState,
        lastAppliedOpSeq: seq,
        vectorClock: newClock,
        compactedAt: Date.now(),
        schemaVersion: CURRENT_SCHEMA_VERSION,
      });

      OpLog.log('[RepairOperationService] Created REPAIR operation', {
        seq,
        repairSummary,
      });
    };

    // Skip lock if caller already holds it (e.g., during sync validation)
    if (options?.skipLock) {
      await doCreateOperation();
    } else {
      await this.lockService.request(LOCK_NAMES.OPERATION_LOG, doCreateOperation);
    }

    // Notify user that repair happened
    this._notifyUser(repairSummary);

    return seq;
  }

  /**
   * Shows a blocking alert and logs devError when repair happens.
   * Uses native alert() to prevent reload until user acknowledges.
   * Always shows alert since user already confirmed the repair.
   */
  private _notifyUser(summary: RepairSummary): void {
    const totalFixes = this._getTotalFixes(summary);

    // Always log
    const errorMsg = `Data repair executed: ${totalFixes} issues fixed. Summary: ${JSON.stringify(summary)}`;
    devError(errorMsg);

    // Always show alert after repair completes (user already confirmed)
    const title = this.translateService.instant(T.F.SYNC.D_DATA_REPAIRED.TITLE);
    const msg = this.translateService.instant(T.F.SYNC.D_DATA_REPAIRED.MSG, {
      count: totalFixes.toString(),
    });
    alertDialog(`${title}\n\n${msg}`);
  }

  /**
   * Calculates the total number of fixes from a repair summary.
   */
  private _getTotalFixes(summary: RepairSummary): number {
    return (
      summary.entityStateFixed +
      summary.orphanedEntitiesRestored +
      summary.invalidReferencesRemoved +
      summary.relationshipsFixed +
      summary.structureRepaired +
      summary.typeErrorsFixed
    );
  }

  /**
   * Creates an empty repair summary (all counts at zero).
   */
  static createEmptyRepairSummary(): RepairSummary {
    return {
      entityStateFixed: 0,
      orphanedEntitiesRestored: 0,
      invalidReferencesRemoved: 0,
      relationshipsFixed: 0,
      structureRepaired: 0,
      typeErrorsFixed: 0,
    };
  }
}
