import { createReducer, on } from '@ngrx/store';
import * as a from './focus-mode.actions';
import {
  FocusMainUIState,
  FocusModeMode,
  FocusModeState,
  FocusScreen,
  TimerState,
  FOCUS_MODE_DEFAULTS,
} from '../focus-mode.model';
import { LS } from '../../../core/persistence/storage-keys.const';

export const FOCUS_MODE_FEATURE_KEY = 'focusMode';

const focusModeModeFromLS = localStorage.getItem(LS.FOCUS_MODE_MODE);

const createIdleTimer = (): TimerState => ({
  isRunning: false,
  startedAt: null,
  elapsed: 0,
  duration: 0,
  purpose: null,
});

export const initialState: FocusModeState = {
  timer: createIdleTimer(),
  currentScreen: FocusScreen.Main,
  mainState: FocusMainUIState.Preparation,
  isOverlayShown: false,
  mode: Object.values(FocusModeMode).includes(focusModeModeFromLS as any)
    ? (focusModeModeFromLS as FocusModeMode)
    : FocusModeMode.Countdown,
  currentCycle: 1,
  lastCompletedDuration: 0,
  pausedTaskId: null,
};

const createWorkTimer = (duration: number): TimerState => ({
  isRunning: true,
  startedAt: Date.now(),
  elapsed: 0,
  duration,
  purpose: 'work',
});

const createBreakTimer = (duration: number, isLong = false): TimerState => ({
  isRunning: true,
  startedAt: Date.now(),
  elapsed: 0,
  duration,
  purpose: 'break',
  isLongBreak: isLong,
});

const updateTimer = (timer: TimerState): TimerState => {
  if (!timer.isRunning || !timer.startedAt) {
    return timer;
  }

  const now = Date.now();
  const elapsed = now - timer.startedAt;
  return { ...timer, elapsed };
};

