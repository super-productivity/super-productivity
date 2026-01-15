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
import { selectCurrentTask, selectCurrentTaskId } from '../../tasks/store/task.selectors';
import { combineLatest } from 'rxjs';
import { FocusModeMode, TimerState } from '../../focus-mode/focus-mode.model';
import { DroidLog } from '../../../core/log';
import { HydrationStateService } from '../../../op-log/apply/hydration-state.service';
import { SnackService } from '../../../core/snack/snack.service';

@Injectable()
export class AndroidFocusModeEffects {
  private _store = inject(Store);
  private _hydrationState = inject(HydrationStateService);
  private _snackService = inject(SnackService);

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

  // Handle notification action callbacks
  handleFocusPause$ =
    IS_ANDROID_WEB_VIEW &&
    createEffect(() =>
      androidInterface.onFocusPause$.pipe(
        tap(() => DroidLog.log('AndroidFocusModeEffects: Pause action received')),
        withLatestFrom(this._store.select(selectCurrentTaskId)),
        map(([_, currentTaskId]) =>
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
        withLatestFrom(this._store.select(selectPausedTaskId)),
        map(([_, pausedTaskId]) => focusModeActions.skipBreak({ pausedTaskId })),
      ),
    );

  handleFocusComplete$ =
    IS_ANDROID_WEB_VIEW &&
    createEffect(() =>
      androidInterface.onFocusComplete$.pipe(
        tap(() => DroidLog.log('AndroidFocusModeEffects: Complete action received')),
        map(() => focusModeActions.completeFocusSession({ isManual: true })),
      ),
    );

  // Handle native timer completion (when native service detects timer reached 0 in background)
  handleNativeTimerComplete$ =
    IS_ANDROID_WEB_VIEW &&
    createEffect(() =>
      androidInterface.onFocusModeTimerComplete$.pipe(
        tap((isBreak) =>
          DroidLog.log(
            'AndroidFocusModeEffects: Native timer complete received, isBreak=' + isBreak,
          ),
        ),
        withLatestFrom(this._store.select(selectPausedTaskId)),
        map(([isBreak, pausedTaskId]) => {
          if (isBreak) {
            // Break timer completed, skip the break (go back to work)
            return focusModeActions.skipBreak({ pausedTaskId });
          } else {
            // Work session completed
            return focusModeActions.completeFocusSession({ isManual: false });
          }
        }),
      ),
    );

  private _safeNativeCall(fn: () => void, errorMsg: string, showSnackbar = false): void {
    try {
      fn();
    } catch (e) {
      DroidLog.err(errorMsg, e);
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
