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
    // Must be online
    if (!isOnline()) {
      return false;
    }

    // Don't overlap with full sync
    if (this._providerManager.isSyncInProgress) {
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
   */
  private async _performUpload(): Promise<void> {
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

    try {
      OpLog.verbose('ImmediateUploadService: Starting immediate upload...');

      // Use sync service's uploadPendingOps which includes migration detection callback.
      // This ensures SYNC_IMPORT is created when switching to a new/empty server.
      // Returns null if fresh client (blocked from upload).
      const result = await this._syncService.uploadPendingOps(syncCapableProvider);
      if (!result) {
        OpLog.verbose('ImmediateUploadService: Upload returned null (fresh client)');
        return;
      }

      // Note: piggybacked ops and rejected ops are already handled by _syncService.uploadPendingOps()
      // We just need to handle the sync status here.

      // If LWW local-wins created new update ops from piggybacked ops,
      // do a follow-up upload to push them to the server immediately
      if ((result.localWinOpsCreated ?? 0) > 0) {
        OpLog.verbose(
          `ImmediateUploadService: LWW created ${result.localWinOpsCreated} local-win op(s), re-uploading`,
        );
        await this._syncService.uploadPendingOps(syncCapableProvider);
      }

      // Don't show checkmark when piggybacked ops exist - there may be more
      // remote ops pending. Let normal sync cycle confirm full sync state.
      if (result.piggybackedOps.length > 0) {
        OpLog.verbose(
          `ImmediateUploadService: Uploaded ${result.uploadedCount} ops, ` +
            `processed ${result.piggybackedOps.length} piggybacked (checkmark deferred)`,
        );
        return;
      }

      // Show checkmark ONLY when server confirms no pending remote ops
      // (empty piggybackedOps means we're confirmed in sync)
      if (result.uploadedCount > 0 || (result.localWinOpsCreated ?? 0) > 0) {
        this._providerManager.setSyncStatus('IN_SYNC');
        OpLog.verbose(
          `ImmediateUploadService: Uploaded ${result.uploadedCount} ops, confirmed in sync`,
        );
      }
    } catch (e) {
      // Check for storage quota exceeded - this requires user action
      const message = e instanceof Error ? e.message : 'Unknown error';
      handleStorageQuotaError(message);

      // Silent failure for other errors - normal sync will pick up pending ops
      OpLog.warn(
        'ImmediateUploadService: Immediate upload failed, will retry on normal sync',
        e,
      );
      // Don't emit ERROR state - transient failures are expected
    }
  }

  ngOnDestroy(): void {
    this._subscription?.unsubscribe();
    this._subscription = null;
  }
}
