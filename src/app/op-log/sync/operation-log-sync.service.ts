import { inject, Injectable, Injector } from '@angular/core';
import { Store } from '@ngrx/store';
import { planSnapshotHydration } from '@sp/sync-core';
import {
  VectorClock,
  compareVectorClocks,
  isVectorClockEmpty,
} from '../../core/util/vector-clock';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { OpLog } from '../../core/log';
import { OperationSyncCapable } from '../sync-providers/provider.interface';
import { OperationLogUploadService } from './operation-log-upload.service';
import {
  DownloadOutcome,
  SuccessfulDownloadResult,
  UploadOutcome,
} from '../core/types/sync-results.types';
import { OperationLogDownloadService } from './operation-log-download.service';
import { SnackService } from '../../core/snack/snack.service';
import { T } from '../../t.const';
import {
  IncompleteRemoteOperationsError,
  LocalDataConflictError,
} from '../core/errors/sync-errors';
import { SuperSyncStatusService } from './super-sync-status.service';
import {
  isKeptPrefixDecryptErrorSuperseded,
  toDownloadResultForRejection,
} from './download-outcome.util';
import { ServerMigrationService } from './server-migration.service';
import { OperationWriteFlushService } from './operation-write-flush.service';
import { RepairSyncContextService } from '../validation/repair-sync-context.service';
import { RemoteOpsProcessingService } from './remote-ops-processing.service';
import { VectorClockService } from './vector-clock.service';
import {
  DownloadResultForRejection,
  RejectedOpsHandlerService,
  RejectionHandlingResult,
} from './rejected-ops-handler.service';
import { SyncHydrationService } from '../persistence/sync-hydration.service';
import {
  SyncImportConflictData,
  SyncImportConflictResolution,
} from './dialog-sync-import-conflict/dialog-sync-import-conflict.component';
import {
  IncomingFullStateConflictGateResult,
  SyncImportConflictGateService,
} from './sync-import-conflict-gate.service';
import { OperationLogHydratorService } from '../persistence/operation-log-hydrator.service';
import { SyncProviderManager } from '../sync-providers/provider-manager.service';
import { SyncLocalStateService } from './sync-local-state.service';
import {
  ForceUploadResult,
  SyncImportConflictCoordinatorService,
} from './sync-import-conflict-coordinator.service';
import { isExampleTaskCreateOp } from '../validation/is-example-task-op.util';
import { isFullStateOpType, Operation, OperationLogEntry } from '../core/operation.types';
import {
  canKeepPendingOnSnapshot,
  reapplyKeptPendingOps,
} from './keep-pending-on-snapshot.util';
import { OperationApplierService } from '../apply/operation-applier.service';
import { processDeferredActions } from './process-deferred-actions-flush.util';
import { HydrationStateService } from '../apply/hydration-state.service';
import { getDeferredActions } from '../capture/operation-capture.meta-reducer';

type RemoteOpsProcessingResult = Awaited<
  ReturnType<RemoteOpsProcessingService['processRemoteOps']>
>;

type GuardedRemoteOpsProcessingResult = RemoteOpsProcessingResult & {
  preApplyFullStateConflict?: IncomingFullStateConflictGateResult;
  /**
   * Pending work appeared between the gate check and the apply, and the
   * incoming full-state op was a causal REPAIR. Nothing was applied; the
   * caller must leave the cursor behind the batch and retry (#9773).
   */
  preApplyRepairDeferred?: boolean;
  /**
   * A causal REPAIR was deferred but the substitute local heal FAILED —
   * this client's state is still invalid and the skipped snapshot is the
   * one known fix. The caller must skip ONLY the cursor persist (so the
   * next cycle re-downloads the repair) while letting the rest of the
   * cycle — in particular the deferred upload acknowledgement — proceed:
   * once the pending ops are acknowledged the gate stops deferring the
   * repair and applies it. Early-returning instead would keep the pending
   * set non-empty and re-arm the deferral forever (#9777 follow-up).
   */
  deferredRepairHealFailed?: boolean;
};

import { TabSeqFrontierService } from '../persistence/tab-seq-frontier.service';
import { RemoteStateRebuildService } from './remote-state-rebuild.service';
import { partitionSnapshotOps } from './partition-snapshot-ops.util';
/**
 * Orchestrates synchronization of the Operation Log with remote storage.
 *
 * ## Overview
 * This service is the main coordinator for syncing operations between clients.
 * It handles uploading local changes, downloading remote changes, detecting conflicts,
 * and ensuring data consistency across all clients.
 *
 * ## Sync Flow
 * ```
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │                           UPLOAD FLOW                                   │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │  1. Check if fresh client (block upload if no history)                 │
 * │  2. Upload pending ops via OperationLogUploadService                   │
 * │  3. Process piggybacked ops FIRST (triggers conflict detection)        │
 * │  4. Mark server-rejected ops as rejected                               │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │                          DOWNLOAD FLOW                                  │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │  1. Download remote ops via OperationLogDownloadService                │
 * │  2. Fresh client? → Show confirmation dialog                           │
 * │  3. Process remote ops (_processRemoteOps)                             │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │                     PROCESS REMOTE OPS FLOW                             │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │  1. Schema migration (receiver-side)                                   │
 * │  2. Filter ops invalidated by SYNC_IMPORT                              │
 * │  3. Full-state op? → Skip conflict detection, apply directly           │
 * │  4. Conflict detection via vector clocks                               │
 * │  5. Conflicts? → Auto-resolve with LWW, piggyback non-conflicting ops  │
 * │  6. No conflicts? → Apply ops directly                                 │
 * │  7. Validate state (Checkpoint D)                                      │
 * └─────────────────────────────────────────────────────────────────────────┘
 * ```
 *
 * ## Key Concepts
 *
 * ### Piggybacked Operations
 * When uploading, the server may return ops from other clients in the same response.
 * These are processed BEFORE marking rejected ops so conflict detection works properly.
 *
 * ### Non-Conflicting Ops Piggybacking
 * When conflicts are detected, non-conflicting ops are passed to ConflictResolutionService
 * to be applied together with resolved conflicts. This ensures dependency sorting works
 * (e.g., Task depends on Project from a resolved conflict).
 *
 * ### Fresh Client Safety
 * A client with no history must download before uploading to prevent overwriting
 * valid remote data with empty state. Fresh clients also see a confirmation dialog.
 *
 * ## Delegated Services
 * - **OperationLogUploadService**: Handles server communication for uploads
 * - **OperationLogDownloadService**: Handles server communication for downloads
 * - **ConflictResolutionService**: Presents conflicts to user and applies resolutions
 * - **VectorClockService**: Manages vector clock state and entity frontiers
 * - **OperationApplierService**: Applies operations to NgRx store
 * - **ValidateStateService**: Validates and repairs state after sync (Checkpoint D)
 */
@Injectable({
  providedIn: 'root',
})
export class OperationLogSyncService {
  private store = inject(Store);
  private opLogStore = inject(OperationLogStoreService);
  private uploadService = inject(OperationLogUploadService);
  private downloadService = inject(OperationLogDownloadService);
  private snackService = inject(SnackService);
  private superSyncStatusService = inject(SuperSyncStatusService);
  private serverMigrationService = inject(ServerMigrationService);
  private writeFlushService = inject(OperationWriteFlushService);
  private repairSyncContext = inject(RepairSyncContextService);
  private tabSeqFrontier = inject(TabSeqFrontierService);

  // Extracted services
  private remoteOpsProcessingService = inject(RemoteOpsProcessingService);
  private vectorClockService = inject(VectorClockService);
  private rejectedOpsHandlerService = inject(RejectedOpsHandlerService);
  private syncHydrationService = inject(SyncHydrationService);
  private syncImportConflictGateService = inject(SyncImportConflictGateService);
  private syncLocalStateService = inject(SyncLocalStateService);
  private syncImportConflictCoordinator = inject(SyncImportConflictCoordinatorService);
  private providerManager = inject(SyncProviderManager);
  private operationApplier = inject(OperationApplierService);
  private hydrationState = inject(HydrationStateService);
  private injector = inject(Injector);
  private remoteStateRebuild = inject(RemoteStateRebuildService);

  /**
   * Checks if this client is "wholly fresh" - meaning it has never synced before
   * and has no local operation history. A fresh client accepting remote data
   * should require user confirmation to prevent accidental data loss.
   *
   * @returns true if this is a fresh client with no history
   */
  async isWhollyFreshClient(): Promise<boolean> {
    return this.syncLocalStateService.isWhollyFreshClient();
  }

  /**
   * Whether this client has ever completed a sync, for the SYNC_IMPORT conflict gate's
   * never-synced guard. The orchestrator (SyncWrapperService) MUST read this BEFORE
   * download and thread it into both downloadRemoteOps() and uploadPendingOps(): a sync
   * persists downloaded ops with `syncedAt` and marks accepted uploads synced, so a read
   * taken mid-cycle would see the sync's own writes and disarm the guard.
   */
  async hasSyncedOps(): Promise<boolean> {
    return this.opLogStore.hasSyncedOps();
  }

