import { inject, Injectable } from '@angular/core';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { Operation, VectorClock } from '../core/operation.types';
import { mergeVectorClocks } from '../../core/util/vector-clock';
import { OpLog } from '../../core/log';
import { ConflictResolutionService } from './conflict-resolution.service';
import { VectorClockService } from './vector-clock.service';
import { LockService } from './lock.service';
import { toEntityKey } from '../util/entity-key.util';
import { LOCK_NAMES } from '../core/operation-log.const';
import { SnackService } from '../../core/snack/snack.service';
import { T } from '../../t.const';
import { CLIENT_ID_PROVIDER } from '../util/client-id.provider';
import { LWWOperationFactory } from './lww-operation-factory.service';

/**
 * Resolves stale local operations that were rejected due to concurrent modification.
 *
 * ## When Stale Operations Occur
 * During sync, the server may reject local operations if their vector clocks
 * are dominated by operations from other clients. This means our local changes
 * are based on outdated state.
 *
 * ## Resolution Strategy
 * Instead of losing local changes, we:
 * 1. Mark the old pending ops as rejected (their clocks are stale)
 * 2. Create NEW ops with the current entity state and merged vector clocks
 * 3. The new ops will be uploaded on next sync cycle
 *
 * This preserves local changes while ensuring vector clocks properly dominate
 * all known operations.
 */
@Injectable({
  providedIn: 'root',
})
export class StaleOperationResolverService {
  private opLogStore = inject(OperationLogStoreService);
  private vectorClockService = inject(VectorClockService);
  private conflictResolutionService = inject(ConflictResolutionService);
  private lockService = inject(LockService);
  private snackService = inject(SnackService);
  private clientIdProvider = inject(CLIENT_ID_PROVIDER);
  private lwwOperationFactory = inject(LWWOperationFactory);

  /**
   * Resolves stale local operations by creating new LWW Update operations.
   *
   * @param staleOps - Operations that were rejected due to concurrent modification
   * @param extraClocks - Additional clocks to merge (from force download)
   * @param snapshotVectorClock - Aggregated clock from snapshot optimization (if available)
   * @returns Number of merged ops created
   */
  async resolveStaleLocalOps(
    staleOps: Array<{ opId: string; op: Operation }>,
    extraClocks?: VectorClock[],
    snapshotVectorClock?: VectorClock,
  ): Promise<number> {
    // Acquire lock to prevent race conditions with operation capture and other sync operations.
    // Without this lock, user actions during conflict resolution could write ops with
    // stale vector clocks, leading to data corruption.
    let result = 0;
    await this.lockService.request(LOCK_NAMES.OPERATION_LOG, async () => {
      const clientId = await this.clientIdProvider.loadClientId();
      if (!clientId) {
        OpLog.err(
          'StaleOperationResolverService: Cannot resolve stale ops - no client ID',
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
          `StaleOperationResolverService: Merging snapshotVectorClock with ${Object.keys(snapshotVectorClock).length} entries`,
        );
        globalClock = mergeVectorClocks(globalClock, snapshotVectorClock);
      }

      // If extra clocks were provided (from force download), merge them all
      // This helps recover from situations where our local clock is missing entries
      if (extraClocks && extraClocks.length > 0) {
        OpLog.normal(
          `StaleOperationResolverService: Merging ${extraClocks.length} clocks from force download`,
        );
        for (const clock of extraClocks) {
          globalClock = mergeVectorClocks(globalClock, clock);
        }
      }

      // Group ops by entity to handle multiple ops for the same entity
      const opsByEntity = new Map<string, Array<{ opId: string; op: Operation }>>();
      for (const item of staleOps) {
        // Skip ops without entityId (shouldn't happen for entity-level ops)
        if (!item.op.entityId) {
          OpLog.warn(
            `StaleOperationResolverService: Skipping stale op ${item.opId} - no entityId`,
          );
          continue;
        }
        const entityKey = toEntityKey(item.op.entityType, item.op.entityId);
        if (!opsByEntity.has(entityKey)) {
          opsByEntity.set(entityKey, []);
        }
        opsByEntity.get(entityKey)!.push(item);
      }

      const opsToReject: string[] = [];
      const newOpsCreated: Operation[] = [];
      let discardedChangesCount = 0;

      for (const [entityKey, entityOps] of opsByEntity) {
        // Get the first op to determine entity type and ID
        const firstOp = entityOps[0].op;
        const entityType = firstOp.entityType;
        const entityId = firstOp.entityId!; // Non-null - we filtered out ops without entityId above

        // Start with the global clock, merge in local pending ops' clocks, and increment
        const allClocks = [globalClock, ...entityOps.map(({ op }) => op.vectorClock)];
        const newClock = this.lwwOperationFactory.mergeAndIncrementClocks(
          allClocks,
          clientId,
        );

        // Get current entity state from NgRx store
        const entityState = await this.conflictResolutionService.getCurrentEntityState(
          entityType,
          entityId,
        );
        if (entityState === undefined) {
          OpLog.warn(
            `StaleOperationResolverService: Cannot create update op - entity not found: ${entityKey}`,
          );
          // Still mark the ops as rejected, but track that changes were discarded
          opsToReject.push(...entityOps.map((e) => e.opId));
          discardedChangesCount += entityOps.length;
          continue;
        }

        // Preserve the maximum timestamp from the stale ops being replaced.
        // This is critical for LWW conflict resolution: if we use Date.now(), the new op
        // would have a later timestamp than the original user action, causing it to
        // incorrectly win against concurrent ops that were actually made earlier.
        const preservedTimestamp = Math.max(...entityOps.map((e) => e.op.timestamp));

        // Create new UPDATE op with current state and merged clock
        const newOp = this.lwwOperationFactory.createLWWUpdateOp(
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
          `StaleOperationResolverService: Created LWW update op for ${entityKey}, ` +
            `replacing ${entityOps.length} stale op(s). New clock: ${JSON.stringify(newClock)}`,
        );
      }

      // Mark old ops as rejected
      if (opsToReject.length > 0) {
        await this.opLogStore.markRejected(opsToReject);
        OpLog.normal(
          `StaleOperationResolverService: Marked ${opsToReject.length} stale ops as rejected`,
        );
      }

      // Append new ops to the log (will be uploaded on next sync)
      // Uses appendWithVectorClockUpdate to ensure vector clock store stays in sync
      for (const op of newOpsCreated) {
        await this.opLogStore.appendWithVectorClockUpdate(op, 'local');
        OpLog.normal(
          `StaleOperationResolverService: Appended LWW update op ${op.id} for ${op.entityType}:${op.entityId}`,
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
