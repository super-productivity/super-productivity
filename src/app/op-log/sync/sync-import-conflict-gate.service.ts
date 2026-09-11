import { inject, Injectable } from '@angular/core';
import { takeInterpretableOpPrefix } from './remote-op-block.util';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import {
  ActionType,
  FULL_STATE_OP_TYPES,
  Operation,
  OperationLogEntry,
  OpType,
} from '../core/operation.types';
import { OperationWriteFlushService } from './operation-write-flush.service';
import { SyncImportConflictData } from './dialog-sync-import-conflict/dialog-sync-import-conflict.component';
import { isExampleTaskCreateOp } from '../validation/is-example-task-op.util';
import { OpLog } from '../../core/log';

/**
 * Enabling/configuring sync on a never-synced client necessarily writes the
 * sync config section before the first download. That setup-only operation is
 * not local user data divergence. Other GLOBAL_CONFIG sections remain protected.
 */
const isInitialSyncSetupOp = (entry: OperationLogEntry): boolean =>
  entry.op.actionType === ActionType.GLOBAL_CONFIG_UPDATE_SECTION &&
  entry.op.opType === OpType.Update &&
  entry.op.entityType === 'GLOBAL_CONFIG' &&
  entry.op.entityId === 'sync';

interface PendingOpClassificationOptions {
  hasCompletedInitialSync: boolean;
}

export interface IncomingFullStateConflictGateResult {
  fullStateOp?: Operation;
  pendingOps: OperationLogEntry[];
  hasMeaningfulPending: boolean;
  discardablePendingOpIds: string[];
  dialogData?: SyncImportConflictData;
  /**
   * Incoming causal REPAIR to skip this cycle rather than prompt for (#9773).
   * Set only when this device holds meaningful pending work.
   */
  deferredRepairOpId?: string;
}

/**
 * A causal REPAIR proves its snapshot covered the whole server prefix; a legacy
 * one carries no base cursor and proves nothing, so it keeps import handling.
 */
const isCausalRepair = (op: Operation): boolean =>
  op.opType === OpType.Repair && op.repairBaseServerSeq !== undefined;

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
   * Every pending op is user work unless it is an onboarding example-task create,
   * or the sync-section setup write on a client that has never completed sync.
   * Full-state ops are always meaningful because applying a newer full-state op
   * can invalidate their local import/repair semantics.
   *
   * The lifecycle default is deliberately conservative: a caller that does not
   * know whether initial sync completed must protect startup-entity changes.
   */
  hasMeaningfulPendingOps(
    ops: OperationLogEntry[],
    options: PendingOpClassificationOptions = {
      hasCompletedInitialSync: true,
    },
  ): boolean {
    return ops.some((entry) => {
      if (FULL_STATE_OP_TYPES.has(entry.op.opType as OpType)) {
        return true;
      }
      if (isExampleTaskCreateOp(entry)) {
        return false;
      }
      if (isInitialSyncSetupOp(entry)) {
        return options.hasCompletedInitialSync;
      }
      return true;
    });
  }

  getDiscardablePendingOpIds(
    ops: OperationLogEntry[],
    options: PendingOpClassificationOptions,
  ): string[] {
    return ops
      .filter(
        (entry) =>
          isExampleTaskCreateOp(entry) ||
          (!options.hasCompletedInitialSync && isInitialSyncSetupOp(entry)),
      )
      .map((entry) => entry.op.id);
  }

  /**
   * @param options.preCapturedPendingOps - Exact pending ops selected by the upload
   *        round, unioned with a live read. NOTE: accepted ops of the current round
   *        are still in the live set when this gate runs (acknowledgement is
   *        deferred until piggyback processing commits), so the union is NOT what
   *        protects them. Its own coverage is the narrower set of ops removed from
   *        the live set mid-upload: a local SYNC_IMPORT deleted on
   *        SYNC_IMPORT_EXISTS, full-state ops perma-rejected by the server, and a
   *        concurrent tab marking ops synced between lock release and this read.
   */
  async checkIncomingFullStateConflict(
    incomingOps: Operation[],
    options: {
      flushPendingWrites?: boolean;
      isNeverSynced?: boolean;
      preCapturedPendingOps?: OperationLogEntry[];
    } = {},
  ): Promise<IncomingFullStateConflictGateResult> {
    // Only the prefix this client can process may prompt: processRemoteOps
    // blocks at the first op with unknown vocabulary (#8764), so a full-state
    // op after it — or one whose own syncImportReason is unknown — must not
    // open a conflict dialog the user cannot evaluate and this client will
    // refuse anyway.
    const fullStateOp = takeInterpretableOpPrefix(incomingOps).find((op) =>
      FULL_STATE_OP_TYPES.has(op.opType),
    );

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

    const livePendingOps = await this.opLogStore.getUnsynced();
    const pendingOps = options.preCapturedPendingOps
      ? this._mergePendingOps(options.preCapturedPendingOps, livePendingOps)
      : livePendingOps;

    // Preserve the cheap example-task-only path. If nothing could be meaningful
    // even for a synced client, there is no reason to read sync history.
    const canContainMeaningfulPending = this.hasMeaningfulPendingOps(pendingOps);
    if (!canContainMeaningfulPending) {
      return {
        fullStateOp,
        pendingOps,
        hasMeaningfulPending: false,
        discardablePendingOpIds: this.getDiscardablePendingOpIds(livePendingOps, {
          hasCompletedInitialSync: true,
        }),
      };
    }

    const isNeverSynced =
      options.isNeverSynced ?? !(await this.opLogStore.hasSyncedOps());
    const classificationOptions = {
      hasCompletedInitialSync: !isNeverSynced,
    };
    const hasMeaningfulPending = this.hasMeaningfulPendingOps(
      pendingOps,
      classificationOptions,
    );
    // Only live pending ops may be rejected. A pre-captured upload snapshot can
    // include ops already acknowledged by the server, which must not be rewritten
    // as rejected locally.
    const discardablePendingOpIds = this.getDiscardablePendingOpIds(
      livePendingOps,
      classificationOptions,
    );

    const result = {
      fullStateOp,
      pendingOps,
      hasMeaningfulPending,
      discardablePendingOpIds,
    };

    if (!hasMeaningfulPending) {
      return result;
    }

    // An automatic repair must not put the user in front of the import dialog:
    // every answer it offers is wrong here. Force-upload would replace remote
    // state with this device's (destroying the repair and every other device's
    // concurrent work), force-download would discard this device's pending work,
    // and cancel just re-prompts next cycle. Defer the repair instead — this
    // device keeps its work, and its own post-sync repair pass fixes the same
    // shared corruption locally. (#9773)
    if (isCausalRepair(fullStateOp)) {
      OpLog.normal(
        `SyncImportConflictGateService: Deferring incoming causal REPAIR ` +
          `${fullStateOp.id} from client ${fullStateOp.clientId}; ` +
          `${pendingOps.length} pending local op(s) stay put.`,
      );
      return { ...result, deferredRepairOpId: fullStateOp.id };
    }

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

  private _mergePendingOps(
    uploadSnapshot: OperationLogEntry[],
    livePendingOps: OperationLogEntry[],
  ): OperationLogEntry[] {
    const merged = [...uploadSnapshot];
    const seenOpIds = new Set(uploadSnapshot.map((entry) => entry.op.id));

    for (const entry of livePendingOps) {
      if (!seenOpIds.has(entry.op.id)) {
        merged.push(entry);
        seenOpIds.add(entry.op.id);
      }
    }

    return merged;
  }
}
