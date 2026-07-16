import { DestroyRef, inject, Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter, Observable, Subject } from 'rxjs';
import { SyncWrapperService } from './sync-wrapper.service';
import { SyncBusyService } from './sync-busy.service';
import { SyncTriggerService } from './sync-trigger.service';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { SyncProviderId } from '../../op-log/sync-providers/provider.const';
import { SyncLog } from '../../core/log';

/** What a request was made against, revalidated before every run. */
interface PendingRequest {
  configEpoch: number;
  providerId: SyncProviderId | null;
}

/**
 * The single owner of generic pending background sync work.
 *
 * ## Why
 *
 * Background triggers (interval, resume, visibility, settle) previously called
 * `sync()` directly behind an `exhaustMap`, which DROPS a trigger that arrives
 * while a sync is running. The work it asked for is simply lost until something
 * else happens to trigger again. This service collapses a burst into at most one
 * pending rerun and drains it once the current work settles.
 *
 * ## Contract
 *
 * `request()` is fire-and-forget: it never throws, never returns a result, and
 * carries no failure taxonomy. Callers that need a result or an error must keep
 * awaiting `sync()` directly — initial, after-enable, before-close and explicit
 * user syncs all deliberately stay on that path.
 *
 * ## State
 *
 * `idle | running`, plus one dirty slot. A new request overwrites the slot with
 * a freshly captured epoch while remaining a single dirty bit, so a burst of
 * fifty triggers is one rerun, not fifty.
 *
 * ## Staleness
 *
 * A request captures the config epoch and active provider. Both are revalidated
 * immediately before I/O — before EVERY leading or trailing run, not only at
 * `request()` time — because the whole point is that requests get deferred, and
 * a deferral is exactly the window in which the user switches provider, moves
 * the folder, or signs out. A stale request is DROPPED, never retargeted at
 * whatever the current target happens to be: the trigger that wanted a sync of
 * target A has no opinion about target B, and a live trigger will ask again.
 *
 * ## What it must never do
 *
 * Start a shadow initial sync. A request arriving before the awaited
 * initial/after-enable path may mark dirty, but may not run: that path owns
 * opening the gate, and the scheduler drains afterwards.
 */
@Injectable({ providedIn: 'root' })
export class BackgroundSyncSchedulerService {
  private _syncWrapper = inject(SyncWrapperService);
  private _busy = inject(SyncBusyService);
  private _syncTrigger = inject(SyncTriggerService);
  private _providerManager = inject(SyncProviderManager);
  private _destroyRef = inject(DestroyRef);

  private _isRunning = false;
  private _pending: PendingRequest | null = null;
  private _settled$ = new Subject<void>();

  /**
   * Emits after every run settles, successfully or not. Deliberately narrow: it
   * carries no outcome, so a source cannot mistake it for "your work succeeded".
   * It exists so a high-watermark owner can re-check its OWN durable progress
   * condition without this service having to model per-source state.
   */
  readonly settled$: Observable<void> = this._settled$.asObservable();

  constructor() {
    // Two independent wake-ups, because either alone strands a request.
    //
    // Busy falling: work we deferred can now run.
    this._busy.isBusy$
      .pipe(
        filter((isBusy) => !isBusy),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe(() => void this._drain());

    // Gate opening: the initial sync's own `finally` releases the busy signals
    // BEFORE SyncEffects flips the gate in its `.then()`. So the busy-falling
    // wake-up above fires while the gate is still shut, finds the request
    // ineligible, and returns — and without this second wake-up nothing would
    // ever come back for it. The first background sync of the session would
    // silently never happen.
    this._syncTrigger.initialSyncGateOpen$
      .pipe(
        filter((isOpen) => isOpen),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe(() => void this._drain());
  }

  /**
   * Ask for a background full sync. Collapses into the single pending slot if
   * one is already queued, and re-captures the epoch so the newest request wins.
   */
  request(): void {
    this._pending = {
      configEpoch: this._providerManager.configEpoch,
      providerId: this._providerManager.getActiveProvider()?.id ?? null,
    };
    void this._drain();
  }

  private async _drain(): Promise<void> {
    if (this._isRunning || !this._pending) {
      return;
    }
    // Someone else's sync/maintenance is running. Stay dirty and make no sync()
    // call: it would only bounce off the guard and return HANDLED_ERROR, burning
    // the request. The busy-falling wake-up brings us back.
    if (this._busy.isBusy) {
      return;
    }
    // The awaited initial/after-enable path owns the gate. The gate wake-up
    // brings us back.
    if (!this._syncTrigger.isInitialSyncDoneSync()) {
      return;
    }

    const request = this._pending;
    this._pending = null;

    if (!this._isStillCurrent(request)) {
      SyncLog.log('BackgroundSyncScheduler: dropping stale request');
      return;
    }

    this._isRunning = true;
    try {
      // `sync()` resolves with the truthy string 'HANDLED_ERROR' on a handled
      // failure, so its result cannot be truth-tested. Nothing here reads it:
      // a settled failure and a settled success release identical state, and
      // source-specific retry policy lives with the source, not here.
      await this._syncWrapper.sync();
    } catch (err) {
      // Fire-and-forget: an unhandled throw must not escape into an unhandled
      // rejection, and must not prevent the trailing drain below.
      SyncLog.err('BackgroundSyncScheduler: background sync threw', err);
    } finally {
      this._isRunning = false;
      this._settled$.next();
    }

    // Honour dirty once. Any request that arrived during the run drains now;
    // requests arriving during THIS trailing run collapse into the slot again,
    // so there is never more than one pending rerun.
    void this._drain();
  }

  /**
   * A deferred request is only allowed to perform I/O against the same target it
   * was made against.
   */
  private _isStillCurrent(request: PendingRequest): boolean {
    const currentProviderId = this._providerManager.getActiveProvider()?.id ?? null;
    return (
      request.configEpoch === this._providerManager.configEpoch &&
      request.providerId === currentProviderId
    );
  }
}
