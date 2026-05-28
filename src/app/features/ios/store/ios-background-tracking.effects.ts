import { inject, Injectable } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { exhaustMap, tap, withLatestFrom } from 'rxjs/operators';
import { MOBILE_BACKGROUND_IDLE_CAP_MS } from '../../../app.constants';
import { IS_IOS_NATIVE } from '../../../util/is-native-platform';
import { GlobalTrackingIntervalService } from '../../../core/global-tracking-interval/global-tracking-interval.service';
import { OperationWriteFlushService } from '../../../op-log/sync/operation-write-flush.service';
import { TaskService } from '../../tasks/task.service';
import * as focusModeActions from '../../focus-mode/store/focus-mode.actions';
import { selectTimer } from '../../focus-mode/store/focus-mode.selectors';
import { TimerState } from '../../focus-mode/focus-mode.model';
import { Log } from '../../../core/log';
import { iosInterface } from '../ios-interface';

/**
 * Synchronously dispatch any accumulated tracked time, then drain the op-log
 * write queue. iOS budgets ~5 s after `didEnterBackground` before suspending
 * the WebView; the existing `main.ts` `appStateChange` listener wraps that
 * window in `BackgroundTask.beforeExit`, and this handler completes inside
 * the same budget.
 *
 * Exported as a plain function so the spec can drive it directly without
 * tripping the `IS_IOS_NATIVE` gate on `createEffect`.
 */
export const handleIosPause = async (
  taskService: TaskService,
  operationWriteFlush: OperationWriteFlushService,
): Promise<void> => {
  taskService.flushAccumulatedTimeSpent();
  await operationWriteFlush.flushPendingWrites();
};

/**
 * Credit the wall-clock gap (capped) to the active task, reset the tracking
 * anchor so the next 1 s interval tick doesn't double-count any uncapped
 * remainder, flush accumulated time, then nudge the focus-mode reducer if a
 * session is running (the reducer recomputes elapsed from `Date.now() -
 * startedAt`, so one dispatch self-corrects regardless of missed ticks).
 *
 * Sync-window race: `task.service.ts` already gates the `tick$` subscriber
 * on `isDataImportInProgress$`, so this dispatch is silently dropped during
 * a SYNC_IMPORT — by design.
 */
export const handleIosResume = (
  globalTracking: GlobalTrackingIntervalService,
  taskService: TaskService,
  store: Store,
  timer: TimerState,
): void => {
  globalTracking.triggerWakeUpTick(MOBILE_BACKGROUND_IDLE_CAP_MS);
  globalTracking.resetTrackingStart();
  taskService.flushAccumulatedTimeSpent();
  if (timer.purpose !== null && timer.isRunning) {
    store.dispatch(focusModeActions.tick());
  }
};

@Injectable()
export class IosBackgroundTrackingEffects {
  private _store = inject(Store);
  private _taskService = inject(TaskService);
  private _globalTrackingIntervalService = inject(GlobalTrackingIntervalService);
  private _operationWriteFlush = inject(OperationWriteFlushService);

  flushOnPause$ =
    IS_IOS_NATIVE &&
    createEffect(
      () =>
        iosInterface.onPause$.pipe(
          // exhaustMap: rapid pause events (control-center swipe, app switcher)
          // coalesce onto a single in-flight flush. Safe because the flush is
          // idempotent — accumulator is cleared in the first pass.
          exhaustMap(() =>
            handleIosPause(this._taskService, this._operationWriteFlush).catch((e) => {
              Log.err('iOS background flush failed', e);
            }),
          ),
        ),
      { dispatch: false },
    );

  reconcileOnResume$ =
    IS_IOS_NATIVE &&
    createEffect(
      () =>
        iosInterface.onResume$.pipe(
          withLatestFrom(this._store.select(selectTimer)),
          tap(([, timer]) => {
            handleIosResume(
              this._globalTrackingIntervalService,
              this._taskService,
              this._store,
              timer,
            );
          }),
        ),
      { dispatch: false },
    );
}
