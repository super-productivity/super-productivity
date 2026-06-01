import { inject, Injectable } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import { Action, Store } from '@ngrx/store';
import { filter, map, pairwise, startWith, tap, withLatestFrom } from 'rxjs/operators';
import { IS_ANDROID_WEB_VIEW } from '../../../util/is-android-web-view';
import { androidInterface } from '../android-interface';
import {
  selectIsBreakActive,
  selectIsLongBreak,
  selectMode,
  selectPausedTaskId,
  selectTimeRemaining,
  selectTimer,
} from '../../focus-mode/store/focus-mode.selectors';
import * as focusModeActions from '../../focus-mode/store/focus-mode.actions';
import { selectCurrentTask, selectCurrentTaskId } from '../../tasks/store/task.selectors';
import { combineLatest, Observable } from 'rxjs';
import { FocusModeMode, TimerState } from '../../focus-mode/focus-mode.model';
import { DroidLog } from '../../../core/log';
import { HydrationStateService } from '../../../op-log/apply/hydration-state.service';
import { SnackService } from '../../../core/snack/snack.service';
import { GlobalTrackingIntervalService } from '../../../core/global-tracking-interval/global-tracking-interval.service';

/**
 * On app resume, fire a single `tick()` so the wall-clock-based focus reducer
 * snaps the in-app countdown back to the truth after the WebView interval was
 * frozen in the background (#7856). The `tick` reducer is a no-op when the timer
 * is idle or paused, so no extra guard is needed here.
 */
export const createFocusResumeTick$ = (onResume$: Observable<void>): Observable<Action> =>
  onResume$.pipe(map(() => focusModeActions.tick()));

/**
 * Whether the focus-mode notification needs a fresh push to the native service.
 * Elapsed-only changes are throttled to 5s (the native handler already ticks
 * every second), but pause/purpose changes — and the large elapsed jump a resume
 * `tick()` produces (#7856) — must propagate immediately so the notification
 * reconciles with the corrected in-app countdown.
 */
export const hasFocusNotificationStateChanged = (
  prevTimer: TimerState | undefined,
  currTimer: TimerState,
): boolean => {
  if (!prevTimer) return true;
  // Pause state changed
  if (prevTimer.isRunning !== currTimer.isRunning) return true;
  // Purpose changed (work -> break or vice versa)
  if (prevTimer.purpose !== currTimer.purpose) return true;
  // Otherwise throttle elapsed-only updates to every 5 seconds
  return Math.abs(currTimer.elapsed - prevTimer.elapsed) >= 5000;
};

/**
 * Whether a native timer-complete event should drive a state change. The native
 * foreground service fires this when its countdown reaches 0; we act on it only
 * while the matching session is still active in app state — a break event needs an
 * active break, a work event needs a still-running work session. The work guard is
 * what makes the native completion a no-op once a resume `tick()` has already
 * completed the session on return from the background (#7856), so the two never
 * double-complete. Pure + exported so the `IS_ANDROID_WEB_VIEW`-gated effect's guard
 * is unit-testable.
 */
export const shouldHandleNativeTimerComplete = (
  isBreak: boolean,
  timer: TimerState,
): boolean =>
  isBreak ? timer.purpose === 'break' : timer.purpose === 'work' && timer.isRunning;

@Injectable()
export class AndroidFocusModeEffects {
  private _store = inject(Store);
  private _hydrationState = inject(HydrationStateService);
  private _snackService = inject(SnackService);
  private _globalTrackingInterval = inject(GlobalTrackingIntervalService);

