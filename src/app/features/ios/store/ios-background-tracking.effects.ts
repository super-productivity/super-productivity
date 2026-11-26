import { inject, Injectable } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';
import { tap, withLatestFrom } from 'rxjs/operators';
import { MOBILE_BACKGROUND_IDLE_CAP_MS } from '../../../app.constants';
import { IS_IOS_NATIVE } from '../../../util/is-native-platform';
import { GlobalTrackingIntervalService } from '../../../core/global-tracking-interval/global-tracking-interval.service';
import { TaskService } from '../../tasks/task.service';
import * as focusModeActions from '../../focus-mode/store/focus-mode.actions';
import {
  selectIsOvertimeEnabled,
  selectTimer,
} from '../../focus-mode/store/focus-mode.selectors';
import { TimerState } from '../../focus-mode/focus-mode.model';
import { iosInterface } from '../ios-interface';
import {
  creditResumeGap,
  getFocusAutoCompleteCapMs,
} from '../../focus-mode/resume-gap-credit';

export type IosResumeDeps = {
  globalTracking: GlobalTrackingIntervalService;
  taskService: TaskService;
  store: Store;
};

/**
 * Credit the wall-clock gap (capped) to the active task, reset the tracking
 * anchor so the next 1 s interval tick doesn't double-count any uncapped
 * remainder, flush accumulated time, then nudge the focus-mode reducer if a
 * session is running (the reducer recomputes elapsed from `Date.now() -
 * startedAt`, so one dispatch self-corrects regardless of missed ticks). That
 * tick may complete a Pomodoro/Countdown, so the task is credited only up to
 * the session end before it (#10599, see creditResumeGap).
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
  deps: IosResumeDeps,
  timer: TimerState,
  isOvertimeEnabled: boolean,
): void => {
  creditResumeGap(
    {
      globalTracking: deps.globalTracking,
      taskService: deps.taskService,
      tickFocus: () => {
        if (timer.purpose !== null && timer.isRunning) {
          deps.store.dispatch(focusModeActions.tick());
        }
      },
    },
    MOBILE_BACKGROUND_IDLE_CAP_MS,
    getFocusAutoCompleteCapMs(timer, isOvertimeEnabled),
  );
};

/**
 * Wire a resume stream to the reconciliation handler, reading the latest focus
 * timer and overtime setting off the store. Exported (and effect-independent)
 * so the spec can drive the full pipe — `withLatestFrom` included — without
 * tripping the `IS_IOS_NATIVE` gate on `createEffect`.
 */
export const reconcileOnResume = (
  onResume$: Observable<void>,
  store: Store,
  globalTracking: GlobalTrackingIntervalService,
  taskService: TaskService,
): Observable<unknown> =>
  onResume$.pipe(
    withLatestFrom(store.select(selectTimer), store.select(selectIsOvertimeEnabled)),
    tap(([, timer, isOvertimeEnabled]) =>
      handleIosResume({ globalTracking, taskService, store }, timer, isOvertimeEnabled),
    ),
  );

@Injectable()
export class IosBackgroundTrackingEffects {
  private _store = inject(Store);
  private _taskService = inject(TaskService);
  private _globalTrackingIntervalService = inject(GlobalTrackingIntervalService);

  reconcileOnResume$ =
    IS_IOS_NATIVE &&
    createEffect(
      () =>
        reconcileOnResume(
          iosInterface.onResume$,
          this._store,
          this._globalTrackingIntervalService,
          this._taskService,
        ),
      { dispatch: false },
    );
}
