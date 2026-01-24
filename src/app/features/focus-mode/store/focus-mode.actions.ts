import { createAction, props } from '@ngrx/store';
import { FocusModeMode } from '../focus-mode.model';

// Core actions
export const focusModeLoaded = createAction('[FocusMode] Loaded');
export const tick = createAction('[FocusMode] Timer Tick');

// Primary actions (using Focus prefix for consistency)
export const setFocusModeMode = createAction(
  '[FocusMode] Set Mode',
  props<{ mode: FocusModeMode }>(),
);

// Phase transitions
export const showFocusOverlay = createAction('[FocusMode] Show Overlay');
export const hideFocusOverlay = createAction('[FocusMode] Hide Overlay');

export const selectFocusTask = createAction('[FocusMode] Select Task');
export const selectFocusDuration = createAction('[FocusMode] Select Duration');
export const startFocusPreparation = createAction('[FocusMode] Start Preparation');

export const startFocusSession = createAction(
  '[FocusMode] Start Session',
  props<{ duration?: number }>(),
);

export const navigateToMainScreen = createAction('[FocusMode] Navigate To Main Screen');

export const pauseFocusSession = createAction(
  '[FocusMode] Pause Session',
  props<{ pausedTaskId?: string | null }>(),
);
export const unPauseFocusSession = createAction('[FocusMode] Resume Session');
export const clearResumingBreakFlag = createAction(
  '[FocusMode] Clear Resuming Break Flag',
);

export const completeFocusSession = createAction(
  '[FocusMode] Complete Session',
  props<{ isManual?: boolean }>(),
);
export const cancelFocusSession = createAction('[FocusMode] Cancel Session');

export const startBreak = createAction(
  '[FocusMode] Start Break',
  props<{ duration?: number; isLongBreak?: boolean; pausedTaskId?: string | null }>(),
);
export const skipBreak = createAction(
  '[FocusMode] Skip Break',
  props<{ pausedTaskId?: string | null }>(),
);
export const completeBreak = createAction(
  '[FocusMode] Complete Break',
  props<{ pausedTaskId?: string | null }>(),
);

export const exitBreakToPlanning = createAction(
  '[FocusMode] Exit Break To Planning',
  props<{ pausedTaskId?: string | null }>(),
);

export const incrementCycle = createAction('[FocusMode] Next Cycle');
export const resetCycles = createAction('[FocusMode] Reset Cycles');

// Store pausedTaskId without pausing the session (for manual break scenarios)
export const setPausedTaskId = createAction(
  '[FocusMode] Set Paused Task Id',
  props<{ pausedTaskId: string | null }>(),
);

// Additional compatibility actions
export const setFocusSessionDuration = createAction(
  '[FocusMode] Set Focus Session Duration',
  props<{ focusSessionDuration: number }>(),
);

export const completeTask = createAction('[FocusMode] Complete Task');

export const adjustRemainingTime = createAction(
  '[FocusMode] Adjust Remaining Time',
  props<{ amountMs: number }>(),
);
