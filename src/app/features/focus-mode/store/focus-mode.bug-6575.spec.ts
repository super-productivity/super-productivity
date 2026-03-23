/**
 * Tests for GitHub issue #6575
 * https://github.com/super-productivity/super-productivity/issues/6575
 *
 * Bug: Finishing a task in focus mode with isSyncSessionWithTracking causes
 * the session UI to revert to the preparation state (showing play button
 * instead of pause/end buttons).
 *
 * Root cause: When a task is completed with isSyncSessionWithTracking enabled,
 * the chain task done → unsetCurrentTask → pauseFocusSession → (new task selected)
 * → unPauseFocusSession fires. The unPauseFocusSession reducer resumes the timer
 * but does NOT restore mainState to InProgress, leaving the UI in Preparation.
 */

import { focusModeReducer, initialState } from './focus-mode.reducer';
import * as a from './focus-mode.actions';
import { FocusMainUIState, FocusModeState, FocusScreen } from '../focus-mode.model';

describe('FocusMode Bug #6575: unPauseFocusSession should restore InProgress state', () => {
  const createPausedWorkState = (): FocusModeState => ({
    ...initialState,
    timer: {
      isRunning: false,
      startedAt: null,
      elapsed: 600000, // 10 minutes elapsed
      duration: 1500000, // 25 minutes
      purpose: 'work',
    },
    currentScreen: FocusScreen.Main,
    mainState: FocusMainUIState.InProgress,
    isOverlayShown: true,
    pausedTaskId: 'task-1',
  });

  const createPausedBreakState = (): FocusModeState => ({
    ...initialState,
    timer: {
      isRunning: false,
      startedAt: null,
      elapsed: 120000, // 2 minutes elapsed
      duration: 300000, // 5 minutes
      purpose: 'break',
    },
    currentScreen: FocusScreen.Break,
    mainState: FocusMainUIState.Preparation,
    isOverlayShown: true,
    pausedTaskId: 'task-1',
  });

  it('should restore mainState to InProgress even when mainState was Preparation (exact bug state)', () => {
    const bugState: FocusModeState = {
      ...createPausedWorkState(),
      mainState: FocusMainUIState.Preparation, // This is the actual bug state
    };
    const result = focusModeReducer(bugState, a.unPauseFocusSession());

    expect(result.mainState).toBe(FocusMainUIState.InProgress);
    expect(result.currentScreen).toBe(FocusScreen.Main);
  });

  it('should restore mainState to InProgress when resuming a paused work session', () => {
    const pausedState = createPausedWorkState();
    const result = focusModeReducer(pausedState, a.unPauseFocusSession());

    expect(result.mainState).toBe(FocusMainUIState.InProgress);
    expect(result.timer.isRunning).toBe(true);
    expect(result.timer.purpose).toBe('work');
  });

  it('should set currentScreen to Main when resuming a paused work session', () => {
    const pausedState = createPausedWorkState();
    const result = focusModeReducer(pausedState, a.unPauseFocusSession());

    expect(result.currentScreen).toBe(FocusScreen.Main);
  });

  it('should NOT change mainState when resuming a paused break session', () => {
    const pausedState = createPausedBreakState();
    const result = focusModeReducer(pausedState, a.unPauseFocusSession());

    // Break sessions don't need InProgress mainState
    expect(result.mainState).toBe(FocusMainUIState.Preparation);
    expect(result.timer.isRunning).toBe(true);
    expect(result.timer.purpose).toBe('break');
  });

  it('should be a no-op when timer has no purpose', () => {
    const idleState = { ...initialState };
    const result = focusModeReducer(idleState, a.unPauseFocusSession());

    expect(result).toBe(idleState);
  });

  it('should simulate the full pause/unpause cycle for task switching', () => {
    // Step 1: Start a work session
    let state = focusModeReducer(
      initialState,
      a.startFocusSession({ duration: 1500000 }),
    );
    expect(state.mainState).toBe(FocusMainUIState.InProgress);
    expect(state.timer.isRunning).toBe(true);

    // Step 2: Pause (triggered by task done → unsetCurrentTask → syncTrackingStopToSession)
    state = focusModeReducer(state, a.pauseFocusSession({ pausedTaskId: 'task-1' }));
    expect(state.timer.isRunning).toBe(false);
    expect(state.mainState).toBe(FocusMainUIState.InProgress);

    // Step 3: Unpause (triggered by new task selected → syncTrackingStartToSession)
    state = focusModeReducer(state, a.unPauseFocusSession());
    expect(state.timer.isRunning).toBe(true);
    expect(state.mainState).toBe(FocusMainUIState.InProgress);
    expect(state.currentScreen).toBe(FocusScreen.Main);
  });
});
