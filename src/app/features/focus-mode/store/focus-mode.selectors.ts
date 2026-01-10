import { createFeatureSelector, createSelector } from '@ngrx/store';
import { FOCUS_MODE_FEATURE_KEY } from './focus-mode.reducer';
import { FocusModeState } from '../focus-mode.model';

// Base selectors
export const selectFocusModeState =
  createFeatureSelector<FocusModeState>(FOCUS_MODE_FEATURE_KEY);

export const selectTimer = createSelector(selectFocusModeState, (state) => state.timer);

export const selectCurrentScreen = createSelector(
  selectFocusModeState,
  (state) => state.currentScreen,
);

export const selectMainState = createSelector(
  selectFocusModeState,
  (state) => state.mainState,
);

export const selectMode = createSelector(selectFocusModeState, (state) => state.mode);

export const selectIsOverlayShown = createSelector(
  selectFocusModeState,
  (state) => state.isOverlayShown,
);

export const selectCurrentCycle = createSelector(
  selectFocusModeState,
  (state) => state.currentCycle,
);

export const selectLastSessionDuration = createSelector(
  selectFocusModeState,
  (state) => state.lastCompletedDuration,
);

// Session selectors
export const selectIsSessionRunning = createSelector(
  selectTimer,
  (timer) => timer.isRunning && timer.purpose === 'work',
);

export const selectIsSessionPaused = createSelector(
  selectTimer,
  (timer) => !timer.isRunning && timer.purpose === 'work',
);

// Break selectors
export const selectIsBreakActive = createSelector(
  selectTimer,
  (timer) => timer.purpose === 'break',
);

export const selectIsLongBreak = createSelector(
  selectTimer,
  (timer) => timer.purpose === 'break' && timer.isLongBreak === true,
);

// Timer selectors - much simpler!
export const selectTimeElapsed = createSelector(selectTimer, (timer) => timer.elapsed);

export const selectTimeDuration = createSelector(selectTimer, (timer) => timer.duration);

export const selectTimeRemaining = createSelector(
  selectTimeElapsed,
  selectTimeDuration,
  (elapsed, duration) => Math.max(0, duration - elapsed),
);

export const selectProgress = createSelector(
  selectTimeElapsed,
  selectTimeDuration,
  (elapsed, duration) => (duration > 0 ? (elapsed / duration) * 100 : 0),
);

export const selectIsRunning = createSelector(
  selectTimer,
  (timer) => timer.isRunning && timer.purpose !== null,
);

// Session completed selector
export const selectIsSessionCompleted = createSelector(
  selectCurrentScreen,
  (currentScreen) => currentScreen === 'SessionDone',
);

// Paused task during breaks
export const selectPausedTaskId = createSelector(
  selectFocusModeState,
  (state) => state.pausedTaskId,
);
