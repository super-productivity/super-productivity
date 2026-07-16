import { inject, Injectable } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import {
  concatMap,
  delay,
  distinctUntilChanged,
  exhaustMap,
  filter,
  first,
  map,
  pairwise,
  shareReplay,
  switchMap,
  take,
  tap,
  throttleTime,
  withLatestFrom,
} from 'rxjs/operators';
import { SyncTriggerService } from './sync-trigger.service';
import { BackgroundSyncSchedulerService } from './background-sync-scheduler.service';
import {
  INITIAL_SYNC_DELAY_MS,
  SYNC_BEFORE_CLOSE_ID,
  SYNC_INITIAL_SYNC_TRIGGER,
} from '../../imex/sync/sync.const';
import { SyncProviderId } from '../../op-log/sync-exports';
import { asyncScheduler, combineLatest, defer, EMPTY, merge, Observable, of } from 'rxjs';
import { IS_ONLINE$ } from '../../util/is-online.token';
import { SnackService } from '../../core/snack/snack.service';
import { T } from '../../t.const';
import { ExecBeforeCloseService } from '../../core/electron/exec-before-close.service';
import { IS_ELECTRON } from '../../app.constants';
import { TaskService } from '../../features/tasks/task.service';
import { SimpleCounterService } from '../../features/simple-counter/simple-counter.service';
import { SyncWrapperService } from './sync-wrapper.service';
import { getSyncErrorStr } from './get-sync-error-str';
import { InitialPwaUpdateCheckService } from '../../core/initial-pwa-update-check.service';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { SyncLog } from '../../core/log';
import { alertDialog } from '../../util/native-dialogs';
import { vectorClockPruned$ } from '../../core/util/vector-clock';

@Injectable()
export class SyncEffects {
  private _syncWrapperService = inject(SyncWrapperService);
  private _syncTriggerService = inject(SyncTriggerService);
  private _backgroundSyncScheduler = inject(BackgroundSyncSchedulerService);
  private _isOnline$ = inject(IS_ONLINE$);
  private _snackService = inject(SnackService);
  private _taskService = inject(TaskService);
  private _simpleCounterService = inject(SimpleCounterService);
  private _dataInitStateService = inject(DataInitStateService);
  private _execBeforeCloseService = inject(ExecBeforeCloseService);
  private readonly _initialPwaUpdateCheckService = inject(InitialPwaUpdateCheckService);