  /**
   * Upload pending local operations to remote storage.
   * Any piggybacked operations received during upload are automatically processed.
   *
   * IMPORTANT: The order of operations is critical:
   * 1. Upload ops → server may reject some with CONFLICT_CONCURRENT
   * 2. Process piggybacked ops FIRST → triggers conflict detection with local pending ops
   * 3. THEN mark server-rejected ops as rejected (if not already resolved via conflict dialog)
   *
   * This order ensures users see conflict dialogs when the server rejects their changes,
   * rather than having their local changes silently discarded.
   *
   * SAFETY: A wholly fresh client (no snapshot, no operations) should NOT upload.
   * Fresh clients must first download and apply remote data before they can contribute.
   * This prevents scenarios where a fresh/empty client overwrites existing remote data.
   *
   * SERVER MIGRATION: When a client with history connects to an empty server for the
   * first time (server migration scenario), we create a SYNC_IMPORT with full state
   * before uploading regular ops. This ensures all data is transferred to the new server.
   */
  async uploadPendingOps(
    syncProvider: OperationSyncCapable,
    options?: {
      skipPiggybackProcessing?: boolean;
      skipServerMigrationCheck?: boolean;
      isNeverSynced?: boolean;
      /** Sync epoch captured at cycle start (#9074); fences local writes. */
      fenceEpoch?: number;
    },
  ): Promise<UploadOutcome> {
    // CRITICAL: Ensure all pending write operations have completed before uploading.
    // The effect that writes operations uses concatMap for sequential processing,
    // but if sync is triggered before all operations are written to IndexedDB,
    // we would upload an incomplete set. This flush waits for all queued writes.
    await this._flushLocalWritesIncludingDeferredActions();
    await this._assertNoIncompleteRemoteOperations();

    // Capture never-synced status before the upload runs. The orchestrator passes a
    // value captured even earlier (pre-download, since download persists synced ops);
    // fall back to a local read for standalone upload callers.
    const isNeverSyncedAtSyncStart =
      options?.isNeverSynced ?? !(await this.opLogStore.hasSyncedOps());

    // SAFETY: Block upload from wholly fresh clients
    // A fresh client has nothing meaningful to upload and uploading could overwrite
    // valid remote data with empty/default state.
    const isFresh = await this.isWhollyFreshClient();
    if (isFresh) {
      OpLog.warn(
        'OperationLogSyncService: Upload blocked - this is a fresh client with no history. ' +
          'Download remote data first before uploading.',
      );
      return { kind: 'blocked_fresh_client' };
    }

    // SERVER MIGRATION CHECK: Run inside upload serialization before pending ops
    // are captured. ServerMigrationService deduplicates the final append inside
    // the cross-tab operation-log barrier.
    // Skip migration check for force uploads (e.g., after password change) to avoid
    // DecryptError when downloading ops encrypted with a different key.
    const result = await this.uploadService.uploadPendingOps(syncProvider, {
      preUploadCallback: options?.skipServerMigrationCheck
        ? undefined
        : () => this.serverMigrationService.checkAndHandleMigration(syncProvider),
      skipPiggybackProcessing: options?.skipPiggybackProcessing,
      // Keep accepted operations pending until piggyback processing commits. This
      // preserves the conflict gate across cancellation and crash/retry boundaries.
      deferAcknowledgement: true,
      ...(options?.fenceEpoch !== undefined ? { fenceEpoch: options.fenceEpoch } : {}),
    });

    // STEP 1: Process piggybacked ops FIRST
    // This is critical: piggybacked ops may contain the "winning" remote versions
    // that caused our local ops to be rejected. By processing them first while our
    // local ops are still in the pending list, conflict detection will work properly
    // and the user will see a conflict dialog to choose which version to keep.
    //
    // STEP 2: Now handle server-rejected operations
    // At this point, conflicts have been detected and presented to the user.
    // We mark remaining rejected ops (those not already resolved via conflict dialog)
    // as rejected so they won't be re-uploaded.
    //
    // CRITICAL: Use try-finally to ensure rejected ops are ALWAYS handled,
    // even if processing throws. Otherwise rejected ops remain in pending
    // state and get re-uploaded infinitely.
    let localWinOpsCreated = 0;
    let rejectionResult: RejectionHandlingResult = {
      kind: 'completed',
      mergedOpsCreated: 0,
      permanentRejectionCount: 0,
    };

    if (result.piggybackedOps.length > 0) {
      let startupOpIdsToDiscard: string[] = [];
      let startupCleanupFullStateOpId: string | undefined;
      // Check for piggybacked SYNC_IMPORT — mirrors the download path check (lines 552-604).
      // Without this, a SYNC_IMPORT from another client arriving as a piggybacked op
      // would silently replace local state via processRemoteOps().
      const piggybackedConflict =
        await this.syncImportConflictGateService.checkIncomingFullStateConflict(
          result.piggybackedOps,
          {
            isNeverSynced: isNeverSyncedAtSyncStart,
            flushPendingWrites: true,
            preCapturedPendingOps: result.selectedPendingOps ?? [],
          },
        );
      if (piggybackedConflict.fullStateOp) {
        const { fullStateOp, pendingOps, dialogData, deferredRepairOpId } =
          piggybackedConflict;

        // Existing synced store data is not a conflict here. Prompt only when
        // local pending user changes would be discarded; otherwise an old client
        // can accidentally force-upload stale state over the remote import.
        // (PASSWORD_CHANGED SYNC_IMPORTs without pending ops also fall through
        // to silent acceptance via this gate — the data is identical, only the
        // encryption changed.)
        if (dialogData) {
          OpLog.warn(
            `OperationLogSyncService: Piggybacked ${fullStateOp.opType} from client ${fullStateOp.clientId} ` +
              `with ${pendingOps.length} pending local ops. Showing conflict dialog.`,
          );

          const conflictResult = await this._handleSyncImportConflict(
            syncProvider,
            dialogData,
            'OperationLogSyncService (piggybacked full-state op)',
          );
          if (conflictResult === 'CANCEL') {
            return { kind: 'cancelled' };
          }
          // USE_LOCAL or USE_REMOTE was handled — report as completed with no further work.
          // Validation failure (if any during USE_REMOTE force-download) is on the
          // session-validation latch already; the wrapper reads it. (#7330)
          return {
            kind: 'completed',
            uploadedCount: result.uploadedCount,
            piggybackedOpsCount: result.piggybackedOps.length,
            localWinOpsCreated: 0,
            permanentRejectionCount: 0,
            hasMorePiggyback: false,
            rejectedOps: [],
          };
        } else if (deferredRepairOpId) {
          OpLog.normal(
            `OperationLogSyncService: Deferring piggybacked REPAIR from client ` +
              `${fullStateOp.clientId}; ${pendingOps.length} pending local op(s) ` +
              `keep their place and this client repairs its own state instead.`,
          );
        } else {
          // Known limitation (#7985, upload→piggyback path): example-task ops accepted earlier in
          // THIS same upload round were already marked synced, so they have left
          // getUnsynced() and are absent from discardablePendingOpIds here — they remain on
          // the server. State stays correct because receivers drop them as CONCURRENT
          // against the import (SyncImportFilterService). Only reachable in the narrow window
          // where example tasks are created on a still-empty server and uploaded just as a
          // remote import arrives; afterInitialSyncDoneStrict$ shrinks it further.
          startupOpIdsToDiscard = piggybackedConflict.discardablePendingOpIds;
          startupCleanupFullStateOpId = fullStateOp.id;
          OpLog.normal(
            `OperationLogSyncService: Accepting piggybacked ${fullStateOp.opType} from client ` +
              `${fullStateOp.clientId} without conflict dialog; ` +
              `${pendingOps.length} pending op(s), no meaningful pending user changes.`,
          );
        }
      }

      const processResult = await this._processRemoteOpsWithStartupCleanup(
        result.piggybackedOps,
        startupCleanupFullStateOpId,
        startupOpIdsToDiscard,
        {
          repairBaseServerSeq: result.lastServerSeqToPersist,
          rebaseKeptTimeDeltas: syncProvider.providerMode === 'superSyncOps',
          conflictRecheck: {
            isNeverSynced: isNeverSyncedAtSyncStart,
            preCapturedPendingOps: result.selectedPendingOps ?? [],
          },
          fenceEpoch: options?.fenceEpoch,
          ...(piggybackedConflict.deferredRepairOpId
            ? { deferredRepairOpId: piggybackedConflict.deferredRepairOpId }
            : {}),
        },
      );
      localWinOpsCreated = processResult.localWinOpsCreated;
      // Validation failure (if any) is on the session-validation latch.

      if (processResult.preApplyFullStateConflict?.dialogData) {
        const { fullStateOp, pendingOps, dialogData } =
          processResult.preApplyFullStateConflict;
        OpLog.warn(
          `OperationLogSyncService: ${fullStateOp?.opType ?? 'Full-state op'} gained ` +
            `${pendingOps.length} pending local op(s) before piggyback apply. Showing conflict dialog.`,
        );
        const conflictResult = await this._handleSyncImportConflict(
          syncProvider,
          dialogData,
          'OperationLogSyncService (piggybacked full-state pre-apply recheck)',
        );
        if (conflictResult === 'CANCEL') {
          return { kind: 'cancelled' };
        }
        return {
          kind: 'completed',
          uploadedCount: result.uploadedCount,
          piggybackedOpsCount: result.piggybackedOps.length,
          localWinOpsCreated: 0,
          permanentRejectionCount: 0,
          hasMorePiggyback: false,
          rejectedOps: [],
        };
      }

      if (processResult.preApplyRepairDeferred) {
        // Cursor stays behind the repair (the persist below is skipped), so the
        // batch comes back next cycle and the gate defers the repair up front.
        OpLog.normal(
          'OperationLogSyncService: Pending work appeared before the piggybacked REPAIR apply; ' +
            'retrying the batch next cycle.',
        );
        return {
          kind: 'completed',
          uploadedCount: result.uploadedCount,
          piggybackedOpsCount: result.piggybackedOps.length,
          localWinOpsCreated: 0,
          permanentRejectionCount: 0,
          hasMorePiggyback: false,
          rejectedOps: [],
        };
      }

      if (processResult.blockedByIncompatibleOp) {
        return { kind: 'blocked_incompatible' };
      }

      // #8304: Persist lastServerSeq ONLY now that the piggybacked ops have been applied
      // above. The upload service deferred this (see UploadResult.lastServerSeqToPersist)
      // so that a crash — or a cancelled/USE_REMOTE/USE_LOCAL SYNC_IMPORT dialog, all of
      // which return early ABOVE without reaching here — cannot advance the seq past ops
      // that were never stored. Mirrors the download path's invariant.
      // A version/migration block keeps the cursor behind the blocked op so it is
      // re-downloaded and retried after an app update instead of skipped forever.
      if (processResult.deferredRepairHealFailed) {
        // Heal-substitute for the deferred piggybacked REPAIR failed. Skip ONLY
        // the cursor persist — the repair snapshot is the one known fix, so it
        // must be re-downloadable next cycle. Everything below still runs;
        // above all the deferred acknowledgement MUST proceed, because the gate
        // defers the repair precisely while meaningful pending ops exist:
        // skipping markSynced would keep those (server-accepted) ops pending
        // forever, re-arming the deferral every cycle — a livelock with no
        // exit. With the ack drained, the next cycle's gate lets the repair
        // through and it heals the state the local attempt could not.
        OpLog.err(
          'OperationLogSyncService: Local heal after deferring a piggybacked REPAIR failed; ' +
            'keeping the cursor behind the repair for retry.',
        );
      } else if (result.lastServerSeqToPersist !== undefined) {
        await syncProvider.setLastServerSeq(result.lastServerSeqToPersist);
      }
    }

    const pendingAcknowledgementSeqs = result.pendingAcknowledgementSeqs ?? [];
    if (pendingAcknowledgementSeqs.length > 0) {
      // #9074: never acknowledge ops against a changed sync target.
      this.providerManager.assertSyncEpochUnchanged(
        options?.fenceEpoch,
        'deferred acknowledgement',
      );
      await this.opLogStore.markSynced(
        pendingAcknowledgementSeqs,
        result.pendingAcknowledgementOriginals,
      );
    }

    // STEP 2: resolve rejections and count merged ops needing upload.
    // Pass a download callback so the handler can trigger downloads for concurrent mods.
    //
    // NOTE: This must NOT run after a SYNC_IMPORT conflict dialog resolution (USE_LOCAL,
    // USE_REMOTE, CANCEL) — those paths return early above to avoid stale rejection handling.
    const downloadCallback = async (downloadOptions?: {
      forceFromSeq0?: boolean;
      isReDeliveryRetry?: boolean;
      ignoredLocalFullStateOpIds?: string[];
    }): Promise<DownloadResultForRejection> => {
      const outcome = await this.downloadRemoteOps(syncProvider, {
        ...downloadOptions,
        isNeverSynced: isNeverSyncedAtSyncStart,
        ...(options?.fenceEpoch !== undefined ? { fenceEpoch: options.fenceEpoch } : {}),
      });
      return toDownloadResultForRejection(outcome, await syncProvider.getLastServerSeq());
    };
    try {
      // #9074: the rejection handler appends merged/local-win ops and flips
      // rejection markers — old-epoch writes that would resurrect data around
      // a clean-slate replacement. It re-asserts before its in-place rebase.
      const assertFence = (context: string): void =>
        this.providerManager.assertSyncEpochUnchanged(options?.fenceEpoch, context);
      assertFence('rejected-ops handling');
      rejectionResult = await this.rejectedOpsHandlerService.handleRejectedOps(
        result.rejectedOps,
        downloadCallback,
        assertFence,
      );
      if (rejectionResult.kind === 'cancelled') {
        return { kind: 'cancelled' };
      }
      localWinOpsCreated += rejectionResult.mergedOpsCreated;
    } catch (rejectionError) {
      // FIX #6571: Propagate rejection handler errors instead of swallowing them.
      // Previously, errors here were logged but not rethrown, causing uploadPendingOps
      // to return kind='completed' with permanentRejectionCount=0, masking the failure.
      OpLog.err('OperationLogSyncService: Error handling rejected ops', rejectionError);
      throw rejectionError;
    }

    // Update pending ops status for UI indicator
    const pendingOps = await this.opLogStore.getUnsynced();
    this.superSyncStatusService.updatePendingOpsStatus(pendingOps.length > 0);

    // Detect (warn-only) an encryption-state mismatch in piggybacked ops — never auto-disable
    await this.warnOnEncryptionStateMismatch(
      syncProvider,
      result.piggybackHasOnlyUnencryptedData,
    );

    return {
      kind: 'completed',
      uploadedCount: result.uploadedCount,
      piggybackedOpsCount: result.piggybackedOps.length,
      localWinOpsCreated,
      permanentRejectionCount: rejectionResult.permanentRejectionCount,
      hasMorePiggyback: result.hasMorePiggyback ?? false,
      rejectedOps: result.rejectedOps,
      ...(result.encryptionRequiredKeyMissing
        ? { encryptionRequiredKeyMissing: true }
        : {}),
      ...(result.blockedByRejectedFullState ? { blockedByRejectedFullState: true } : {}),
      ...(result.fullStateUploadDeferred ? { fullStateUploadDeferred: true } : {}),
    };
  }

