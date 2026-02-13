import { inject, Injectable } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import {
  concatMap,
  delay,
  distinctUntilChanged,
  exhaustMap,
  filter,
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
import {
  INITIAL_SYNC_DELAY_MS,
  SYNC_BEFORE_CLOSE_ID,
  SYNC_INITIAL_SYNC_TRIGGER,
} from '../../imex/sync/sync.const';
import { SyncProviderId } from '../../op-log/sync-exports';
import { asyncScheduler, combineLatest, EMPTY, merge, Observable, of } from 'rxjs';
import { isOnline$ } from '../../util/is-online';
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
  private _snackService = inject(SnackService);
  private _taskService = inject(TaskService);
  private _simpleCounterService = inject(SimpleCounterService);
  private _dataInitStateService = inject(DataInitStateService);
  private _execBeforeCloseService = inject(ExecBeforeCloseService);
  private readonly _initialPwaUpdateCheckService = inject(InitialPwaUpdateCheckService);

  syncBeforeQuit$ = createEffect(
    () =>
      !IS_ELECTRON
        ? EMPTY
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
        tap(({ originalSize, maxSize }) => {
          this._snackService.open({
            msg: T.F.SYNC.S.VECTOR_CLOCK_LIMIT_REACHED,
            type: 'WARNING',
            translateParams: {
              originalSize,
              maxSize,
            },
            config: { duration: 0 },
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

  triggerSync$ = createEffect(
    () =>
      this._dataInitStateService.isAllDataLoadedInitially$.pipe(
        switchMap(() =>
          merge(
            // dynamic
            combineLatest([
              this._syncWrapperService.isEnabledAndReady$,
              this._syncWrapperService.syncInterval$,
            ]).pipe(
              switchMap(([isEnabledAndReady, syncInterval]) =>
                isEnabledAndReady && syncInterval
                  ? this._syncTriggerService.getSyncTrigger$(syncInterval)
                  : EMPTY,
              ),
            ),

            // initial after starting app
            this._initialPwaUpdateCheckService.afterInitialUpdateCheck$.pipe(
              concatMap(() => this._syncWrapperService.isEnabledAndReady$),
              take(1),
              withLatestFrom(this._syncWrapperService.syncProviderId$),
              switchMap(([isEnabledAndReady, providerId]) => {
                if (!isEnabledAndReady) {
                  this._syncTriggerService.setInitialSyncDone(true);
                  return EMPTY;
                }
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
        withLatestFrom(isOnline$),
        // don't run multiple after each other when dialog is open
        exhaustMap(([trigger, isOnline]) => {
          if (!isOnline) {
            // this._snackService.open({msg: T.F.DROPBOX.S.OFFLINE, type: 'ERROR'});
            if (trigger === SYNC_INITIAL_SYNC_TRIGGER) {
              this._syncTriggerService.setInitialSyncDone(true);
            }
            // we need to return something
            return of(null);
          }
          return this._syncWrapperService
            .sync()
            .then(() => {
              if (trigger === SYNC_INITIAL_SYNC_TRIGGER) {
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
