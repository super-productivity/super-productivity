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
import {
  selectCurrentTask,
  selectCurrentTaskId,
  selectIsTaskDataLoaded,
} from '../../tasks/store/task.selectors';
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
 * The notification's chronometer ticks natively, so steady-state elapsed
 * changes need no push at all — and since prev/curr are consecutive per-tick
 * emissions (~1s apart), the 5s gate suppresses them entirely (#8243). Do not
 * weaken it: every push re-runs startForeground + a notification rebuild.
 * Pause/purpose changes — and the large elapsed jump a resume `tick()`
 * produces (#7856) — must propagate immediately so the notification
 * reconciles with the corrected in-app countdown. (The 5000 here and
 * TIME_SPENT_JUMP_THRESHOLD_MS in android-foreground-tracking.effects.ts
 * encode the same "larger than any tick" idea but differ in semantics —
 * abs() vs decrease-always-passes — so they are deliberately not shared.)
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
  // clobbered. (The sibling resyncFocusTimerOnResume$ also fires on resume, but
  // its tick() is a no-op while the store is idle, so the two don't conflict.)
  // After restore, syncFocusModeToNotification$ re-issues startFocusModeService
  // with the same remaining time the native service already holds — an
  // intentional, idempotent round-trip (no countdown reset).
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
