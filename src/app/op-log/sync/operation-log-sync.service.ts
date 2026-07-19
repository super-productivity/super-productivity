import { inject, Injectable, Injector } from '@angular/core';
import { Store } from '@ngrx/store';
import { planSnapshotHydration } from '@sp/sync-core';
import {
  VectorClock,
  compareVectorClocks,
  isVectorClockEmpty,
  mergeVectorClocks,
} from '../../core/util/vector-clock';
import { FILE_BASED_SYNC_CONSTANTS } from '../sync-providers/file-based/file-based-sync.types';
import {
  ImportBackupRef,
  OperationLogStoreService,
} from '../persistence/operation-log-store.service';
import { BackupService } from '../backup/backup.service';
import { OpLog } from '../../core/log';
import {
  OperationSyncCapable,
  SyncProviderBase,
} from '../sync-providers/provider.interface';
import { SyncProviderId } from '../sync-providers/provider.const';
import { OperationLogUploadService } from './operation-log-upload.service';
import { DownloadOutcome, UploadOutcome } from '../core/types/sync-results.types';
import { OperationLogDownloadService } from './operation-log-download.service';
import { SnackService } from '../../core/snack/snack.service';
import { T } from '../../t.const';
import {
  CaptureRacedRebuildError,
  IncompleteRemoteOperationsError,
  LocalDataConflictError,
} from '../core/errors/sync-errors';
import { SuperSyncStatusService } from './super-sync-status.service';
import { ServerMigrationService } from './server-migration.service';
import { OperationWriteFlushService } from './operation-write-flush.service';
import { RepairSyncContextService } from '../validation/repair-sync-context.service';
import { RemoteOpsProcessingService } from './remote-ops-processing.service';
import { ConflictJournalService } from './conflict-journal.service';
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
import {
  CURRENT_SCHEMA_VERSION,
  MIN_SUPPORTED_SCHEMA_VERSION,
  SchemaMigrationService,
  getOperationSchemaVersion,
} from '../persistence/schema-migration.service';
import { OperationLogHydratorService } from '../persistence/operation-log-hydrator.service';
import { SyncProviderManager } from '../sync-providers/provider-manager.service';
import { getDefaultMainModelData, MODEL_CONFIGS } from '../model/model-config';
import { loadAllData } from '../../root-store/meta/load-all-data.action';
import { SyncLocalStateService } from './sync-local-state.service';
import {
  ForceUploadResult,
  SyncImportConflictCoordinatorService,
} from './sync-import-conflict-coordinator.service';
import { isExampleTaskCreateOp } from '../validation/is-example-task-op.util';
import { Operation, OperationLogEntry } from '../core/operation.types';
import { ValidateStateService } from '../validation/validate-state.service';
import { extractEntityKeysFromState } from '../persistence/extract-entity-keys';
import { firstValueFrom } from 'rxjs';
import { selectSyncConfig } from '../../features/config/store/global-config.reducer';
import {
  applyLocalOnlySyncSettingsToAppData,
  LocalOnlySyncSettings,
  stripLocalOnlySyncSettingsFromAppData,
} from '../../features/config/local-only-sync-settings.util';
import { DEFAULT_GLOBAL_CONFIG } from '../../features/config/default-global-config.const';
import { OperationApplierService } from '../apply/operation-applier.service';
import { processDeferredActions } from './process-deferred-actions-flush.util';
import { HydrationStateService } from '../apply/hydration-state.service';
import { getDeferredActions } from '../capture/operation-capture.meta-reducer';

type RemoteOpsProcessingResult = Awaited<
  ReturnType<RemoteOpsProcessingService['processRemoteOps']>
>;