  /**
   * Download and process remote operations from storage.
   * For fresh clients (no local history), shows a confirmation dialog before accepting remote data
   * to prevent accidental data overwrites.
   *
   * When server migration is detected (gap on empty server), triggers a full state upload
   * to ensure all local data is transferred to the new server.
   *
   * @param syncProvider - The sync provider to download from
   * @param options.forceFromSeq0 - Force download from seq 0 to rebuild clock state
   * @returns Result indicating whether server migration was handled (requires follow-up upload)
   *          and how many local-win ops were created during LWW resolution
   */
  async downloadRemoteOps(
    syncProvider: OperationSyncCapable,
    options?: {
      forceFromSeq0?: boolean;
      isReDeliveryRetry?: boolean;
      isNeverSynced?: boolean;
      ignoredLocalFullStateOpIds?: string[];
      /** Sync epoch captured at cycle start (#9074); fences local writes. */
      fenceEpoch?: number;
      /** Top-level cycle downloads only (#9256); see `isDecryptedPrefixKeepable`. */
      keepDecryptedPrefix?: boolean;
    },
  ): Promise<DownloadOutcome> {
    // Crash-resume: a prior USE_REMOTE rebuild committed its baseline
    // replacement but crashed before the replay finished. The normal download
    // path excludes this client's own ops server-side, so resuming through it
    // would silently lose them — redo the raw rebuild instead.
    if (await this.opLogStore.isRawRebuildIncomplete()) {
      // #9074: the raw rebuild replaces local state wholesale — never from a
      // stale cycle. (Provider I/O below is fenced by the provider delegate;
      // these explicit asserts cover the LOCAL writes.)
      this.providerManager.assertSyncEpochUnchanged(
        options?.fenceEpoch,
        'raw-rebuild resume',
      );
      await this._resumeInterruptedRawRebuild(syncProvider, true);
      // State was replaced wholesale, exactly like a snapshot hydration.
      return { kind: 'snapshot_hydrated' };
    }

    await this._flushLocalWritesIncludingDeferredActions();
    // Another tab can commit the destructive replacement while this caller is
    // waiting for the operation-log flush barrier. Re-read the marker after the
    // barrier and resume the raw rebuild instead of entering the normal download
    // path with a partial baseline.
    if (await this.opLogStore.isRawRebuildIncomplete()) {
      this.providerManager.assertSyncEpochUnchanged(
        options?.fenceEpoch,
        'raw-rebuild resume (post-flush)',
      );
      await this._resumeInterruptedRawRebuild(syncProvider, false);
      return { kind: 'snapshot_hydrated' };
    }
    await this._assertNoIncompleteRemoteOperations();

    const result = await this.downloadService.downloadRemoteOps(syncProvider, options);

    // FIX #6571: Check download success before processing results.
    // Previously, success=false was ignored and treated as "no new ops",
    // causing sync to report IN_SYNC despite a failed download.
    if (!result.success) {
      throw new Error(
        'Download failed - partial or no data received. ' +
          `failedFileCount=${result.failedFileCount}`,
      );
    }
    const outcome = await this._processDownloadResult(syncProvider, result, options);
    // #9256: the kept prefix is applied and its cursor persisted; report the failed
    // page now, unless this cycle's outcome supersedes the decrypt error.
    if (
      result.decryptErrorAfterKeptPrefix &&
      !isKeptPrefixDecryptErrorSuperseded(outcome, {
        prefixCursor: result.latestServerSeq,
        persistedCursor: await syncProvider.getLastServerSeq(),
      })
    ) {
      throw result.decryptErrorAfterKeptPrefix;
    }
    return outcome;
  }