  // Start/stop focus mode notification when timer state changes
  syncFocusModeToNotification$ =
    IS_ANDROID_WEB_VIEW &&
    createEffect(
      () =>
        combineLatest([
          this._store.select(selectTimer),
          this._store.select(selectMode),
          this._store.select(selectCurrentTask),
          this._store.select(selectIsBreakActive),
          this._store.select(selectIsLongBreak),
          this._store.select(selectTimeRemaining),
        ]).pipe(
          // PERF: Skip during hydration/sync to avoid unnecessary processing
          filter(() => !this._hydrationState.isApplyingRemoteOps()),
          map(
            ([timer, mode, currentTask, isBreakActive, isLongBreak, timeRemaining]) => ({
              timer,
              mode,
              currentTask,
              isBreakActive,
              isLongBreak,
              timeRemaining,
            }),
          ),
          startWith(null),
          pairwise(),
          tap(([prev, curr]) => {
            if (!curr) return;

            const {
              timer,
              mode,
              currentTask,
              isBreakActive,
              isLongBreak,
              timeRemaining,
            } = curr;
            const taskTitle = currentTask?.title || null;

            // Check if focus mode is active (has a purpose)
            const isFocusModeActive = timer.purpose !== null;
            const wasFocusModeActive = prev?.timer?.purpose !== null;

            if (isFocusModeActive) {
              const title = this._getNotificationTitle(mode, isBreakActive, isLongBreak);
              const remainingMs = timer.duration > 0 ? timeRemaining : timer.elapsed; // Flowtime shows elapsed

              // Start service if just became active, otherwise update
              if (!wasFocusModeActive) {
                DroidLog.log('AndroidFocusModeEffects: Starting focus mode service', {
                  title,
                  duration: timer.duration,
                  remaining: remainingMs,
                  isBreak: isBreakActive,
                  isPaused: !timer.isRunning,
                });
                this._safeNativeCall(
                  () =>
                    androidInterface.startFocusModeService?.(
                      title,
                      timer.duration,
                      remainingMs,
                      isBreakActive,
                      !timer.isRunning,
                      taskTitle,
                    ),
                  'Failed to start focus mode notification',
                  true,
                );
              } else if (hasFocusNotificationStateChanged(prev?.timer, timer)) {
                // Only update if something significant changed
                DroidLog.log('AndroidFocusModeEffects: Updating focus mode service', {
                  title,
                  remaining: remainingMs,
                  isPaused: !timer.isRunning,
                  isBreak: isBreakActive,
                });
                this._safeNativeCall(
                  () =>
                    androidInterface.updateFocusModeService?.(
                      title,
                      remainingMs,
                      !timer.isRunning,
                      isBreakActive,
                      taskTitle,
                    ),
                  'Failed to update focus mode service',
                );
              }
            } else if (wasFocusModeActive && !isFocusModeActive) {
              // Focus mode ended, stop the service
              DroidLog.log('AndroidFocusModeEffects: Stopping focus mode service');
              this._safeNativeCall(
                () => androidInterface.stopFocusModeService?.(),
                'Failed to stop focus mode service',
              );
            }
          }),
        ),
      { dispatch: false },
    );

  // Handle notification action callbacks
  handleFocusPause$ =
    IS_ANDROID_WEB_VIEW &&
    createEffect(() =>
      androidInterface.onFocusPause$.pipe(
        tap(() => DroidLog.log('AndroidFocusModeEffects: Pause action received')),
        withLatestFrom(
          this._store.select(selectTimer),
          this._store.select(selectCurrentTaskId),
        ),
        tap(([, timer]) => {
          if (timer.purpose === 'work' && timer.isRunning) {
            const cap =
              timer.duration > 0
                ? Math.max(0, timer.duration - timer.elapsed)
                : undefined;
            this._globalTrackingInterval.triggerWakeUpTick(cap);
          }
        }),
        map(([, , currentTaskId]) =>
          focusModeActions.pauseFocusSession({ pausedTaskId: currentTaskId }),
        ),
      ),
    );

  handleFocusResume$ =
    IS_ANDROID_WEB_VIEW &&
    createEffect(() =>
      androidInterface.onFocusResume$.pipe(
        tap(() => DroidLog.log('AndroidFocusModeEffects: Resume action received')),
        map(() => focusModeActions.unPauseFocusSession()),
      ),
    );

