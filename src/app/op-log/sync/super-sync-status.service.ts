import { computed, Injectable, signal } from '@angular/core';

/** Maximum age in milliseconds for a remote check to be considered fresh */
const REMOTE_CHECK_MAX_AGE_MS = 60000; // 1 minute

/**
 * Tracks sync status for the UI indicator (used by all sync providers).
 *
 * This service manages:
 * 1. Whether a successful remote check has completed since startup
 * 2. Whether there are pending local operations to upload
 * 3. Whether the last remote check is recent enough (within 1 minute)
 *
 * The UI uses this to show:
 * - Single checkmark: sync is enabled and ready
 * - Double checkmark: no pending ops AND we've successfully synced with remote recently
 */
@Injectable({
  providedIn: 'root',
})
export class SuperSyncStatusService {
  // Has a successful remote check completed within the last minute?
  private _hasRecentRemoteCheck = signal(false);

  // Timer handle for expiring the remote check after 1 minute
  private _remoteCheckExpiryTimer: ReturnType<typeof setTimeout> | null = null;

  // Are there pending local operations?
  private _hasPendingOps = signal(true);

  /**
   * True when there are no pending local operations (all uploaded).
   * Used to show single checkmark in UI.
   */
  readonly hasNoPendingOps = computed(() => !this._hasPendingOps());

  /**
   * Confirmed in sync = no pending ops AND we've successfully checked remote recently.
   * Used to show double checkmark in UI.
   */
  readonly isConfirmedInSync = computed(() => {
    return !this._hasPendingOps() && this._hasRecentRemoteCheck();
  });

  /**
   * Called after successfully checking the remote server for updates.
   * This includes both cases where updates were found and where no updates were found.
   * The "recent" status expires after 1 minute.
   */
  markRemoteChecked(): void {
    this._hasRecentRemoteCheck.set(true);

    // Cancel any existing expiry timer
    if (this._remoteCheckExpiryTimer !== null) {
      clearTimeout(this._remoteCheckExpiryTimer);
    }

    // Set new expiry timer - after 1 minute, mark as no longer recent
    this._remoteCheckExpiryTimer = setTimeout(() => {
      this._hasRecentRemoteCheck.set(false);
      this._remoteCheckExpiryTimer = null;
    }, REMOTE_CHECK_MAX_AGE_MS);
  }

  /**
   * Called when sync provider changes or is disabled.
   * Resets to default state.
   */
  clearScope(): void {
    // Cancel any pending expiry timer
    if (this._remoteCheckExpiryTimer !== null) {
      clearTimeout(this._remoteCheckExpiryTimer);
      this._remoteCheckExpiryTimer = null;
    }
    this._hasRecentRemoteCheck.set(false);
    this._hasPendingOps.set(true);
  }

  /**
   * Called after sync operations to update whether there are pending ops.
   */
  updatePendingOpsStatus(hasPending: boolean): void {
    this._hasPendingOps.set(hasPending);
  }
}
