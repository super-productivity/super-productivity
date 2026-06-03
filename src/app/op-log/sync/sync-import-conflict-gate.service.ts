import { inject, Injectable } from '@angular/core';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import {
  ActionType,
  extractActionPayload,
  FULL_STATE_OP_TYPES,
  Operation,
  OperationLogEntry,
  OpType,
} from '../core/operation.types';
import { OperationWriteFlushService } from './operation-write-flush.service';
import { SyncImportConflictData } from './dialog-sync-import-conflict/dialog-sync-import-conflict.component';

const USER_ENTITY_TYPES = new Set(['TASK', 'PROJECT', 'TAG', 'NOTE']);

/**
 * Startup example/onboarding tasks are generated locally on first run (see
 * ExampleTasksService) and must not count as "meaningful local work" that would block
 * an incoming SYNC_IMPORT. This only ever runs against local pending ops from
 * getUnsynced() — never against incoming remote ops — so a remote-supplied
 * `isExampleTask` flag cannot be used to bypass the conflict dialog.
 */
const isExampleTaskCreateOp = (entry: OperationLogEntry): boolean => {
  const { op } = entry;
  if (
    op.actionType !== ActionType.TASK_SHARED_ADD ||
    op.opType !== OpType.Create ||
    op.entityType !== 'TASK'
  ) {
    return false;
  }

  const actionPayload = extractActionPayload(op.payload);
  return actionPayload['isExampleTask'] === true;
};

export interface IncomingFullStateConflictGateResult {
  fullStateOp?: Operation;
  pendingOps: OperationLogEntry[];
  hasMeaningfulPending: boolean;
  discardablePendingOpIds: string[];
  dialogData?: SyncImportConflictData;
}

/**
 * Decides whether an incoming full-state operation would discard meaningful local work.
 *
 * This service intentionally stops at detection: it reads pending local ops and builds
 * dialog data, but leaves dialog display and resolution side effects to
 * OperationLogSyncService. That keeps the same decision usable from both download
 * and piggyback-upload paths without coupling the gate to sync-provider actions.
 */
@Injectable({
  providedIn: 'root',
})
export class SyncImportConflictGateService {
  private opLogStore = inject(OperationLogStoreService);
  private writeFlushService = inject(OperationWriteFlushService);

  /**
   * Config-only pending ops are not considered user work for this conflict gate.
   * Full-state ops are always meaningful because applying a newer full-state op can
   * invalidate their local import/repair semantics.
   */
  hasMeaningfulPendingOps(ops: OperationLogEntry[]): boolean {
    return ops.some((entry) => {
      if (FULL_STATE_OP_TYPES.has(entry.op.opType as OpType)) {
        return true;
      }
      if (isExampleTaskCreateOp(entry)) {
        return false;
      }
      return (
        USER_ENTITY_TYPES.has(entry.op.entityType) &&
        (entry.op.opType === OpType.Create ||
          entry.op.opType === OpType.Update ||
          entry.op.opType === OpType.Delete)
      );
    });
  }

  async checkIncomingFullStateConflict(
    incomingOps: Operation[],
    options: { flushPendingWrites?: boolean; isNeverSynced?: boolean } = {},
  ): Promise<IncomingFullStateConflictGateResult> {
    const fullStateOp = incomingOps.find((op) => FULL_STATE_OP_TYPES.has(op.opType));

    if (!fullStateOp) {
      return {
        pendingOps: [],
        hasMeaningfulPending: false,
        discardablePendingOpIds: [],
      };
    }

    if (options.flushPendingWrites) {
      // Download can race with captured operations that are not persisted yet.
      // Piggyback upload already flushed before uploading, so callers opt in only
      // when they need this second pre-check flush.
      await this.writeFlushService.flushPendingWrites();
    }

    const pendingOps = await this.opLogStore.getUnsynced();
    const hasMeaningfulPending = this.hasMeaningfulPendingOps(pendingOps);
    // Example-task ops that the caller may reject when it accepts the import silently.
    // When `hasMeaningfulPending` is true (real work pending alongside example tasks),
    // the conflict dialog is shown instead and these are intentionally left untouched:
    // if the user keeps local state, their example tasks ride along with the rest.
    const discardablePendingOpIds = pendingOps
      .filter(isExampleTaskCreateOp)
      .map((entry) => entry.op.id);

    const result = {
      fullStateOp,
      pendingOps,
      hasMeaningfulPending,
      discardablePendingOpIds,
    };

    if (!hasMeaningfulPending) {
      return result;
    }

    // A client that has never completed a sync cannot have diverged from remote — its
    // "meaningful" pending ops are pre-first-sync startup state (e.g. example tasks).
    // Flag this so the dialog guards the destructive USE_LOCAL choice with an extra
    // confirmation (it would overwrite the populated remote with throwaway data).
    //
    // Callers SHOULD pass `isNeverSynced` captured at sync-cycle start (pre-download).
    // A live `hasSyncedOps()` here is unreliable on the piggyback-upload path: by the
    // time that gate runs, this same sync has already persisted downloaded ops
    // (syncedAt set) and marked accepted uploads synced, so reading it now would see
    // post-sync state and wrongly clear the guard. Fall back to a live read only for
    // standalone callers (e.g. the download path, where nothing is persisted yet).
    const isNeverSynced =
      options.isNeverSynced ?? !(await this.opLogStore.hasSyncedOps());

    return {
      ...result,
      dialogData: {
        filteredOpCount: pendingOps.length,
        localImportTimestamp: fullStateOp.timestamp ?? Date.now(),
        syncImportReason: fullStateOp.syncImportReason,
        scenario: 'INCOMING_IMPORT',
        isNeverSynced,
      },
    };
  }
}
