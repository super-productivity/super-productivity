import { inject, Injectable, OnDestroy } from '@angular/core';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, exhaustMap, filter, take } from 'rxjs/operators';
import { isOnline } from '../../util/is-online';
import { SyncProviderManager } from '../sync-providers/provider-manager.service';
import { OperationLogSyncService } from './operation-log-sync.service';
import { isFileBasedProvider, isOperationSyncCapable } from './operation-sync.util';
import { OpLog } from '../../core/log';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { handleStorageQuotaError } from './sync-error-utils';
import { SyncWrapperService } from '../../imex/sync/sync-wrapper.service';
import { SyncSessionValidationService } from './sync-session-validation.service';
import { SyncCycleGuardService } from './sync-cycle-guard.service';
import {
  ForceUploadFailedError,
  ForceUploadPendingOpsError,
  IncompleteRemoteOperationsError,
} from '../core/errors/sync-errors';
import { SnackService } from '../../core/snack/snack.service';
import { T } from '../../t.const';

const IMMEDIATE_UPLOAD_DEBOUNCE_MS = 2000;

/**
 * Uploads operations to sync providers immediately after they're persisted to IndexedDB.
 *
 * This service provides near-real-time sync by uploading operations as they happen,
 * rather than waiting for periodic sync triggers. Features:
 *
 * - 2000ms debounce to batch rapid operations
 * - Silent failure (normal sync will pick up pending ops)
 * - Handles piggybacked operations from server responses
 *
 * ## Provider Types
 * - **SuperSync**: Uses API-based sync directly - IMMEDIATE UPLOAD ENABLED
 * - **File-based (Dropbox, WebDAV, LocalFile)**: IMMEDIATE UPLOAD DISABLED
 *   (uses periodic sync instead to avoid excessive API calls)
 *
 * ## Checkmark (IN_SYNC) behavior
 *
 * The sync checkmark is ONLY shown when the server confirms there are no pending
 * remote operations (i.e., piggybackedOps is empty). This ensures the checkmark
 * accurately represents "fully in sync" state:
 *
 * - Upload succeeds + no piggybacked ops → Show checkmark (confirmed in sync)
 * - Upload succeeds + piggybacked ops exist → Process them, but NO checkmark
 *   (there may be more remote ops; let normal sync confirm full sync)
 *
 * Guards:
 * - Only uploads when online
 * - Only uploads for SuperSync (not file-based providers)
 * - Skips when full sync is in progress
 * - Skips for fresh clients (no history)
 */
@Injectable({
  providedIn: 'root',
})
export class ImmediateUploadService implements OnDestroy {
  private _providerManager = inject(SyncProviderManager);
  private _syncService = inject(OperationLogSyncService);
  private _dataInitStateService = inject(DataInitStateService);
  private _syncWrapper = inject(SyncWrapperService);
  private _sessionValidation = inject(SyncSessionValidationService);
  private _syncCycleGuard = inject(SyncCycleGuardService);
  private _snackService = inject(SnackService);

  private _uploadTrigger$ = new Subject<void>();
  private _subscription: Subscription | null = null;
  private _isInitialized = false;
  private _pendingTriggerCount = 0;

  constructor() {
    // Initialize only after data is loaded to avoid race condition where
    // upload attempts happen before sync config is loaded from IndexedDB.
    // This prevents 404 errors to default baseUrl during app startup.
    this._dataInitStateService.isAllDataLoadedInitially$
      .pipe(filter(Boolean), take(1))
      .subscribe(() => {
        this.initialize();
      });
  }

  /**
   * Initializes the immediate upload pipeline.
   * Call once after app initialization.
   */
  initialize(): void {
    if (this._subscription) {
      return; // Already initialized
    }

    this._subscription = this._uploadTrigger$
      .pipe(
        debounceTime(IMMEDIATE_UPLOAD_DEBOUNCE_MS),
        filter(() => this._canUpload()),
        exhaustMap(() => this._performUpload()),
      )
      .subscribe();

    this._isInitialized = true;

    if (this._pendingTriggerCount > 0) {
      OpLog.verbose(
        `ImmediateUploadService: Replaying ${this._pendingTriggerCount} queued trigger(s)`,
      );
      this._uploadTrigger$.next();
      this._pendingTriggerCount = 0;
    }

    OpLog.verbose('ImmediateUploadService: Initialized');
  }

  /**
   * Trigger an immediate upload attempt.
   * Called by OperationLogEffects after persisting an operation.
   */
  trigger(): void {
    if (this._isInitialized) {
      this._uploadTrigger$.next();
    } else {
      this._pendingTriggerCount++;
    }
  }

