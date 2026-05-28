import { inject, Injectable } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { tap, withLatestFrom } from 'rxjs/operators';
import { MOBILE_BACKGROUND_IDLE_CAP_MS } from '../../../app.constants';
import { IS_IOS_NATIVE } from '../../../util/is-native-platform';
import { GlobalTrackingIntervalService } from '../../../core/global-tracking-interval/global-tracking-interval.service';
import { TaskService } from '../../tasks/task.service';
import * as focusModeActions from '../../focus-mode/store/focus-mode.actions';
import { selectTimer } from '../../focus-mode/store/focus-mode.selectors';
import { TimerState } from '../../focus-mode/focus-mode.model';
import { iosInterface } from '../ios-interface';

/**
 * Credit the wall-clock gap (capped) to the active task, reset the tracking
 * anchor so the next 1 s interval tick doesn't double-count any uncapped
 * remainder, flush accumulated time, then nudge the focus-mode reducer if a
 * session is running (the reducer recomputes elapsed from `Date.now() -
 * startedAt`, so one dispatch self-corrects regardless of missed ticks).
 *
 * Pause persistence is handled in `main.ts`'s `appStateChange` listener inside
 * the `BackgroundTask.beforeExit` budget — this effect only handles resume.
 *
 * Sync-window race: `task.service.ts` already gates the `tick$` subscriber
 * on `isDataImportInProgress$`, so this dispatch is silently dropped during
 * a SYNC_IMPORT — by design.
 *
 * Exported as a plain function so the spec can drive it directly without
 * tripping the `IS_IOS_NATIVE` gate on `createEffect`.
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
