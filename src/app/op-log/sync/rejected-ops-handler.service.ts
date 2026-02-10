import { inject, Injectable } from '@angular/core';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { Operation, VectorClock } from '../core/operation.types';
import { OpLog } from '../../core/log';
import { SnackService } from '../../core/snack/snack.service';
import { T } from '../../t.const';
import { SupersededOperationResolverService } from './superseded-operation-resolver.service';
import { DownloadCallback, RejectedOpInfo } from '../core/types/sync-results.types';
import { handleStorageQuotaError } from './sync-error-utils';
import { MAX_CONCURRENT_RESOLUTION_ATTEMPTS } from '../core/operation-log.const';
import { toEntityKey } from '../util/entity-key.util';

// Re-export for consumers that import from this service
export type {
  DownloadResultForRejection,
  DownloadCallback,
  RejectedOpInfo,
} from '../core/types/sync-results.types';

/**
 * Result of handling rejected operations.
 */
export interface RejectionHandlingResult {
  /** Number of merged ops created from conflict resolution (these need to be uploaded) */
  mergedOpsCreated: number;
  /** Number of operations that were permanently rejected (validation errors, etc.) */
  permanentRejectionCount: number;
}

/**
 * Handles operations that were rejected by the server during upload.
 *
 * Responsibilities:
 * - Categorizing rejections (permanent vs concurrent modification)
 * - Marking permanent rejections as rejected
 * - Resolving concurrent modifications by downloading and merging clocks
 * - Creating merged operations for superseded local ops
 *
 * This service is used by OperationLogSyncService after upload to handle
 * any operations that the server rejected.
 */
@Injectable({
  providedIn: 'root',
})
export class RejectedOpsHandlerService {
  private opLogStore = inject(OperationLogStoreService);
  private snackService = inject(SnackService);
  private supersededOperationResolver = inject(SupersededOperationResolverService);

  /**
   * Tracks resolution attempts per entity key (entityType:entityId) to prevent infinite loops.
   * When the same entity keeps getting rejected after concurrent modification resolution
   * (e.g., due to vector clock pruning making domination impossible), this counter detects
   * the loop and marks ops as permanently rejected after MAX_CONCURRENT_RESOLUTION_ATTEMPTS.
   * Cleared when a sync cycle has no rejections (healthy state).
   */
  private _resolutionAttemptsByEntity = new Map<string, number>();

