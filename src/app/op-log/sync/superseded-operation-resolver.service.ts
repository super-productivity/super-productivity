import { inject, Injectable } from '@angular/core';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { ActionType, Operation, OpType, VectorClock } from '../core/operation.types';
import { mergeVectorClocks, limitVectorClockSize } from '../../core/util/vector-clock';
import { OpLog } from '../../core/log';
import { ConflictResolutionService } from './conflict-resolution.service';
import { VectorClockService } from './vector-clock.service';
import { LockService } from './lock.service';
import { toEntityKey } from '../util/entity-key.util';
import { LOCK_NAMES } from '../core/operation-log.const';
import { SnackService } from '../../core/snack/snack.service';
import { T } from '../../t.const';
import { CLIENT_ID_PROVIDER } from '../util/client-id.provider';
import { uuidv7 } from '../../util/uuid-v7';
import { CURRENT_SCHEMA_VERSION } from '../persistence/schema-migration.service';

/**
 * Resolves superseded local operations that were rejected due to concurrent modification.
 *
 * ## When Superseded Operations Occur
 * During sync, the server may reject local operations if their vector clocks
 * are dominated by operations from other clients. This means our local changes
 * are based on outdated state.
 *
 * ## Resolution Strategy
 * Instead of losing local changes, we:
 * 1. Mark the old pending ops as rejected (their clocks are superseded)
 * 2. Create NEW ops with the current entity state and merged vector clocks
 * 3. The new ops will be uploaded on next sync cycle
 *
 * This preserves local changes while ensuring vector clocks properly dominate
 * all known operations.
 */
@Injectable({
  providedIn: 'root',
})
export class SupersededOperationResolverService {
  private opLogStore = inject(OperationLogStoreService);
  private vectorClockService = inject(VectorClockService);
  private conflictResolutionService = inject(ConflictResolutionService);
  private lockService = inject(LockService);
  private snackService = inject(SnackService);
  private clientIdProvider = inject(CLIENT_ID_PROVIDER);

  /**
   * Re-creates an operation with a merged vector clock, preserving its original payload.
   * Used for operations whose entities are no longer in the NgRx store (DELETE, moveToArchive).
   */
  private _recreateOpWithMergedClock(
    sourceOp: Operation,
    vectorClock: VectorClock,
    clientId: string,
    timestamp: number,
  ): Operation {
    return {
      id: uuidv7(),
      actionType: sourceOp.actionType,
      opType: sourceOp.opType,
      entityType: sourceOp.entityType,
      entityId: sourceOp.entityId,
      entityIds: sourceOp.entityIds,
      payload: sourceOp.payload,
      clientId,
      vectorClock,
      timestamp,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    };
  }

