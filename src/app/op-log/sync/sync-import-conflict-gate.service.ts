import { inject, Injectable } from '@angular/core';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import {
  FULL_STATE_OP_TYPES,
  Operation,
  OperationLogEntry,
  OpType,
} from '../core/operation.types';
import { OperationWriteFlushService } from './operation-write-flush.service';
import { SyncImportConflictData } from './dialog-sync-import-conflict/dialog-sync-import-conflict.component';

const USER_ENTITY_TYPES = new Set(['TASK', 'PROJECT', 'TAG', 'NOTE']);

export interface IncomingFullStateConflictGateResult {
  fullStateOp?: Operation;
  pendingOps: OperationLogEntry[];
  hasMeaningfulPending: boolean;
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
    options: { flushPendingWrites?: boolean } = {},
  ): Promise<IncomingFullStateConflictGateResult> {
    const fullStateOp = incomingOps.find((op) => FULL_STATE_OP_TYPES.has(op.opType));

    if (!fullStateOp) {
      return {
        pendingOps: [],
        hasMeaningfulPending: false,
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

    const result = {
      fullStateOp,
      pendingOps,
      hasMeaningfulPending,
    };

    if (!hasMeaningfulPending) {
      return result;
    }

    return {
      ...result,
      dialogData: {
        filteredOpCount: pendingOps.length,
        localImportTimestamp: fullStateOp.timestamp ?? Date.now(),
        syncImportReason: fullStateOp.syncImportReason,
        scenario: 'INCOMING_IMPORT',
      },
    };
  }
}