  /**
   * Synchronous guard checks before attempting upload.
   * Immediate upload is ONLY for SuperSync - file-based providers use periodic sync.
   */
  private _canUpload(): boolean {
    // E2E tests set this flag to prevent background uploads that interfere
    // with controlled, sequential sync via syncAndWait()
    if ((globalThis as any).__SP_E2E_BLOCK_IMMEDIATE_UPLOAD) {
      return false;
    }

    // Must be online
    if (!isOnline()) {
      return false;
    }

    // Don't overlap with full sync
    if (this._providerManager.isSyncInProgress) {
      return false;
    }

    // Don't overlap with encryption operations (password change, enable/disable)
    if (this._syncWrapper.isEncryptionOperationInProgress) {
      return false;
    }

    // Must have an active provider
    const provider = this._providerManager.getActiveProvider();
    if (!provider) {
      return false;
    }

    // IMPORTANT: Only enable immediate upload for SuperSync (API-based sync).
    // File-based providers (Dropbox, WebDAV, LocalFile) should use periodic sync
    // to avoid excessive API calls and rate limiting.
    if (isFileBasedProvider(provider)) {
      return false;
    }

    // Must support operation sync (SuperSync implements this directly)
    if (!isOperationSyncCapable(provider)) {
      return false;
    }

    return true;
  }

  /**
   * Performs the immediate upload with all async checks and error handling.
   *
   * Uses OperationLogSyncService.uploadPendingOps() which includes:
   * - Server migration detection and SYNC_IMPORT creation
   * - Processing of piggybacked ops from server
   * - Handling of rejected ops
   *
   * Note: This is only called for SuperSync (file-based providers are filtered in _canUpload)
   *
   * ## Session boundary (#7330)
   *
   * uploadPendingOps() processes piggybacked remote ops, which run
   * post-sync validation (`RemoteOpsProcessingService.validateAfterSync`).
   * On corruption, validation flips the SyncSessionValidationService latch.
   * Without an explicit `withSession()` wrapper here, the latch flip would
   * either fire outside any session (logged as a contract violation and
   * silently dropped by the next normal sync's reset) or — worse — go
   * unread while `_performUpload` claimed `IN_SYNC` based purely on
   * `result.uploadedCount`. That reproduces the exact #7330 surface on
   * the immediate-upload path.
   */
  private async _performUpload(): Promise<void> {
    // #8309: opportunistically claim the sync cycle. Skip if any cycle (the
    // main sync, a force flow, or the WS-download side channel) is already
    // active — the running cycle or the next trigger covers this upload, and a
    // background upload must not mutate state / flip the session-validation
    // latch while another cycle (or its conflict dialog) is open.
    if (!this._syncCycleGuard.tryBegin()) {
      OpLog.verbose(
        'ImmediateUploadService: Skipping immediate upload — another sync cycle is active',
      );
      return;
    }
    try {
      await this._performUploadInner();
    } finally {
      this._syncCycleGuard.end();
    }
  }

