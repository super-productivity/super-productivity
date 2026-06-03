import { Injectable } from '@angular/core';
import { SyncLog } from '../../core/log';

/**
 * Session-scoped latch that records whether post-sync state validation
 * failed at any point during the current sync session.
 *
 * A "sync session" is a single top-level sync operation:
 * - `SyncWrapperService._sync()`
 * - `SyncWrapperService._forceDownload()`
 * - `WsTriggeredDownloadService._downloadOps()`
 * - `ImmediateUploadService._performUpload()`
 *
 * The USE_REMOTE branch in `SyncWrapperService._handleLocalDataConflict`
 * is *not* an entry point — it runs inside `_sync()`'s session and uses
 * `reset()` for sub-scope re-scoping (see the `reset()` docs below).
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
 * - Every sync entry point wraps its work in `withSession()`. The wrapper
 *   resets the latch up-front and clears the session marker on completion.
 * - `setFailed()` is called by validation sites when state is corrupt.
 *   Outside an active session it logs an error (programming-error guard) but
 *   still flips the flag so we err on the side of surfacing the failure.
 * - `hasFailed()` is read by the wrapper before claiming IN_SYNC.
 *
 * ## Why `withSession` instead of `reset()` + `try/finally`?
 *
 * The previous API had a "remember to call reset() before doing work"
 * contract enforced only by code review. A new entry point that forgot the
 * reset would inherit a leaked-failed latch from a prior session. The
 * callback form makes the session boundary unambiguous and self-clearing,
 * and lets us assert "no nested sessions" — a re-entry that would silently
 * clobber the outer session's state.
 */
@Injectable({ providedIn: 'root' })
export class SyncSessionValidationService {
  private _failed = false;
  private _sessionActive = false;

  /**
   * Run `work` inside a fresh validation session.
   *
   * Resets the latch at entry, marks a session as active for the duration,
   * and clears the marker on completion (success or error). If a session is
   * already active when called, logs an error and runs `work` in the outer
   * session's context without resetting (treats the inner call as a no-op
   * boundary so the outer's state isn't clobbered).
   */
  async withSession<T>(work: () => Promise<T>): Promise<T> {
    if (this._sessionActive) {
      SyncLog.err(
        'SyncSessionValidationService: nested withSession() detected — this is a ' +
          'programming error. Inner call will run in the outer session context.',
      );
      return await work();
    }
    this._sessionActive = true;
    this._failed = false;
    try {
      return await work();
    } finally {
      this._sessionActive = false;
    }
  }

  setFailed(): void {
    if (!this._sessionActive) {
      // Programming error: validation fired without a sync entry point
      // having opened a session. Still flip the flag so the failure isn't
      // silently lost — the next session's reset will clear it cleanly.
      SyncLog.err(
        'SyncSessionValidationService: setFailed() called outside an active ' +
          'session. A sync code path is calling validation without going through ' +
          'a known entry point.',
      );
    }
    this._failed = true;
  }

  hasFailed(): boolean {
    return this._failed;
  }

  /**
   * Clear the failed flag within an already-open session.
   *
   * The intended use is sub-scope re-scoping: a recovery branch within a
   * sync session wants to ignore failures recorded earlier in the same
   * session and start a fresh validation scope (e.g., USE_REMOTE conflict
   * recovery in `SyncWrapperService._handleLocalDataConflict`).
   *
   * This is NOT a substitute for `withSession()` — top-level entry points
   * MUST use `withSession()`. Calling `reset()` outside an active session
   * still works but logs a warning, since that pattern shouldn't appear
   * outside test setup.
   */
  reset(): void {
    if (!this._sessionActive) {
      SyncLog.err(
        'SyncSessionValidationService: reset() called outside an active ' +
          'session. Top-level sync entry points must use withSession() instead.',
      );
    }
    this._failed = false;
  }

  /**
   * @internal Test-only helper to clear state between unit tests that
   * inject the singleton directly. Production code MUST use `withSession()`.
   */
  _resetForTest(): void {
    this._failed = false;
    this._sessionActive = false;
  }
}