  /**
   * Handles operations that were rejected by the server.
   *
   * This is called AFTER processing piggybacked ops to ensure that:
   * 1. Conflicts are detected properly (local ops still in pending list)
   * 2. User has had a chance to resolve conflicts via the dialog
   * 3. Only ops that weren't resolved via conflict dialog get marked rejected
   *
   * Special handling for CONCURRENT MODIFICATION rejections:
   * - These indicate the server has a conflicting operation from another client
   * - We try to download any new ops first
   * - If download returns new ops, conflict detection happens automatically
   * - If download returns nothing (we already have the conflicting ops), we:
   *   1. Mark the old pending ops as rejected
   *   2. Create NEW ops with current state and merged vector clocks
   *   3. The new ops will be uploaded on next sync cycle
   *
   * @param rejectedOps - Operations rejected by the server with error messages
   * @param downloadCallback - Callback to trigger download for concurrent modification resolution
   * @returns Result with merged ops count and permanent rejection count
   */
  async handleRejectedOps(
    rejectedOps: RejectedOpInfo[],
    downloadCallback?: DownloadCallback,
  ): Promise<RejectionHandlingResult> {
    if (rejectedOps.length === 0) {
      // No rejections = sync is healthy, reset resolution attempt counters
      this._resolutionAttemptsByEntity.clear();
      return { mergedOpsCreated: 0, permanentRejectionCount: 0 };
    }

    let mergedOpsCreated = 0;

    // Separate concurrent modification rejections from permanent failures
    // For concurrent mods, we collect the full operation and existingClock for later processing
    const concurrentModificationOps: Array<{
      opId: string;
      op: Operation;
      existingClock?: VectorClock;
    }> = [];
    const permanentlyRejectedOps: string[] = [];

    for (const rejected of rejectedOps) {
      // Check for storage quota exceeded - show strong alert and skip marking as rejected
      // This is a critical error that requires user action
      if (rejected.errorCode === 'STORAGE_QUOTA_EXCEEDED') {
        OpLog.error(
          `RejectedOpsHandlerService: Storage quota exceeded - sync is broken!`,
        );
        handleStorageQuotaError(rejected.errorCode);
        // Don't mark as rejected - user needs to take action to fix storage
        continue;
      }

      // INTERNAL_ERROR = transient server error (transaction rollback, DB issue, etc.)
      // These should be retried on next sync, not permanently rejected
      if (rejected.errorCode === 'INTERNAL_ERROR') {
        OpLog.normal(
          `RejectedOpsHandlerService: Transient error for op ${rejected.opId}, will retry: ${rejected.error || 'unknown'}`,
        );
        continue;
      }

      // DUPLICATE_OPERATION = the operation already exists on the server.
      // This is NOT an error - it means the op was successfully uploaded before but the
      // client didn't record it as synced (e.g., network timeout after server accepted).
      // Mark it as synced so the client stops retrying.
      if (rejected.errorCode === 'DUPLICATE_OPERATION') {
        const dupEntry = await this.opLogStore.getOpById(rejected.opId);
        if (dupEntry && !dupEntry.syncedAt) {
          OpLog.normal(
            `RejectedOpsHandlerService: Op ${rejected.opId} already on server (duplicate), marking as synced`,
          );
          await this.opLogStore.markSynced([dupEntry.seq]);
        }
        continue;
      }

      const entry = await this.opLogStore.getOpById(rejected.opId);
      // Skip if:
      // - Op doesn't exist (was somehow removed)
      // - Op is already synced (was accepted after all)
      // - Op is already rejected (conflict resolution already handled it)
      if (!entry || entry.syncedAt || entry.rejectedAt) {
        continue;
      }

      // Check if this is a conflict that needs resolution via merge
      // These happen when another client uploaded a conflicting operation.
      // Use errorCode for reliable detection (string matching is fragile).
      // FIX: Also handle CONFLICT_SUPERSEDED the same as CONFLICT_CONCURRENT.
      // CONFLICT_SUPERSEDED occurs when operations have incomplete vector clocks
      // (e.g., due to superseded clock bug) and should be resolved via merge, not rejected.
      const needsConflictResolution =
        rejected.errorCode === 'CONFLICT_CONCURRENT' ||
        rejected.errorCode === 'CONFLICT_SUPERSEDED' ||
        rejected.errorCode === 'CONFLICT_STALE'; // TODO: remove after all servers are updated

      if (needsConflictResolution) {
        concurrentModificationOps.push({
          opId: rejected.opId,
          op: entry.op,
          existingClock: rejected.existingClock,
        });
        OpLog.normal(
          `RejectedOpsHandlerService: Concurrent modification for ${entry.op.entityType}:${entry.op.entityId}, ` +
            `will resolve after download check`,
        );
      } else {
        permanentlyRejectedOps.push(rejected.opId);
        OpLog.normal(
          `RejectedOpsHandlerService: Marking op ${rejected.opId} as rejected: ${rejected.error || 'unknown error'}`,
        );
      }
    }

    // Mark permanent rejections (validation errors, etc.) as rejected
    if (permanentlyRejectedOps.length > 0) {
      await this.opLogStore.markRejected(permanentlyRejectedOps);
      OpLog.normal(
        `RejectedOpsHandlerService: Marked ${permanentlyRejectedOps.length} server-rejected ops as rejected`,
      );
      this.snackService.open({
        type: 'ERROR',
        msg: T.F.SYNC.S.UPLOAD_OPS_REJECTED,
        translateParams: { count: permanentlyRejectedOps.length },
      });
    }

    // For concurrent modifications: try download first, then resolve locally if needed
    let retryExceededCount = 0;
    if (concurrentModificationOps.length > 0 && downloadCallback) {
      const result = await this._resolveConcurrentModifications(
        concurrentModificationOps,
        downloadCallback,
      );
      mergedOpsCreated = result.mergedOpsCreated;
      retryExceededCount = result.retryExceededCount;
    }

    return {
      mergedOpsCreated,
      permanentRejectionCount: permanentlyRejectedOps.length + retryExceededCount,
    };
  }

