import { inject, Injectable } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import { Store } from '@ngrx/store';
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
import {
  selectCurrentTask,
  selectCurrentTaskId,
  selectIsTaskDataLoaded,
} from '../../tasks/store/task.selectors';
import { combineLatest } from 'rxjs';
import { FocusModeMode, TimerState } from '../../focus-mode/focus-mode.model';
import { DroidLog } from '../../../core/log';
import { HydrationStateService } from '../../../op-log/apply/hydration-state.service';
import { SnackService } from '../../../core/snack/snack.service';
import { GlobalTrackingIntervalService } from '../../../core/global-tracking-interval/global-tracking-interval.service';

export type NativeFocusModeData = {
  durationMs: number;
  /** Countdown remainder, or elapsed time for Flowtime (durationMs === 0). */
  remainingMs: number;
  isBreak: boolean;
  isPaused: boolean;
};

/**
 * Parse the JSON string returned by `androidInterface.getFocusModeElapsed()`.
 * Returns null for any falsy/`'null'` input or shape mismatch — the caller
 * treats null as "native is not running a focus session".
 *
 * Exported so unit tests can exercise it without instantiating the effect
 * (which is gated behind IS_ANDROID_WEB_VIEW).
 */
export const parseNativeFocusModeData = (
  json: string | null | undefined,
): NativeFocusModeData | null => {
  if (!json || json === 'null') {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    DroidLog.err('Failed to parse native focus mode data', e);
    return null;
  }

  if (!parsed || typeof parsed !== 'object') {
    DroidLog.warn('Native service returned non-object focus data', {
      length: json.length,
    });
    return null;
  }

  const { durationMs, remainingMs, isBreak, isPaused } =
    parsed as Partial<NativeFocusModeData>;
  if (
    typeof durationMs !== 'number' ||
    !Number.isFinite(durationMs) ||
    typeof remainingMs !== 'number' ||
    !Number.isFinite(remainingMs) ||
    typeof isBreak !== 'boolean' ||
    typeof isPaused !== 'boolean'
  ) {
    DroidLog.warn('Native service returned invalid focus data', {
      length: json.length,
    });
    return null;
  }

  return { durationMs, remainingMs, isBreak, isPaused };
};

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
            // `prev` is null on the `startWith(null)` seed (cold start). Treat
            // that as "not active" — otherwise the first emission of an idle
            // store would wrongly fire the stop branch below and tear down a
            // native session that survived the app swipe (#7855).
            const wasFocusModeActive = !!prev && prev.timer.purpose !== null;

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
              } else if (this._hasStateChanged(prev?.timer, timer, taskTitle, curr)) {
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

  // Re-adopt a focus session that kept running in the native foreground
  // service after the app was swiped from recents and reopened (#7855). The
  // WebView is recreated with an idle store, so without this the session (and
  // its notification, once syncFocusModeToNotification$ re-syncs) would be lost.
  //
  // Triggers ONLY on the resume/cold-start edge:
  //   - onResume$ (ReplaySubject + startWith) fires on every app resume and
  //     replays the cold-start emission even if it fired before we subscribed;
  //   - selectIsTaskDataLoaded flips false→true once when hydration settles.
  // `selectTimer` is SAMPLED via withLatestFrom, NOT used as a trigger. This is
  // load-bearing: if the timer were a combineLatest source, *ending* a session
  // (cancel/complete) would re-emit an idle store and re-run this read. Because
  // the native stop is asynchronous (stopFocusModeService → stopService →
  // onDestroy on the UI thread), getFocusModeElapsed() would still see
  // isRunning === true and wrongly re-adopt the session that just ended —
  // resurrecting a cancelled session / double-logging a completed one. Sampling
  // the timer means only a genuine resume/cold-start can trigger recovery.
  //
  // We recover only while the store is idle, so a live in-app session is never
  // clobbered. After restore, syncFocusModeToNotification$ re-issues
  // startFocusModeService with the same remaining time the native service
  // already holds — an intentional, idempotent round-trip (no countdown reset).
  recoverFocusSession$ =
    IS_ANDROID_WEB_VIEW &&
    createEffect(() =>
      combineLatest([
        androidInterface.onResume$.pipe(startWith(undefined)),
        this._store.select(selectIsTaskDataLoaded),
      ]).pipe(
        filter(([, isTaskDataLoaded]) => isTaskDataLoaded),
        withLatestFrom(this._store.select(selectTimer)),
        filter(
          ([, timer]) =>
            timer.purpose === null && !this._hydrationState.isApplyingRemoteOps(),
        ),
        map(() => parseNativeFocusModeData(androidInterface.getFocusModeElapsed?.())),
        filter((data): data is NativeFocusModeData => data !== null),
        tap((data) =>
          DroidLog.log('AndroidFocusModeEffects: Recovering focus session from native', {
            durationMs: data.durationMs,
            remainingMs: data.remainingMs,
            isBreak: data.isBreak,
            isPaused: data.isPaused,
          }),
        ),
        map((data) => focusModeActions.restoreFocusSessionFromNative(data)),
      ),
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
        filter(([isBreak, timer]) =>
          isBreak
            ? timer.purpose === 'break'
            : timer.purpose === 'work' && timer.isRunning,
        ),
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

  private _hasStateChanged(
    prevTimer: TimerState | undefined,
    currTimer: TimerState,
    taskTitle: string | null,
    curr: {
      timer: TimerState;
      mode: FocusModeMode;
      currentTask: { title: string } | null;
      isBreakActive: boolean;
      isLongBreak: boolean;
      timeRemaining: number;
    },
  ): boolean {
    if (!prevTimer) return true;

    // Check if pause state changed
    if (prevTimer.isRunning !== currTimer.isRunning) return true;

    // Check if purpose changed (work -> break or vice versa)
    if (prevTimer.purpose !== currTimer.purpose) return true;

    // Only update notification every 5 seconds to reduce overhead
    // (native service already updates every second)
    const elapsedDiff = Math.abs(currTimer.elapsed - prevTimer.elapsed);
    if (elapsedDiff >= 5000) return true;

    return false;
  }
}
