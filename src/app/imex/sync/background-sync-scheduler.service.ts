import { DestroyRef, inject, Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter, Observable, pairwise, Subject } from 'rxjs';
import { SyncWrapperService } from './sync-wrapper.service';
import { SyncBusyService } from './sync-busy.service';
import { SyncTriggerService } from './sync-trigger.service';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { SyncProviderId } from '../../op-log/sync-providers/provider.const';
import { SYNC_MIN_INTERVAL } from './sync.const';
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
   * When sync work last settled, on a MONOTONIC clock. `null` = nothing has
   * settled yet, so the first request is never spaced.
   *
   * Deliberately not `Date.now()`. A backward wall-clock correction — NTP after
   * Android Doze, Electron resume, a VM restore, a user clock change — makes the
   * elapsed calculation negative, which arms a timer of `floor + jump`. A
   * one-hour correction would arm a one-hour timer, and since this is now the
   * only automatic sync path, background sync would stall completely until it
   * fired. Clamping the delay does not fix it: each 5s retry recomputes the same
   * negative elapsed and re-arms, so it stalls just as hard, in a loop.
   * `performance.now()` cannot go backwards.
   */
  private _lastSettleAt: number | null = null;
  private _spacingTimer: ReturnType<typeof setTimeout> | null = null;

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
    // `pairwise` so this is a real busy→idle TRANSITION, not the seeded `false`
    // every subscriber receives. Filtering on the value alone would stamp
    // _lastSettleAt at construction and needlessly delay the session's first
    // background sync by the whole floor.
    this._busy.isBusy$
      .pipe(
        pairwise(),
        filter(([wasBusy, isBusy]) => wasBusy && !isBusy),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe(() => {
        // Stamp on ANY sync work settling, not just our own runs. The floor must
        // space a background sync against every other sync — otherwise the first
        // one of the session fires back-to-back with the initial sync (the exact
        // "blur right after initial sync" case the old shared throttle guarded,
        // which the effect split dissolved), and a trigger deferred during the
        // before-close sync starts fresh I/O at the instant the window closes.
        this._lastSettleAt = performance.now();
        this._scheduleDrain();
      });

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
      .subscribe(() => this._scheduleDrain());

    this._destroyRef.onDestroy(() => {
      if (this._spacingTimer !== null) {
        clearTimeout(this._spacingTimer);
        this._spacingTimer = null;
      }
    });
  }

  /**
   * Wake-ups must NOT drain on the emitting call stack.
   *
   * The busy edge fires from `SyncCycleGuard.end()`, which `sync()` calls from
   * inside its own `finally`. Draining synchronously there starts the next sync
   * re-entrantly, part-way through the previous one's teardown — before the
   * wrapper's SYNCING safeguard runs, which would then see the NEW sync's status
   * and reset it to UNKNOWN_OR_CHANGED. Provider status is still a live
   * exclusion gate for the immediate-upload side channel, so corrupting it is
   * not merely cosmetic.
   *
   * Yielding a microtask lets the finishing cycle unwind completely, so the next
   * sync starts from a settled state. Found by wiring the real guard and busy
   * service together — the fakes could not surface it.
   */
  private _scheduleDrain(): void {
    queueMicrotask(() => void this._drain());
  }

  /**
   * Re-check once the duty-cycle floor has elapsed. A single timer, because the
   * dirty bit is single: re-arming per request would stack timers that all drain
   * the same one slot.
   */
  private _armSpacingTimer(delayMs: number): void {
    if (this._spacingTimer !== null) {
      return;
    }
    this._spacingTimer = setTimeout(() => {
      this._spacingTimer = null;
      void this._drain();
    }, delayMs);
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
    // Duty-cycle floor. Deferring instead of dropping removed the only thing
    // that bounded the SYNC rate: exhaustMap. The trigger-side throttle never
    // bounded it — the interval timer is self-sustaining and independent of sync
    // activity, so whenever a sync outlasts syncInterval (a 90s WebDAV sync on a
    // 60s interval is ordinary — getFileRev is a full GET, not a cheap ETag),
    // every tick lands mid-sync and drains the instant the previous one settles.
    // That is a permanent back-to-back sync loop with no idle gap.
    //
    // The wasted I/O is the lesser harm. sync() opens the hydration window and
    // closes it in its finally, so with no gap `isInSyncWindow` is effectively
    // always true and skipDuringSyncWindow() would suppress TODAY_TAG repair and
    // day-change effects INDEFINITELY. The floor guarantees a real idle window
    // between runs, in which those effects can fire.
    if (this._lastSettleAt !== null) {
      const sinceLastSettle = performance.now() - this._lastSettleAt;
      if (sinceLastSettle < SYNC_MIN_INTERVAL) {
        this._armSpacingTimer(SYNC_MIN_INTERVAL - sinceLastSettle);
        return;
      }
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
      this._lastSettleAt = performance.now();
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
