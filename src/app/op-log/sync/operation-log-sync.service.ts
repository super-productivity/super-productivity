import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { OpType, VectorClock, FULL_STATE_OP_TYPES } from '../core/operation.types';
import { OpLog } from '../../core/log';
import {
  OperationSyncCapable,
  SyncProviderServiceInterface,
} from '../sync-providers/provider.interface';
import { SyncProviderId } from '../sync-providers/provider.const';
import { OperationLogUploadService, UploadResult } from './operation-log-upload.service';
import { OperationLogDownloadService } from './operation-log-download.service';
import { SnackService } from '../../core/snack/snack.service';
import { T } from '../../t.const';
import { LocalDataConflictError } from '../core/errors/sync-errors';
import { SuperSyncStatusService } from './super-sync-status.service';
import { ServerMigrationService } from './server-migration.service';
import { OperationWriteFlushService } from './operation-write-flush.service';
import { RemoteOpsProcessingService } from './remote-ops-processing.service';
import {
  DownloadResultForRejection,
  RejectedOpsHandlerService,
  RejectionHandlingResult,
} from './rejected-ops-handler.service';
import { SyncHydrationService } from '../persistence/sync-hydration.service';
import { SyncImportConflictDialogService } from './sync-import-conflict-dialog.service';
import { getDefaultMainModelData } from '../model/model-config';
import { loadAllData } from '../../root-store/meta/load-all-data.action';
import { StateSnapshotService } from '../backup/state-snapshot.service';
import { INBOX_PROJECT } from '../../features/project/project.const';
import { SYSTEM_TAG_IDS } from '../../features/tag/tag.const';
import { confirmDialog } from '../../util/native-dialogs';

/**
 * Type guard for NgRx entity state (has an `ids` array).
 */