export const focusModeReducer = createReducer(
  initialState,

  // Mode changes
  on(a.setFocusModeMode, (state, { mode }) => ({
    ...state,
    mode,
  })),

  // Overlay control
  on(a.showFocusOverlay, (state) => ({
    ...state,
    isOverlayShown: true,
  })),

  on(a.hideFocusOverlay, (state) => ({
    ...state,
    isOverlayShown: false,
  })),

  // Screen navigation
  on(a.selectFocusTask, (state) => ({
    ...state,
    currentScreen: FocusScreen.Main,
    mainState: FocusMainUIState.Preparation,
  })),

  on(a.selectFocusDuration, (state) => ({
    ...state,
    currentScreen: FocusScreen.Main,
    mainState: FocusMainUIState.Preparation,
  })),

  on(a.startFocusPreparation, (state) => ({
    ...state,
    currentScreen: FocusScreen.Main,
    mainState: FocusMainUIState.Countdown,
  })),

  on(a.navigateToMainScreen, (state) => ({
    ...state,
    currentScreen: FocusScreen.Main,
    mainState: FocusMainUIState.Preparation,
  })),

  on(a.startFocusSession, (state, { duration }) => {
    // important to use 0 for flowtime
    const timer = createWorkTimer(duration ?? FOCUS_MODE_DEFAULTS.SESSION_DURATION);
    return {
      ...state,
      timer,
      currentScreen: FocusScreen.Main,
      mainState: FocusMainUIState.InProgress,
    };
  }),

  on(a.pauseFocusSession, (state, { pausedTaskId }) => {
    // Allow pausing both work sessions and breaks
    if (state.timer.purpose === null) return state;

    return {
      ...state,
      timer: {
        ...state.timer,
        isRunning: false,
      },
      // Store paused task ID if provided (for sync feature)
      pausedTaskId: pausedTaskId ?? state.pausedTaskId,
    };
  }),

  on(a.unPauseFocusSession, (state) => {
    // Allow resuming both work sessions and breaks
    if (state.timer.purpose === null) return state;

    return {
      ...state,
      timer: {
        ...state.timer,
        isRunning: true,
        startedAt: Date.now() - state.timer.elapsed,
      },
    };
  }),

  on(a.completeFocusSession, (state, { isManual }) => {
    const duration = state.timer.elapsed;

    return {
      ...state,
      timer: createIdleTimer(),
      currentScreen: FocusScreen.SessionDone,
      mainState: FocusMainUIState.Preparation,
      lastCompletedDuration: duration,
    };
  }),

  on(a.cancelFocusSession, (state) => ({
    ...state,
    timer: createIdleTimer(),
    currentScreen: FocusScreen.Main,
    mainState: FocusMainUIState.Preparation,
    isOverlayShown: false,
    pausedTaskId: null,
  })),

  // Break handling
  on(a.startBreak, (state, { duration, isLongBreak, pausedTaskId }) => {
    const timer = createBreakTimer(
      duration || FOCUS_MODE_DEFAULTS.SHORT_BREAK_DURATION,
      isLongBreak || false,
    );

    return {
      ...state,
      timer,
      currentScreen: FocusScreen.Break,
      mainState: FocusMainUIState.Preparation,
      pausedTaskId: pausedTaskId ?? state.pausedTaskId,
    };
  }),

  on(a.skipBreak, a.completeBreak, (state) => ({
    ...state,
    timer: createIdleTimer(),
    currentScreen: FocusScreen.Main,
    mainState: FocusMainUIState.Preparation,
    pausedTaskId: null,
  })),

  // Exit break to planning - same as skip/complete but doesn't trigger auto-start effect
  on(a.exitBreakToPlanning, (state) => ({
    ...state,
    timer: createIdleTimer(),
    currentScreen: FocusScreen.Main,
    mainState: FocusMainUIState.Preparation,
    pausedTaskId: null,
  })),

  // Timer updates - much simpler!
  on(a.tick, (state) => {
    if (!state.timer.isRunning || !state.timer.purpose) {
      return state;
    }

    const updatedTimer = updateTimer(state.timer);

    // Check if timer completed - mark for completion but let effects handle the flow
    if (updatedTimer.duration > 0 && updatedTimer.elapsed >= updatedTimer.duration) {
      if (updatedTimer.purpose === 'work') {
        // Work session completed - stop timer and mark duration, but don't change screen yet
        return {
          ...state,
          timer: { ...updatedTimer, isRunning: false }, // Stop the timer but preserve state
          lastCompletedDuration: updatedTimer.elapsed,
        };
      } else if (updatedTimer.purpose === 'break') {
        // Break completed - stop timer but stay on break screen for user confirmation
        return {
          ...state,
          timer: { ...updatedTimer, isRunning: false },
        };
      }
    }

    // Just update the timer
    return {
      ...state,
      timer: updatedTimer,
    };
  }),

  // Duration setting - don't set duration for Flowtime sessions
  on(a.setFocusSessionDuration, (state, { focusSessionDuration }) => {
    // Prevent setting duration for Flowtime mode to ensure it runs forever
    if (state.mode === FocusModeMode.Flowtime) {
      return state;
    }
    return {
      ...state,
      timer: {
        ...state.timer,
        duration: focusSessionDuration,
      },
    };
  }),

  // Cycle management
  on(a.incrementCycle, (state) => ({
    ...state,
    currentCycle: state.currentCycle + 1,
  })),

  on(a.resetCycles, (state) => ({
    ...state,
    currentCycle: 1,
  })),

  // Store pausedTaskId without pausing the session
  on(a.setPausedTaskId, (state, { pausedTaskId }) => ({
    ...state,
    pausedTaskId,
  })),

  // Adjust remaining time by modifying goal duration (work sessions only)
  on(a.adjustRemainingTime, (state, { amountMs }) => {
    if (state.timer.purpose !== 'work') {
      return state;
    }

    if (state.mode === FocusModeMode.Flowtime) {
      return state;
    }

    const currentDuration = state.timer.duration;
    if (typeof currentDuration !== 'number') {
      return state;
    }

    const updatedDuration = Math.max(0, currentDuration + amountMs);

    if (updatedDuration === currentDuration) {
      return state;
    }

    return {
      ...state,
      timer: {
        ...state.timer,
        duration: updatedDuration,
      },
    };
  }),
);

// For backward compatibility, export the old State interface name
export type State = FocusModeState;
