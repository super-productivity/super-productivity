import { inject, Injectable } from '@angular/core';
import { distinctUntilChanged, map, merge, Observable, shareReplay } from 'rxjs';
import { SyncWrapperService } from './sync-wrapper.service';
import { SyncCycleGuardService } from '../../op-log/sync/sync-cycle-guard.service';

/**
 * The single busy/idle definition for sync work, so callers stop polling three
 * signals independently and disagreeing about what "busy" means.
 *
 * ## What counts as busy
 *
 * The union of the three authorities, because none of them covers every flow:
 *
 * | signal                             | sync() | conflict dialog | forceUpload | immediate upload | WS download |
 * |------------------------------------|--------|-----------------|-------------|------------------|-------------|
 * | `SyncCycleGuard.isActive`          | yes    | yes             | yes         | yes              | yes         |
 * | `isEncryptionOperationInProgress`  | no     | no              | yes         | no               | no          |
 * | `isSyncInProgress$`                | yes    | yes             | no          | no               | no          |
 *
 * The cycle guard is the widest — it is claimed by all four entry points — so
 * the union is in practice `isActive || isEncryptionOperationInProgress`. The
 * encryption flag is still required: `runWithSyncBlocked()` holds it across the
 * pre-guard drain window, before any cycle is claimed. `isSyncInProgress$` is
 * folded in for defence in depth; it is not known to add coverage today, and is
 * cheap.
 *
 * Provider `SYNCING` status is deliberately NOT an input. It is presentation
 * state set only by `sync()`, so it is strictly narrower than the guard, and
 * treating it as a fourth authority would be a lock that disagrees with the
 * other three. (`SyncProviderManager.isSyncInProgress$` is also dead and
 * semantically broken — it filters out the very status that ends a cycle.)
 *
 * ## Why an edge is needed at all
 *
 * `isActive` is a plain field and `isEncryptionOperationInProgress` is a getter,
 * so neither can tell a subscriber when it stops being true.
 * {@link SyncCycleGuardService.released$} supplies the missing edge. Recomputing
 * the whole union on every edge also makes emission order self-correcting:
 * `sync()`'s `finally` clears `isSyncInProgress$` while the guard is still held,
 * and only the guard's release resolves the union to idle.
 *
 * ## What this is not
 *
 * Not an exclusion authority and not a lock. `SyncCycleGuard.tryBegin()` remains
 * the only thing that may grant a cycle; this observable answers "is anything
 * running?", which is inherently stale the moment it is read. Gate on it to
 * avoid starting pointless work, then still claim the guard and handle refusal.
 */
@Injectable({ providedIn: 'root' })
export class SyncBusyService {
  private _syncWrapper = inject(SyncWrapperService);
  private _cycleGuard = inject(SyncCycleGuardService);

  /**
   * Emits the current busy state, and again on every transition. Recomputed
   * from all three signals on each edge rather than tracked incrementally, so
   * no interleaving of the underlying sets can desynchronise it.
   *
   * Emits on subscribe: all three inputs replay a current value, so the merge is
   * seeded without a `startWith`.
   *
   * Uses the guard's full activity edge rather than only its release: the side
   * channels claim a cycle without touching either wrapper signal, so a
   * release-only input would leave those cycles reported as idle for their
   * entire duration.
   */
  readonly isBusy$: Observable<boolean> = merge(
    this._syncWrapper.isSyncInProgress$,
    this._syncWrapper.isEncryptionOperationInProgress$,
    this._cycleGuard.isActive$,
  ).pipe(
    map(() => this.isBusy),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  /**
   * Point-in-time read, for the synchronous check-before-first-await pattern the
   * sync entry points use. Inherently stale once returned — see the class
   * docblock; it never substitutes for `tryBegin()`.
   */
  get isBusy(): boolean {
    return (
      this._cycleGuard.isActive ||
      this._syncWrapper.isEncryptionOperationInProgress ||
      this._syncWrapper.isSyncInProgressSync()
    );
  }
}
