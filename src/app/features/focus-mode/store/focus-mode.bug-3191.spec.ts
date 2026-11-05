/**
 * Regression tests for GitHub issue #3191
 * https://github.com/super-productivity/super-productivity/issues/3191
 *
 * Skipping / completing a Pomodoro session while task tracking is already
 * paused must still start a running break (full remaining time, counting
 * down — not stuck paused or already "done").
 *
 * The old Pomodoro dialog keyed off isManualPause and showed "Break is over!"
 * when work had been paused. Focus mode always creates a running break timer;
 * stopTrackingOnSessionEnd$ must not unset tracking after that startBreak
 * (see focus-mode.effects.spec.ts) or syncTrackingStopToSession$ pauses it.
 */

import * as actions from './focus-mode.actions';
import { focusModeReducer, initialState } from './focus-mode.reducer';
import {
  FocusMainUIState,
  FocusModeMode,
  FocusModeState,
  FocusScreen,
  FOCUS_MODE_DEFAULTS,
} from '../focus-mode.model';

describe('FocusMode Bug #3191: complete session while tracking paused starts a running break', () => {
  it('starts a running break after completing a paused Pomodoro work session', () => {
    let state: FocusModeState = {
      ...initialState,
      mode: FocusModeMode.Pomodoro,
      currentCycle: 1,
      mainState: FocusMainUIState.InProgress,
      currentScreen: FocusScreen.Main,
      timer: {
        isRunning: true,
        startedAt: Date.now() - 60_000,
        elapsed: 60_000,
        duration: FOCUS_MODE_DEFAULTS.SESSION_DURATION,
        purpose: 'work',
      },
    };

    // User paused tracking → syncTrackingStopToSession$ pauses the work timer
    state = focusModeReducer(
      state,
      actions.pauseFocusSession({ pausedTaskId: 'task-1' }),
    );
    expect(state.timer.isRunning).toBe(false);
    expect(state.pausedTaskId).toBe('task-1');

    // "Skip to end" / complete session (UI always uses isManual: true)
    state = focusModeReducer(state, actions.completeFocusSession({ isManual: true }));
    state = focusModeReducer(state, actions.incrementCycle());
    state = focusModeReducer(
      state,
      actions.startBreak({
        duration: FOCUS_MODE_DEFAULTS.SHORT_BREAK_DURATION,
        isLongBreak: false,
      }),
    );

    expect(state.currentScreen).toBe(FocusScreen.Break);
    expect(state.timer.purpose).toBe('break');
    expect(state.timer.isRunning).toBe(true);
    expect(state.timer.elapsed).toBe(0);
    expect(state.timer.duration).toBe(FOCUS_MODE_DEFAULTS.SHORT_BREAK_DURATION);
    expect(state.timer.duration - state.timer.elapsed).toBe(
      FOCUS_MODE_DEFAULTS.SHORT_BREAK_DURATION,
    );
  });
});