  syncBeforeQuit$ = createEffect(
    () =>
      !IS_ELECTRON
        ? // NOT the bare `EMPTY` singleton: createEffect stamps a
          // non-configurable marker onto whatever object it is handed, so
          // returning the module-wide instance brands it process-wide and every
          // later construction of this class dies with "Cannot redefine property
          // __@ngrx/effects_create__" — which is why this class had no
          // behavioural tests. `defer` hands over a fresh instance per
          // construction; the subscribed behaviour is unchanged.
          defer(() => EMPTY)
        : this._dataInitStateService.isAllDataLoadedInitially$.pipe(
            concatMap(() => this._syncWrapperService.isEnabledAndReady$),
            distinctUntilChanged(),
            tap((isEnabled) =>
              isEnabled
                ? this._execBeforeCloseService.schedule(SYNC_BEFORE_CLOSE_ID)
                : this._execBeforeCloseService.unschedule(SYNC_BEFORE_CLOSE_ID),
            ),
            switchMap((isEnabled) =>
              isEnabled ? this._execBeforeCloseService.onBeforeClose$ : EMPTY,
            ),
            filter((ids) => ids.includes(SYNC_BEFORE_CLOSE_ID)),
            switchMap(() => {
              this._taskService.setCurrentId(null);
              this._simpleCounterService.flushAccumulatedTime();
              this._simpleCounterService.turnOffAll();
              // Yield to the event loop so NgRx effects triggered by the above
              // dispatches (e.g. persistence writes to IndexedDB) get a chance to
              // run before we start the sync.  A single macrotask tick is enough
              // because the op-log persistence effects schedule their writes in
              // the same tick; we just need to let them execute.
              return new Promise<void>((resolve) => setTimeout(resolve, 0));
            }),
            switchMap(() =>
              this._syncWrapperService
                .sync()
                .then(() => {
                  this._execBeforeCloseService.setDone(SYNC_BEFORE_CLOSE_ID);
                })
                .catch((e: unknown) => {
                  SyncLog.err(e);
                  this._snackService.open({
                    msg: T.F.DROPBOX.S.SYNC_ERROR,
                    type: 'ERROR',
                  });
                  // Inform user but always allow close - sync already failed
                  alertDialog('Sync failed. The app will close.');
                  this._execBeforeCloseService.setDone(SYNC_BEFORE_CLOSE_ID);
                }),
            ),
          ),
    { dispatch: false },
  );
  vectorClockPruningNotification$ = createEffect(
    () =>
      vectorClockPruned$.pipe(
        // Pruning fires on essentially every download-merge once a user has
        // accumulated >20 client IDs (see #8696). Show a calm breadcrumb at
        // most once per app session — enough to recognise it is happening,
        // without nagging. The durable record lives in the (WARN-level) log.
        take(1),
        tap(({ originalSize, maxSize }) => {
          this._snackService.open({
            msg: T.F.SYNC.S.VECTOR_CLOCK_LIMIT_REACHED,
            // CUSTOM (not WARNING): this is a benign, self-healing cleanup, not
            // an alert the user must act on. Neutral icon, auto-dismiss — but a
            // touch longer than the 3s default so the sentence is readable.
            type: 'CUSTOM',
            ico: 'sync',
            translateParams: {
              originalSize,
              maxSize,
            },
            config: { duration: 5000 },
          });
        }),
      ),
    { dispatch: false },
  );

  // private _wasJustEnabled$: Observable<boolean> = of(false);
  private _wasJustEnabled$: Observable<boolean> =
    this._dataInitStateService.isAllDataLoadedInitially$.pipe(
      // NOTE: it is important that we don't use distinct until changed here
      switchMap(() => this._syncWrapperService.isEnabledAndReady$),
      pairwise(),
      map(([a, b]) => !a && !!b),
      filter((wasJustEnabled) => wasJustEnabled),
      shareReplay(),
    );

  /**
   * The dynamic background branch — interval, resume, visibility, idle/activity,
   * online-regained, and the trailing settle timer.
   *
   * Split out of {@link triggerSync$} and routed through the scheduler, which
   * defers a trigger that arrives while other sync work is running instead of
   * dropping it. Under the old shared `exhaustMap` these triggers were silently
   * discarded whenever a sync was already in flight, so the work they asked for
   * was lost until something else happened to trigger again.
   *
   * The gate is NOT checked here: the scheduler owns it, so a trigger arriving
   * before the initial sync completes marks dirty and drains afterwards rather
   * than being dropped or starting a shadow initial sync.
   */
  scheduleBackgroundSync$ = createEffect(
    () =>
      this._dataInitStateService.isAllDataLoadedInitially$.pipe(
        switchMap(() =>
          combineLatest([
            this._syncWrapperService.isEnabledAndReady$,
            this._syncWrapperService.syncInterval$,
            this._syncWrapperService.syncProviderId$,
          ]).pipe(
            switchMap(([isEnabledAndReady, syncInterval, providerId]) =>
              isEnabledAndReady && syncInterval
                ? this._syncTriggerService.getSyncTrigger$(
                    syncInterval,
                    providerId !== SyncProviderId.SuperSync,
                  )
                : EMPTY,
            ),
          ),
        ),
        tap((x) => SyncLog.log('sync(effect) background trigger.....', x)),
        // Unchanged frequency limit. The scheduler collapses a burst into one
        // rerun anyway, but this keeps the pre-existing rate ceiling rather than
        // quietly raising it as a side effect of the split.
        throttleTime(2000, asyncScheduler, { leading: true, trailing: false }),
        // E2E tests set this flag after setup to prevent auto-sync from interfering
        // with controlled, sequential sync via the sync button click
        filter(() => !(globalThis as any).__SP_E2E_BLOCK_AUTO_SYNC),
        withLatestFrom(this._isOnline$),
        // Offline background triggers were already no-ops; requesting here would
        // only queue work that fails. I_IS_ONLINE re-triggers on reconnect.
        filter(([, isOnline]) => !!isOnline),
        tap(() => this._backgroundSyncScheduler.request()),
      ),
    { dispatch: false },
  );

