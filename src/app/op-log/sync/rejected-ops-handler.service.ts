import { inject, Injectable } from '@angular/core';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { Operation } from '../core/operation.types';
import { OpLog } from '../../core/log';
import { SnackService } from '../../core/snack/snack.service';
import { T } from '../../t.const';
import { MAX_REJECTED_OPS_BEFORE_WARNING } from '../core/operation-log.const';
import { StaleOperationResolverService } from './stale-operation-resolver.service';
import { DownloadCallback } from '../core/types/sync-results.types';
import { handleStorageQuotaError } from './sync-error-utils';

// Re-export for consumers that import from this service
export type {
  DownloadResultForRejection,
  DownloadCallback,
} from '../core/types/sync-results.types';

/**
 * Handles operations that were rejected by the server during upload.
 *
 * Responsibilities:
 * - Categorizing rejections (permanent vs concurrent modification)
 * - Marking permanent rejections as rejected
 * - Resolving concurrent modifications by downloading and merging clocks
 * - Creating merged operations for stale local ops
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
  private staleOperationResolver = inject(StaleOperationResolverService);

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
   * @returns Number of merged ops created (caller should trigger follow-up upload if > 0)
   */
  async handleRejectedOps(
    rejectedOps: Array<{ opId: string; error?: string; errorCode?: string }>,
    downloadCallback?: DownloadCallback,
  ): Promise<number> {
    if (rejectedOps.length === 0) {
      return 0;
    }

    let mergedOpsCreated = 0;

    // Separate concurrent modification rejections from permanent failures
    // For concurrent mods, we collect the full operation for later processing
    const concurrentModificationOps: Array<{ opId: string; op: Operation }> = [];
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
        OpLog.warn(
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
      // FIX: Also handle CONFLICT_STALE the same as CONFLICT_CONCURRENT.
      // CONFLICT_STALE occurs when operations have incomplete vector clocks
      // (e.g., due to stale clock bug) and should be resolved via merge, not rejected.
      const needsConflictResolution =
        rejected.errorCode === 'CONFLICT_CONCURRENT' ||
        rejected.errorCode === 'CONFLICT_STALE';

      if (needsConflictResolution) {
        concurrentModificationOps.push({
          opId: rejected.opId,
          op: entry.op,
        });
        OpLog.warn(
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

      // Notify user if significant number of ops were rejected without conflict resolution
      if (permanentlyRejectedOps.length >= MAX_REJECTED_OPS_BEFORE_WARNING) {
        this.snackService.open({
          type: 'ERROR',
          msg: T.F.SYNC.S.UPLOAD_OPS_REJECTED,
          translateParams: { count: permanentlyRejectedOps.length },
        });
      }
    }

    // For concurrent modifications: try download first, then resolve locally if needed
    if (concurrentModificationOps.length > 0 && downloadCallback) {
      mergedOpsCreated = await this._resolveConcurrentModifications(
        concurrentModificationOps,
        downloadCallback,
      );
    }

    return mergedOpsCreated;
  }

  /**
   * Resolves concurrent modification rejections by downloading and merging.
   */
  private async _resolveConcurrentModifications(
    concurrentModificationOps: Array<{ opId: string; op: Operation }>,
    downloadCallback: DownloadCallback,
  ): Promise<number> {
    let mergedOpsCreated = 0;

    OpLog.warn(
      `RejectedOpsHandlerService: ${concurrentModificationOps.length} ops had concurrent modifications. ` +
        `Triggering download to check for new remote ops...`,
    );

    try {
      // Try to download new remote ops - if there are any, conflict detection will handle them
      const downloadResult = await downloadCallback();

      // Helper to check which ops are still pending
      const getStillPendingOps = async (): Promise<
        Array<{ opId: string; op: Operation }>
      > => {
        const pending: Array<{ opId: string; op: Operation }> = [];
        for (const { opId, op } of concurrentModificationOps) {
          const entry = await this.opLogStore.getOpById(opId);
          if (entry && !entry.syncedAt && !entry.rejectedAt) {
            pending.push({ opId, op });
          }
        }
        return pending;
      };

      // If download got new ops, conflict detection already happened in _processRemoteOps
      // If download got nothing (newOpsCount === 0), we need to resolve locally
      if (downloadResult.newOpsCount === 0) {
        const stillPendingOps = await getStillPendingOps();

        if (stillPendingOps.length > 0) {
          // Normal download returned 0 ops but concurrent ops still pending.
          // This means our local clock is likely missing entries the server has.
          // Try a FORCE download from seq 0 to get ALL op clocks.
          OpLog.warn(
            `RejectedOpsHandlerService: Download returned no new ops but ${stillPendingOps.length} ` +
              `concurrent ops still pending. Forcing full download from seq 0...`,
          );

          const forceDownloadResult = await downloadCallback({ forceFromSeq0: true });

          // Use the clocks from force download to resolve stale ops
          if (
            forceDownloadResult.allOpClocks &&
            forceDownloadResult.allOpClocks.length > 0
          ) {
            OpLog.normal(
              `RejectedOpsHandlerService: Got ${forceDownloadResult.allOpClocks.length} clocks from force download`,
            );
            mergedOpsCreated += await this.staleOperationResolver.resolveStaleLocalOps(
              stillPendingOps,
              forceDownloadResult.allOpClocks,
              forceDownloadResult.snapshotVectorClock,
            );
          } else if (forceDownloadResult.snapshotVectorClock) {
            // Force download returned no individual clocks but we have snapshot clock
            OpLog.normal(
              `RejectedOpsHandlerService: Using snapshotVectorClock from force download`,
            );
            mergedOpsCreated += await this.staleOperationResolver.resolveStaleLocalOps(
              stillPendingOps,
              undefined,
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
          OpLog.warn(
            `RejectedOpsHandlerService: Download got ${downloadResult.newOpsCount} ops but ${stillPendingOps.length} ` +
              `concurrent ops still pending. Resolving locally with merged clocks...`,
          );
          mergedOpsCreated += await this.staleOperationResolver.resolveStaleLocalOps(
            stillPendingOps,
            undefined,
            downloadResult.snapshotVectorClock,
          );
        }
      }
    } catch (e) {
      OpLog.err(
        'RejectedOpsHandlerService: Failed to download after concurrent modification detection',
        e,
      );
    }

    return mergedOpsCreated;
  }
}
