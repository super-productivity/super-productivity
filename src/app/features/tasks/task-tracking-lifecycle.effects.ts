import { DOCUMENT } from '@angular/common';
import { inject, Injectable } from '@angular/core';
import { createEffect, ofType } from '@ngrx/effects';
import { defer, EMPTY, fromEvent, merge } from 'rxjs';
import {
  catchError,
  exhaustMap,
  filter,
  switchMap,
  take,
  tap,
  timeout,
} from 'rxjs/operators';
import { IS_ELECTRON_TOKEN } from '../../app.constants';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { ExecBeforeCloseService } from '../../core/electron/exec-before-close.service';
import { Log } from '../../core/log';
import { CapacitorPlatformService } from '../../core/platform/capacitor-platform.service';
import { OperationWriteFlushService } from '../../op-log/sync/operation-write-flush.service';
import { LOCAL_ACTIONS } from '../../util/local-actions.token';
import { setCurrentTask } from './store/task.actions';
import { TaskService } from './task.service';

export const TRACKING_BEFORE_CLOSE_ID = 'TRACKING_BEFORE_CLOSE';
const CLOSE_FLUSH_TIMEOUT_MS = 5000;

/** Flush the existing tracking actions before the desktop/web renderer disappears. */
@Injectable()
export class TaskTrackingLifecycleEffects {
  private _document = inject(DOCUMENT);
  private _isElectron = inject(IS_ELECTRON_TOKEN);
  private _platform = inject(CapacitorPlatformService);
  private _taskService = inject(TaskService);
  private _writes = inject(OperationWriteFlushService);
  private _close = inject(ExecBeforeCloseService);
  private _dataInit = inject(DataInitStateService);
  private _actions$ = inject(LOCAL_ACTIONS);
  private _isCloseRegistered = false;

  flushOnHide$ = createEffect(
    () =>
      this._platform.isNative
        ? defer(() => EMPTY)
        : merge(
            // Electron's main window disables backgroundThrottling, which keeps
            // its page visible when hidden to the tray: in practice web only.
            fromEvent(this._document, 'visibilitychange').pipe(
              filter(() => this._document.hidden),
            ),
            // Reload may not hide the document until destruction. Start the
            // writes earlier where possible; web unload still cannot await IDB.
            fromEvent(this._document.defaultView!, 'beforeunload'),
          ).pipe(
            tap(() => this._taskService.flushAccumulatedTimeSpent()),
            exhaustMap(() =>
              defer(() => this._writes.flushPendingWrites()).pipe(
                catchError((error: unknown) => {
                  Log.err('Could not flush tracked time on page hide', error);
                  return EMPTY;
                }),
              ),
            ),
          ),
    { dispatch: false },
  );

  registerBeforeClose$ = createEffect(
    () =>
      !this._isElectron
        ? defer(() => EMPTY)
        : merge(
            this._dataInit.isAllDataLoadedInitially$.pipe(take(1)),
            // A cancelled finish-day dialog can leave the app open after our
            // acknowledgement. Re-arm when the user starts tracking again.
            this._actions$.pipe(ofType(setCurrentTask)),
          ).pipe(
            filter(() => !this._isCloseRegistered),
            tap(() => {
              this._close.schedule(TRACKING_BEFORE_CLOSE_ID);
              this._isCloseRegistered = true;
            }),
          ),
    { dispatch: false },
  );

  flushBeforeClose$ = createEffect(
    () =>
      !this._isElectron
        ? defer(() => EMPTY)
        : this._close.onBeforeClose$.pipe(
            filter((ids) => ids.includes(TRACKING_BEFORE_CLOSE_ID)),
            // A retry after cancelling/resuming must stop and drain again.
            // Only the latest quit may acknowledge, including on timeout.
            switchMap(() =>
              defer(() => {
                // Stop only on real quit, not hide/close-to-tray. This prevents
                // new ticks while waiting for the write queue or another handler.
                this._taskService.setCurrentId(null);
                this._taskService.flushAccumulatedTimeSpent();
                return this._writes.flushPendingWrites();
              }).pipe(
                timeout(CLOSE_FLUSH_TIMEOUT_MS),
                catchError((error: unknown) => {
                  Log.err('Could not flush tracked time before closing', error);
                  return EMPTY;
                }),
                tap({
                  complete: () => {
                    this._isCloseRegistered = false;
                    this._close.setDone(TRACKING_BEFORE_CLOSE_ID);
                    // A cancelled quit can resume tracking while writes drain.
                    // Re-arm after setDone: main removes every matching id on ack.
                    if (this._taskService.currentTaskId()) {
                      this._close.schedule(TRACKING_BEFORE_CLOSE_ID);
                      this._isCloseRegistered = true;
                    }
                  },
                }),
              ),
            ),
          ),
    { dispatch: false },
  );
}