  private async _processDownloadResult(
    syncProvider: OperationSyncCapable,
    result: SuccessfulDownloadResult,
    options: Parameters<OperationLogSyncService['downloadRemoteOps']>[1],
  ): Promise<DownloadOutcome> {
    // Server migration detected: gap on empty server
    // Create a SYNC_IMPORT operation with full local state to seed the new server
    if (result.needsFullStateUpload) {
      // #9074: appends a SYNC_IMPORT locally — old-epoch state must not seed
      // the new epoch's server.
      this.providerManager.assertSyncEpochUnchanged(
        options?.fenceEpoch,
        'server migration',
      );
      const outcome =
        await this.serverMigrationService.handleServerMigration(syncProvider);
      // #9932: blocking this cycle's upload is right only when this client HAS
      // state that failed to ship AND the server still holds no base state for
      // the ordinary ops that would follow (see `server_migration_skipped` in
      // DownloadOutcome). Only these two reasons are that case.
      //
      // `server_not_empty` is NOT: the fresh check found that someone seeded the
      // server meanwhile, so a base state exists and the ordinary path applies —
      // blocking there strands a cycle for nothing, and the client reports
      // not-in-sync with its ops still pending. `empty_state` has nothing to
      // ship at all. Both fall through to the ordinary upload, as before #9932.
      const seedingFailed =
        outcome.kind === 'skipped' &&
        (outcome.reason === 'validation_failed' || outcome.reason === 'no_client_id');
      if (seedingFailed) {
        OpLog.warn(
          `OperationLogSyncService: Server-reset seeding created no SYNC_IMPORT (${outcome.reason}).`,
        );
        return { kind: 'server_migration_skipped' };
      }
      // Persist lastServerSeq=0 for the migration case (server was reset)
      if (result.latestServerSeq !== undefined) {
        await syncProvider.setLastServerSeq(result.latestServerSeq);
      }
      if (outcome.kind === 'skipped') {
        OpLog.normal(
          `OperationLogSyncService: Server was reset but nothing was seeded (${outcome.reason}); continuing with the ordinary upload.`,
        );
        return { kind: 'no_new_ops' };
      }
      return { kind: 'server_migration_handled' };
    }

    // FILE-BASED SYNC: Handle full state snapshot from fresh download
    // When downloading from seq 0 on file-based providers (Dropbox, WebDAV, LocalFile),
    // we receive the complete application state in snapshotState. This must be hydrated
    // directly instead of processing incremental ops (which are already reflected in the state).
    if (result.providerMode === 'fileSnapshotOps' && result.snapshotState) {
      // Issue #7339: a file-based snapshot whose vector clock is dominated by the
      // local clock contains nothing the local client doesn't already have. Hydrating
      // would discard local-only ops and a conflict dialog has nothing to resolve.
      // Without this short-circuit, FileBasedSyncAdapter's snapshot-replacement gap
      // detection re-fires every sync for clients that haven't uploaded their own
      // snapshot, trapping them in a perpetual conflict-dialog loop.
      //
      // Both clocks must be non-empty for the comparison to be meaningful: an empty
      // remote clock would compare EQUAL to a fresh local client and incorrectly skip
      // hydrating a snapshot that may carry real state from a legacy file.
      let hydrationPlan = planSnapshotHydration({
        snapshotVectorClock: result.snapshotVectorClock,
      });
      if (hydrationPlan.reason === 'missing-local-clock') {
        const localClock = await this.opLogStore.getVectorClock();
        hydrationPlan = planSnapshotHydration({
          localVectorClock: localClock,
          snapshotVectorClock: result.snapshotVectorClock,
        });
      }
      if (await this.syncLocalStateService.confirmSnapshotSkip(hydrationPlan, result)) {
        OpLog.normal(
          `OperationLogSyncService: Local vector clock ${hydrationPlan.comparison} remote snapshot — ` +
            'skipping snapshot hydration (local already has all remote data).',
        );
        // Deliberately do NOT append operations already represented by the
        // snapshot. Split files can also return a newer suffix, however, and
        // snapshot-clock dominance says nothing about that suffix. Apply it
        // normally before advancing the cursor.
        // VectorClockService.getEntityFrontier() builds per-entity frontiers
        // by iterating the op log in seq order with last-write-wins semantics.
        // Appending historical remote ops at the current tail would regress
        // the frontier for any entity where local already has newer ops,
        // which then lets future remote ops be classified as non-conflicting
        // and silently overwrite local changes.
        //
        // The trade-off: snapshot-included ops keep coming back in result.newOps on each
        // sync until the file's snapshot advances or the user uploads their
        // own snapshot. They are never re-applied to state, because (a) the
        // dominate-check skips state mutation, and (b) the regular hydration
        // path replaces state wholesale from snapshotState, not by replaying
        // individual ops. So the cost is bounded re-download bandwidth, not
        // data corruption.
        const { postSnapshotOps } = this._partitionSnapshotOps(
          result.newOps,
          result.snapshotAppliedOpIds,
        );
        let suffixProcessResult: RemoteOpsProcessingResult | undefined;
        if (postSnapshotOps.length > 0) {
          suffixProcessResult = await this._processRemoteOpsWithStartupCleanup(
            postSnapshotOps,
            undefined,
            [],
            { fenceEpoch: options?.fenceEpoch },
          );
          if (suffixProcessResult.blockedByIncompatibleOp) {
            return { kind: 'blocked_incompatible' };
          }
        }
        if (result.latestServerSeq !== undefined) {
          await syncProvider.setLastServerSeq(result.latestServerSeq);
        }
        return suffixProcessResult
          ? {
              kind: 'ops_processed',
              newOpsCount: postSnapshotOps.length,
              localWinOpsCreated: suffixProcessResult.localWinOpsCreated,
              allOpClocks: result.allOpClocks,
              snapshotVectorClock: result.snapshotVectorClock,
            }
          : {
              kind: 'no_new_ops',
              allOpClocks: result.allOpClocks,
              snapshotVectorClock: result.snapshotVectorClock,
            };
      }

      OpLog.normal(
        'OperationLogSyncService: Received snapshotState from file-based sync. Hydrating...',
      );

      // Check if client has unsynced local ops that would be lost
      const unsyncedOps = await this.opLogStore.getUnsynced();
      const hasLocalChanges = unsyncedOps.length > 0;

      // Nothing from this sync is persisted yet, so these live reads reflect
      // whether the client completed a prior sync cycle.
      const isNeverSyncedAtSyncStart =
        options?.isNeverSynced ?? !(await this.opLogStore.hasSyncedOps());
      // A local state-cache snapshot is only a last-synced baseline after a
      // completed sync: fresh clients can already have a snapshot containing
      // local changes, and using its clock would suppress the count-free
      // first-sync overwrite warning (#9166). Missing synced op rows cannot
      // prove "never synced" either (a snapshot-only first sync commits zero
      // synced rows, and compaction can prune them all later), so also consult
      // the persisted per-provider cursor, which only advances after a
      // completed, durably applied sync (setLastServerSeq below). Captured once
      // here so every conflict surfaced during this snapshot attempt uses the
      // same baseline decision, including the late-durable-op recheck inside
      // _hydrateSnapshotExclusive().
      const hasCompletedSyncBaseline =
        !isNeverSyncedAtSyncStart || (await syncProvider.getLastServerSeq()) > 0;
      const lastSyncedVectorClock = hasCompletedSyncBaseline
        ? ((await this.vectorClockService.getSnapshotVectorClock()) ?? null)
        : null;

      // Collected here, applied AFTER hydrateFromRemoteSync succeeds so a
      // hydration failure doesn't permanently drop discardable startup ops
      // while leaving the user without the remote snapshot.
      let startupOpIdsToDiscard: string[] = [];
      let keepPendingOps = false;

      if (hasLocalChanges) {
        // Throw LocalDataConflictError if unsynced ops contain meaningful user data
        // OR if the NgRx store has meaningful data (tasks, projects, tags, notes).
        // The store check catches provider-switch scenarios: user switches from
        // SuperSync→Dropbox, only has a config-change op (not "meaningful"), but the
        // store is full of real data that would be overwritten by old Dropbox state.
        //
        // #7985: hasMeaningfulStoreData() counts ANY task, including onboarding example
        // tasks (they carry the isExampleTask marker only on their op-log ops, not in NgRx
        // state). Derive the example task ids from the pending example-create ops and let
        // the store check ignore them, so a fresh file-based client (Dropbox/WebDAV) that
        // only has example tasks adopts remote silently instead of hitting the spurious
        // conflict dialog #7976/#7980 removed for the SuperSync path. Scope: this fires only
        // while the example create ops are still pending (a never-synced file client) —
        // exactly the reachable scenario. A real (non-example) task / non-INBOX project /
        // non-system tag / note still reads as meaningful and shows the dialog.
        const exampleTaskEntries = unsyncedOps.filter(isExampleTaskCreateOp);
        const exampleTaskIds = new Set(
          exampleTaskEntries
            .map((entry) => entry.op.entityId)
            .filter((id): id is string => id !== undefined),
        );
        const pendingOpClassification = {
          hasCompletedInitialSync: !isNeverSyncedAtSyncStart,
        };
        const discardableStartupOpIds =
          this.syncImportConflictGateService.getDiscardablePendingOpIds(
            unsyncedOps,
            pendingOpClassification,
          );
        const hasMeaningfulUserData =
          this.syncImportConflictGateService.hasMeaningfulPendingOps(
            unsyncedOps,
            pendingOpClassification,
          ) || (await this.syncLocalStateService.hasMeaningfulStoreData(exampleTaskIds));

        if (hasMeaningfulUserData) {
          // SPAP-9: before surfacing the binary USE_LOCAL/USE_REMOTE dialog, use
          // the vector clocks to decide the safe outcome by causality. Only a
          // client with genuine sync history (a populated local clock) can be
          // auto-resolved — a missing/empty local clock (provider switch, legacy
          // store-only data) still falls through to the dialog, preserving the
          // existing "genuinely can't auto-decide" behaviour.
          const localClock = await this.opLogStore.getVectorClock();
          const gate = this._classifySnapshotConflict(
            localClock,
            result.snapshotVectorClock,
          );

          if (gate === 'keep-local') {
            // Local strictly dominates the snapshot: keep local, no dialog. The
            // pending ops are left untouched so the normal upload phase ships them.
            OpLog.normal(
              'OperationLogSyncService: Local vector clock strictly ahead of remote snapshot — ' +
                'keeping local and deferring to the upload phase (no conflict dialog).',
            );
            if (result.latestServerSeq !== undefined) {
              await syncProvider.setLastServerSeq(result.latestServerSeq);
            }
            return {
              kind: 'no_new_ops',
              allOpClocks: result.allOpClocks,
              snapshotVectorClock: result.snapshotVectorClock,
            };
          }

          keepPendingOps =
            gate === 'dialog' &&
            (await canKeepPendingOnSnapshot(result, unsyncedOps, syncProvider));

          if (gate === 'dialog' && !keepPendingOps) {
            // Client has meaningful user data and clocks can't be auto-resolved -
            // show conflict dialog.
            OpLog.warn(
              `OperationLogSyncService: Client has ${unsyncedOps.length} unsynced local ops ` +
                'with meaningful user data (pending ops or store data). ' +
                'Throwing LocalDataConflictError for conflict resolution dialog.',
            );

            throw new LocalDataConflictError(
              unsyncedOps.length,
              result.snapshotState as Record<string, unknown>,
              result.snapshotVectorClock,
              lastSyncedVectorClock,
              result.remoteLastModified,
            );
          }

          // gate === 'apply-snapshot': the remote snapshot strictly dominates the
          // local clock, so local holds nothing the snapshot lacks. Adopt the
          // snapshot without a dialog by falling through to hydration below.
          startupOpIdsToDiscard = discardableStartupOpIds;
          OpLog.normal(
            keepPendingOps
              ? 'OperationLogSyncService: Catch-up snapshot — keeping pending ops on top.'
              : 'OperationLogSyncService: Remote snapshot strictly ahead of local clock — ' +
                  'applying snapshot without conflict dialog.',
          );
        } else {
          // Defer the markRejected call until hydration has succeeded — see
          // the declaration of startupOpIdsToDiscard above for rationale.
          startupOpIdsToDiscard = discardableStartupOpIds;
          // Only system/config ops AND no meaningful store data - proceed with download
          OpLog.normal(
            `OperationLogSyncService: Client has ${unsyncedOps.length} unsynced ops but no meaningful user data. ` +
              'Proceeding with snapshot download (no conflict dialog needed).',
          );
        }
      }

      // Only show confirmation for wholly fresh clients without any local changes
      if (
        !hasLocalChanges &&
        !(await this.syncLocalStateService.confirmSnapshotWithoutPendingOps(
          result,
          lastSyncedVectorClock,
        ))
      ) {
        this.snackService.open({ msg: T.F.SYNC.S.FRESH_CLIENT_SYNC_CANCELLED });
        return { kind: 'cancelled' };
      }

      const initialUnsyncedOpIds = new Set(unsyncedOps.map((entry) => entry.op.id));

      // Single-file snapshots are current through every returned recent op. Split
      // snapshots can lag behind sync-ops.json, so only the explicitly-listed
      // snapshot ops may be recorded as already applied; the remaining suffix
      // must run through normal remote-op processing before the cursor advances.
      // An absent list keeps the legacy single-file contract (all ops included).
      const { snapshotIncludedOps, postSnapshotOps } = this._partitionSnapshotOps(
        result.newOps,
        result.snapshotAppliedOpIds,
      );

      // #9074: hydration replaces local state wholesale from the downloaded
      // snapshot — the single worst write a stale cycle can make after a
      // provider/target switch (an old provider's snapshot over new state).
      this.providerManager.assertSyncEpochUnchanged(
        options?.fenceEpoch,
        'snapshot hydration',
      );
      await this.writeFlushService.flushThenRunExclusive(() =>
        this._hydrateSnapshotExclusive(
          result,
          initialUnsyncedOpIds,
          snapshotIncludedOps,
          lastSyncedVectorClock,
          keepPendingOps ? { discardOpIds: startupOpIdsToDiscard } : undefined,
        ),
      );

      // Now that the remote snapshot is applied, it's safe to drop the
      // startup ops we previously decided were obsolete. Doing this
      // after hydration ensures a hydration failure leaves the queue intact
      // so the next attempt can retry. The keep path rejected them in-transaction.
      if (!keepPendingOps) await this._discardStartupOps(startupOpIdsToDiscard);
      let suffixProcessResult: RemoteOpsProcessingResult | undefined;
      if (postSnapshotOps.length > 0) {
        suffixProcessResult = await this._processRemoteOpsWithStartupCleanup(
          postSnapshotOps,
          undefined,
          [],
          { fenceEpoch: options?.fenceEpoch },
        );
        if (suffixProcessResult.blockedByIncompatibleOp) {
          return { kind: 'blocked_incompatible' };
        }
      }
      // Kept ops were checked against the old state only; a suffix may skip
      // validation when every op in it is filtered.
      if (keepPendingOps) await this.remoteOpsProcessingService.validateAfterSync();

      // Persist lastServerSeq after hydration
      if (result.latestServerSeq !== undefined) {
        await syncProvider.setLastServerSeq(result.latestServerSeq);
      }

      OpLog.normal('OperationLogSyncService: Snapshot hydration complete.');

      return suffixProcessResult
        ? {
            kind: 'ops_processed',
            newOpsCount: postSnapshotOps.length,
            localWinOpsCreated: suffixProcessResult.localWinOpsCreated,
            allOpClocks: result.allOpClocks,
            snapshotVectorClock: result.snapshotVectorClock,
          }
        : {
            kind: 'snapshot_hydrated',
            allOpClocks: result.allOpClocks,
            snapshotVectorClock: result.snapshotVectorClock,
          };
    }

    if (result.newOps.length === 0) {
      // FIX I.2: Pre-op-log client with meaningful data on empty server. It can't
      // upload (isWhollyFreshClient blocks it), server migration won't trigger
      // (hasSyncedOps=false), and no remote ops exist to raise a conflict dialog.
      // Seed via SYNC_IMPORT. Same for a never-synced genesis client (#9863).
      const isEmptyServer = result.latestServerSeq === 0;
      if (isEmptyServer) {
        const isFresh =
          await this.syncLocalStateService.isFreshOrNeverSyncedGenesisClient(
            result.newOps,
          );
        if (isFresh && (await this.syncLocalStateService.hasMeaningfulStoreData())) {
          OpLog.warn(
            'OperationLogSyncService: Pre-op-log client with meaningful local data on empty server. ' +
              'Creating SYNC_IMPORT via server migration to seed the server.',
          );
          this.providerManager.assertSyncEpochUnchanged(
            options?.fenceEpoch,
            'empty-server migration',
          );
          const outcome = await this.serverMigrationService.handleServerMigration(
            syncProvider,
            { syncImportReason: 'SERVER_MIGRATION' },
          );
          // No SYNC_IMPORT → nothing shipped the state → skip this cycle's upload
          // (see DownloadOutcome) so the next download re-evaluates. (#9921)
          // `empty_state` is unreachable here (the gate above is a subset of the
          // seeding's own check) and would strand the genesis state, so it is
          // not exempted like in the server-reset branch.
          if (outcome.kind === 'skipped') {
            OpLog.warn(
              `OperationLogSyncService: Empty-server seeding created no SYNC_IMPORT (${outcome.reason}).`,
            );
            return { kind: 'server_migration_skipped' };
          }
          // The SYNC_IMPORT makes the client non-fresh; upload proceeds normally.
          return { kind: 'server_migration_handled' };
        }
      }

      OpLog.normal(
        'OperationLogSyncService: No new remote operations to process after download.',
      );
      // IMPORTANT: Persist lastServerSeq even when no ops - keeps client in sync with server.
      // This is safe because we're not storing any ops, so there's no risk of localStorage
      // getting ahead of IndexedDB.
      if (result.latestServerSeq !== undefined) {
        await syncProvider.setLastServerSeq(result.latestServerSeq);
      }
      return {
        kind: 'no_new_ops',
        allOpClocks: result.allOpClocks,
        snapshotVectorClock: result.snapshotVectorClock,
      };
    }

    // SAFETY: a wholly fresh client — or a never-synced genesis client on the
    // otherwise silent path (#9863) — receiving remote data for the first time.
    const isFreshClient =
      await this.syncLocalStateService.isFreshOrNeverSyncedGenesisClient(result.newOps);
    if (isFreshClient && result.newOps.length > 0) {
      if (await this.syncLocalStateService.hasMeaningfulStoreData()) {
        OpLog.warn(
          `OperationLogSyncService: Fresh client has local data and ${result.newOps.length} remote ops. Showing conflict dialog.`,
        );
        // No last-synced clock (SPAP-7) or remote snapshot (#9391) on this path.
        // Pending count: 0 when wholly fresh, >= 1 for a genesis client.
        const unsyncedCount = (await this.opLogStore.getUnsynced()).length;
        throw new LocalDataConflictError(unsyncedCount, null, undefined, null);
      }

      OpLog.warn(
        `OperationLogSyncService: Fresh client detected. Requesting confirmation before accepting ${result.newOps.length} remote ops.`,
      );

      const confirmed = this.syncLocalStateService.confirmFreshClientSync(
        result.newOps.length,
      );
      if (!confirmed) {
        OpLog.normal(
          'OperationLogSyncService: User cancelled fresh client sync. Remote data not applied.',
        );
        this.snackService.open({
          msg: T.F.SYNC.S.FRESH_CLIENT_SYNC_CANCELLED,
        });
        return { kind: 'cancelled' };
      }

      OpLog.normal(
        'OperationLogSyncService: User confirmed fresh client sync. Proceeding with remote data.',
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Check for incoming SYNC_IMPORT with conflicting local ops.
    // This prevents a deadlock where:
    // 1. Client A enables encryption → uploads SYNC_IMPORT
    // 2. Client B downloads SYNC_IMPORT, applies it (replacing state)
    // 3. Client B uploads its pending local ops (now invalid)
    // 4. Client A silently filters them → both show "in sync" but no data exchanges
    //
    // By checking BEFORE processing, we give the user a choice:
    // - USE_REMOTE: discard local ops, apply the remote SYNC_IMPORT
    // - USE_LOCAL: force upload local state (overriding remote)
    // ─────────────────────────────────────────────────────────────────────────
    // Flush in-flight captured ops before reading pending state. Without this,
    // an op enqueued in OperationCaptureService but not yet drained to
    // IndexedDB would be invisible to getUnsynced(), the gate would silently
    // accept the import, and SyncImportFilterService would then discard the
    // just-landed op as CONCURRENT.
    const incomingConflict =
      await this.syncImportConflictGateService.checkIncomingFullStateConflict(
        result.newOps,
        {
          flushPendingWrites: true,
          // Pre-download snapshot from the orchestrator (falls back to a live read here,
          // which is correct on this path: no ops are persisted until processRemoteOps).
          isNeverSynced: options?.isNeverSynced,
        },
      );
    let startupOpIdsToDiscard: string[] = [];
    let startupCleanupFullStateOpId: string | undefined;
    if (incomingConflict.fullStateOp) {
      const { fullStateOp, pendingOps, dialogData, deferredRepairOpId } =
        incomingConflict;
      // Existing synced store data is not a conflict here. Prompt only when
      // local pending user changes would be discarded; otherwise an old client
      // can accidentally force-upload stale state over the remote import.
      // (PASSWORD_CHANGED SYNC_IMPORTs without pending ops also fall through
      // to silent acceptance via this gate — the data is identical, only the
      // encryption changed.)
      if (dialogData) {
        OpLog.warn(
          `OperationLogSyncService: Incoming ${fullStateOp.opType} from client ${fullStateOp.clientId} ` +
            `with ${pendingOps.length} pending local ops. Showing conflict dialog.`,
        );

        const conflictResult = await this._handleSyncImportConflict(
          syncProvider,
          dialogData,
          'OperationLogSyncService (incoming full-state op)',
        );
        if (conflictResult === 'CANCEL') {
          return { kind: 'cancelled' };
        }
        // Validation failure (if any during USE_REMOTE force-download) is on
        // the session-validation latch — wrapper reads it. (#7330)
        return { kind: 'no_new_ops' };
      } else if (deferredRepairOpId) {
        OpLog.normal(
          `OperationLogSyncService: Deferring incoming REPAIR from client ` +
            `${fullStateOp.clientId}; ${pendingOps.length} pending local op(s) ` +
            `keep their place and this client repairs its own state instead.`,
        );
      } else {
        startupOpIdsToDiscard = incomingConflict.discardablePendingOpIds;
        startupCleanupFullStateOpId = fullStateOp.id;
        OpLog.normal(
          `OperationLogSyncService: Accepting incoming ${fullStateOp.opType} from client ` +
            `${fullStateOp.clientId} without conflict dialog; ` +
            `${pendingOps.length} pending op(s), no meaningful pending user changes.`,
        );
      }
    }

    const processResult = await this._processRemoteOpsWithStartupCleanup(
      result.newOps,
      startupCleanupFullStateOpId,
      startupOpIdsToDiscard,
      {
        repairBaseServerSeq: result.latestServerSeq,
        rebaseKeptTimeDeltas: syncProvider.providerMode === 'superSyncOps',
        ignoredLocalFullStateOpIds: options?.ignoredLocalFullStateOpIds,
        conflictRecheck: { isNeverSynced: options?.isNeverSynced },
        fenceEpoch: options?.fenceEpoch,
        ...(incomingConflict.deferredRepairOpId
          ? { deferredRepairOpId: incomingConflict.deferredRepairOpId }
          : {}),
      },
    );

    if (processResult.preApplyRepairDeferred) {
      // Cursor stays behind the repair (the persist below is skipped), so the
      // batch comes back next cycle and the gate defers the repair up front.
      OpLog.normal(
        'OperationLogSyncService: Pending work appeared before the incoming REPAIR apply; ' +
          'retrying the batch next cycle.',
      );
      return { kind: 'no_new_ops' };
    }

    if (processResult.preApplyFullStateConflict?.dialogData) {
      const { fullStateOp, pendingOps, dialogData } =
        processResult.preApplyFullStateConflict;
      OpLog.warn(
        `OperationLogSyncService: ${fullStateOp?.opType ?? 'Full-state op'} gained ` +
          `${pendingOps.length} pending local op(s) before download apply. Showing conflict dialog.`,
      );
      const conflictResult = await this._handleSyncImportConflict(
        syncProvider,
        dialogData,
        'OperationLogSyncService (incoming full-state pre-apply recheck)',
      );
      if (conflictResult === 'CANCEL') {
        return { kind: 'cancelled' };
      }
      return { kind: 'no_new_ops' };
    }

    if (processResult.blockedByIncompatibleOp) {
      return { kind: 'blocked_incompatible' };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Handle SYNC_IMPORT conflict: all remote ops filtered by STORED local import.
    // This happens when user imports/restores data locally, and other devices
    // have been creating changes without knowledge of that import.
    //
    // We show the dialog when the filtering import was created locally (source='local').
    // If the import is from another client (source='remote'), we silently
    // discard the old ops - the import was already accepted from the remote source.
    // ─────────────────────────────────────────────────────────────────────────
    if (
      processResult.allOpsFilteredBySyncImport &&
      processResult.filteredOpCount > 0 &&
      processResult.isLocalUnsyncedImport
    ) {
      OpLog.warn(
        `OperationLogSyncService: All ${processResult.filteredOpCount} remote ops filtered by local SYNC_IMPORT. ` +
          `Showing conflict resolution dialog (local import detected).`,
      );

      const conflictResult = await this._handleSyncImportConflict(
        syncProvider,
        {
          filteredOpCount: processResult.filteredOpCount,
          localImportTimestamp: processResult.filteringImport?.timestamp ?? Date.now(),
          syncImportReason: processResult.filteringImport?.syncImportReason,
          scenario: 'LOCAL_IMPORT_FILTERS_REMOTE',
        },
        'OperationLogSyncService (local SYNC_IMPORT filters remote)',
      );
      if (conflictResult === 'CANCEL') {
        return { kind: 'cancelled' };
      }
      // Validation failure (if any during USE_REMOTE force-download) is on
      // the session-validation latch — wrapper reads it. (#7330)
      return { kind: 'no_new_ops' };
    } else if (
      processResult.allOpsFilteredBySyncImport &&
      processResult.filteredOpCount > 0
    ) {
      // Ops were filtered by a remote import (from another client).
      // This is expected behavior - old ops from before a previously-accepted
      // remote import are silently discarded. No dialog needed because the
      // import was already accepted when it was downloaded.
      OpLog.normal(
        `OperationLogSyncService: ${processResult.filteredOpCount} remote ops silently filtered by ` +
          `remote SYNC_IMPORT (not showing dialog - import came from another client).`,
      );
    }

    // IMPORTANT: Persist lastServerSeq AFTER ops are stored in IndexedDB.
    // This ensures localStorage and IndexedDB stay in sync. If we crash before this point,
    // lastServerSeq won't be updated, and the client will re-download the ops on next sync.
    // This is the correct behavior - better to re-download than to skip ops.
    // A version/migration block keeps the cursor behind the blocked op so it is
    // re-downloaded and retried after an app update instead of skipped forever.
    if (processResult.deferredRepairHealFailed) {
      // The substitute local heal after deferring an incoming REPAIR failed:
      // state is still invalid and the deferred snapshot is the one known fix.
      // Skip ONLY the cursor persist so the next cycle re-downloads the repair
      // — once this cycle's uploads are acknowledged the gate stops deferring
      // it and applies it (see the piggyback-path twin). Everything else
      // proceeds normally; re-downloaded ops are deduped by appliedOpIds, and
      // the session-validation latch already reports the failure (sync shows
      // ERROR).
      OpLog.err(
        'OperationLogSyncService: Local heal after deferring an incoming REPAIR failed; ' +
          'keeping the cursor behind the repair for retry.',
      );
    } else if (result.latestServerSeq !== undefined) {
      await syncProvider.setLastServerSeq(result.latestServerSeq);
    }

    // Update pending ops status for UI indicator
    const pendingOps = await this.opLogStore.getUnsynced();
    this.superSyncStatusService.updatePendingOpsStatus(pendingOps.length > 0);

    // Detect (warn-only) an encryption-state mismatch — never auto-disable local encryption
    await this.warnOnEncryptionStateMismatch(
      syncProvider,
      result.serverHasOnlyUnencryptedData,
    );

    return {
      kind: 'ops_processed',
      newOpsCount: result.newOps.length,
      localWinOpsCreated: processResult.localWinOpsCreated,
      allOpClocks: result.allOpClocks,
      snapshotVectorClock: result.snapshotVectorClock,
    };
  }

  private async _processRemoteOpsWithStartupCleanup(
    remoteOps: Operation[],
    fullStateOpId: string | undefined,
    startupOpIds: string[],
    options?: {
      repairBaseServerSeq?: number;
      rebaseKeptTimeDeltas?: boolean;
      ignoredLocalFullStateOpIds?: readonly string[];
      conflictRecheck?: {
        isNeverSynced?: boolean;
        preCapturedPendingOps?: OperationLogEntry[];
      };
      /** Sync epoch captured at cycle start (#9074); fences the apply. */
      fenceEpoch?: number;
      /** Causal REPAIR the gate deferred; dropped from this batch (#9773). */
      deferredRepairOpId?: string;
    },
  ): Promise<GuardedRemoteOpsProcessingResult> {
    const startupOpIdsToDiscard = new Set(startupOpIds);
    let preApplyFullStateConflict: IncomingFullStateConflictGateResult | undefined;
    let preApplyRepairDeferred = false;
    let deferredRepairHealFailed = false;
    // Drop the deferred repair, then treat the rest of the batch as ordinary
    // remote ops. The snapshot is not lost work: this client already applies
    // every op the repair was built from, so only the correction itself is
    // skipped — and the post-apply validation below recomputes that locally.
    const opsToProcess = options?.deferredRepairOpId
      ? remoteOps.filter((op) => op.id !== options.deferredRepairOpId)
      : remoteOps;
    try {
      const conflictRecheck = options?.conflictRecheck;
      const beforeFullStateApply = conflictRecheck
        ? async (fullStateOps: Operation[]): Promise<boolean> => {
            const conflict =
              await this.syncImportConflictGateService.checkIncomingFullStateConflict(
                fullStateOps,
                {
                  isNeverSynced: conflictRecheck.isNeverSynced,
                  preCapturedPendingOps: conflictRecheck.preCapturedPendingOps,
                },
              );
            for (const opId of conflict.discardablePendingOpIds) {
              startupOpIdsToDiscard.add(opId);
            }
            if (conflict.deferredRepairOpId) {
              // Too late to drop the repair from this batch — it is already
              // partitioned for a wholesale apply. Block the apply and leave
              // the cursor behind it; the next cycle's gate check runs before
              // partitioning and defers it properly (#9773).
              preApplyRepairDeferred = true;
              return false;
            }
            if (conflict.dialogData) {
              preApplyFullStateConflict = conflict;
              return false;
            }
            return true;
          }
        : undefined;
      const result = await this.repairSyncContext.runWithBaseServerSeq(
        options?.repairBaseServerSeq,
        async () => {
          const processed = await this.remoteOpsProcessingService.processRemoteOps(
            opsToProcess,
            {
              ...(options?.ignoredLocalFullStateOpIds?.length
                ? {
                    ignoredLocalFullStateOpIds: options.ignoredLocalFullStateOpIds,
                  }
                : {}),
              ...(beforeFullStateApply ? { beforeFullStateApply } : {}),
              ...(options?.rebaseKeptTimeDeltas ? { rebaseKeptTimeDeltas: true } : {}),
              ...(options?.fenceEpoch !== undefined
                ? { fenceEpoch: options.fenceEpoch }
                : {}),
            },
          );
          if (options?.deferredRepairOpId && !preApplyRepairDeferred) {
            // Heal even when the deferred repair was the only op. Keep its causal
            // server context so receivers preserve their concurrent work.
            deferredRepairHealFailed =
              !(await this.remoteOpsProcessingService.validateAfterSync());
          }
          return processed;
        },
      );
      if (
        result.fullStateApplyBlockedByLocalConflict &&
        !preApplyFullStateConflict?.dialogData &&
        !preApplyRepairDeferred
      ) {
        throw new Error(
          'Full-state apply was blocked without conflict data for resolution.',
        );
      }
      await this._discardStartupOpsIfFullStateCommitted(
        fullStateOpId,
        [...startupOpIdsToDiscard],
        result.committedFullStateOpIds,
      );
      return {
        ...result,
        ...(preApplyFullStateConflict ? { preApplyFullStateConflict } : {}),
        ...(preApplyRepairDeferred ? { preApplyRepairDeferred } : {}),
        ...(deferredRepairHealFailed ? { deferredRepairHealFailed } : {}),
      };
    } catch (error) {
      try {
        // The reducer/apply transaction can commit the full-state op before a
        // later validation or deferred-action drain throws. Query persistence
        // so obsolete startup ops cannot replay after an already-applied import.
        await this._discardStartupOpsIfFullStateCommitted(
          fullStateOpId,
          [...startupOpIdsToDiscard],
          [],
          true,
        );
      } catch (cleanupError) {
        // Preserve the primary processing error. A later retry can re-check and
        // clean up once persistence is available again.
        OpLog.err(
          'OperationLogSyncService: Failed to verify startup-op cleanup after remote processing error.',
          { name: (cleanupError as Error | undefined)?.name },
        );
      }
      throw error;
    }
  }

  private _partitionSnapshotOps(
    ops: Operation[],
    snapshotAppliedOpIds: string[] | undefined,
  ): { snapshotIncludedOps: Operation[]; postSnapshotOps: Operation[] } {
    return partitionSnapshotOps(ops, snapshotAppliedOpIds);
  }

  /**
   * Body of the exclusive file-snapshot hydration section: hydrates the remote
   * snapshot while user actions are deferred, persists the buffered intents on
   * top of it, and replays their archive side effects. Runs inside
   * `writeFlushService.flushThenRunExclusive` — no other op-log writer can
   * interleave.
   */
  private async _hydrateSnapshotExclusive(
    result: {
      snapshotState?: unknown;
      snapshotVectorClock?: Record<string, number>;
      remoteLastModified?: number;
    },
    initialUnsyncedOpIds: Set<string>,
    snapshotIncludedOps: Operation[],
    // Baseline decision captured by the caller before the snapshot attempt, so
    // the late-durable-op conflict below classifies never-synced clients the
    // same way as the pre-hydration conflict gate (#9166).
    lastSyncedVectorClock: Record<string, number> | null,
    // #10972: keep pending ops on top; `discardOpIds` are startup ops to drop.
    keepPending?: { discardOpIds: readonly string[] },
  ): Promise<void> {
    let deferredActionsOverwrittenBySnapshot: ReturnType<typeof getDeferredActions> = [];
    let didReplaceArchive = false;
    let didCommitStateLoad = false;
    let hydrationFailed = false;
    let hydrationError: unknown;
    let isRemoteApplyWindowOpen = true;
    // Keep capture in deferred mode from the last pre-hydration durability
    // check through the snapshot dispatch. Otherwise an action can be
    // persisted against the old state and then silently overwritten by
    // loadAllData while this async hydration is in progress.
    this.hydrationState.startApplyingRemoteOps();
    try {
      try {
        const pendingAtHydrationCutoff = await this.opLogStore.getUnsynced();
        const lateDurableOps = pendingAtHydrationCutoff.filter(
          (entry) => !initialUnsyncedOpIds.has(entry.op.id),
        );
        const keepsLate =
          keepPending && !lateDurableOps.some((e) => isFullStateOpType(e.op.opType));
        if (lateDurableOps.length > 0 && !keepsLate) {
          throw new LocalDataConflictError(
            pendingAtHydrationCutoff.length,
            result.snapshotState as Record<string, unknown>,
            result.snapshotVectorClock,
            lastSyncedVectorClock,
            result.remoteLastModified,
          );
        }

        // Hydrate state from snapshot. No SYNC_IMPORT is created, so
        // concurrent ops from other clients are not clean-slate filtered.
        await this.syncHydrationService.hydrateFromRemoteSync(
          result.snapshotState as Record<string, unknown>,
          result.snapshotVectorClock,
          {
            snapshotIncludedOps,
            // Capture only actions that ran on the old state. Actions emitted
            // by loadAllData effects run after the snapshot reducer and are
            // already valid on top of the new state, so replaying those would
            // double-apply additive reducers.
            beforeStateLoad: () => {
              deferredActionsOverwrittenBySnapshot = getDeferredActions();
            },
            afterStateLoad: () => {
              didCommitStateLoad = true;
            },
            afterArchiveReplacement: () => {
              didReplaceArchive = true;
            },
            keepPendingOps: keepPending,
          },
        );
        if (keepPending && didCommitStateLoad) {
          const { opLogStore, operationApplier, snackService, tabSeqFrontier } = this;
          const deps = { opLogStore, operationApplier, snackService, tabSeqFrontier };
          await reapplyKeptPendingOps(deps);
        }
      } catch (error) {
        hydrationFailed = true;
        hydrationError = error;
      }

      // The file snapshot baseline transaction either committed state, clock,
      // archives, and included remote ops together or left the old baseline
      // intact. Deferred intents therefore always drain against a complete
      // frontier, including when hydration failed before live-state dispatch.
      await this._processSnapshotDeferredActionsWithRetry();

      if (didCommitStateLoad) {
        // Persistent actions dispatched before loadAllData already ran once on
        // the old NgRx state. Re-dispatch remote-marked clones synchronously on
        // top of the snapshot without capturing a second operation.
        for (const action of deferredActionsOverwrittenBySnapshot) {
          this.store.dispatch({
            ...action,
            meta: {
              ...action.meta,
              isRemote: true,
            },
          });
        }
      }

      if (didReplaceArchive) {
        // Hydration also replaces archive stores. Re-run archive side effects
        // for every local intent created since the cutoff, in durable seq order.
        // Keep looping until both the deferred queue and durable archive work
        // are empty. The final queue check and remote-window close are
        // synchronous, so an action cannot land in the handoff gap.
        // Kept pending ops lost their archive effects with the old archive too.
        const restoredLocalOpIds = new Set(keepPending ? [] : initialUnsyncedOpIds);
        while (true) {
          while (getDeferredActions().length > 0) {
            await this._processSnapshotDeferredActionsWithRetry();
          }

          const localOpsNeedingArchiveRestore = (await this.opLogStore.getUnsynced())
            .filter((entry) => !restoredLocalOpIds.has(entry.op.id))
            .sort((a, b) => a.seq - b.seq)
            .map((entry) => entry.op);
          if (localOpsNeedingArchiveRestore.length === 0) {
            if (getDeferredActions().length > 0) continue;
            this.hydrationState.endApplyingRemoteOps();
            isRemoteApplyWindowOpen = false;
            break;
          }

          const applyResult = await this.operationApplier.applyOperations(
            localOpsNeedingArchiveRestore,
            {
              isLocalHydration: false,
              skipDeferredLocalActions: true,
              skipReducerDispatch: true,
              remoteApplyWindowAlreadyOpen: true,
            },
          );
          if (
            applyResult.failedOp ||
            applyResult.appliedOps.length !== localOpsNeedingArchiveRestore.length
          ) {
            throw new Error(
              'Snapshot hydration incomplete: local archive changes could not be restored.',
            );
          }
          for (const op of localOpsNeedingArchiveRestore) {
            restoredLocalOpIds.add(op.id);
          }
        }
      } else {
        while (getDeferredActions().length > 0) {
          await this._processSnapshotDeferredActionsWithRetry();
        }
        this.hydrationState.endApplyingRemoteOps();
        isRemoteApplyWindowOpen = false;
      }

      if (hydrationFailed) throw hydrationError;
    } finally {
      if (isRemoteApplyWindowOpen) {
        this.hydrationState.endApplyingRemoteOps();
      }
    }
  }

  private async _processSnapshotDeferredActionsWithRetry(): Promise<void> {
    try {
      await processDeferredActions(this.injector, true);
    } catch (error) {
      OpLog.warn(
        'OperationLogSyncService: deferred snapshot action drain failed; retrying once',
        { name: (error as Error | undefined)?.name },
      );
      await processDeferredActions(this.injector, true);
    }
  }

  private async _discardStartupOpsIfFullStateCommitted(
    fullStateOpId: string | undefined,
    startupOpIds: string[],
    committedFullStateOpIds: string[] = [],
    acceptReducerCommittedFailureStatus: boolean = false,
  ): Promise<void> {
    if (!fullStateOpId || startupOpIds.length === 0) {
      return;
    }

    const applicationStatus = (await this.opLogStore.getOpById(fullStateOpId))
      ?.applicationStatus;
    const isCommitted =
      committedFullStateOpIds.includes(fullStateOpId) ||
      applicationStatus === 'applied' ||
      (acceptReducerCommittedFailureStatus &&
        (applicationStatus === 'archive_pending' || applicationStatus === 'failed'));
    if (isCommitted) {
      await this._discardStartupOps(startupOpIds);
    }
  }

  /**
   * Rejects startup-only ops so they are NOT uploaded after an authoritative remote
   * state is accepted silently. They were already excluded from the conflict gate's
   * "meaningful work" check (see SyncImportConflictGateService); rejecting them keeps
   * the op-log consistent with the just-applied remote data.
   *
   * These ids always come from getUnsynced() (local pending ops, never remote ops),
   * so a remote startup marker can never reach this path.
   */
  private async _discardStartupOps(opIds: string[]): Promise<void> {
    if (opIds.length > 0) {
      await this.opLogStore.markRejected(opIds);
    }
  }

  /**
   * SPAP-9: classify a seq-0 file-based snapshot conflict by causality so we can
   * avoid the binary USE_LOCAL/USE_REMOTE dialog when the vector clocks make the
   * safe outcome unambiguous.
   *
   * Comparison direction is snapshot-vs-local:
   * - GREATER_THAN / EQUAL → remote strictly ahead (or identical): apply snapshot.
   * - LESS_THAN            → local strictly ahead: keep local, upload later.
   * - CONCURRENT           → true divergence: show the conflict dialog.
   *
   * A missing or empty local clock means a client with no genuine sync history
   * (provider switch, legacy store-only data). Such a client cannot be
   * auto-resolved, so it keeps the existing dialog behaviour — mirroring the
   * fresh-client throws elsewhere in this method.
   */
  private _classifySnapshotConflict(
    localClock: VectorClock | null | undefined,
    snapshotClock: Record<string, number> | undefined,
  ): 'apply-snapshot' | 'keep-local' | 'dialog' {
    if (
      !localClock ||
      isVectorClockEmpty(localClock) ||
      !snapshotClock ||
      isVectorClockEmpty(snapshotClock)
    ) {
      return 'dialog';
    }

    switch (compareVectorClocks(snapshotClock, localClock)) {
      case 'GREATER_THAN':
      case 'EQUAL':
        return 'apply-snapshot';
      case 'LESS_THAN':
        return 'keep-local';
      case 'CONCURRENT':
        return 'dialog';
    }
  }

  /**
   * Shows the SYNC_IMPORT conflict dialog and executes the user's chosen action.
   *
   * This consolidates the repeated dialog + switch pattern used when a SYNC_IMPORT
   * conflicts with local data (piggybacked upload, incoming download, or local
   * import filtering remote ops).
   *
   * @param syncProvider - The sync provider to use for force upload/download
   * @param dialogData - Data passed to the conflict dialog
   * @param logPrefix - Prefix for log messages to identify the calling context
   * @returns The user's resolution choice after the action has been executed
   */
  private async _handleSyncImportConflict(
    syncProvider: OperationSyncCapable,
    dialogData: SyncImportConflictData,
    logPrefix: string,
  ): Promise<SyncImportConflictResolution> {
    return this.syncImportConflictCoordinator.handleSyncImportConflict(
      dialogData,
      logPrefix,
      {
        useLocal: () => this.forceUploadLocalState(syncProvider),
        useRemote: () => this.forceDownloadRemoteState(syncProvider),
      },
    );
  }

  /**
   * Force upload local state as a SYNC_IMPORT, replacing all remote data.
   * This is used when user explicitly chooses "USE_LOCAL" in conflict resolution.
   *
   * Unlike server migration, this does NOT check if server is empty - it always
   * creates a SYNC_IMPORT to override remote state with local state.
   *
   * @param syncProvider - The sync provider to upload to
   */
  async forceUploadLocalState(
    syncProvider: OperationSyncCapable,
  ): Promise<ForceUploadResult> {
    return this.syncImportConflictCoordinator.forceUploadLocalState(syncProvider);
  }

  /**
   * Force download all remote state, replacing local data (USE_REMOTE).
   * Kept here as the entry point; the rebuild lives in
   * {@link RemoteStateRebuildService.forceDownloadRemoteState}.
   */
  async forceDownloadRemoteState(
    syncProvider: OperationSyncCapable,
    options?: { isCrashResume?: boolean },
  ): Promise<void> {
    return this.remoteStateRebuild.forceDownloadRemoteState(syncProvider, options);
  }

  private async _flushLocalWritesIncludingDeferredActions(): Promise<void> {
    await this.writeFlushService.flushPendingWrites();
    await processDeferredActions(this.injector, false);
    // Deferred writes are awaited directly, but this second barrier also
    // catches ordinary actions dispatched while their drain was running.
    await this.writeFlushService.flushPendingWrites();
  }

  private async _assertNoIncompleteRemoteOperations(): Promise<void> {
    const state = await this._readIncompleteRemoteOperationsState();
    if (!state.isBlocked) {
      return;
    }

    // One in-session repair attempt when the ONLY blockers are quarantined
    // archive failures: their reducers already committed, and the archive-only
    // retry is idempotent (ARCHIVE_AFFECTING_ACTION_TYPES invariant). Without
    // this, a transient archive failure wedges sync until the next app start —
    // the error snack's "restart" advice — even though a retry would succeed
    // immediately. Never attempted while a raw rebuild is incomplete or
    // reducer-uncommitted `pending` rows exist (retrying those would be wrong).
    if (!state.isRawRebuildIncomplete && state.pendingCount === 0) {
      await this.injector.get(OperationLogHydratorService).retryFailedRemoteOps();
      const recheck = await this._readIncompleteRemoteOperationsState();
      if (!recheck.isBlocked) {
        OpLog.normal(
          'OperationLogSyncService: In-session archive retry cleared the incomplete-remote gate.',
        );
        return;
      }
    }

    throw new IncompleteRemoteOperationsError();
  }

  private async _readIncompleteRemoteOperationsState(): Promise<{
    isBlocked: boolean;
    isRawRebuildIncomplete: boolean;
    pendingCount: number;
    failedCount: number;
  }> {
    const [isRawRebuildIncomplete, pendingRemoteOps, failedRemoteOps] = await Promise.all(
      [
        this.opLogStore.isRawRebuildIncomplete(),
        this.opLogStore.getPendingRemoteOps(),
        this.opLogStore.getFailedRemoteOps(),
      ],
    );
    return {
      isBlocked:
        isRawRebuildIncomplete ||
        pendingRemoteOps.length > 0 ||
        failedRemoteOps.length > 0,
      isRawRebuildIncomplete,
      pendingCount: pendingRemoteOps.length,
      failedCount: failedRemoteOps.length,
    };
  }

  private async _resumeInterruptedRawRebuild(
    syncProvider: OperationSyncCapable,
    flushLocalWrites: boolean,
  ): Promise<void> {
    OpLog.warn(
      'OperationLogSyncService: Interrupted USE_REMOTE rebuild detected — redoing the raw rebuild.',
    );
    try {
      if (flushLocalWrites) {
        // Flush belongs inside the recovery boundary: if persistence is still
        // unhealthy, the pre-replace backup is the only safe rollback and its
        // Undo affordance must remain visible.
        await this._flushLocalWritesIncludingDeferredActions();
      }
      await this.forceDownloadRemoteState(syncProvider, { isCrashResume: true });
    } catch (error) {
      // The prior attempt already committed the destructive baseline (that is
      // why we are resuming), so the user's original data now lives only in
      // the pre-replace backup. If this resume cannot finish — empty/newer-
      // schema remote, or a persistent download failure — forceDownloadRemoteState
      // throws in its download/validate phase, before it can offer Undo, and
      // the backup would otherwise stay stranded with no restore affordance.
      await this.remoteStateRebuild.offerStrandedRebuildBackup();
      throw error;
    }
  }

  /** See {@link RemoteStateRebuildService.offerInterruptedRebuildRecovery}. */
  async offerInterruptedRebuildRecovery(): Promise<void> {
    return this.remoteStateRebuild.offerInterruptedRebuildRecovery();
  }

  /**
   * Detects an encryption-state mismatch: the server has only unencrypted data
   * while local config has encryption enabled. Detect-and-warn ONLY — it never
   * mutates config. The "server is unencrypted" signal is attacker-controllable
   * (GHSA-vrc7-775g-ggqc), so adopting a plaintext remote must be a deliberate
   * user action in Sync settings, never an automatic downgrade. The download
   * path additionally fails closed on the plaintext blob itself
   * (PlaintextWhenEncryptionExpectedError).
   *
   * @param syncProvider - The sync provider to check
   * @param serverHasOnlyUnencryptedData - Whether all downloaded/piggybacked ops were unencrypted
   */
  async warnOnEncryptionStateMismatch(
    syncProvider: OperationSyncCapable,
    serverHasOnlyUnencryptedData: boolean | undefined,
  ): Promise<void> {
    // No detection possible if we didn't download any ops
    if (!serverHasOnlyUnencryptedData) {
      return;
    }

    // Check if local config has encryption enabled
    const localEncryptKey = syncProvider.getEncryptKey
      ? await syncProvider.getEncryptKey()
      : undefined;

    // No mismatch if local config also has no encryption
    if (!localEncryptKey) {
      return;
    }

    // Mismatch detected: server has only unencrypted data but local has encryption enabled.
    //
    // GHSA-vrc7-775g-ggqc: NEVER auto-disable encryption to match a plaintext
    // server. The "server is unencrypted" signal is attacker-controllable — a
    // compromised remote or a MITM can strip encryption — so silently flipping
    // the user's encryption setting off to match it is a downgrade that would
    // leak subsequent uploads as plaintext. Encryption reflects the user's
    // explicit intent; adopting a plaintext remote must be a deliberate action
    // in Sync settings, never an automatic reaction. This was already the
    // behavior for SuperSync (mandatory encryption); it now applies to every
    // provider. The download path additionally fails closed on the plaintext
    // blob itself (PlaintextWhenEncryptionExpectedError).
    OpLog.warn(
      'OperationLogSyncService: Encryption state mismatch detected — server has ' +
        'only unencrypted data but local encryption is enabled. NOT auto-disabling; ' +
        'the user must change this in Sync settings if intended.',
    );
  }
}
