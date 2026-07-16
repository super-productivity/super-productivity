import { Injectable } from '@angular/core';
import { firstValueFrom, Subject, timer } from 'rxjs';

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
 *   and returns false when a cycle is already active. Cycle entry points never
 *   wait on the guard itself: immediate/user-triggered flows skip, while the
 *   WebSocket high-watermark queue retries later. Therefore the guard cannot
 *   deadlock.
 *
 * ## Waiting (#9074)
 * The no-wait rule above applies to the three CYCLE entry points only. A
 * non-cycle caller performing a destructive config operation
 * (`SyncWrapperService.runWithSyncBlocked`) may {@link waitUntilFree} with a
 * bounded timeout to drain an in-flight side-channel cycle before mutating the
 * epoch's remote state. Such callers must have blocked new cycles first (the
 * encryption-operation flag), or the wait result is stale immediately.
 *
 * Cross-tab apply-phase serialization remains the job of the existing Web
 * Locks; cross-tab gate/seq staleness is out of scope for this guard.
 */
@Injectable({ providedIn: 'root' })
export class SyncCycleGuardService {
  private _isActive = false;
  private _released$ = new Subject<void>();

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
    this._released$.next();
  }

  /**
   * Waits (bounded) until no cycle is active. Returns `false` on timeout with
   * the cycle still active. For non-cycle callers only — see the class doc's
   * "Waiting" section; cycle entry points must keep using {@link tryBegin}.
   */
  async waitUntilFree(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (this._isActive) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        return false;
      }
      await Promise.race([
        firstValueFrom(this._released$),
        firstValueFrom(timer(remaining)),
      ]);
    }
    return true;
  }

  /** @internal Test-only reset for the root singleton between unit tests. */
  _resetForTest(): void {
    this._isActive = false;
  }
}