  /**
   * Resolves superseded local operations by creating new LWW Update operations.
   *
   * @param supersededOps - Operations that were rejected due to concurrent modification
   * @param extraClocks - Additional clocks to merge (from force download)
   * @param snapshotVectorClock - Aggregated clock from snapshot optimization (if available)
   * @returns Number of merged ops created
   */
  async resolveSupersededLocalOps(
    supersededOps: Array<{ opId: string; op: Operation }>,
    extraClocks?: VectorClock[],
    snapshotVectorClock?: VectorClock,
  ): Promise<number> {
    // Acquire lock to prevent race conditions with operation capture and other sync operations.
    // Without this lock, user actions during conflict resolution could write ops with
    // superseded vector clocks, leading to data corruption.
    let result = 0;
    await this.lockService.request(LOCK_NAMES.OPERATION_LOG, async () => {
      const clientId = await this.clientIdProvider.loadClientId();
      if (!clientId) {
        OpLog.err(
          'SupersededOperationResolverService: Cannot resolve superseded ops - no client ID',
        );
        return;
      }

      // Get the GLOBAL vector clock which includes snapshot + all ops after
      // This ensures we have all known clocks, not just entity-specific ones
      let globalClock = await this.vectorClockService.getCurrentVectorClock();

      // Merge snapshot vector clock if available (from server's snapshot optimization)
      // This ensures we have the clocks from ops that were skipped during download
      if (snapshotVectorClock && Object.keys(snapshotVectorClock).length > 0) {
        OpLog.normal(
          `SupersededOperationResolverService: Merging snapshotVectorClock with ${Object.keys(snapshotVectorClock).length} entries`,
        );
        globalClock = mergeVectorClocks(globalClock, snapshotVectorClock);
      }

      // If extra clocks were provided (from force download), merge them all
      // This helps recover from situations where our local clock is missing entries
      if (extraClocks && extraClocks.length > 0) {
        OpLog.normal(
          `SupersededOperationResolverService: Merging ${extraClocks.length} clocks from force download`,
        );
        for (const clock of extraClocks) {
          globalClock = mergeVectorClocks(globalClock, clock);
        }
      }

      // Load protected client IDs (e.g., from latest SYNC_IMPORT) to preserve during pruning
      const protectedClientIds = await this.opLogStore.getProtectedClientIds();

      const opsToReject: string[] = [];
      const newOpsCreated: Operation[] = [];

      // Handle bulk semantic operations BEFORE entity-by-entity grouping.
      // moveToArchive uses OpType.Update but its reducer removes entities from the NgRx store
      // (via deleteTaskHelper). This is the ONLY action with this pattern — all other entity
      // removals use OpType.Delete (handled below). The normal resolution path would call
      // getCurrentEntityState() → undefined → discard, permanently losing the archive.
      // Instead, re-create the operation with a merged clock preserving the original payload.
      // NOTE: If a future action type also removes entities with OpType.Update, add it here.
      const regularSupersededOps: Array<{ opId: string; op: Operation }> = [];
      for (const item of supersededOps) {
        if (item.op.actionType === ActionType.TASK_SHARED_MOVE_TO_ARCHIVE) {
          // Re-create the archive operation with a merged vector clock.
          // The original payload is preserved exactly (MultiEntityPayload format with
          // actionPayload.tasks containing full task data for remote archive writes).
          const mergedClock = this.conflictResolutionService.mergeAndIncrementClocks(
            [globalClock, item.op.vectorClock],
            clientId,
          );
          const newClock = limitVectorClockSize(
            mergedClock,
            clientId,
            protectedClientIds,
          );
          const newOp = this._recreateOpWithMergedClock(
            item.op,
            newClock,
            clientId,
            item.op.timestamp,
          );
          newOpsCreated.push(newOp);
          opsToReject.push(item.opId);
          OpLog.normal(
            `SupersededOperationResolverService: Created replacement moveToArchive op ${newOp.id} ` +
              `with ${item.op.entityIds?.length ?? 0} tasks, replacing superseded op ${item.opId}`,
          );
        } else {
          regularSupersededOps.push(item);
        }
      }

      // Group remaining ops by entity to handle multiple ops for the same entity
      const opsByEntity = new Map<string, Array<{ opId: string; op: Operation }>>();
      for (const item of regularSupersededOps) {
        // Skip ops without entityId (shouldn't happen for entity-level ops)
        if (!item.op.entityId) {
          OpLog.normal(
            `SupersededOperationResolverService: Skipping superseded op ${item.opId} - no entityId`,
          );
          continue;
        }
        const entityKey = toEntityKey(item.op.entityType, item.op.entityId);
        if (!opsByEntity.has(entityKey)) {
          opsByEntity.set(entityKey, []);
        }
        opsByEntity.get(entityKey)!.push(item);
      }
      let discardedChangesCount = 0;

      for (const [entityKey, entityOps] of opsByEntity) {
        // Get the first op to determine entity type and ID
        const firstOp = entityOps[0].op;
        const entityType = firstOp.entityType;
        const entityId = firstOp.entityId!; // Non-null - we filtered out ops without entityId above

        // Start with the global clock, merge in local pending ops' clocks, and increment
        const allClocks = [globalClock, ...entityOps.map(({ op }) => op.vectorClock)];
        const mergedClock = this.conflictResolutionService.mergeAndIncrementClocks(
          allClocks,
          clientId,
        );
        // Prune to match what the regular capture pipeline produces, preventing
        // infinite rejection loops when server compares pruned vs unpruned clocks
        const newClock = limitVectorClockSize(mergedClock, clientId, protectedClientIds);

        // Check if all superseded ops for this entity are DELETE operations
        const allOpsAreDeletes = entityOps.every((e) => e.op.opType === OpType.Delete);

        if (allOpsAreDeletes) {
          // For DELETE operations, we can't get current state (entity is deleted).
          // Create a new DELETE operation with merged clock instead of UPDATE.
          // Use the first op's actionType and payload since they're self-contained.
          const preservedTimestamp = Math.max(...entityOps.map((e) => e.op.timestamp));
          const newDeleteOp = this._recreateOpWithMergedClock(
            entityOps[0].op,
            newClock,
            clientId,
            preservedTimestamp,
          );

          newOpsCreated.push(newDeleteOp);
          opsToReject.push(...entityOps.map((e) => e.opId));

          OpLog.normal(
            `SupersededOperationResolverService: Created replacement DELETE op for ${entityKey}, ` +
              `replacing ${entityOps.length} superseded DELETE op(s). New clock: ${JSON.stringify(newClock)}`,
          );
          continue;
        }

        // Get current entity state from NgRx store
        const entityState = await this.conflictResolutionService.getCurrentEntityState(
          entityType,
          entityId,
        );
        if (entityState === undefined) {
          OpLog.normal(
            `SupersededOperationResolverService: Cannot create update op - entity not found: ${entityKey}`,
          );
          // Still mark the ops as rejected, but track that changes were discarded
          opsToReject.push(...entityOps.map((e) => e.opId));
          discardedChangesCount += entityOps.length;
          continue;
        }

        // Preserve the maximum timestamp from the superseded ops being replaced.
        // This is critical for LWW conflict resolution: if we use Date.now(), the new op
        // would have a later timestamp than the original user action, causing it to
        // incorrectly win against concurrent ops that were actually made earlier.
        const preservedTimestamp = Math.max(...entityOps.map((e) => e.op.timestamp));

        // Create new UPDATE op with current state and merged clock
        const newOp = this.conflictResolutionService.createLWWUpdateOp(
          entityType,
          entityId,
          entityState,
          clientId,
          newClock,
          preservedTimestamp,
        );

        newOpsCreated.push(newOp);
        opsToReject.push(...entityOps.map((e) => e.opId));

        OpLog.normal(
          `SupersededOperationResolverService: Created LWW update op for ${entityKey}, ` +
            `replacing ${entityOps.length} superseded op(s). New clock: ${JSON.stringify(newClock)}`,
        );
      }

      // Mark old ops as rejected
      if (opsToReject.length > 0) {
        await this.opLogStore.markRejected(opsToReject);
        OpLog.normal(
          `SupersededOperationResolverService: Marked ${opsToReject.length} superseded ops as rejected`,
        );
      }

      // Append new ops to the log (will be uploaded on next sync)
      // Uses appendWithVectorClockUpdate to ensure vector clock store stays in sync
      for (const op of newOpsCreated) {
        await this.opLogStore.appendWithVectorClockUpdate(op, 'local');
        OpLog.normal(
          `SupersededOperationResolverService: Appended LWW update op ${op.id} for ${op.entityType}:${op.entityId}`,
        );
      }

      if (newOpsCreated.length > 0) {
        this.snackService.open({
          msg: T.F.SYNC.S.LWW_CONFLICTS_AUTO_RESOLVED,
          translateParams: {
            localWins: newOpsCreated.length,
            remoteWins: 0,
          },
        });
      }

      // Notify user if local changes were discarded because entities no longer exist
      if (discardedChangesCount > 0) {
        this.snackService.open({
          msg: T.F.SYNC.S.LOCAL_CHANGES_DISCARDED,
          translateParams: {
            count: discardedChangesCount,
          },
        });
      }

      result = newOpsCreated.length;
    });
    return result;
  }
}
