import { inject, Injectable } from '@angular/core';
import { uuidv7 } from '../../util/uuid-v7';
import { StateSnapshotService } from '../backup/state-snapshot.service';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { generateClientId } from '../../core/util/generate-client-id';
import { OpLog } from '../../core/log';
import { Operation, OpType, SyncImportReason } from '../core/operation.types';
import { ActionType } from '../core/action-types.enum';
import { CURRENT_SCHEMA_VERSION } from '../persistence/schema-migration.service';
import { extractEntityKeysFromState } from '../persistence/extract-entity-keys';
import { OperationWriteFlushService } from '../sync/operation-write-flush.service';
import { LockService } from '../sync/lock.service';
import { LOCK_NAMES } from '../core/operation-log.const';
import { TaskTimeSyncService } from '../../features/tasks/task-time-sync.service';

/**
 * Reason a clean-slate was triggered. Logged for diagnostic correlation
 * (so a future sync-stuck incident can be tied to the cause without
 * forensic recovery).
 */
export type CleanSlateReason = 'ENCRYPTION_CHANGE' | 'MANUAL';

/**
 * Service for performing "clean slate" operations on the sync state.
 *
 * Atomically replaces the local op-log + state_cache + vector_clock + clientId
 * with a fresh baseline derived from current state. Used by encryption-password
 * changes (which need a fresh sync baseline) and by user-initiated sync
 * recovery.
 *
 * Atomicity is guaranteed by
 * `OperationLogStoreService.runDestructiveStateReplacement`. The clientId now
 * lives in `SUP_OPS` too, so it rotates atomically with the op-log inside that
 * single transaction — no cross-database rollback is needed (issues #7709,
 * #7732).
 *
 * @example
 * ```typescript
 * await cleanSlateService.createCleanSlate('ENCRYPTION_CHANGE', 'PASSWORD_CHANGED');
 * await syncService.triggerSync();
 * ```
 */
@Injectable({
  providedIn: 'root',
})
export class CleanSlateService {
  private stateSnapshotService = inject(StateSnapshotService);
  private opLogStore = inject(OperationLogStoreService);
  private operationWriteFlushService = inject(OperationWriteFlushService);
  private lockService = inject(LockService);
  private taskTimeSyncService = inject(TaskTimeSyncService);

  /**
   * Creates a clean slate by resetting local operation log and preparing
   * a fresh SYNC_IMPORT operation for upload.
   *
   * The destructive sequence (rotate clientId, clear OPS, append SYNC_IMPORT,
   * write vector clock, write state_cache) runs as a single atomic
   * transaction. On failure it aborts wholesale and the prior id stands.
   *
   * Does NOT upload to the server — that happens on the next sync, with the
   * `isCleanSlate=true` flag, which makes the server delete its operations
   * and accept the new baseline. Other clients then re-sync from the new
   * baseline.
   *
   * @throws If state snapshot cannot be retrieved or operations cannot be stored.
   */
  async createCleanSlate(
    reason: CleanSlateReason,
    syncImportReason: SyncImportReason,
  ): Promise<void> {
    // Move the current timer batch into the op log before fixing the new
    // baseline. Deltas that arrive after this flush remain projected out and
    // are persisted as tail operations after the replacement.
    this.taskTimeSyncService.flush();
    await this.operationWriteFlushService.flushPendingWrites();

    const { syncImportId } = await this.lockService.request(
      LOCK_NAMES.OPERATION_LOG,
      async () => {
        // Diagnostic snapshot of state about to be wiped. Captured before any
        // mutation. Lets a future sync-stuck incident be correlated to the local
        // op-log shape that preceded the destructive recovery (count of unsynced
        // user work, prior vector-clock entries) without forensic recovery.
        const priorClock = await this.opLogStore.getVectorClock();
        const priorUnsynced = await this.opLogStore.getUnsynced();
        const priorOpTypeBreakdown = priorUnsynced.reduce<Record<string, number>>(
          (acc, entry) => {
            const key = entry.op.opType;
            acc[key] = (acc[key] ?? 0) + 1;
            return acc;
          },
          {},
        );
        OpLog.normal('[CleanSlate] Starting clean slate process', {
          reason,
          syncImportReason,
          priorUnsyncedCount: priorUnsynced.length,
          priorUnsyncedByOpType: priorOpTypeBreakdown,
          priorClockSize: priorClock ? Object.keys(priorClock).length : 0,
        });

        // 1. Get current application state (includes all features + archives).
        // IMPORTANT: must use the async version to load real archives from
        // IndexedDB. The sync getStateSnapshot() returns DEFAULT_ARCHIVE (empty)
        // which causes data loss.
        const currentState =
          await this.stateSnapshotService.getStateSnapshotForOperationLogAsync();

        // Mint a fresh clientId for the new sync baseline. It is pure here —
        // persisted only inside runDestructiveStateReplacement's atomic
        // SUP_OPS transaction, which also clears the ClientIdService cache.
        // On a throw the tx aborts and the prior id stands.
        const newClientId = generateClientId();
        OpLog.normal('[CleanSlate] Generated new client ID', {
          newClientIdSuffix: newClientId.slice(-3),
        });

        const newVectorClock = { [newClientId]: 1 };
        const syncImportOp: Operation = {
          id: uuidv7(),
          actionType: ActionType.LOAD_ALL_DATA,
          opType: OpType.SyncImport,
          entityType: 'ALL',
          entityId: undefined,
          payload: currentState,
          clientId: newClientId,
          vectorClock: newVectorClock,
          timestamp: Date.now(),
          schemaVersion: CURRENT_SCHEMA_VERSION,
          syncImportReason,
        };

        OpLog.normal('[CleanSlate] Created SYNC_IMPORT operation', {
          opId: syncImportOp.id,
        });

        OpLog.normal('[CleanSlate] Replacing op-log + state cache atomically');
        await this.opLogStore.runDestructiveStateReplacement({
          syncImportOp,
          snapshotEntityKeys: extractEntityKeysFromState(currentState),
        });

        return { syncImportId: syncImportOp.id };
      },
    );

    OpLog.normal('[CleanSlate] Clean slate completed successfully', {
      syncImportId,
      reason,
    });
  }
}
