import { Injectable } from '@angular/core';

/**
 * In-tab mutual-exclusion guard for the three top-level sync entry points:
 * - `SyncWrapperService.sync()`        (periodic / user-triggered full sync)
 * - `ImmediateUploadService._performUpload()` (side channel)
 * - `WsTriggeredDownloadService._downloadOps()` (side channel)
 *
 * ## Why (#8309)
 * These flows share the per-tab {@link SyncSessionValidationService} latch,
 * whose single-mutable-boolean design is only safe if at most ONE session is
 * active at a time. They also run lock-free seams — the SYNC_IMPORT
 * conflict-gate decision (which awaits a user dialog) and `setLastServerSeq`
 * persistence — that a concurrent flow can invalidate. The apply phase is
 * already serialized by the cross-tab `OPERATION_LOG`/`UPLOAD`/`DOWNLOAD` Web
 * Locks; this guard closes the remaining in-tab seams and prevents
 * `withSession()` latch misattribution (two overlapping sessions sharing one
 * latch).
 *
 * ## Why a synchronous in-memory skip-guard, not a Web Lock
 * - The conflict gate awaits a user dialog. Holding a cross-tab Web Lock across
 *   that wait would stall other tabs until the 30s lock timeout.
 * - Every entry point claims the cycle with {@link tryBegin} *before its first
 *   `await`*, so the check-and-set is atomic on the single-threaded event loop,
 *   and skips when a cycle is already active. Skipping (rather than queuing) is
 *   the correct semantics: an opportunistic side channel must not mutate state
 *   while another cycle (or its conflict dialog) is open, and a user-triggered
 *   sync that collides with a short-lived side channel is simply retried on the
 *   next trigger. Because nothing ever waits on the guard, it cannot deadlock.
 *
 * Cross-tab apply-phase serialization remains the job of the existing Web
 * Locks; cross-tab gate/seq staleness is out of scope for this guard.
 */
@Injectable({ providedIn: 'root' })
export class SyncCycleGuardService {
  private _isActive = false;

  get isActive(): boolean {
    return this._isActive;
  }

  /**
   * Synchronously claim the cycle. Returns `false` (without claiming) if a
   * cycle is already active. MUST be called before the caller's first `await`
   * so the check-and-set is atomic within the single-threaded event loop.
   */
  tryBegin(): boolean {
    if (this._isActive) {
      return false;
    }
    this._isActive = true;
    return true;
  }

  /** Release the cycle. Always call from a `finally` block. */
  end(): void {
    this._isActive = false;
  }

  /** @internal Test-only reset for the root singleton between unit tests. */
  _resetForTest(): void {
    this._isActive = false;
  }
}
