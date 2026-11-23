import { inject, Injectable } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { combineLatest } from 'rxjs';
import { distinctUntilChanged, filter, map, tap } from 'rxjs/operators';
import { IS_ANDROID_WEB_VIEW } from '../../../util/is-android-web-view';
import { androidInterface } from '../android-interface';
import { selectCurrentTask } from '../../tasks/store/task.selectors';
import { selectConfigFeatureState } from '../../config/store/global-config.reducer';
import { HydrationStateService } from '../../../op-log/apply/hydration-state.service';
import { DroidLog } from '../../../core/log';
import { Task } from '../../tasks/task.model';
import { T } from '../../../t.const';
import { truncate } from '../../../util/truncate';
import { parseNativeTrackingData } from './android-foreground-tracking.effects';

export interface NativeTimeEstimate {
  taskId: string;
  timeEstimate: number;
  title: string;
}

/**
 * What native should be told about the current task's estimate: null clears
 * it (feature off, nothing tracked, or no estimate). Exported for testing —
 * the effect itself is gated by IS_ANDROID_WEB_VIEW.
 */
export const getNativeTimeEstimate = (
  isNotifyEnabled: boolean,
  currentTask: Task | null | undefined,
): NativeTimeEstimate | null =>
  isNotifyEnabled && currentTask && currentTask.timeEstimate > 0
    ? {
        taskId: currentTask.id,
        timeEstimate: currentTask.timeEstimate,
        title: currentTask.title,
      }
    : null;

export const isSameNativeTimeEstimate = (
  a: NativeTimeEstimate | null,
  b: NativeTimeEstimate | null,
): boolean =>
  a === b ||
  (!!a &&
    !!b &&
    a.taskId === b.taskId &&
    a.timeEstimate === b.timeEstimate &&
    a.title === b.title);

/**
 * Whether the native tracking service shows the "estimate exceeded"
 * notification for this task, so the web app must not post a second one.
 * False on APKs without native support and whenever native tracks nothing or
 * another task (e.g. focus mode replaces the tracking service).
 */
export const isTimeEstimateNotifiedNatively = (taskId: string): boolean =>
  IS_ANDROID_WEB_VIEW &&
  !!androidInterface.setTrackingTimeEstimate &&
  parseNativeTrackingData(androidInterface.getTrackingElapsed?.())?.taskId === taskId;

/**
 * Hands the tracked task's estimate to the native tracking service, which
 * arms an alarm for the moment it is exceeded. The web app's own check stops
 * while Android pauses the WebView (screen locked, app in the background), so
 * without this the notification only appeared on reopening the app (#11896).
 */
@Injectable()
export class AndroidTimeEstimateEffects {
  private _store = inject(Store);
  private _translateService = inject(TranslateService);
  private _hydrationState = inject(HydrationStateService);

  syncTimeEstimateToNative$ =
    IS_ANDROID_WEB_VIEW &&
    createEffect(
      () =>
        combineLatest([
          this._store.select(selectConfigFeatureState),
          this._store.select(selectCurrentTask),
        ]).pipe(
          filter(
            () =>
              !!androidInterface.setTrackingTimeEstimate &&
              !this._hydrationState.isApplyingRemoteOps(),
          ),
          map(([cfg, currentTask]) =>
            getNativeTimeEstimate(
              !!cfg?.timeTracking?.isNotifyWhenTimeEstimateExceeded,
              currentTask,
            ),
          ),
          distinctUntilChanged(isSameNativeTimeEstimate),
          tap((estimate) => this._pushToNative(estimate)),
        ),
      { dispatch: false },
    );

  private _pushToNative(estimate: NativeTimeEstimate | null): void {
    try {
      if (!estimate) {
        androidInterface.setTrackingTimeEstimate?.('', 0, '', '');
        return;
      }
      const translateParams = { title: truncate(estimate.title) };
      androidInterface.setTrackingTimeEstimate?.(
        estimate.taskId,
        estimate.timeEstimate,
        this._translateService.instant(T.F.TASK.N.ESTIMATE_EXCEEDED, translateParams),
        this._translateService.instant(
          T.F.TASK.N.ESTIMATE_EXCEEDED_BODY,
          translateParams,
        ),
      );
    } catch (e) {
      DroidLog.err('Failed to set tracking time estimate', e);
    }
  }
}