  private async _performUploadInner(): Promise<void> {
    const provider = this._providerManager.getActiveProvider();
    if (!provider) {
      return;
    }

    // Check provider is ready (authenticated)
    if (!(await provider.isReady())) {
      OpLog.verbose('ImmediateUploadService: Provider not ready, skipping');
      return;
    }

    // Provider is already validated as OperationSyncCapable in _canUpload()
    const syncCapableProvider =
      provider as unknown as import('../sync-providers/provider.interface').OperationSyncCapable;

    return this._sessionValidation.withSession(async () => {
      try {
        OpLog.verbose('ImmediateUploadService: Starting immediate upload...');

        // Use sync service's uploadPendingOps which includes migration detection callback.
        // This ensures SYNC_IMPORT is created when switching to a new/empty server.
        const result = await this._syncService.uploadPendingOps(syncCapableProvider);
        if (result.kind === 'blocked_fresh_client') {
          OpLog.verbose('ImmediateUploadService: Upload blocked (fresh client)');
          return;
        }

        if (result.kind === 'cancelled') {
          OpLog.verbose(
            'ImmediateUploadService: Upload cancelled (piggybacked SYNC_IMPORT conflict)',
          );
          return;
        }

        if (result.kind === 'blocked_incompatible') {
          OpLog.warn(
            'ImmediateUploadService: Piggyback processing blocked by an incompatible operation',
          );
          this._providerManager.setSyncStatus('ERROR');
          return;
        }

        // result.kind === 'completed' from here

        // If LWW local-wins created new update ops from piggybacked ops,
        // do a follow-up upload to push them to the server immediately
        let finalResult = result;
        let totalUploadedCount = result.uploadedCount;
        let hasPermanentRejection = result.permanentRejectionCount > 0;
        let encryptionRequiredKeyMissing = result.encryptionRequiredKeyMissing === true;
        let blockedByRejectedFullState = result.blockedByRejectedFullState === true;
        if (result.localWinOpsCreated > 0) {
          OpLog.verbose(
            `ImmediateUploadService: LWW created ${result.localWinOpsCreated} local-win op(s), re-uploading`,
          );
          const followUpResult =
            await this._syncService.uploadPendingOps(syncCapableProvider);
          if (followUpResult.kind === 'blocked_incompatible') {
            OpLog.warn(
              'ImmediateUploadService: Local-win follow-up blocked by an incompatible operation',
            );
            this._providerManager.setSyncStatus('ERROR');
            return;
          }
          if (
            followUpResult.kind === 'cancelled' ||
            followUpResult.kind === 'blocked_fresh_client'
          ) {
            return;
          }
          finalResult = followUpResult;
          totalUploadedCount += followUpResult.uploadedCount;
          hasPermanentRejection ||= followUpResult.permanentRejectionCount > 0;
          encryptionRequiredKeyMissing ||=
            followUpResult.encryptionRequiredKeyMissing === true;
          blockedByRejectedFullState ||=
            followUpResult.blockedByRejectedFullState === true;
        }

        // Read the validation latch BEFORE any IN_SYNC / deferred-checkmark
        // decision. A failure during piggybacked-op processing (or the
        // re-upload above) is otherwise lost when the next normal sync
        // resets the latch on entry.
        if (this._sessionValidation.hasFailed()) {
          OpLog.err(
            'ImmediateUploadService: Post-sync validation failed during immediate upload — reporting ERROR',
          );
          this._providerManager.setSyncStatus('ERROR');
          return;
        }

        // Don't show checkmark when piggybacked ops exist - there may be more
        // remote ops pending. Let normal sync cycle confirm full sync state.
        if (hasPermanentRejection) {
          this._providerManager.setSyncStatus('ERROR');
          return;
        }

        if (blockedByRejectedFullState) {
          this._providerManager.setSyncStatus('ERROR');
          return;
        }

        if (encryptionRequiredKeyMissing) {
          this._providerManager.setSyncStatus('UNKNOWN_OR_CHANGED');
          return;
        }

        if (
          finalResult.piggybackedOpsCount > 0 ||
          finalResult.hasMorePiggyback ||
          finalResult.localWinOpsCreated > 0
        ) {
          OpLog.verbose(
            `ImmediateUploadService: Uploaded ${totalUploadedCount} ops, ` +
              `processed ${finalResult.piggybackedOpsCount} piggybacked (checkmark deferred)`,
          );
          return;
        }

        // Show checkmark ONLY when server confirms no pending remote ops
        // (empty piggybackedOps means we're confirmed in sync)
        if (totalUploadedCount > 0) {
          this._providerManager.setSyncStatus('IN_SYNC');
          OpLog.verbose(
            `ImmediateUploadService: Uploaded ${totalUploadedCount} ops, confirmed in sync`,
          );
        }
      } catch (e) {
        if (e instanceof ForceUploadPendingOpsError) {
          this._providerManager.setSyncStatus('UNKNOWN_OR_CHANGED');
          return;
        }

        if (e instanceof ForceUploadFailedError) {
          this._providerManager.setSyncStatus('ERROR');
          this._snackService.open({
            msg: T.F.SYNC.S.FORCE_UPLOAD_FAILED,
            type: 'ERROR',
          });
          return;
        }

        if (e instanceof IncompleteRemoteOperationsError) {
          this._providerManager.setSyncStatus('ERROR');
          if (!this._snackService.hasPendingPersistentAction()) {
            this._snackService.open({
              msg: T.F.SYNC.S.INCOMPLETE_REMOTE_OPERATIONS,
              type: 'ERROR',
              config: { duration: 0 },
            });
          }
          return;
        }

        // Check for storage quota exceeded - this requires user action
        const message = e instanceof Error ? e.message : 'Unknown error';
        handleStorageQuotaError(message);

        // Validation failure is structural state corruption, not a transient
        // network/throttle error — surface ERROR even though the upload
        // itself threw afterward.
        if (this._sessionValidation.hasFailed()) {
          this._providerManager.setSyncStatus('ERROR');
        }

        // Silent failure for other errors - normal sync will pick up pending ops
        OpLog.warn(
          'ImmediateUploadService: Immediate upload failed, will retry on normal sync',
          e,
        );
        // Don't emit ERROR state for non-validation failures - transient failures are expected
      }
    });
  }

  ngOnDestroy(): void {
    this._subscription?.unsubscribe();
    this._subscription = null;
  }
}