  // When the app returns to the foreground, the WebView's interval(1000) may have
  // been frozen while backgrounded, leaving the in-app focus countdown stale and
  // adrift from the still-accurate native notification (#7856). Fire one tick so
  // the wall-clock reducer snaps the countdown back to the truth — mirroring how
  // time tracking re-syncs from native on resume (syncOnResume$).
  resyncFocusTimerOnResume$ =
    IS_ANDROID_WEB_VIEW &&
    createEffect(() =>
      createFocusResumeTick$(
        androidInterface.onResume$.pipe(
          tap(() =>
            DroidLog.log('AndroidFocusModeEffects: App resumed, re-syncing focus timer'),
          ),
        ),
      ),
    );

  handleFocusSkip$ =
    IS_ANDROID_WEB_VIEW &&
    createEffect(() =>
      androidInterface.onFocusSkip$.pipe(
        tap(() => DroidLog.log('AndroidFocusModeEffects: Skip action received')),
        withLatestFrom(
          this._store.select(selectTimer),
          this._store.select(selectPausedTaskId),
        ),
        filter(([, timer]) => timer.purpose === 'break'),
        map(([, , pausedTaskId]) => focusModeActions.skipBreak({ pausedTaskId })),
      ),
    );

  handleFocusComplete$ =
    IS_ANDROID_WEB_VIEW &&
    createEffect(() =>
      androidInterface.onFocusComplete$.pipe(
        tap(() => DroidLog.log('AndroidFocusModeEffects: Complete action received')),
        withLatestFrom(this._store.select(selectTimer)),
        filter(([, timer]) => timer.purpose === 'work' && timer.isRunning),
        map(([, timer]) =>
          focusModeActions.completeFocusSession({
            isManual: true,
            completedDuration: this._completionDuration(timer),
          }),
        ),
      ),
    );

  handleNativeTimerComplete$ =
    IS_ANDROID_WEB_VIEW &&
    createEffect(() =>
      androidInterface.onFocusModeTimerComplete$.pipe(
        tap((isBreak) =>
          DroidLog.log(
            'AndroidFocusModeEffects: Native timer complete received, isBreak=' + isBreak,
          ),
        ),
        withLatestFrom(
          this._store.select(selectTimer),
          this._store.select(selectPausedTaskId),
        ),
        filter(([isBreak, timer]) => shouldHandleNativeTimerComplete(isBreak, timer)),
        map(([isBreak, timer, pausedTaskId]) => {
          if (isBreak) {
            return focusModeActions.skipBreak({ pausedTaskId });
          }
          return focusModeActions.completeFocusSession({
            isManual: false,
            completedDuration: this._completionDuration(timer),
          });
        }),
      ),
    );

  private _completionDuration(timer: TimerState): number {
    if (timer.duration > 0) {
      const cap = Math.max(0, timer.duration - timer.elapsed);
      const tick = this._globalTrackingInterval.triggerWakeUpTick(cap);
      return Math.min(timer.duration, timer.elapsed + tick.duration);
    }
    const tick = this._globalTrackingInterval.triggerWakeUpTick();
    return timer.elapsed + tick.duration;
  }

  private _safeNativeCall(fn: () => void, errorMsg: string, showSnackbar = false): void {
    try {
      fn();
    } catch (e) {
      DroidLog.err(errorMsg, e);
      DroidLog.err('Native call stack trace:', new Error().stack);
      if (showSnackbar) {
        this._snackService.open({ msg: errorMsg, type: 'ERROR' });
      }
    }
  }

  private _getNotificationTitle(
    mode: FocusModeMode,
    isBreak: boolean,
    isLongBreak: boolean,
  ): string {
    if (isBreak) {
      return isLongBreak ? 'Long Break' : 'Break';
    }

    switch (mode) {
      case 'Pomodoro':
        return 'Pomodoro';
      case 'Flowtime':
        return 'Flow';
      case 'Countdown':
        return 'Focus';
      default:
        return 'Focus';
    }
  }
}
