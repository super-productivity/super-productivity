import { Injectable } from '@angular/core';
import { BehaviorSubject, distinctUntilChanged, Observable } from 'rxjs';

/**
 * In-tab mutual-exclusion guard for the three top-level sync entry points:
 * - `SyncWrapperService.sync()`        (periodic / user-triggered full sync)
 * - `ImmediateUploadService._performUpload()` (side channel)
 * - `WsTriggeredDownloadService._drainPending()` (queued side channel)
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
 *   and returns false when a cycle is already active. Callers never wait on the
 *   guard itself: immediate/user-triggered flows skip, while the WebSocket
 *   high-watermark queue retries later. Therefore the guard cannot deadlock.
 *
 * {@link isActive$} does NOT weaken that: it reports activity, it does not grant
 * it. A subscriber may use it to retry `tryBegin()` at a moment when the claim
 * is likelier to succeed, but must still treat a `false` return as "skip/retry
 * later" and must never block on the notification. Awaiting an emission as if it
 * were a lock hand-off would reintroduce exactly the deadlock this design rules
 * out — it carries no claim, and any number of subscribers may race for the next
 * `tryBegin()`.
 *
 * Cross-tab apply-phase serialization remains the job of the existing Web
 * Locks; cross-tab gate/seq staleness is out of scope for this guard.
 */
@Injectable({ providedIn: 'root' })
export class SyncCycleGuardService {
  private _isActive$ = new BehaviorSubject(false);

  /**
   * Cycle activity as an edge, for busy definitions built on {@link isActive}
   * (the getter alone cannot tell a subscriber when it changes). Emits on BOTH
   * transitions: the side channels claim a cycle without touching any other
   * sync signal, so a claim-only-visible-on-release stream would report those
   * cycles as idle for their whole duration.
   *
   * Observing activity is NOT holding it — see the class docblock.
   */
  readonly isActive$: Observable<boolean> = this._isActive$
    .asObservable()
    .pipe(distinctUntilChanged());

  get isActive(): boolean {
    return this._isActive$.getValue();
  }

  /**
   * Synchronously claim the cycle. Returns `false` (without claiming) if a
   * cycle is already active. MUST be called before the caller's first `await`
   * so the check-and-set is atomic within the single-threaded event loop.
   */
  tryBegin(): boolean {
    if (this.isActive) {
      return false;
    }
    this._isActive$.next(true);
    return true;
  }

  /** Release the cycle. Always call from a `finally` block. */
  end(): void {
    this._setInactive();
  }

  /** @internal Test-only reset for the root singleton between unit tests. */
  _resetForTest(): void {
    this._setInactive();
  }

  /**
   * Single active→inactive transition point, so every release site notifies.
   * `end()` is called unconditionally from `finally` blocks that may not hold
   * the cycle, so the guard suppresses no-op releases rather than emitting a
   * spurious edge for a cycle that was never active.
   */
  private _setInactive(): void {
    if (!this.isActive) {
      return;
    }
    this._isActive$.next(false);
  }
}
