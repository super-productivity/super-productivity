import { Injectable } from '@angular/core';

/**
 * Session-scoped latch that records whether post-sync state validation
 * failed at any point during the current sync session.
 *
 * A "sync session" is a single top-level sync operation:
 * - `SyncWrapperService.sync()`
 * - `SyncWrapperService._forceDownload()`
 * - `SyncWrapperService.resolveSyncConflict()` (USE_REMOTE branch)
 *
 * These entry points are serialised by the wrapper's global lock, so a
 * single mutable boolean is safe — there is never more than one session
 * active at a time.
 *
 * ## Why a latch instead of typed return plumbing?
 *
 * Validation runs in several places (`RemoteOpsProcessingService.validateAfterSync`,
 * `ConflictResolutionService._validateAndRepairAfterResolution`, etc.) called
 * from many code paths (download, upload, piggyback, retry, USE_REMOTE force
 * download). Threading a `validationFailed: boolean` through every result type
 * meant adding the field to seven discriminated-union variants and remembering
 * to forward it at every junction. A new variant or call site that forgot to
 * carry the flag would silently let `IN_SYNC` ride over corrupt state.
 *
 * The latch collapses that to: validation site flips it, wrapper reads it
 * once before deciding `IN_SYNC` vs `ERROR`. Issue #7330.
 *
 * ## Contract
 *
 * - `reset()` must be called by every wrapper entry point before doing work.
 * - `setFailed()` is called by validation sites whenever
 *   `validateAndRepairCurrentState` returns `false`.
 * - `hasFailed()` is read by the wrapper before claiming IN_SYNC.
 */
@Injectable({ providedIn: 'root' })
export class SyncSessionValidationService {
  private _failed = false;

  reset(): void {
    this._failed = false;
  }

  setFailed(): void {
    this._failed = true;
  }

  hasFailed(): boolean {
    return this._failed;
  }
}
