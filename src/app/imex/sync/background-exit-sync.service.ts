import { inject, Injectable } from '@angular/core';
import {
  asapScheduler,
  defer,
  filter,
  firstValueFrom,
  map,
  Observable,
  observeOn,
  of,
  race,
  switchMap,
  take,
  timer,
} from 'rxjs';
import { SyncProviderId, SyncStatus } from '../../op-log/sync-exports';
import { OperationLogStoreService } from '../../op-log/persistence/operation-log-store.service';
import { OperationWriteFlushService } from '../../op-log/sync/operation-write-flush.service';
import { IS_ONLINE$ } from '../../util/is-online.token';
import { SyncLog } from '../../core/log';
import { SyncBusyService } from './sync-busy.service';
import { SyncTriggerService } from './sync-trigger.service';
import { SyncWrapperService } from './sync-wrapper.service';

/**
 * How long the push may hold the background budget. iOS grants roughly 30s
 * after `beforeExit`. The plugin ends the task itself on expiry, so this is
 * not about termination: it ends our side first, so `finish()` and the log
 * line run instead of the app being suspended mid-push.
 */
export const BACKGROUND_EXIT_SYNC_BUDGET_MS = 20000;

/**
 * Pushes local ops while the mobile app goes to the background — the last
 * moment the OS reliably lets JS run. Ops left only on the phone stay invisible
 * to the user's other devices until the app is opened again.
 *
 * Calls `sync()` directly instead of `BackgroundSyncSchedulerService.request()`:
 * the scheduler's duty-cycle floor defers a request made within 5s of the last
 * settle, and a deferred request never runs once the OS suspends the WebView.
 * The floor exists to leave idle windows for day-change effects in the
 * foreground, which do not apply to an app that is leaving it.
 *
 * See docs/plans/2026-10-30-narrow-mobile-background-sync.md (Step 0).
 */
@Injectable({ providedIn: 'root' })
export class BackgroundExitSyncService {
  private _flushService = inject(OperationWriteFlushService);
  private _syncWrapper = inject(SyncWrapperService);
  private _syncTrigger = inject(SyncTriggerService);
  private _busy = inject(SyncBusyService);
  private _isOnline$ = inject(IS_ONLINE$);
  private _opLogStore = inject(OperationLogStoreService);

  /**
   * Persists pending ops, then pushes them within
   * {@link BACKGROUND_EXIT_SYNC_BUDGET_MS}. Never throws: the caller is an OS
   * lifecycle callback that must always finish.
   */
  async flushAndPush(): Promise<void> {
    // The budget covers the flush too: a hung write must not keep iOS from
    // reaching BackgroundTask.finish().
    const push$ = defer(() => this._flushThenCanPush()).pipe(
      switchMap((canPush) => (canPush ? this._syncWhenIdle$() : of('SKIPPED' as const))),
    );
    try {
      const result = await firstValueFrom(
        race(
          push$,
          timer(BACKGROUND_EXIT_SYNC_BUDGET_MS).pipe(map(() => 'BUDGET' as const)),
        ),
      );
      if (result === 'BUDGET') {
        // A started sync keeps running if the OS allows; a suspended one aborts
        // like a crash, and its ops are retried on the next sync.
        SyncLog.log('BackgroundExitSync: budget elapsed before sync settled');
      }
    } catch (e) {
      SyncLog.err('BackgroundExitSync: sync threw', e);
    }
  }

  private async _flushThenCanPush(): Promise<boolean> {
    try {
      await this._flushService.flushPendingWrites();
    } catch (e) {
      // Still try to push: ops persisted before the failure are worth sending.
      SyncLog.err('BackgroundExitSync: flush failed', e);
    }
    return this._canPush();
  }

  /**
   * A running sync may have read the op log before the ops just flushed, and a
   * second sync() would bounce off it. Wait for it to settle instead of asking
   * the scheduler, whose duty-cycle floor would defer the rerun past suspension.
   */
  private _syncWhenIdle$(): Observable<SyncStatus | 'HANDLED_ERROR'> {
    return this._busy.isBusy$.pipe(
      filter((isBusy) => !isBusy),
      // The idle edge fires inside the finishing sync's `finally`; starting
      // sync() on that stack lets its SYNCING safeguard reset the new status.
      // Same reason as the scheduler's `_scheduleDrain`.
      observeOn(asapScheduler),
      // A side channel may claim the cycle during that hop; sync() would then
      // bounce without pushing, so wait for the next idle edge instead. No
      // await sits between this check and sync()'s own claim.
      filter(() => !this._busy.isBusy),
      take(1),
      switchMap(() => this._syncWrapper.sync()),
    );
  }

  private async _canPush(): Promise<boolean> {
    // E2E tests block automatic sync to drive it by hand.
    if ((globalThis as Record<string, unknown>).__SP_E2E_BLOCK_AUTO_SYNC) {
      return false;
    }
    // The awaited initial sync owns the first cycle; pushing before it would
    // race the conflict and import checks it runs.
    if (!this._syncTrigger.isInitialSyncDoneSync()) {
      return false;
    }
    const [isReady, isOnline, cfg, unsynced] = await Promise.all([
      firstValueFrom(this._syncWrapper.isEnabledAndReady$),
      firstValueFrom(this._isOnline$),
      firstValueFrom(this._syncWrapper.syncCfg$),
      this._opLogStore.getUnsynced(),
    ]);
    // Same gate as the background triggers this replaces: SyncEffects runs
    // them only while syncInterval$ is non-zero. Not read from syncInterval$:
    // its WS signal emits first from an Angular effect, which waits for the
    // next change detection and so delays the push.
    const isAutoSync =
      !cfg.isManualSyncOnly &&
      (cfg.syncProvider === SyncProviderId.SuperSync || !!cfg.syncInterval);
    // Nothing to push: skip, so a file picker or permission dialog pausing the
    // app costs no sync. Downloads wait for resume, which triggers its own.
    return isReady && isOnline && isAutoSync && unsynced.length > 0;
  }
}
