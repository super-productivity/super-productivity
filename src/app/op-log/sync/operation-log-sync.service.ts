import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { planSnapshotHydration } from '@sp/sync-core';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { BackupService } from '../backup/backup.service';
import { FULL_STATE_OP_TYPES } from '../core/operation.types';
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
import { LocalDataConflictError } from '../core/errors/sync-errors';
import { SuperSyncStatusService } from './super-sync-status.service';
import { ServerMigrationService } from './server-migration.service';
import { OperationWriteFlushService } from './operation-write-flush.service';
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
import { SyncImportConflictGateService } from './sync-import-conflict-gate.service';
import { SyncProviderManager } from '../sync-providers/provider-manager.service';
import { getDefaultMainModelData } from '../model/model-config';
import { loadAllData } from '../../root-store/meta/load-all-data.action';
import { SyncLocalStateService } from './sync-local-state.service';
import { SyncImportConflictCoordinatorService } from './sync-import-conflict-coordinator.service';
import { isExampleTaskCreateOp } from '../validation/is-example-task-op.util';

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

  // Extracted services
  private remoteOpsProcessingService = inject(RemoteOpsProcessingService);
  private vectorClockService = inject(VectorClockService);
  private rejectedOpsHandlerService = inject(RejectedOpsHandlerService);
  private syncHydrationService = inject(SyncHydrationService);
  private syncImportConflictGateService = inject(SyncImportConflictGateService);
  private syncLocalStateService = inject(SyncLocalStateService);
  private syncImportConflictCoordinator = inject(SyncImportConflictCoordinatorService);
  private providerManager = inject(SyncProviderManager);

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
    },
  ): Promise<UploadOutcome> {
    // CRITICAL: Ensure all pending write operations have completed before uploading.
    // The effect that writes operations uses concatMap for sequential processing,
    // but if sync is triggered before all operations are written to IndexedDB,
    // we would upload an incomplete set. This flush waits for all queued writes.
    await this.writeFlushService.flushPendingWrites();

    // Capture never-synced status BEFORE the upload runs: uploadService.uploadPendingOps
    // marks accepted ops synced, which flips hasSyncedOps() and would defeat the piggyback
    // conflict gate's never-synced guard if it read live state afterwards. The orchestrator
    // passes a value captured even earlier (pre-download, since download also persists
    // synced ops); fall back to a local read for standalone upload callers.
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

    // SERVER MIGRATION CHECK: Passed as callback to execute INSIDE the upload lock.
    // This prevents race conditions where multiple tabs could both detect migration
    // and create duplicate SYNC_IMPORT operations.
    // Skip migration check for force uploads (e.g., after password change) to avoid
    // DecryptError when downloading ops encrypted with a different key.
    const result = await this.uploadService.uploadPendingOps(syncProvider, {
      preUploadCallback: options?.skipServerMigrationCheck
        ? undefined
        : () => this.serverMigrationService.checkAndHandleMigration(syncProvider),
      skipPiggybackProcessing: options?.skipPiggybackProcessing,
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
      mergedOpsCreated: 0,
      permanentRejectionCount: 0,
    };

    if (result.piggybackedOps.length > 0) {
      // Check for piggybacked SYNC_IMPORT — mirrors the download path check (lines 552-604).
      // Without this, a SYNC_IMPORT from another client arriving as a piggybacked op
      // would silently replace local state via processRemoteOps().
      const piggybackedConflict =
        await this.syncImportConflictGateService.checkIncomingFullStateConflict(
          result.piggybackedOps,
          { isNeverSynced: isNeverSyncedAtSyncStart },
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
          await this._discardExampleTaskOps(piggybackedConflict.discardablePendingOpIds);
          OpLog.normal(
            `OperationLogSyncService: Accepting piggybacked ${fullStateOp.opType} from client ` +
              `${fullStateOp.clientId} without conflict dialog; ` +
              `${pendingOps.length} pending op(s), no meaningful pending user changes.`,
          );
        }
      }

      const processResult = await this.remoteOpsProcessingService.processRemoteOps(
        result.piggybackedOps,
      );
      localWinOpsCreated = processResult.localWinOpsCreated;
      // Validation failure (if any) is on the session-validation latch.

      // #8304: Persist lastServerSeq ONLY now that the piggybacked ops have been applied
      // above. The upload service deferred this (see UploadResult.lastServerSeqToPersist)
      // so that a crash — or a cancelled/USE_REMOTE/USE_LOCAL SYNC_IMPORT dialog, all of
      // which return early ABOVE without reaching here — cannot advance the seq past ops
      // that were never stored. Mirrors the download path's invariant.
      if (result.lastServerSeqToPersist !== undefined) {
        await syncProvider.setLastServerSeq(result.lastServerSeqToPersist);
      }
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
    }): Promise<DownloadResultForRejection> => {
      const outcome = await this.downloadRemoteOps(syncProvider, {
        ...downloadOptions,
        isNeverSynced: isNeverSyncedAtSyncStart,
      });
      // Validation failure (if any during the nested download) is on the
      // session-validation latch — no need to thread the boolean back. (#7330)
      switch (outcome.kind) {
        case 'ops_processed':
          return {
            newOpsCount: outcome.newOpsCount,
            allOpClocks: outcome.allOpClocks,
            snapshotVectorClock: outcome.snapshotVectorClock,
          };
        case 'no_new_ops':
        case 'snapshot_hydrated':
          return {
            newOpsCount: 0,
            allOpClocks: outcome.allOpClocks,
            snapshotVectorClock: outcome.snapshotVectorClock,
          };
        case 'server_migration_handled':
        case 'cancelled':
          return { newOpsCount: 0 };
      }
    };
    try {
      rejectionResult = await this.rejectedOpsHandlerService.handleRejectedOps(
        result.rejectedOps,
        downloadCallback,
      );
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
    options?: { forceFromSeq0?: boolean; isNeverSynced?: boolean },
  ): Promise<DownloadOutcome> {
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
        // Deliberately do NOT call appendBatchSkipDuplicates(result.newOps).
        // VectorClockService.getEntityFrontier() builds per-entity frontiers
        // by iterating the op log in seq order with last-write-wins semantics.
        // Appending historical remote ops at the current tail would regress
        // the frontier for any entity where local already has newer ops,
        // which then lets future remote ops be classified as non-conflicting
        // and silently overwrite local changes.
        //
        // The trade-off: those ops keep coming back in result.newOps on each
        // sync until the file's snapshot advances or the user uploads their
        // own snapshot. They are never re-applied to state, because (a) the
        // dominate-check skips state mutation, and (b) the regular hydration
        // path replaces state wholesale from snapshotState, not by replaying
        // individual ops. So the cost is bounded re-download bandwidth, not
        // data corruption.
        if (result.latestServerSeq !== undefined) {
          await syncProvider.setLastServerSeq(result.latestServerSeq);
        }
        return {
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
      // hydration failure doesn't permanently drop the pending example-create
      // ops while leaving the user without the remote snapshot.
      let exampleTaskOpIdsToDiscard: string[] = [];

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
        const exampleTaskOpIds = exampleTaskEntries.map((entry) => entry.op.id);
        const hasMeaningfulUserData =
          this.syncImportConflictGateService.hasMeaningfulPendingOps(unsyncedOps) ||
          this.syncLocalStateService.hasMeaningfulStoreData(exampleTaskIds);

        if (hasMeaningfulUserData) {
          // Client has meaningful user data - show conflict dialog
          OpLog.warn(
            `OperationLogSyncService: Client has ${unsyncedOps.length} unsynced local ops ` +
              'with meaningful user data (pending ops or store data). ' +
              'Throwing LocalDataConflictError for conflict resolution dialog.',
          );

          // The local snapshot's vector clock is this client's last-synced
          // baseline: unsynced ops sit on top of it, so the dialog can compute
          // changes-since-last-sync as a per-client delta instead of summing
          // the whole (lifetime) clock (SPAP-7). Undefined snapshot → null.
          const lastSyncedVectorClock =
            (await this.vectorClockService.getSnapshotVectorClock()) ?? null;

          throw new LocalDataConflictError(
            unsyncedOps.length,
            result.snapshotState as Record<string, unknown>,
            result.snapshotVectorClock,
            lastSyncedVectorClock,
          );
        } else {
          // Defer the markRejected call until hydration has succeeded — see
          // the declaration of exampleTaskOpIdsToDiscard above for rationale.
          exampleTaskOpIdsToDiscard = exampleTaskOpIds;
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

      // Hydrate state from snapshot - DON'T create SYNC_IMPORT for file-based bootstrap.
      // Creating SYNC_IMPORT would trigger "clean slate" semantics that filter concurrent
      // ops from other clients (via SyncImportFilterService). For normal file-based sync,
      // we want to merge concurrent work, not discard it.
      await this.syncHydrationService.hydrateFromRemoteSync(
        result.snapshotState as Record<string, unknown>,
        result.snapshotVectorClock,
        false, // Don't create SYNC_IMPORT for file-based bootstrap
      );

      // Now that the remote snapshot is applied, it's safe to drop the
      // example-create ops we previously decided were obsolete. Doing this
      // after hydration ensures a hydration failure leaves the queue intact
      // so the next attempt can retry.
      await this._discardExampleTaskOps(exampleTaskOpIdsToDiscard);

      // CRITICAL FIX: Write recentOps to IndexedDB after snapshot hydration.
      // File-based providers return ALL recentOps on every download, relying on
      // getAppliedOpIds() (from IndexedDB) to filter already-applied ops.
      // Without writing these ops, they bypass the filter on the next sync cycle
      // and get applied again, duplicating entities.
      if (result.newOps.length > 0) {
        const appendResult = await this.opLogStore.appendBatchSkipDuplicates(
          result.newOps,
          'remote',
        );
        OpLog.normal(
          `OperationLogSyncService: Wrote ${appendResult.writtenOps.length} snapshot ops to IndexedDB ` +
            '(prevents duplication on next sync cycle).' +
            (appendResult.skippedCount > 0
              ? ` Skipped ${appendResult.skippedCount} duplicate(s).`
              : ''),
        );
      }

      // Persist lastServerSeq after hydration
      if (result.latestServerSeq !== undefined) {
        await syncProvider.setLastServerSeq(result.latestServerSeq);
      }

      OpLog.normal('OperationLogSyncService: Snapshot hydration complete.');

      return {
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
        await this._discardExampleTaskOps(incomingConflict.discardablePendingOpIds);
        OpLog.normal(
          `OperationLogSyncService: Accepting incoming ${fullStateOp.opType} from client ` +
            `${fullStateOp.clientId} without conflict dialog; ` +
            `${pendingOps.length} pending op(s), no meaningful pending user changes.`,
        );
      }
    }

    const processResult = await this.remoteOpsProcessingService.processRemoteOps(
      result.newOps,
    );

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

  /**
   * Rejects the auto-generated startup example-task ops so they are NOT uploaded
   * after a SYNC_IMPORT is accepted silently. They were already excluded from the
   * conflict gate's "meaningful work" check (see SyncImportConflictGateService); the
   * import replaces local state, so rejecting them keeps the op-log consistent with
   * the just-applied remote data instead of re-uploading throwaway onboarding tasks.
   *
   * These ids always come from getUnsynced() (local pending ops, never remote ops),
   * so a remote `isExampleTask` flag can never reach this path.
   */
  private async _discardExampleTaskOps(opIds: string[]): Promise<void> {
    if (opIds.length > 0) {
      await this.opLogStore.markRejected(opIds);
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
  async forceUploadLocalState(syncProvider: OperationSyncCapable): Promise<void> {
    await this.syncImportConflictCoordinator.forceUploadLocalState(syncProvider);
  }

  /**
   * Force download all remote state, replacing local data.
   * This is used when user explicitly chooses "USE_REMOTE" in conflict resolution.
   *
   * Clears all local unsynced operations and downloads from seq 0 to get
   * the complete remote state including any SYNC_IMPORT.
   *
   * IMPORTANT: This also resets the vector clock to the remote snapshot's clock
   * to ensure rejected local ops don't pollute the causal history.
   *
   * @param syncProvider - The sync provider to download from
   */
  async forceDownloadRemoteState(syncProvider: OperationSyncCapable): Promise<void> {
    OpLog.warn(
      'OperationLogSyncService: Force downloading remote state - clearing local import and unsynced ops.',
    );

    // Safety net (#8107): snapshot current local state before we destroy it, so an
    // unintended "Use Server Data" — which can roll the user back to a stale server
    // snapshot — is reversible via the Undo affordance shown on success below.
    // Fail-safe: if the backup can't be written, abort rather than wipe without a
    // recovery point (mirrors BackupService._persistImportToOperationLog).
    let backupSavedAt: number;
    try {
      backupSavedAt = await this.backupService.captureImportBackup();
    } catch (e) {
      OpLog.warn(
        'OperationLogSyncService: Pre-replace safety backup failed; aborting force download.',
        { name: (e as Error | undefined)?.name },
      );
      throw new Error(
        'Pre-replace safety backup failed; aborting to preserve local state.',
      );
    }

    // IMPORTANT: Clear local full-state ops (SYNC_IMPORT, BACKUP_IMPORT, REPAIR)
    // This is critical - if the user chose USE_REMOTE, we must not filter incoming
    // ops against the local import that we're discarding.
    const clearedFullStateOps = await this.opLogStore.clearFullStateOps();
    if (clearedFullStateOps > 0) {
      OpLog.normal(
        `OperationLogSyncService: Cleared ${clearedFullStateOps} local full-state op(s).`,
      );
    }

    // Clear all unsynced local ops - we're replacing them with remote state
    await this.opLogStore.clearUnsyncedOps();

    // Reset lastServerSeq to 0 so we download everything
    await syncProvider.setLastServerSeq(0);

    // Download all remote ops from the beginning
    const result = await this.downloadService.downloadRemoteOps(syncProvider, {
      forceFromSeq0: true,
    });

    if (!result.success) {
      throw new Error(
        'Download failed - partial or no data received. ' +
          `failedFileCount=${result.failedFileCount}`,
      );
    }

    // Reset the vector clock to the remote snapshot's clock.
    // This removes entries from rejected local ops that would otherwise
    // pollute the causal history and cause incorrect conflict detection.
    if (result.snapshotVectorClock) {
      await this.opLogStore.setVectorClock(result.snapshotVectorClock);
      OpLog.normal(
        'OperationLogSyncService: Reset vector clock to remote snapshot clock.',
      );
    }

    // FILE-BASED SYNC: Handle snapshot state from force download.
    // When downloading from seq 0 on file-based providers, we may receive a
    // snapshotState instead of incremental ops. This happens when the remote
    // has a SYNC_IMPORT (full state snapshot) with empty recentOps.
    if (result.providerMode === 'fileSnapshotOps' && result.snapshotState) {
      OpLog.normal(
        'OperationLogSyncService: Force download received snapshotState. Hydrating...',
      );

      // Hydrate from snapshot - DON'T create SYNC_IMPORT since we're
      // accepting remote state, not uploading local state.
      await this.syncHydrationService.hydrateFromRemoteSync(
        result.snapshotState as Record<string, unknown>,
        result.snapshotVectorClock,
        false, // Don't create SYNC_IMPORT
      );

      // CRITICAL FIX: Write recentOps to IndexedDB after snapshot hydration.
      // Same rationale as downloadRemoteOps: file-based providers return ALL
      // recentOps on every download and rely on getAppliedOpIds() to filter them.
      if (result.newOps.length > 0) {
        const appendResult = await this.opLogStore.appendBatchSkipDuplicates(
          result.newOps,
          'remote',
        );
        OpLog.normal(
          `OperationLogSyncService: Wrote ${appendResult.writtenOps.length} snapshot ops to IndexedDB ` +
            'after force-download hydration.' +
            (appendResult.skippedCount > 0
              ? ` Skipped ${appendResult.skippedCount} duplicate(s).`
              : ''),
        );
      }

      // Update lastServerSeq after hydration
      if (result.latestServerSeq !== undefined) {
        await syncProvider.setLastServerSeq(result.latestServerSeq);
      }

      OpLog.normal(
        'OperationLogSyncService: Force download snapshot hydration complete.',
      );
      this._showRestorePreviousDataSnack(backupSavedAt);
      return;
    }

    if (result.newOps.length > 0) {
      // Check if there's a full-state op in the batch (SYNC_IMPORT would replace state)
      const hasFullStateOp = result.newOps.some((op) =>
        FULL_STATE_OP_TYPES.has(op.opType),
      );

      // If no full-state op, we need to reset state before applying incremental ops.
      // This is because USE_REMOTE should REPLACE local state with remote state,
      // not merge remote ops into existing local state.
      if (!hasFullStateOp) {
        OpLog.normal(
          'OperationLogSyncService: No full-state op in remote. Resetting state before applying incremental ops.',
        );
        // Reset to default/empty state so incremental ops build fresh state
        const defaultData = getDefaultMainModelData();
        this.store.dispatch(
          loadAllData({
            appDataComplete: defaultData as Parameters<
              typeof loadAllData
            >[0]['appDataComplete'],
          }),
        );
        // Brief yield to let NgRx process the state reset
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      // Process all remote ops (no confirmation needed - user already chose USE_REMOTE).
      // Skip conflict detection because the NgRx store was just reset to empty state,
      // which causes all entities to appear missing and CONCURRENT ops to be discarded.
      // Validation failure is surfaced via the session-validation latch. (#7330)
      await this.remoteOpsProcessingService.processRemoteOps(result.newOps, {
        skipConflictDetection: true,
      });

      // Update lastServerSeq
      if (result.latestServerSeq !== undefined) {
        await syncProvider.setLastServerSeq(result.latestServerSeq);
      }
    }

    OpLog.normal(
      `OperationLogSyncService: Force download complete. Processed ${result.newOps.length} ops.`,
    );
    this._showRestorePreviousDataSnack(backupSavedAt);
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
  private _showRestorePreviousDataSnack(backupSavedAt: number): void {
    this.snackService.open({
      type: 'WARNING',
      msg: T.F.SYNC.S.LOCAL_DATA_REPLACE_UNDO,
      actionStr: T.G.UNDO,
      actionFn: async (): Promise<void> => {
        try {
          const didRestore = await this.backupService.restoreImportBackup(backupSavedAt);
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
      config: { duration: 0 },
    });
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
