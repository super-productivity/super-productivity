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
import { incrementVectorClock } from '../../core/util/vector-clock';
import { LockService } from '../sync/lock.service';
import { T } from '../../t.const';
import { OpLog } from '../../core/log';
import { VectorClockService } from '../sync/vector-clock.service';
import { CURRENT_SCHEMA_VERSION } from '../persistence/schema-migration.service';
import { devError } from '../../util/dev-error';
import { TranslateService } from '@ngx-translate/core';
import { LOCK_NAMES } from '../core/operation-log.const';
import { alertDialog } from '../../util/native-dialogs';
import { RepairSyncContextService } from './repair-sync-context.service';
import { StateSnapshotService } from '../backup/state-snapshot.service';
import { SnackService } from '../../core/snack/snack.service';

export interface RebaseStaleRepairOptions {
  staleRepairOpId: string;
  repairSummary: RepairSummary;
  clientId: string;
  repairBaseServerSeq: number;
}

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
  private repairSyncContext = inject(RepairSyncContextService);
  private stateSnapshotService = inject(StateSnapshotService);
  private snackService = inject(SnackService);

  // Once-per-session guard for the non-interactive "data repaired" snack, so a
  // repeat-repair loop can't spam it (mirrors the version-block snack latch).
  private _hasShownRepairSnackThisSession = false;

  /**
   * Creates a REPAIR operation with the repaired state and saves it to the operation log.
   * Also updates the state cache to the repaired state for faster future hydration.
   *
   * @param repairedState - The fully repaired application state
   * @param repairSummary - Summary of what was repaired (counts by category)
   * @param clientId - The client ID for the operation (passed by caller to avoid circular dependency)
   * @param options.skipLock - If true, skip acquiring sp_op_log lock. Use when caller already holds the lock.
   * @param options.interactive - If true, show the blocking "data repaired" acknowledge
   *        dialog. Defaults to false (fail-safe): automatic/in-lock repair must never block
   *        on a native dialog, which would hold sp_op_log open during background sync (#9026).
   * @returns The sequence number of the created operation
   */
  async createRepairOperation(
    repairedState: unknown,
    repairSummary: RepairSummary,
    clientId: string,
    options?: { skipLock?: boolean; interactive?: boolean },
  ): Promise<number> {
    if (!clientId) {
      throw new Error('clientId is required - cannot create repair operation');
    }

    let seq: number = 0;

    const doCreateOperation = async (): Promise<void> => {
      const op = await this._buildRepairOperation(
        repairedState,
        repairSummary,
        clientId,
        this.repairSyncContext.baseServerSeq,
      );

      // 1. Append via the mixed-source batch: its in-transaction rebase derives
      // the final clock from the durable clock, so a stale in-memory clock
      // cache (e.g. another tab advanced the clock since our last read) can
      // never regress the durable clock or reuse counters (#8939).
      const { written } = await this.opLogStore.appendMixedSourceBatchSkipDuplicates([
        { ops: [op], source: 'local' },
      ]);
      const writtenOp = written[0];
      if (!writtenOp) {
        throw new Error('REPAIR operation was not appended');
      }
      seq = writtenOp.seq;

      // 2. Save state cache with repaired state for fast hydration.
      // Use the rebased clock that was actually written, not the proposed one.
      await this.opLogStore.saveStateCache({
        state: repairedState,
        lastAppliedOpSeq: seq,
        vectorClock: writtenOp.op.vectorClock,
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

    // Notify user that repair happened (non-blocking unless interactive — #9026).
    this._notifyUser(repairSummary, options?.interactive ?? false);

    return seq;
  }

  /**
   * Rebuilds a stale automatic repair after its missing server suffix was applied.
   * The old rejection marker and the new repair are persisted atomically so a
   * crash cannot strand the repaired state without an uploadable boundary.
   */
  async rebaseStaleRepair(options: RebaseStaleRepairOptions): Promise<number> {
    const { staleRepairOpId, repairSummary, clientId, repairBaseServerSeq } = options;
    if (!clientId) {
      throw new Error('clientId is required - cannot rebase repair operation');
    }

    return this.lockService.request(LOCK_NAMES.OPERATION_LOG, async () => {
      const repairedState = await this.stateSnapshotService.getStateSnapshotAsync();
      const replacementOp = await this._buildRepairOperation(
        repairedState,
        repairSummary,
        clientId,
        repairBaseServerSeq,
      );
      const seq = await this.opLogStore.replaceRejectedRepair({
        staleRepairOpId,
        replacementOp,
        repairedState,
      });
      OpLog.log('[RepairOperationService] Rebased stale REPAIR operation', {
        seq,
        staleRepairOpId,
        repairBaseServerSeq,
      });
      return seq;
    });
  }

  private async _buildRepairOperation(
    repairedState: unknown,
    repairSummary: RepairSummary,
    clientId: string,
    repairBaseServerSeq?: number,
  ): Promise<Operation> {
    const payload: RepairPayload = {
      appDataComplete: repairedState,
      repairSummary,
      ...(repairBaseServerSeq !== undefined ? { repairBaseServerSeq } : {}),
    };
    // Proposed clock only — both write paths rebase it onto the durable clock
    // in-transaction (#8939). No client-side pruning: like capture ops, REPAIR
    // ops ship the full clock; the server prunes AFTER conflict detection, and
    // pruning here would drop client IDs the server still tracks, causing
    // false CONCURRENT comparisons.
    const currentClock = await this.vectorClockService.getCurrentVectorClock();
    const newClock = incrementVectorClock(currentClock, clientId);

    return {
      id: uuidv7(),
      actionType: ActionType.REPAIR_AUTO,
      opType: OpType.Repair,
      entityType: 'ALL',
      payload,
      clientId,
      vectorClock: newClock,
      timestamp: Date.now(),
      schemaVersion: CURRENT_SCHEMA_VERSION,
      syncImportReason: 'REPAIR',
      ...(repairBaseServerSeq !== undefined ? { repairBaseServerSeq } : {}),
    };
  }

  /**
   * Records that a repair happened and, for interactive (foreground) callers,
   * shows a blocking native alert() acknowledgement.
   *
   * The `interactive` gate is load-bearing for #9026: automatic/in-lock repair
   * (background sync) must never reach a blocking dialog — neither this alert()
   * nor `devError`, which itself pops a blocking alert/confirm in dev builds —
   * or it would hold the sp_op_log lock open for as long as the dialog sits
   * there. The summary is six numeric counts (no user content), safe to log.
   */
  private _notifyUser(summary: RepairSummary, interactive: boolean): void {
    const totalFixes = this._getTotalFixes(summary);
    const logMsg = `Data repair executed: ${totalFixes} issues fixed. Summary: ${JSON.stringify(summary)}`;

    if (!interactive) {
      // Automatic/in-lock repair (background sync): never a native dialog — that
      // would hold sp_op_log open (#9026). Record it, and surface a single
      // non-blocking snack per session so a silent data change (auto-repair can
      // drop entities/refs and propagate cross-device) isn't wholly invisible.
      // Only when something actually changed.
      OpLog.err(logMsg);
      if (totalFixes > 0 && !this._hasShownRepairSnackThisSession) {
        this._hasShownRepairSnackThisSession = true;
        this.snackService.open({
          type: 'WARNING',
          msg: T.F.SYNC.D_DATA_REPAIRED.MSG,
          translateParams: { count: totalFixes },
        });
      }
      return;
    }

    // Foreground: loud dev diagnostic + user acknowledgement.
    devError(logMsg);
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