const isEntityState = (obj: unknown): obj is { ids: string[] } =>
  typeof obj === 'object' &&
  obj !== null &&
  'ids' in obj &&
  Array.isArray((obj as { ids: unknown }).ids);

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
  private translateService = inject(TranslateService);
  private superSyncStatusService = inject(SuperSyncStatusService);
  private serverMigrationService = inject(ServerMigrationService);
  private writeFlushService = inject(OperationWriteFlushService);
  private stateSnapshotService = inject(StateSnapshotService);

  // Extracted services
  private remoteOpsProcessingService = inject(RemoteOpsProcessingService);
  private rejectedOpsHandlerService = inject(RejectedOpsHandlerService);
  private syncHydrationService = inject(SyncHydrationService);
  private syncImportConflictDialogService = inject(SyncImportConflictDialogService);

  /**
   * Checks if this client is "wholly fresh" - meaning it has never synced before
   * and has no local operation history. A fresh client accepting remote data
   * should require user confirmation to prevent accidental data loss.
   *
   * @returns true if this is a fresh client with no history
   */
  async isWhollyFreshClient(): Promise<boolean> {
    const snapshot = await this.opLogStore.loadStateCache();
    const lastSeq = await this.opLogStore.getLastSeq();

    // Fresh client: no snapshot AND no operations in the log
    return !snapshot && lastSeq === 0;
  }

  /**
   * Checks if the NgRx store has meaningful user data (tasks, projects, tags, notes).
   * This detects data that existed before the operation-log feature was added.
   *
   * @returns true if user has created any tasks, projects (besides INBOX), tags (besides system tags), or notes
   */
  private _hasMeaningfulLocalData(): boolean {
    const snapshot = this.stateSnapshotService.getStateSnapshot();

    if (!snapshot) {
      OpLog.warn(
        'OperationLogSyncService._hasMeaningfulLocalData: Unable to get state snapshot',
      );
      return false; // Assume no data rather than blocking sync
    }

    // Check for tasks (any tasks = meaningful data)
    if (isEntityState(snapshot.task) && snapshot.task.ids.length > 0) {
      return true;
    }

    // Check for projects (beyond the default INBOX project)
    if (
      isEntityState(snapshot.project) &&
      snapshot.project.ids.some((id) => id !== INBOX_PROJECT.id)
    ) {
      return true;
    }

    // Check for tags (beyond system tags like TODAY, URGENT, IMPORTANT, IN_PROGRESS)
    if (
      isEntityState(snapshot.tag) &&
      snapshot.tag.ids.some((id) => !SYSTEM_TAG_IDS.has(id))
    ) {
      return true;
    }

    // Check for notes
    if (isEntityState(snapshot.note) && snapshot.note.ids.length > 0) {
      return true;
    }

    return false;
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
    options?: { skipPiggybackProcessing?: boolean; skipServerMigrationCheck?: boolean },
  ): Promise<UploadResult | null> {
    // CRITICAL: Ensure all pending write operations have completed before uploading.
    // The effect that writes operations uses concatMap for sequential processing,
    // but if sync is triggered before all operations are written to IndexedDB,
    // we would upload an incomplete set. This flush waits for all queued writes.
    await this.writeFlushService.flushPendingWrites();

    // SAFETY: Block upload from wholly fresh clients
    // A fresh client has nothing meaningful to upload and uploading could overwrite
    // valid remote data with empty/default state.
    const isFresh = await this.isWhollyFreshClient();
    if (isFresh) {
      OpLog.warn(
        'OperationLogSyncService: Upload blocked - this is a fresh client with no history. ' +
          'Download remote data first before uploading.',
      );
      return null;
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
    try {
      if (result.piggybackedOps.length > 0) {
        const processResult = await this.remoteOpsProcessingService.processRemoteOps(
          result.piggybackedOps,
        );
        localWinOpsCreated = processResult.localWinOpsCreated;
      }
    } finally {
      // handleRejectedOps may create merged ops for concurrent modifications
      // These need to be uploaded, so we add them to localWinOpsCreated
      // Pass a download callback so the handler can trigger downloads for concurrent mods
      const downloadCallback = (downloadOptions?: {
        forceFromSeq0?: boolean;
      }): Promise<DownloadResultForRejection> =>
        this.downloadRemoteOps(syncProvider, downloadOptions);
      rejectionResult = await this.rejectedOpsHandlerService.handleRejectedOps(
        result.rejectedOps,
        downloadCallback,
      );
      localWinOpsCreated += rejectionResult.mergedOpsCreated;
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
      ...result,
      localWinOpsCreated,
      permanentRejectionCount: rejectionResult.permanentRejectionCount,
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
    options?: { forceFromSeq0?: boolean },
  ): Promise<{
    serverMigrationHandled: boolean;
    localWinOpsCreated: number;
    newOpsCount: number;
    allOpClocks?: VectorClock[];
    snapshotVectorClock?: VectorClock;
    cancelled?: boolean;
  }> {
    const result = await this.downloadService.downloadRemoteOps(syncProvider, options);

    // Server migration detected: gap on empty server
    // Create a SYNC_IMPORT operation with full local state to seed the new server
    if (result.needsFullStateUpload) {
      await this.serverMigrationService.handleServerMigration(syncProvider);
      // Persist lastServerSeq=0 for the migration case (server was reset)
      if (result.latestServerSeq !== undefined) {
        await syncProvider.setLastServerSeq(result.latestServerSeq);
      }
      // Return with flag indicating migration was handled - caller should upload the SYNC_IMPORT
      return { serverMigrationHandled: true, localWinOpsCreated: 0, newOpsCount: 0 };
    }

    // FILE-BASED SYNC: Handle full state snapshot from fresh download
    // When downloading from seq 0 on file-based providers (Dropbox, WebDAV, LocalFile),
    // we receive the complete application state in snapshotState. This must be hydrated
    // directly instead of processing incremental ops (which are already reflected in the state).
    if (result.snapshotState) {
      OpLog.normal(
        'OperationLogSyncService: Received snapshotState from file-based sync. Hydrating...',
      );

      // Check if client has unsynced local ops that would be lost
      const unsyncedOps = await this.opLogStore.getUnsynced();
      const hasLocalChanges = unsyncedOps.length > 0;

      if (hasLocalChanges) {
        // Only throw LocalDataConflictError if unsynced ops contain meaningful user data.
        // Fresh clients may have initial state ops (settings, etc.), but these shouldn't
        // trigger a conflict dialog - we should just download the remote data.
        //
        // Meaningful user data = task/project/tag CREATE/UPDATE operations
        // These are entities the user explicitly created/modified and would lose if overwritten.
        // Also includes full-state ops (backup import, sync import, repair) which represent
        // explicit user actions that should trigger conflict resolution.
        const USER_ENTITY_TYPES = ['TASK', 'PROJECT', 'TAG', 'NOTE'];
        const hasMeaningfulUserData = unsyncedOps.some((entry) => {
          // Full-state ops are always meaningful - they represent explicit user actions
          if (FULL_STATE_OP_TYPES.has(entry.op.opType as OpType)) {
            return true;
          }
          // Regular ops: meaningful if they modify user entities
          return (
            USER_ENTITY_TYPES.includes(entry.op.entityType) &&
            (entry.op.opType === OpType.Create || entry.op.opType === OpType.Update)
          );
        });

        if (hasMeaningfulUserData) {
          // Client has meaningful user data - show conflict dialog
          OpLog.warn(
            `OperationLogSyncService: Client has ${unsyncedOps.length} unsynced local ops ` +
              'with meaningful user data. Throwing LocalDataConflictError for conflict resolution dialog.',
          );

          throw new LocalDataConflictError(
            unsyncedOps.length,
            result.snapshotState as Record<string, unknown>,
            result.snapshotVectorClock,
          );
        } else {
          // Only system/config ops - proceed with download (don't throw)
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
        if (isFreshClient && this._hasMeaningfulLocalData()) {
          OpLog.warn(
            'OperationLogSyncService: Fresh client detected with meaningful local data in store. ' +
              'Throwing LocalDataConflictError for conflict resolution dialog.',
          );

          throw new LocalDataConflictError(
            0, // No unsynced ops, but we have meaningful store data
            result.snapshotState as Record<string, unknown>,
            result.snapshotVectorClock,
          );
        }

        // Original flow for truly fresh clients (no store data)
        if (isFreshClient) {
          OpLog.warn(
            'OperationLogSyncService: Fresh client detected. Requesting confirmation before accepting snapshot.',
          );

          const confirmed = this._showFreshClientSyncConfirmation(1); // Show as "1 snapshot"
          if (!confirmed) {
            OpLog.normal(
              'OperationLogSyncService: User cancelled fresh client sync. Snapshot not applied.',
            );
            this.snackService.open({
              msg: T.F.SYNC.S.FRESH_CLIENT_SYNC_CANCELLED,
            });
            return {
              serverMigrationHandled: false,
              localWinOpsCreated: 0,
              newOpsCount: 0,
            };
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

      // Persist lastServerSeq after hydration
      if (result.latestServerSeq !== undefined) {
        await syncProvider.setLastServerSeq(result.latestServerSeq);
      }

      OpLog.normal('OperationLogSyncService: Snapshot hydration complete.');

      return {
        serverMigrationHandled: false,
        localWinOpsCreated: 0,
        newOpsCount: 0, // Snapshot applied, not incremental ops
        allOpClocks: result.allOpClocks,
        snapshotVectorClock: result.snapshotVectorClock,
      };
    }

    if (result.newOps.length === 0) {
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
        serverMigrationHandled: false,
        localWinOpsCreated: 0,
        newOpsCount: 0,
        // Include all op clocks from forced download (even though no new ops)
        allOpClocks: result.allOpClocks,
        // Include snapshot vector clock for superseded op resolution
        snapshotVectorClock: result.snapshotVectorClock,
      };
    }

    // SAFETY: Fresh client confirmation
    // If this is a wholly fresh client (no local data) receiving remote data for the first time,
    // show a confirmation dialog to prevent accidental data loss scenarios where a fresh client
    // could overwrite existing remote data.
    const isFreshClient = await this.isWhollyFreshClient();
    if (isFreshClient && result.newOps.length > 0) {
      OpLog.warn(
        `OperationLogSyncService: Fresh client detected. Requesting confirmation before accepting ${result.newOps.length} remote ops.`,
      );

      const confirmed = this._showFreshClientSyncConfirmation(result.newOps.length);
      if (!confirmed) {
        OpLog.normal(
          'OperationLogSyncService: User cancelled fresh client sync. Remote data not applied.',
        );
        this.snackService.open({
          msg: T.F.SYNC.S.FRESH_CLIENT_SYNC_CANCELLED,
        });
        return { serverMigrationHandled: false, localWinOpsCreated: 0, newOpsCount: 0 };
      }

      OpLog.normal(
        'OperationLogSyncService: User confirmed fresh client sync. Proceeding with remote data.',
      );
    }

    const processResult = await this.remoteOpsProcessingService.processRemoteOps(
      result.newOps,
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Handle SYNC_IMPORT conflict: all remote ops filtered by local import
    // This happens when user imports/restores data locally, and other devices
    // have been creating changes without knowledge of that import.
    //
    // IMPORTANT: We only show the dialog when isLocalUnsyncedImport is true.
    // This means the filtering import is a LOCAL import that hasn't been synced yet.
    // If the import is from another client (remote) or already synced, we silently
    // discard the old ops - no user choice is needed because the import was already
    // accepted. This prevents the dialog from showing multiple times when old ops
    // arrive after a remote import was already applied.
    // ─────────────────────────────────────────────────────────────────────────
    if (
      processResult.allOpsFilteredBySyncImport &&
      processResult.filteredOpCount > 0 &&
      processResult.isLocalUnsyncedImport
    ) {
      OpLog.warn(
        `OperationLogSyncService: All ${processResult.filteredOpCount} remote ops filtered by local SYNC_IMPORT. ` +
          `Showing conflict resolution dialog (local unsynced import detected).`,
      );

      const resolution = await this.syncImportConflictDialogService.showConflictDialog({
        filteredOpCount: processResult.filteredOpCount,
        localImportTimestamp: processResult.filteringImport?.timestamp ?? Date.now(),
        localImportClientId: processResult.filteringImport?.clientId ?? 'unknown',
      });

      switch (resolution) {
        case 'USE_LOCAL':
          OpLog.normal(
            'OperationLogSyncService: User chose USE_LOCAL. Force uploading local state.',
          );
          await this.forceUploadLocalState(syncProvider);
          return {
            serverMigrationHandled: false,
            localWinOpsCreated: 0,
            newOpsCount: 0,
          };
        case 'USE_REMOTE':
          OpLog.normal(
            'OperationLogSyncService: User chose USE_REMOTE. Force downloading remote state.',
          );
          await this.forceDownloadRemoteState(syncProvider);
          return {
            serverMigrationHandled: false,
            localWinOpsCreated: 0,
            newOpsCount: 0,
          };
        case 'CANCEL':
        default:
          OpLog.normal(
            'OperationLogSyncService: User cancelled sync import conflict resolution.',
          );
          return {
            serverMigrationHandled: false,
            localWinOpsCreated: 0,
            newOpsCount: 0,
            cancelled: true,
          };
      }
    } else if (
      processResult.allOpsFilteredBySyncImport &&
      processResult.filteredOpCount > 0
    ) {
      // Ops were filtered but it's NOT a local unsynced import (remote or already synced).
      // This is expected behavior - old ops from before a previously-accepted import are
      // silently discarded. No dialog needed.
      OpLog.normal(
        `OperationLogSyncService: ${processResult.filteredOpCount} remote ops silently filtered by ` +
          `already-accepted SYNC_IMPORT (not showing dialog - import was remote or already synced).`,
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
      serverMigrationHandled: false,
      localWinOpsCreated: processResult.localWinOpsCreated,
      newOpsCount: result.newOps.length,
      allOpClocks: result.allOpClocks,
      snapshotVectorClock: result.snapshotVectorClock,
    };
  }

  /**
   * Shows a confirmation dialog for fresh client sync.
   * Uses synchronous window.confirm() to prevent race conditions where
   * pending operations could be added during an async dialog.
   */
  private _showFreshClientSyncConfirmation(opCount: number): boolean {
    const title = this.translateService.instant(T.F.SYNC.D_FRESH_CLIENT_CONFIRM.TITLE);
    const message = this.translateService.instant(
      T.F.SYNC.D_FRESH_CLIENT_CONFIRM.MESSAGE,
      {
        count: opCount,
      },
    );
    return confirmDialog(`${title}\n\n${message}`);
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
    OpLog.warn(
      'OperationLogSyncService: Force uploading local state - creating SYNC_IMPORT to override remote.',
    );

    // Create SYNC_IMPORT with current local state
    // Pass skipServerEmptyCheck=true because we're forcing upload even if server has data
    await this.serverMigrationService.handleServerMigration(syncProvider, {
      skipServerEmptyCheck: true,
    });

    // Upload the SYNC_IMPORT (and any pending ops)
    // Skip piggybacked ops processing and server migration check because:
    // 1. SYNC_IMPORT supersedes all previous ops anyway
    // 2. Piggybacked ops may be encrypted with a different key (e.g., after password change)
    //    which would cause DecryptError
    // 3. Server migration check downloads ops which would fail with DecryptError if password changed
    //
    // Use isCleanSlate=true to ensure server deletes ALL existing data before accepting
    // the new SYNC_IMPORT. This is critical for recovery scenarios like decrypt errors
    // where the server may have data encrypted with a different password.
    await this.uploadService.uploadPendingOps(syncProvider, {
      skipPiggybackProcessing: true,
      isCleanSlate: true,
    });

    OpLog.normal('OperationLogSyncService: Force upload complete.');
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
    if (result.snapshotState) {
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

      // Update lastServerSeq after hydration
      if (result.latestServerSeq !== undefined) {
        await syncProvider.setLastServerSeq(result.latestServerSeq);
      }

      OpLog.normal(
        'OperationLogSyncService: Force download snapshot hydration complete.',
      );
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

      // Process all remote ops (no confirmation needed - user already chose USE_REMOTE)
      await this.remoteOpsProcessingService.processRemoteOps(result.newOps);

      // Update lastServerSeq
      if (result.latestServerSeq !== undefined) {
        await syncProvider.setLastServerSeq(result.latestServerSeq);
      }
    }

    OpLog.normal(
      `OperationLogSyncService: Force download complete. Processed ${result.newOps.length} ops.`,
    );
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
        'Server has only unencrypted data but local config has encryption enabled. ' +
        'Another client must have disabled encryption. Updating local config to match.',
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

    // Update config to disable encryption
    await syncProvider.setPrivateCfg({
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
  ): provider is OperationSyncCapable & SyncProviderServiceInterface<SyncProviderId> {
    const providerWithCfg = provider as Partial<
      SyncProviderServiceInterface<SyncProviderId>
    >;
    return (
      typeof providerWithCfg.privateCfg?.load === 'function' &&
      typeof providerWithCfg.setPrivateCfg === 'function'
    );
  }
}