  /**
   * The two directly-awaited gate-openers: initial sync and after-enable.
   *
   * These deliberately do NOT go through the scheduler. They own opening the
   * initial gate — the scheduler refuses to run until they have — and they are
   * the only sync callers here whose completion other code waits on.
   *
   * Both are one-shot, so the retained `exhaustMap` now only guards these two
   * against each other. Background triggers used to share it; their exclusion
   * against a running sync is now the scheduler's busy check plus
   * `SyncCycleGuard.tryBegin()`, which is the authority either way.
   */
  triggerSync$ = createEffect(
    () =>
      this._dataInitStateService.isAllDataLoadedInitially$.pipe(
        switchMap(() =>
          merge(
            // initial after starting app — wait for provider to actually be ready
            this._initialPwaUpdateCheckService.afterInitialUpdateCheck$.pipe(
              concatMap(() =>
                this._syncWrapperService.isEnabledAndReady$.pipe(
                  filter((v) => v),
                  first(),
                ),
              ),
              withLatestFrom(this._syncWrapperService.syncProviderId$),
              switchMap(([_, providerId]) => {
                // SuperSync can be delayed - data is already local, just needs upload/download
                // Other providers (Dropbox, WebDAV, LocalFile) need sync first to download data
                if (providerId === SyncProviderId.SuperSync) {
                  return of(SYNC_INITIAL_SYNC_TRIGGER).pipe(delay(INITIAL_SYNC_DELAY_MS));
                }
                return of(SYNC_INITIAL_SYNC_TRIGGER);
              }),
            ),

            // initial after enabling it
            this._wasJustEnabled$.pipe(
              take(1),
              map(() => 'SYNC_AFTER_ENABLE'),
            ),
          ),
        ),
        tap((x) => SyncLog.log('sync(effect).....', x)),
        // Limit sync frequency to prevent rapid consecutive syncs (e.g., blur event right after initial sync)
        throttleTime(2000, asyncScheduler, { leading: true, trailing: false }),
        // E2E tests set this flag after setup to prevent auto-sync from interfering
        // with controlled, sequential sync via the sync button click
        filter(() => !(globalThis as any).__SP_E2E_BLOCK_AUTO_SYNC),
        withLatestFrom(this._isOnline$),
        // don't run multiple after each other when dialog is open
        exhaustMap(([trigger, isOnline]) => {
          if (!isOnline) {
            // this._snackService.open({msg: T.F.DROPBOX.S.OFFLINE, type: 'ERROR'});
            if (
              trigger === SYNC_INITIAL_SYNC_TRIGGER ||
              trigger === 'SYNC_AFTER_ENABLE'
            ) {
              this._syncTriggerService.setInitialSyncDone(true);
            }
            // we need to return something
            return of(null);
          }
          return this._syncWrapperService
            .sync()
            .then(() => {
              if (
                trigger === SYNC_INITIAL_SYNC_TRIGGER ||
                trigger === 'SYNC_AFTER_ENABLE'
              ) {
                this._syncTriggerService.setInitialSyncDone(true);
              }
            })
            .catch((err: unknown) => {
              this._syncTriggerService.setInitialSyncDone(true);
              this._snackService.open({
                msg: T.F.SYNC.S.UNKNOWN_ERROR,
                translateParams: {
                  err: getSyncErrorStr(err),
                },
                type: 'ERROR',
              });
            });
        }),
      ),
    { dispatch: false },
  );
}