  /**
   * Resolves concurrent modification rejections by downloading and merging.
   */
  private async _resolveConcurrentModifications(
    concurrentModificationOps: Array<{
      opId: string;
      op: Operation;
      existingClock?: VectorClock;
    }>,
    downloadCallback: DownloadCallback,
  ): Promise<{ mergedOpsCreated: number; retryExceededCount: number }> {
    let mergedOpsCreated = 0;

    // Check resolution attempt counts per entity to prevent infinite loops.
    // When vector clock pruning makes it impossible to create a dominating clock,
    // the cycle "upload → reject → merge → upload → reject" repeats forever.
    // After MAX_CONCURRENT_RESOLUTION_ATTEMPTS, we give up and reject permanently.
    const opsToResolve: Array<{
      opId: string;
      op: Operation;
      existingClock?: VectorClock;
    }> = [];
    const opsExceededRetries: Array<{
      opId: string;
      op: Operation;
      existingClock?: VectorClock;
    }> = [];

    // Increment once per unique entity in this batch, not once per op.
    // Without dedup, 4 ops for the same entity would burn 4 attempts in one cycle.
    const entityKeysInBatch = new Set<string>();
    for (const item of concurrentModificationOps) {
      const entityKey = this._getEntityKey(item.op);
      if (!entityKeysInBatch.has(entityKey)) {
        entityKeysInBatch.add(entityKey);
        const attempts = (this._resolutionAttemptsByEntity.get(entityKey) ?? 0) + 1;
        this._resolutionAttemptsByEntity.set(entityKey, attempts);
      }
    }

    // Classify each op based on its entity's attempt count
    for (const item of concurrentModificationOps) {
      const entityKey = this._getEntityKey(item.op);
      const attempts = this._resolutionAttemptsByEntity.get(entityKey) ?? 0;
      if (attempts > MAX_CONCURRENT_RESOLUTION_ATTEMPTS) {
        opsExceededRetries.push(item);
      } else {
        opsToResolve.push(item);
      }
    }

    // Mark exceeded-limit ops as permanently rejected to break the infinite loop
    if (opsExceededRetries.length > 0) {
      OpLog.err(
        `RejectedOpsHandlerService: ${opsExceededRetries.length} ops exceeded max concurrent resolution attempts ` +
          `(${MAX_CONCURRENT_RESOLUTION_ATTEMPTS}). Marking as permanently rejected to break sync loop.`,
      );
      const exceededOpIds = opsExceededRetries.map(({ opId }) => opId);
      await this.opLogStore.markRejected(exceededOpIds);
      this.snackService.open({
        type: 'ERROR',
        msg: T.F.SYNC.S.CONFLICT_RESOLUTION_FAILED,
      });
      // Clean up tracking for rejected entities
      for (const item of opsExceededRetries) {
        this._resolutionAttemptsByEntity.delete(this._getEntityKey(item.op));
      }
    }

    if (opsToResolve.length === 0) {
      return { mergedOpsCreated: 0, retryExceededCount: opsExceededRetries.length };
    }

    OpLog.normal(
      `RejectedOpsHandlerService: ${opsToResolve.length} ops had concurrent modifications. ` +
        `Triggering download to check for new remote ops...`,
    );

    try {
      // Try to download new remote ops - if there are any, conflict detection will handle them
      const downloadResult = await downloadCallback();

      // Helper to check which ops are still pending, preserving existingClock from rejection
      const getStillPendingOps = async (): Promise<
        Array<{ opId: string; op: Operation; existingClock?: VectorClock }>
      > => {
        const pending: Array<{
          opId: string;
          op: Operation;
          existingClock?: VectorClock;
        }> = [];
        for (const { opId, op, existingClock } of opsToResolve) {
          const entry = await this.opLogStore.getOpById(opId);
          if (entry && !entry.syncedAt && !entry.rejectedAt) {
            pending.push({ opId, op, existingClock });
          }
        }
        return pending;
      };

      // Helper to extract entity clocks from still-pending ops for merging
      const extractEntityClocks = (
        ops: Array<{ existingClock?: VectorClock }>,
      ): VectorClock[] => {
        return ops
          .map((item) => item.existingClock)
          .filter((clock): clock is VectorClock => clock !== undefined);
      };

      // If download got new ops, conflict detection already happened in _processRemoteOps
      // If download got nothing (newOpsCount === 0), we need to resolve locally
      if (downloadResult.newOpsCount === 0) {
        const stillPendingOps = await getStillPendingOps();

        if (stillPendingOps.length > 0) {
          // Normal download returned 0 ops but concurrent ops still pending.
          // This means our local clock is likely missing entries the server has.
          // Try a FORCE download from seq 0 to get ALL op clocks.
          OpLog.normal(
            `RejectedOpsHandlerService: Download returned no new ops but ${stillPendingOps.length} ` +
              `concurrent ops still pending. Forcing full download from seq 0...`,
          );

          const forceDownloadResult = await downloadCallback({ forceFromSeq0: true });

          // Use the clocks from force download to resolve superseded ops
          // Also merge in entity clocks from server rejection responses
          const entityClocks = extractEntityClocks(stillPendingOps);
          if (
            forceDownloadResult.allOpClocks &&
            forceDownloadResult.allOpClocks.length > 0
          ) {
            const allExtraClocks = [...forceDownloadResult.allOpClocks, ...entityClocks];
            OpLog.normal(
              `RejectedOpsHandlerService: Got ${forceDownloadResult.allOpClocks.length} clocks from force download` +
                (entityClocks.length > 0
                  ? ` + ${entityClocks.length} entity clocks from rejection`
                  : ''),
            );
            mergedOpsCreated +=
              await this.supersededOperationResolver.resolveSupersededLocalOps(
                stillPendingOps,
                allExtraClocks,
                forceDownloadResult.snapshotVectorClock,
              );
          } else if (forceDownloadResult.snapshotVectorClock || entityClocks.length > 0) {
            // Force download returned no individual clocks but we have snapshot clock or entity clocks
            OpLog.normal(
              `RejectedOpsHandlerService: Using ${forceDownloadResult.snapshotVectorClock ? 'snapshotVectorClock' : ''}` +
                `${forceDownloadResult.snapshotVectorClock && entityClocks.length > 0 ? ' + ' : ''}` +
                `${entityClocks.length > 0 ? `${entityClocks.length} entity clocks from rejection` : ''}`,
            );
            mergedOpsCreated +=
              await this.supersededOperationResolver.resolveSupersededLocalOps(
                stillPendingOps,
                entityClocks.length > 0 ? entityClocks : undefined,
                forceDownloadResult.snapshotVectorClock,
              );
          } else {
            // Force download returned no clocks but we have concurrent ops.
            // This is an unrecoverable edge case - cannot safely resolve without server clocks.
            // Mark ops as rejected to prevent infinite retry loop.
            OpLog.err(
              `RejectedOpsHandlerService: Force download returned no clocks. ` +
                `Cannot safely resolve ${stillPendingOps.length} concurrent ops. Marking as rejected.`,
            );
            for (const { opId } of stillPendingOps) {
              await this.opLogStore.markRejected([opId]);
            }
            this.snackService.open({
              type: 'ERROR',
              msg: T.F.SYNC.S.CONFLICT_RESOLUTION_FAILED,
            });
          }
        }
      } else {
        // Download got new ops - check if our pending ops were resolved by conflict detection
        const stillPendingOps = await getStillPendingOps();

        if (stillPendingOps.length > 0) {
          // Ops still pending after download - conflict detection didn't resolve them
          // This can happen if downloaded ops were for different entities
          // Merge entity clocks from rejection responses into extraClocks
          const entityClocks = extractEntityClocks(stillPendingOps);
          OpLog.normal(
            `RejectedOpsHandlerService: Download got ${downloadResult.newOpsCount} ops but ${stillPendingOps.length} ` +
              `concurrent ops still pending. Resolving locally with merged clocks...` +
              (entityClocks.length > 0
                ? ` (including ${entityClocks.length} entity clocks from rejection)`
                : ''),
          );
          mergedOpsCreated +=
            await this.supersededOperationResolver.resolveSupersededLocalOps(
              stillPendingOps,
              entityClocks.length > 0 ? entityClocks : undefined,
              downloadResult.snapshotVectorClock,
            );
        }
      }
    } catch (e) {
      OpLog.err(
        'RejectedOpsHandlerService: Failed to download after concurrent modification detection',
        e,
      );
      // Mark ops as failed so they can be retried on next sync, and re-throw
      // so caller knows resolution failed
      for (const { opId } of opsToResolve) {
        const entry = await this.opLogStore.getOpById(opId);
        // Only reject if still pending (not synced or already rejected)
        if (entry && !entry.syncedAt && !entry.rejectedAt) {
          await this.opLogStore.markRejected([opId]);
        }
      }
      throw e;
    }

    return { mergedOpsCreated, retryExceededCount: opsExceededRetries.length };
  }

  private _getEntityKey(op: Operation): string {
    const entityId = op.entityId || op.entityIds?.[0];
    if (!entityId) {
      OpLog.warn(
        '[RejectedOpsHandler] Operation has no entityId/entityIds, using wildcard key',
        op.actionType,
        op.entityType,
      );
      return toEntityKey(op.entityType, '*');
    }
    return toEntityKey(op.entityType, entityId);
  }
}