type GuardedRemoteOpsProcessingResult = RemoteOpsProcessingResult & {
  preApplyFullStateConflict?: IncomingFullStateConflictGateResult;
};

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
  private backupService = inject(BackupService);
  private uploadService = inject(OperationLogUploadService);
  private downloadService = inject(OperationLogDownloadService);
  private snackService = inject(SnackService);
  private superSyncStatusService = inject(SuperSyncStatusService);
  private serverMigrationService = inject(ServerMigrationService);
  private writeFlushService = inject(OperationWriteFlushService);
  private schemaMigrationService = inject(SchemaMigrationService);
  private validateStateService = inject(ValidateStateService);
  private repairSyncContext = inject(RepairSyncContextService);

  // Extracted services
  private remoteOpsProcessingService = inject(RemoteOpsProcessingService);
  private conflictJournalService = inject(ConflictJournalService);
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

  /**
   * Once-per-session latch for the USE_REMOTE newer-schema snack: the block
   * persists until an app update, and every auto/WS-triggered resume attempt
   * re-hits the preflight — without the latch the snack re-fires each time.
   */
  private _hasWarnedRebuildVersionBlockThisSession = false;

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
        const { fullStateOp, pendingOps, dialogData } = piggybackedConflict;

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
          conflictRecheck: {
            isNeverSynced: isNeverSyncedAtSyncStart,
            preCapturedPendingOps: result.selectedPendingOps ?? [],
          },
          fenceEpoch: options?.fenceEpoch,
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
      if (result.lastServerSeqToPersist !== undefined) {
        await syncProvider.setLastServerSeq(result.lastServerSeqToPersist);
      }
    }

    const pendingAcknowledgementSeqs = result.pendingAcknowledgementSeqs ?? [];
    if (pendingAcknowledgementSeqs.length > 0) {
      // #9074: the deferred ack is a local persist — a stale cycle must not
      // mark ops synced after a destructive config change (they'd never
      // re-upload to the new epoch's target).
      this.providerManager.assertSyncEpochUnchanged(
        options?.fenceEpoch,
        'deferred acknowledgement',
      );
      await this.opLogStore.markSynced(pendingAcknowledgementSeqs);
    }

    // STEP 2: Handle server-rejected operations
    // handleRejectedOps may create merged ops for concurrent modifications.
    // These need to be uploaded, so we add them to localWinOpsCreated.
    // Pass a download callback so the handler can trigger downloads for concurrent mods.
    //
    // NOTE: This must NOT run after a SYNC_IMPORT conflict dialog resolution (USE_LOCAL,
    // USE_REMOTE, CANCEL) — those paths return early above to avoid stale rejection handling.
    const downloadCallback = async (downloadOptions?: {
      forceFromSeq0?: boolean;
      ignoredLocalFullStateOpIds?: string[];
    }): Promise<DownloadResultForRejection> => {
      const outcome = await this.downloadRemoteOps(syncProvider, {
        ...downloadOptions,
        isNeverSynced: isNeverSyncedAtSyncStart,
        ...(options?.fenceEpoch !== undefined ? { fenceEpoch: options.fenceEpoch } : {}),
      });
      const latestServerSeq = await syncProvider.getLastServerSeq();
      // Validation failure (if any during the nested download) is on the
      // session-validation latch — no need to thread the boolean back. (#7330)
      switch (outcome.kind) {
        case 'ops_processed':
          return {
            kind: 'completed',
            newOpsCount: outcome.newOpsCount,
            allOpClocks: outcome.allOpClocks,
            snapshotVectorClock: outcome.snapshotVectorClock,
            latestServerSeq,
          };
        case 'no_new_ops':
        case 'snapshot_hydrated':
          return {
            kind: 'completed',
            newOpsCount: 0,
            allOpClocks: outcome.allOpClocks,
            snapshotVectorClock: outcome.snapshotVectorClock,
            latestServerSeq,
          };
        case 'server_migration_handled':
          return { kind: 'completed', newOpsCount: 0 };
        case 'cancelled':
          return { kind: 'cancelled' };
        case 'blocked_incompatible':
          throw new Error('Nested download blocked by an incompatible remote operation.');
      }
    };
    try {
      // #9074: the rejection handler appends merged/local-win ops and flips
      // rejection markers — old-epoch writes that would resurrect data around
      // a clean-slate replacement.
      this.providerManager.assertSyncEpochUnchanged(
        options?.fenceEpoch,
        'rejected-ops handling',
      );
      rejectionResult = await this.rejectedOpsHandlerService.handleRejectedOps(
        result.rejectedOps,
        downloadCallback,
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

    // Check for encryption state mismatch in piggybacked ops (another client disabled encryption)
    await this.handleEncryptionStateMismatch(
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
      isNeverSynced?: boolean;
      ignoredLocalFullStateOpIds?: string[];
      /** Sync epoch captured at cycle start (#9074); fences local writes. */
      fenceEpoch?: number;
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

    // Server migration detected: gap on empty server
    // Create a SYNC_IMPORT operation with full local state to seed the new server
    if (result.needsFullStateUpload) {
      // #9074: appends a SYNC_IMPORT locally — old-epoch state must not seed
      // the new epoch's server.
      this.providerManager.assertSyncEpochUnchanged(
        options?.fenceEpoch,
        'server migration',
      );
      await this.serverMigrationService.handleServerMigration(syncProvider);
      // Persist lastServerSeq=0 for the migration case (server was reset)
      if (result.latestServerSeq !== undefined) {
        await syncProvider.setLastServerSeq(result.latestServerSeq);
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
      if (hydrationPlan.shouldSkipHydration) {
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

      // Collected here, applied AFTER hydrateFromRemoteSync succeeds so a
      // hydration failure doesn't permanently drop discardable startup ops
      // while leaving the user without the remote snapshot.
      let startupOpIdsToDiscard: string[] = [];

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
        // Nothing from this sync is persisted yet, so this live read reflects
        // whether the client completed a prior sync cycle.
        const isNeverSyncedAtSyncStart =
          options?.isNeverSynced ?? !(await this.opLogStore.hasSyncedOps());
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
          ) || this.syncLocalStateService.hasMeaningfulStoreData(exampleTaskIds);

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
            FILE_BASED_SYNC_CONSTANTS.AUTO_MERGE_CONCURRENT_SNAPSHOT,
          );

          // The local snapshot's vector clock is this client's last-synced
          // baseline: unsynced ops sit on top of it, so the dialog can compute
          // changes-since-last-sync as a per-client delta instead of summing
          // the whole (lifetime) clock (SPAP-7). Undefined snapshot → null.
          const lastSyncedVectorClock =
            (await this.vectorClockService.getSnapshotVectorClock()) ?? null;

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

          if (gate === 'merge') {
            const mergeOutcome = await this._tryConcurrentSnapshotMerge(
              result,
              syncProvider,
              localClock,
            );
            if (mergeOutcome) {
              return mergeOutcome;
            }
            // Merge could not run (divergence lives only in the compacted
            // snapshot, no incremental ops to LWW-merge). Surface the dialog
            // rather than silently picking a side.
            OpLog.warn(
              'OperationLogSyncService: CONCURRENT snapshot with no incremental remote ops to merge — ' +
                'falling back to the conflict resolution dialog.',
            );
            throw new LocalDataConflictError(
              unsyncedOps.length,
              result.snapshotState as Record<string, unknown>,
              result.snapshotVectorClock,
              lastSyncedVectorClock,
              result.remoteLastModified,
            );
          }

          if (gate === 'dialog') {
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
            'OperationLogSyncService: Remote snapshot strictly ahead of local clock — ' +
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
      if (!hasLocalChanges) {
        const isFreshClient = await this.isWhollyFreshClient();

        // CRITICAL FIX: Even if op-log is empty, check if NgRx store has meaningful data.
        // This catches data that existed before the operation-log feature was added.
        if (isFreshClient && this.syncLocalStateService.hasMeaningfulStoreData()) {
          OpLog.warn(
            'OperationLogSyncService: Fresh client detected with meaningful local data in store. ' +
              'Throwing LocalDataConflictError for conflict resolution dialog.',
          );

          // Fresh client (no unsynced ops, no prior sync) — there is no
          // last-synced clock, so pass null explicitly (SPAP-7).
          throw new LocalDataConflictError(
            0, // No unsynced ops, but we have meaningful store data
            result.snapshotState as Record<string, unknown>,
            result.snapshotVectorClock,
            null,
            result.remoteLastModified,
          );
        }

        // Original flow for truly fresh clients (no store data)
        if (isFreshClient) {
          OpLog.warn(
            'OperationLogSyncService: Fresh client detected. Requesting confirmation before accepting snapshot.',
          );

          const confirmed = this.syncLocalStateService.confirmFreshClientSync(1); // Show as "1 snapshot"
          if (!confirmed) {
            OpLog.normal(
              'OperationLogSyncService: User cancelled fresh client sync. Snapshot not applied.',
            );
            this.snackService.open({
              msg: T.F.SYNC.S.FRESH_CLIENT_SYNC_CANCELLED,
            });
            return { kind: 'cancelled' };
          }

          OpLog.normal(
            'OperationLogSyncService: User confirmed fresh client sync. Proceeding with snapshot.',
          );
        }
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
        this._hydrateSnapshotExclusive(result, initialUnsyncedOpIds, snapshotIncludedOps),
      );

      // Now that the remote snapshot is applied, it's safe to drop the
      // startup ops we previously decided were obsolete. Doing this
      // after hydration ensures a hydration failure leaves the queue intact
      // so the next attempt can retry.
      await this._discardStartupOps(startupOpIdsToDiscard);

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
      // FIX I.2: Pre-op-log client with meaningful data on empty server.
      // A client that has tasks/projects in NgRx but no op-log history can't upload
      // (isWhollyFreshClient blocks upload) and server migration won't trigger
      // (hasSyncedOps=false). With an empty server, there are no remote ops to
      // trigger a conflict dialog. Detect this case and create a SYNC_IMPORT
      // via the migration service so the client is no longer "fresh".
      const isEmptyServer = result.latestServerSeq === 0;
      if (isEmptyServer) {
        const isFresh = await this.isWhollyFreshClient();
        if (isFresh && this.syncLocalStateService.hasMeaningfulStoreData()) {
          OpLog.warn(
            'OperationLogSyncService: Pre-op-log client with meaningful local data on empty server. ' +
              'Creating SYNC_IMPORT via server migration to seed the server.',
          );
          this.providerManager.assertSyncEpochUnchanged(
            options?.fenceEpoch,
            'empty-server migration',
          );
          await this.serverMigrationService.handleServerMigration(syncProvider, {
            syncImportReason: 'SERVER_MIGRATION',
          });
          // After SYNC_IMPORT is created, isWhollyFreshClient() returns false
          // and upload phase will proceed normally.
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

    // SAFETY: Fresh client conflict detection
    // If this is a wholly fresh client receiving remote data for the first time,
    // check if there's meaningful local data that would be overwritten.
    const isFreshClient = await this.isWhollyFreshClient();
    if (isFreshClient && result.newOps.length > 0) {
      if (this.syncLocalStateService.hasMeaningfulStoreData()) {
        // Local data exists — throw conflict error so the full conflict dialog is shown,
        // letting the user choose between keeping local data or using remote data.
        OpLog.warn(
          `OperationLogSyncService: Fresh client has local data and ${result.newOps.length} remote ops. Showing conflict dialog.`,
        );
        // Wholly fresh client — no prior sync, so no last-synced clock (SPAP-7).
        throw new LocalDataConflictError(0, {}, undefined, null);
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
      const { fullStateOp, pendingOps, dialogData } = incomingConflict;
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
        ignoredLocalFullStateOpIds: options?.ignoredLocalFullStateOpIds,
        conflictRecheck: { isNeverSynced: options?.isNeverSynced },
        fenceEpoch: options?.fenceEpoch,
      },
    );

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
    if (result.latestServerSeq !== undefined) {
      await syncProvider.setLastServerSeq(result.latestServerSeq);
    }

    // Update pending ops status for UI indicator
    const pendingOps = await this.opLogStore.getUnsynced();
    this.superSyncStatusService.updatePendingOpsStatus(pendingOps.length > 0);

    // Check for encryption state mismatch (another client disabled encryption)
    await this.handleEncryptionStateMismatch(
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
      ignoredLocalFullStateOpIds?: readonly string[];
      conflictRecheck?: {
        isNeverSynced?: boolean;
        preCapturedPendingOps?: OperationLogEntry[];
      };
      /** Sync epoch captured at cycle start (#9074); fences the apply. */
      fenceEpoch?: number;
    },
  ): Promise<GuardedRemoteOpsProcessingResult> {
    const startupOpIdsToDiscard = new Set(startupOpIds);
    let preApplyFullStateConflict: IncomingFullStateConflictGateResult | undefined;
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
            if (conflict.dialogData) {
              preApplyFullStateConflict = conflict;
              return false;
            }
            return true;
          }
        : undefined;
      const result = await this.repairSyncContext.runWithBaseServerSeq(
        options?.repairBaseServerSeq,
        () =>
          this.remoteOpsProcessingService.processRemoteOps(remoteOps, {
            ...(options?.ignoredLocalFullStateOpIds?.length
              ? {
                  ignoredLocalFullStateOpIds: options.ignoredLocalFullStateOpIds,
                }
              : {}),
            ...(beforeFullStateApply ? { beforeFullStateApply } : {}),
            ...(options?.fenceEpoch !== undefined
              ? { fenceEpoch: options.fenceEpoch }
              : {}),
          }),
      );
      if (
        result.fullStateApplyBlockedByLocalConflict &&
        !preApplyFullStateConflict?.dialogData
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
    if (snapshotAppliedOpIds === undefined) {
      return { snapshotIncludedOps: ops, postSnapshotOps: [] };
    }
    const includedIds = new Set(snapshotAppliedOpIds);
    return {
      snapshotIncludedOps: ops.filter((op) => includedIds.has(op.id)),
      postSnapshotOps: ops.filter((op) => !includedIds.has(op.id)),
    };
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
        if (lateDurableOps.length > 0) {
          const lastSyncedVectorClock =
            (await this.vectorClockService.getSnapshotVectorClock()) ?? null;
          throw new LocalDataConflictError(
            pendingAtHydrationCutoff.length,
            result.snapshotState as Record<string, unknown>,
            result.snapshotVectorClock,
            lastSyncedVectorClock,
            result.remoteLastModified,
          );
        }

        // Hydrate state from snapshot - DON'T create SYNC_IMPORT for file-based
        // bootstrap. Creating it would trigger clean-slate filtering of concurrent
        // ops from other clients.
        await this.syncHydrationService.hydrateFromRemoteSync(
          result.snapshotState as Record<string, unknown>,
          result.snapshotVectorClock,
          false,
          undefined,
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
          },
        );
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
        const restoredLocalOpIds = new Set(initialUnsyncedOpIds);
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
   * - CONCURRENT           → true divergence: merge if enabled, else dialog.
   *
   * A missing or empty local clock means a client with no genuine sync history
   * (provider switch, legacy store-only data). Such a client cannot be
   * auto-resolved, so it keeps the existing dialog behaviour — mirroring the
   * fresh-client throws elsewhere in this method.
   */
  private _classifySnapshotConflict(
    localClock: VectorClock | null | undefined,
    snapshotClock: Record<string, number> | undefined,
    mergeEnabled: boolean,
  ): 'apply-snapshot' | 'keep-local' | 'merge' | 'dialog' {
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
        return mergeEnabled ? 'merge' : 'dialog';
    }
  }

  /**
   * SPAP-9: attempt an entity-level merge of a CONCURRENT seq-0 snapshot instead
   * of the conflict dialog. The client already holds the shared base (it has a
   * populated vector clock), so the only divergent remote work is the file's
   * incremental recent ops. Routing those through the existing remote-ops
   * pipeline runs the standard LWW conflict resolution (remote-wins-ties, which
   * emits LWW_CONFLICTS_AUTO_RESOLVED) and leaves the local pending ops queued
   * for upload — a genuine merge rather than picking a side.
   *
   * Returns null when the merge cannot be proven lossless — either there are no
   * incremental ops to merge, or the retained ops do not bridge the full gap to
   * the snapshot (see guard below). The caller then falls back to the dialog so
   * no data is silently discarded.
   */
  private async _tryConcurrentSnapshotMerge(
    result: Awaited<ReturnType<OperationLogDownloadService['downloadRemoteOps']>>,
    syncProvider: OperationSyncCapable,
    localClock: VectorClock | null | undefined,
  ): Promise<DownloadOutcome | null> {
    if (result.newOps.length === 0) {
      return null;
    }

    // GUARD (review follow-up): this merge replays only the file's retained
    // `recentOps` (result.newOps) and never re-hydrates the compacted
    // `snapshotState`. That is lossless ONLY if replaying those ops on top of the
    // local state reconstructs the snapshot's full causal state — i.e. the local
    // client already holds the snapshot's compacted base. A populated local clock
    // proves the client has *its own* history, NOT that it received another
    // client's ops that were later compacted into the snapshot base.
    //
    // Reconstruct the causal state we would reach by replaying the retained ops on
    // top of local (local ⊔ ⨆ recentOp clocks). If that does not dominate the
    // snapshot's clock, the snapshot's compacted base contains ops this client
    // never downloaded; merging only recentOps would silently and permanently drop
    // those entities. Refuse and fall back to the dialog, which can hydrate the
    // full snapshot via USE_REMOTE — a user-recoverable choice, not silent loss.
    const snapshotClock = result.snapshotVectorClock;
    const bridgedClock = (result.allOpClocks ?? []).reduce<VectorClock>(
      (acc, opClock) => mergeVectorClocks(acc, opClock),
      { ...(localClock ?? {}) } as VectorClock,
    );
    const bridgeComparison = snapshotClock
      ? compareVectorClocks(bridgedClock, snapshotClock)
      : 'GREATER_THAN';
    if (bridgeComparison !== 'EQUAL' && bridgeComparison !== 'GREATER_THAN') {
      OpLog.warn(
        'OperationLogSyncService: CONCURRENT snapshot auto-merge refused — retained recent ops ' +
          'do not bridge the full gap to the snapshot (local+recentOps is ' +
          `${bridgeComparison} vs the snapshot clock, so its compacted base holds ops this client ` +
          'never saw). Falling back to the conflict dialog to avoid silent data loss.',
      );
      return null;
    }

    OpLog.normal(
      `OperationLogSyncService: CONCURRENT snapshot with ${result.newOps.length} incremental remote op(s) — ` +
        'auto-merging via LWW conflict resolution instead of the conflict dialog.',
    );

    const processResult = await this.repairSyncContext.runWithBaseServerSeq(
      result.latestServerSeq,
      () => this.remoteOpsProcessingService.processRemoteOps(result.newOps),
    );

    if (processResult.blockedByIncompatibleOp) {
      return { kind: 'blocked_incompatible' };
    }

    // Persist the cursor only AFTER the ops are applied, matching the normal
    // incremental path's crash-safety ordering. A version/migration block keeps
    // the cursor behind the blocked op (retried after an app update).
    if (result.latestServerSeq !== undefined) {
      await syncProvider.setLastServerSeq(result.latestServerSeq);
    }

    const pendingOps = await this.opLogStore.getUnsynced();
    this.superSyncStatusService.updatePendingOpsStatus(pendingOps.length > 0);

    return {
      kind: 'ops_processed',
      newOpsCount: result.newOps.length,
      localWinOpsCreated: processResult.localWinOpsCreated,
      allOpClocks: result.allOpClocks,
      snapshotVectorClock: result.snapshotVectorClock,
    };
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
   * Force download all remote state, replacing local data.
   * This is used when user explicitly chooses "USE_REMOTE" in conflict resolution.
   *
   * Download-first rebuild: the COMPLETE server history (including this
   * client's own ops and ops already known locally) is downloaded and
   * validated BEFORE any local mutation. Only then is the local op-log
   * replaced wholesale with the server history and replayed from a defaults
   * baseline. Aborts without touching local state on download failure, an
   * empty remote, or a remote containing newer-schema ops.
   *
   * IMPORTANT: This also resets the vector clock to the remote's rebuilt clock
   * to ensure rejected local ops don't pollute the causal history.
   *
   * @param syncProvider - The sync provider to download from
   */
  async forceDownloadRemoteState(
    syncProvider: OperationSyncCapable,
    options?: {
      /**
       * Resuming an interrupted rebuild (crash between the baseline replacement
       * and the replay commit). Keeps the FIRST attempt's pre-replace safety
       * backup: the single backup slot still holds the user's original data,
       * and re-capturing here would overwrite it with the partial baseline.
       */
      isCrashResume?: boolean;
    },
  ): Promise<void> {
    OpLog.warn(
      'OperationLogSyncService: Force downloading remote state for a full rebuild.',
    );

    // ─────────────────────────────────────────────────────────────────────────
    // PHASE 1 — download and validate. Nothing local is mutated until the
    // complete server history is in memory: a network failure here must leave
    // local state untouched (previously the op-log was cleared and the cursor
    // reset BEFORE the download, so a failed download stranded the client with
    // destroyed local bookkeeping).
    //
    // Raw-rebuild mode: includes ops authored by this client and ops already
    // known locally. The normal download filters drop both, which made the old
    // USE_REMOTE unable to rebuild a server history this client had (fully or
    // partially) produced itself.
    // ─────────────────────────────────────────────────────────────────────────
    const result = await this.downloadService.downloadRemoteOps(syncProvider, {
      forceFromSeq0: true,
      includeOwnAndAppliedOps: true,
    });

    if (!result.success) {
      throw new Error(
        'Download failed - partial or no data received. ' +
          `failedFileCount=${result.failedFileCount}`,
      );
    }

    const hasSnapshotState =
      result.providerMode === 'fileSnapshotOps' && !!result.snapshotState;
    if (!hasSnapshotState && result.newOps.length === 0) {
      // An empty remote is not a state to adopt. Silently succeeding here used
      // to leave live NgRx state untouched while the op-log bookkeeping was
      // already wiped — state and log permanently disagreeing.
      throw new Error('USE_REMOTE aborted: remote returned no data to rebuild from.');
    }

    let migratedRemoteOps: Operation[];
    let migratedSnapshotIncludedOps: Operation[] = [];
    let migratedPostSnapshotOps: Operation[] = [];
    if (hasSnapshotState && result.providerMode === 'fileSnapshotOps') {
      const snapshotOps = this._partitionSnapshotOps(
        result.newOps,
        result.snapshotAppliedOpIds,
      );
      migratedSnapshotIncludedOps = this._preflightRemoteOperations(
        snapshotOps.snapshotIncludedOps,
      );
      migratedPostSnapshotOps = this._preflightRemoteOperations(
        snapshotOps.postSnapshotOps,
      );
      migratedRemoteOps = [...migratedSnapshotIncludedOps, ...migratedPostSnapshotOps];
    } else {
      migratedRemoteOps = this._preflightRemoteOperations(result.newOps);
    }

    const currentSyncConfig = await firstValueFrom(this.store.select(selectSyncConfig));
    const localOnlySyncSettings: LocalOnlySyncSettings = {
      isEnabled: currentSyncConfig.isEnabled,
      isEncryptionEnabled: currentSyncConfig.isEncryptionEnabled,
      syncProvider: currentSyncConfig.syncProvider,
      syncInterval: currentSyncConfig.syncInterval,
      isManualSyncOnly: currentSyncConfig.isManualSyncOnly,
    };

    let snapshotState = result.snapshotState as Record<string, unknown> | undefined;
    if (hasSnapshotState && snapshotState) {
      // File providers intentionally omit device-local schedule fields and null
      // the provider on the wire. Restore this device's values before schema
      // validation so a valid transport snapshot is locally replayable.
      snapshotState = applyLocalOnlySyncSettingsToAppData(
        stripLocalOnlySyncSettingsFromAppData(snapshotState),
        localOnlySyncSettings,
      ) as Record<string, unknown>;
      // User-initiated USE_REMOTE recovery: this validates in PHASE 1, before
      // the destructive replace acquires sp_op_log, and the user is in the
      // foreground — so keep the interactive confirm/acknowledge dialogs. Every
      // automatic/in-lock repair path uses the non-interactive default (#9026).
      const validation = await this.validateStateService.validateAndRepair(
        snapshotState,
        { interactive: true },
      );
      if (!validation.isValid) {
        throw new Error(
          'USE_REMOTE aborted: remote snapshot is invalid and could not be repaired.',
        );
      }
      if (validation.wasRepaired && validation.repairedState) {
        snapshotState = validation.repairedState;
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PHASE 2 — destructive replace (local mutations only, no network left).
    // The local op-log becomes exactly the server history: clearing ALL ops
    // (not just unsynced/full-state ones) lets the raw replay below re-append
    // and re-apply ops this client already knew. The old keep-synced-ops
    // variant made the duplicate filter skip them, so a "rebuild" replayed only
    // an unseen suffix onto a defaults reset.
    // ─────────────────────────────────────────────────────────────────────────
    // Reset the vector clock to the remote's causal knowledge (snapshot clock
    // merged with every downloaded op clock). This also drops entries from
    // rejected local ops that would otherwise pollute conflict detection.
    let rebuiltClock: VectorClock = { ...(result.snapshotVectorClock ?? {}) };
    for (const opClock of result.allOpClocks ?? []) {
      rebuiltClock = mergeVectorClocks(rebuiltClock, opClock);
    }
    const defaultData = getDefaultMainModelData();
    const baselineSource = snapshotState ?? defaultData;
    const baselineGlobalConfig =
      baselineSource['globalConfig'] && typeof baselineSource['globalConfig'] === 'object'
        ? (baselineSource['globalConfig'] as Record<string, unknown>)
        : {};
    const baselineSyncConfig =
      baselineGlobalConfig['sync'] && typeof baselineGlobalConfig['sync'] === 'object'
        ? (baselineGlobalConfig['sync'] as Record<string, unknown>)
        : {};
    // getDefaultMainModelData intentionally excludes globalConfig. Add a
    // default config shell before applying the canonical device-local fields
    // so an interrupted rebuild can hydrate enough configuration to sync again.
    const baselineState = applyLocalOnlySyncSettingsToAppData(
      {
        ...baselineSource,
        globalConfig: {
          ...DEFAULT_GLOBAL_CONFIG,
          ...baselineGlobalConfig,
          sync: {
            ...DEFAULT_GLOBAL_CONFIG.sync,
            ...baselineSyncConfig,
          },
        },
      },
      localOnlySyncSettings,
    );
    const archiveYoung =
      (snapshotState?.[
        'archiveYoung'
      ] as typeof MODEL_CONFIGS.archiveYoung.defaultData) ??
      MODEL_CONFIGS.archiveYoung.defaultData!;
    const archiveOld =
      (snapshotState?.['archiveOld'] as typeof MODEL_CONFIGS.archiveOld.defaultData) ??
      MODEL_CONFIGS.archiveOld.defaultData!;

    let capturedBackupRef: ImportBackupRef | undefined;
    let replacementCommitted = false;
    let backupRef: ImportBackupRef | undefined;
    let preservedLocalOps: Operation[] = [];
    // A capture racing the rebuild aborts the attempt (CaptureRacedRebuildError
    // from the asserts below). Retry in-call from the already-downloaded
    // history: the raced ops become durable in the next flush barrier and fold
    // into preservedLocalOps via the resume branch, so each retry converges —
    // important while e.g. active time tracking dispatches continuously, where
    // waiting for the next sync trigger would re-download everything per
    // attempt. In-memory reuse is safe: WS downloads and immediate uploads are
    // gated while the rebuild marker is set. On exhaustion, the persisted
    // marker hands over to the next-sync resume path as before.
    const MAX_CAPTURE_RACE_ATTEMPTS = 3;
    let isCrashResume = options?.isCrashResume ?? false;
    for (let attempt = 1; ; attempt++) {
      try {
        // flushThenRunExclusive drains the capture pipeline BEFORE acquiring the
        // op-log lock (flushPendingWrites re-acquires the same non-reentrant lock,
        // so flushing while holding it deadlocks) and re-checks inside the lock —
        // actions dispatched while the network request and preflight were in
        // flight are durably written and included in the reversible safety backup.
        backupRef = await this.writeFlushService.flushThenRunExclusive(async () => {
          let currentBackupRef: ImportBackupRef | undefined;
          if (isCrashResume) {
            // Keep the first attempt's pre-replace backup (see option JSDoc).
            const marker = await this.opLogStore.loadRawRebuildIncomplete();
            const storedBackup = await this.opLogStore.loadImportBackup();
            const expectedBackupRef = marker?.backupRef ?? capturedBackupRef;
            currentBackupRef = expectedBackupRef
              ? storedBackup?.backupId === expectedBackupRef.backupId
                ? expectedBackupRef
                : undefined
              : storedBackup
                ? {
                    backupId: storedBackup.backupId,
                    savedAt: storedBackup.savedAt,
                  }
                : undefined;
            capturedBackupRef ??= currentBackupRef;
            const liveLocalOps = (await this.opLogStore.getUnsynced()).map(
              (entry) => entry.op,
            );
            preservedLocalOps = this._mergeOperationsById(
              marker?.preservedLocalOps ?? [],
              liveLocalOps,
            );
          } else {
            try {
              currentBackupRef = await this.backupService.captureImportBackup();
              capturedBackupRef = currentBackupRef;
            } catch (e) {
              OpLog.warn(
                'OperationLogSyncService: Pre-replace safety backup failed; aborting force download.',
                { name: (e as Error | undefined)?.name },
              );
              throw new Error(
                'Pre-replace safety backup failed; aborting to preserve local state.',
              );
            }
          }

          // The provider cursor lives outside SUP_OPS, so it cannot join the IDB
          // transaction. Do not reset it eagerly: for file adapters that call is
          // also the durable-apply acknowledgement for the staged download. The
          // transaction stores a raw-rebuild-incomplete marker atomically with
          // the replacement, and crash recovery always re-downloads from seq 0;
          // the cursor is therefore advanced only after replay/hydration succeeds.
          await this.opLogStore.runRemoteStateReplacement({
            baselineState,
            vectorClock: rebuiltClock,
            schemaVersion: CURRENT_SCHEMA_VERSION,
            snapshotEntityKeys: extractEntityKeysFromState(
              baselineState as Parameters<typeof extractEntityKeysFromState>[0],
            ),
            archiveYoung,
            archiveOld,
            preservedLocalOps,
            backupRef: currentBackupRef,
          });
          replacementCommitted = true;

          OpLog.normal(
            'OperationLogSyncService: Replaced local persistence with remote baseline.',
          );

          // FILE-BASED SYNC: Handle snapshot state from force download.
          // When downloading from seq 0 on file-based providers, we may receive a
          // snapshotState instead of incremental ops. This happens when the remote
          // has a SYNC_IMPORT (full state snapshot) with empty recentOps.
          // hydrateFromRemoteSync persists its own state cache + vector clock.
          if (result.providerMode === 'fileSnapshotOps' && snapshotState) {
            OpLog.normal(
              'OperationLogSyncService: Force download received snapshotState. Hydrating...',
            );

            // Hydrate from snapshot - DON'T create SYNC_IMPORT since we're
            // accepting remote state, not uploading local state.
            await this.syncHydrationService.hydrateFromRemoteSync(
              snapshotState,
              result.snapshotVectorClock,
              false, // Don't create SYNC_IMPORT
            );

            // Record only operations already represented by the snapshot. A
            // split-file suffix must still be dispatched on top of that state.
            if (migratedSnapshotIncludedOps.length > 0) {
              const appendResult = await this.opLogStore.appendSnapshotIncludedOps(
                migratedSnapshotIncludedOps,
              );
              OpLog.normal(
                `OperationLogSyncService: Wrote ${appendResult.writtenOps.length} snapshot ops to IndexedDB ` +
                  'after force-download hydration.' +
                  (appendResult.skippedCount > 0
                    ? ` Skipped ${appendResult.skippedCount} duplicate(s).`
                    : ''),
              );
            }

            if (migratedPostSnapshotOps.length > 0) {
              const processResult =
                await this.remoteOpsProcessingService.processRemoteOps(
                  migratedPostSnapshotOps,
                  {
                    skipConflictDetection: true,
                    callerHoldsOperationLogLock: true,
                  },
                );
              if (processResult.blockedByIncompatibleOp) {
                throw new Error(
                  'USE_REMOTE incomplete: a post-snapshot op failed schema migration during replay.',
                );
              }
            }

            await this._restorePreservedLocalOps(preservedLocalOps);

            await this._assertNoCaptureRacedWithRebuild();

            // Update lastServerSeq after hydration
            if (result.latestServerSeq !== undefined) {
              await syncProvider.setLastServerSeq(result.latestServerSeq);
            }

            const hasDurableRecovery = await this._completeRawRebuild(currentBackupRef);

            OpLog.normal(
              'OperationLogSyncService: Force download snapshot hydration complete.',
            );
            return hasDurableRecovery ? currentBackupRef : undefined;
          }

          // Reset live state to defaults, then replay the COMPLETE server history on
          // top. A full-state op in the history replaces state again by its own
          // semantics; a purely incremental history rebuilds from this baseline.
          this.store.dispatch(
            loadAllData({
              appDataComplete: defaultData as Parameters<
                typeof loadAllData
              >[0]['appDataComplete'],
            }),
          );
          // Brief yield to let NgRx process the state reset
          await new Promise((resolve) => setTimeout(resolve, 0));

          // Process all remote ops (no confirmation needed - user already chose USE_REMOTE).
          // Skip conflict detection because the NgRx store was just reset to empty state,
          // which causes all entities to appear missing and CONCURRENT ops to be discarded.
          // Validation failure is surfaced via the session-validation latch. (#7330)
          const processResult = await this.repairSyncContext.runWithBaseServerSeq(
            result.latestServerSeq,
            () =>
              this.remoteOpsProcessingService.processRemoteOps(migratedRemoteOps, {
                skipConflictDetection: true,
                callerHoldsOperationLogLock: true,
              }),
          );

          if (processResult.blockedByIncompatibleOp) {
            // Version blocks were pre-checked above; only a migration exception lands
            // here. The rebuild is partial: keep the cursor at 0 so the next sync
            // retries the remainder, and surface the failure — the Undo snack still
            // offers the pre-replace backup.
            throw new Error(
              'USE_REMOTE incomplete: an op failed schema migration during replay.',
            );
          }

          await this._restorePreservedLocalOps(preservedLocalOps);

          await this._assertNoCaptureRacedWithRebuild();

          // Update lastServerSeq
          if (result.latestServerSeq !== undefined) {
            await syncProvider.setLastServerSeq(result.latestServerSeq);
          }

          const hasDurableRecovery = await this._completeRawRebuild(currentBackupRef);

          OpLog.normal(
            `OperationLogSyncService: Force download complete. Rebuilt from ${migratedRemoteOps.length} ops.`,
          );
          return hasDurableRecovery ? currentBackupRef : undefined;
        });
        break;
      } catch (e) {
        if (
          e instanceof CaptureRacedRebuildError &&
          attempt < MAX_CAPTURE_RACE_ATTEMPTS
        ) {
          OpLog.warn(
            `OperationLogSyncService: Local capture raced the rebuild; retrying phase 2 in-call ` +
              `(attempt ${attempt}/${MAX_CAPTURE_RACE_ATTEMPTS}).`,
          );
          // The replacement committed before the assert threw, so the marker is
          // set: re-enter through the crash-resume branch, which keeps the first
          // attempt's backup and merges the newly-durable raced ops.
          isCrashResume = true;
          continue;
        }
        // Final failure only — showing this per aborted attempt would churn the
        // single snack slot.
        if (replacementCommitted && capturedBackupRef) {
          await this._offerStrandedRebuildBackup();
        }
        throw e;
      }
    }

    // On a crash resume without a surviving backup there is nothing to offer.
    if (backupRef) {
      this._showRestorePreviousDataSnack(backupRef, true);
    }
  }

  private _mergeOperationsById(...operationGroups: Operation[][]): Operation[] {
    const merged: Operation[] = [];
    const seenIds = new Set<string>();
    for (const operations of operationGroups) {
      for (const op of operations) {
        if (!seenIds.has(op.id)) {
          seenIds.add(op.id);
          merged.push(op);
        }
      }
    }
    return merged;
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
      await this._offerStrandedRebuildBackup();
      throw error;
    }
  }

  private _assertNoCaptureRacedWithRebuild(): void {
    if (this.writeFlushService.hasPendingWrites()) {
      throw new CaptureRacedRebuildError();
    }
  }

  private async _completeRawRebuild(backupRef?: ImportBackupRef): Promise<boolean> {
    this._assertNoCaptureRacedWithRebuild();
    const hasDurableRecovery = await this.opLogStore.completeRawRebuild(backupRef);
    // The conflict journal describes conflicts in the op history that was JUST
    // replaced (documented contract: cleared whenever the full dataset is
    // replaced — see BackupService.importCompleteBackup). Stale entries would
    // keep the badge count and offer review actions against replaced state.
    // clearAll swallows its own errors and must not fail the rebuild.
    await this.conflictJournalService.clearAll();
    return hasDurableRecovery;
  }

  /**
   * Replays edits captured after an interrupted rebuild on top of the complete
   * authoritative history. They stay local/unsynced so the next upload carries
   * the user's post-crash intent to the server.
   */
  private async _restorePreservedLocalOps(operations: Operation[]): Promise<void> {
    if (operations.length === 0) {
      return;
    }

    const { writtenOps } = await this.opLogStore.appendBatchSkipDuplicates(
      operations,
      'local',
    );
    if (writtenOps.length === 0) {
      return;
    }

    let restoredClock = (await this.opLogStore.getVectorClock()) ?? {};
    for (const op of writtenOps) {
      restoredClock = mergeVectorClocks(restoredClock, op.vectorClock);
    }
    await this.opLogStore.setVectorClock(restoredClock);

    const applyResult = await this.operationApplier.applyOperations(writtenOps, {
      // The authoritative replacement also overwrote archive IndexedDB stores,
      // so archive-affecting post-crash edits must replay their side effects.
      // The entries themselves remain source=local and unsynced in the op-log.
      isLocalHydration: false,
      skipDeferredLocalActions: true,
    });
    if (applyResult.failedOp || applyResult.appliedOps.length !== writtenOps.length) {
      throw new Error(
        'USE_REMOTE incomplete: post-crash local operations could not be restored.',
      );
    }

    await processDeferredActions(this.injector, true);
  }

  private _preflightRemoteOperations(remoteOps: Operation[]): Operation[] {
    for (const op of remoteOps) {
      let version: number;
      try {
        version = getOperationSchemaVersion(op as { schemaVersion?: unknown });
      } catch (e) {
        // Keep the root cause diagnosable (id-only, no payloads) — this is a
        // rare, support-heavy failure path.
        OpLog.err('OperationLogSyncService: USE_REMOTE preflight version parse failed', {
          id: op.id,
          name: (e as Error | undefined)?.name,
        });
        throw new Error(
          'USE_REMOTE aborted: remote history has an invalid schema version.',
          { cause: e },
        );
      }

      if (version < MIN_SUPPORTED_SCHEMA_VERSION) {
        throw new Error(
          'USE_REMOTE aborted: remote history contains an unsupported schema version.',
        );
      }
      if (version > CURRENT_SCHEMA_VERSION) {
        if (
          !this._hasWarnedRebuildVersionBlockThisSession &&
          !this.snackService.hasPendingPersistentAction()
        ) {
          this._hasWarnedRebuildVersionBlockThisSession = true;
          this.snackService.open({
            type: 'ERROR',
            msg: T.F.SYNC.S.VERSION_TOO_OLD,
            actionStr: T.PS.UPDATE_APP,
            actionFn: () =>
              window.open('https://super-productivity.com/download', '_blank'),
          });
        }
        throw new Error(
          'USE_REMOTE aborted: remote history contains ops from a newer schema version — update the app first.',
        );
      }
    }

    try {
      return this.schemaMigrationService.migrateOperations(remoteOps);
    } catch (e) {
      OpLog.err('OperationLogSyncService: USE_REMOTE preflight migration failed', {
        name: (e as Error | undefined)?.name,
      });
      throw new Error('USE_REMOTE aborted: remote operation migration failed.', {
        cause: e,
      });
    }
  }

  /**
   * Shows a non-blocking snack after a destructive "Use Server Data" replace,
   * offering to restore the local snapshot captured before the wipe — making the
   * otherwise-irreversible replace reversible.
   *
   * WARNING type (honest framing of a data-replacement + provides a dismiss
   * control) and no auto-dismiss timer (duration: 0) so the undo isn't lost to a
   * timeout. (#8107)
   */
  private _showRestorePreviousDataSnack(
    backupRef: ImportBackupRef,
    isCompletedRecovery: boolean,
  ): void {
    this.snackService.open({
      type: 'WARNING',
      msg: T.F.SYNC.S.LOCAL_DATA_REPLACE_UNDO,
      actionStr: T.G.UNDO,
      actionFn: async (): Promise<void> => {
        try {
          const didRestore = await this.backupService.restoreImportBackup(backupRef);
          if (didRestore) {
            await this.opLogStore.clearRawRebuildRecovery(backupRef.backupId);
          }
          this.snackService.open({
            type: didRestore ? 'SUCCESS' : 'ERROR',
            msg: didRestore ? T.F.SYNC.S.RESTORE_SUCCESS : T.F.SYNC.S.RESTORE_ERROR,
          });
        } catch (e) {
          OpLog.err('OperationLogSyncService: Failed to restore pre-replace backup', {
            name: (e as Error | undefined)?.name,
          });
          this.snackService.open({ type: 'ERROR', msg: T.F.SYNC.S.RESTORE_ERROR });
        }
      },
      ...(isCompletedRecovery
        ? {
            dismissFn: async (): Promise<void> => {
              try {
                await this.opLogStore.retireCompletedRawRebuildRecovery(
                  backupRef.backupId,
                );
              } catch (error) {
                OpLog.err(
                  'OperationLogSyncService: Failed to retire dismissed rebuild recovery',
                  { name: (error as Error | undefined)?.name },
                );
              }
            },
          }
        : {}),
      config: { duration: 0 },
    });
  }

  /**
   * Boot-time entry point for raw-rebuild recovery (see StartupService).
   * Handles both an interrupted rebuild and a completed rebuild whose durable
   * Undo token survived a reload.
   */
  async offerInterruptedRebuildRecovery(): Promise<void> {
    await this._offerStrandedRebuildBackup();
  }

  /**
   * Offer the pre-replace Undo after an interrupted USE_REMOTE rebuild whose
   * resume could not finish. The first attempt already committed the destructive
   * baseline, so the user's original data survives only in the IMPORT_BACKUP
   * slot; without an explicit affordance here it has no restore entry point and
   * reads as total data loss. Skipped while a persistent recovery snack is
   * already showing, so repeated resume attempts (auto/WS syncs) don't respawn it.
   */
  private async _offerStrandedRebuildBackup(): Promise<void> {
    if (this.snackService.hasPendingPersistentAction()) {
      return;
    }
    const [incomplete, recovery, backup] = await Promise.all([
      this.opLogStore.loadRawRebuildIncomplete(),
      this.opLogStore.loadRawRebuildRecovery(),
      this.opLogStore.loadImportBackup(),
    ]);
    if (!incomplete && !recovery) {
      return;
    }
    if (!backup) {
      if (recovery && !incomplete) {
        await this.opLogStore.clearRawRebuildRecovery(recovery.backupId);
      }
      return;
    }

    // While incomplete, the surviving backup slot is still the authoritative
    // pre-rebuild snapshot. Completed recovery is stricter: its durable token
    // must match so an unrelated later import can never be offered as Undo.
    if (incomplete) {
      const expectedBackup = incomplete.backupRef;
      if (expectedBackup && expectedBackup.backupId !== backup.backupId) {
        return;
      }
      this._showRestorePreviousDataSnack(
        expectedBackup ?? {
          backupId: backup.backupId,
          savedAt: backup.savedAt,
        },
        false,
      );
    } else if (recovery && recovery.backupId === backup.backupId) {
      this._showRestorePreviousDataSnack(
        {
          backupId: recovery.backupId,
          savedAt: recovery.backupSavedAt,
        },
        true,
      );
    } else if (recovery) {
      await this.opLogStore.clearRawRebuildRecovery(recovery.backupId);
    }
  }

  /**
   * Checks if there's an encryption state mismatch between local config and server data.
   * If the server has only unencrypted data but local config has encryption enabled,
   * this means another client disabled encryption. Updates local config to match.
   *
   * @param syncProvider - The sync provider to check and update
   * @param serverHasOnlyUnencryptedData - Whether all downloaded/piggybacked ops were unencrypted
   */
  async handleEncryptionStateMismatch(
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

    // Mismatch detected: server has only unencrypted data but local has encryption enabled
    OpLog.warn(
      'OperationLogSyncService: Encryption state mismatch detected. ' +
        'Server has only unencrypted data but local config has encryption enabled.',
    );

    // SuperSync: encryption is mandatory — never auto-disable it.
    // An older unencrypted client or stale server must not downgrade encryption.
    const activeProvider = this.providerManager.getActiveProvider();
    if (activeProvider?.id === SyncProviderId.SuperSync) {
      OpLog.warn(
        'OperationLogSyncService: SuperSync requires encryption — ' +
          'NOT auto-disabling. Server has stale unencrypted data.',
      );
      return;
    }

    // Non-SuperSync providers: allow auto-disable
    OpLog.warn(
      'OperationLogSyncService: Non-SuperSync provider — ' +
        'updating local config to match server (disabling encryption).',
    );

    // Check if provider supports config updates using type guard
    if (!this._isSyncProviderWithConfig(syncProvider)) {
      OpLog.warn(
        'OperationLogSyncService: Cannot update encryption config - ' +
          'provider does not support privateCfg or setPrivateCfg.',
      );
      return;
    }

    // Load existing config
    const existingCfg = await syncProvider.privateCfg.load();
    if (!existingCfg) {
      OpLog.warn(
        'OperationLogSyncService: Cannot update encryption config - ' +
          'failed to load existing config.',
      );
      return;
    }

    // Update config via providerManager to ensure currentProviderPrivateCfg$ observable is updated
    await this.providerManager.setProviderConfig(syncProvider.id, {
      ...existingCfg,
      encryptKey: undefined,
      isEncryptionEnabled: false,
    });

    OpLog.normal(
      'OperationLogSyncService: Local encryption config updated to match server state.',
    );

    // Notify user - use WARNING since this is a security-relevant change
    this.snackService.open({
      type: 'WARNING',
      msg: T.F.SYNC.S.ENCRYPTION_DISABLED_ON_OTHER_DEVICE,
    });
  }

  /**
   * Type guard to check if a sync provider supports config updates.
   * Returns true if the provider has both privateCfg.load() and setPrivateCfg().
   */
  private _isSyncProviderWithConfig(
    provider: OperationSyncCapable,
  ): provider is OperationSyncCapable & SyncProviderBase<SyncProviderId> {
    const providerWithCfg = provider as Partial<SyncProviderBase<SyncProviderId>>;
    return (
      typeof providerWithCfg.privateCfg?.load === 'function' &&
      typeof providerWithCfg.setPrivateCfg === 'function'
    );
  }
}
