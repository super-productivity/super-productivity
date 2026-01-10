import * as selectors from './focus-mode.selectors';
import {
  FocusModeState,
  FocusScreen,
  FocusModeMode,
  FocusMainUIState,
  TimerState,
} from '../focus-mode.model';

describe('FocusModeSelectors', () => {
  const createMockTimer = (overrides: Partial<TimerState> = {}): TimerState => ({
    isRunning: false,
    startedAt: null,
    elapsed: 0,
    duration: 1500000,
    purpose: null,
    ...overrides,
  });

  const createMockFocusModeState = (
    overrides: Partial<FocusModeState> = {},
  ): FocusModeState => ({
    timer: createMockTimer(),
    currentScreen: FocusScreen.Main,
    mainState: FocusMainUIState.Preparation,
    isOverlayShown: false,
    mode: FocusModeMode.Pomodoro,
    currentCycle: 1,
    lastCompletedDuration: 0,
    pausedTaskId: null,
    ...overrides,
  });

  describe('selectFocusModeState', () => {
    it('should select the focus mode state', () => {
      const focusModeState = createMockFocusModeState();
      const state = { focusMode: focusModeState };
      const result = selectors.selectFocusModeState.projector(state.focusMode);

      expect(result).toEqual(focusModeState);
    });
  });

  describe('selectTimer', () => {
    it('should select the timer state', () => {
      const timer = createMockTimer({ elapsed: 60000 });
      const focusModeState = createMockFocusModeState({ timer });
      const result = selectors.selectTimer.projector(focusModeState);

      expect(result).toEqual(timer);
    });
  });

  describe('selectCurrentScreen', () => {
    it('should select the current screen', () => {
      const focusModeState = createMockFocusModeState({
        currentScreen: FocusScreen.Main,
      });
      const result = selectors.selectCurrentScreen.projector(focusModeState);

      expect(result).toBe(FocusScreen.Main);
    });
  });

  describe('selectMainState', () => {
    it('should select the main state', () => {
      const focusModeState = createMockFocusModeState({
        mainState: FocusMainUIState.Countdown,
      });
      const result = selectors.selectMainState.projector(focusModeState);

      expect(result).toBe(FocusMainUIState.Countdown);
    });
  });

  describe('selectMode', () => {
    it('should select the focus mode', () => {
      const focusModeState = createMockFocusModeState({
        mode: FocusModeMode.Flowtime,
      });
      const result = selectors.selectMode.projector(focusModeState);

      expect(result).toBe(FocusModeMode.Flowtime);
    });
  });

  describe('selectIsOverlayShown', () => {
    it('should select overlay visibility', () => {
      const focusModeState = createMockFocusModeState({ isOverlayShown: true });
      const result = selectors.selectIsOverlayShown.projector(focusModeState);

      expect(result).toBe(true);
    });
  });

  describe('selectCurrentCycle', () => {
    it('should select the current cycle', () => {
      const focusModeState = createMockFocusModeState({ currentCycle: 3 });
      const result = selectors.selectCurrentCycle.projector(focusModeState);

      expect(result).toBe(3);
    });
  });

  describe('selectLastSessionDuration', () => {
    it('should select the last session duration', () => {
      const focusModeState = createMockFocusModeState({
        lastCompletedDuration: 1800000,
      });
      const result = selectors.selectLastSessionDuration.projector(focusModeState);

      expect(result).toBe(1800000);
    });
  });

  describe('selectIsSessionRunning', () => {
    it('should return true when timer is running with work purpose', () => {
      const timer = createMockTimer({ isRunning: true, purpose: 'work' });
      const result = selectors.selectIsSessionRunning.projector(timer);

      expect(result).toBe(true);
    });

    it('should return false when timer is running with break purpose', () => {
      const timer = createMockTimer({ isRunning: true, purpose: 'break' });
      const result = selectors.selectIsSessionRunning.projector(timer);

      expect(result).toBe(false);
    });

    it('should return false when timer is not running', () => {
      const timer = createMockTimer({ isRunning: false, purpose: 'work' });
      const result = selectors.selectIsSessionRunning.projector(timer);

      expect(result).toBe(false);
    });
  });

  describe('selectIsSessionPaused', () => {
    it('should return true when work session is paused', () => {
      const timer = createMockTimer({ isRunning: false, purpose: 'work' });
      const result = selectors.selectIsSessionPaused.projector(timer);

      expect(result).toBe(true);
    });

    it('should return false when work session is running', () => {
      const timer = createMockTimer({ isRunning: true, purpose: 'work' });
      const result = selectors.selectIsSessionPaused.projector(timer);

      expect(result).toBe(false);
    });

    it('should return false for break sessions', () => {
      const timer = createMockTimer({ isRunning: false, purpose: 'break' });
      const result = selectors.selectIsSessionPaused.projector(timer);

      expect(result).toBe(false);
    });
  });

  describe('selectIsBreakActive', () => {
    it('should return true when timer purpose is break', () => {
      const timer = createMockTimer({ purpose: 'break' });
      const result = selectors.selectIsBreakActive.projector(timer);

      expect(result).toBe(true);
    });

    it('should return false when timer purpose is work', () => {
      const timer = createMockTimer({ purpose: 'work' });
      const result = selectors.selectIsBreakActive.projector(timer);

      expect(result).toBe(false);
    });

    it('should return false when timer purpose is null', () => {
      const timer = createMockTimer({ purpose: null });
      const result = selectors.selectIsBreakActive.projector(timer);

      expect(result).toBe(false);
    });
  });

  describe('selectIsLongBreak', () => {
    it('should return true for long break', () => {
      const timer = createMockTimer({ purpose: 'break', isLongBreak: true });
      const result = selectors.selectIsLongBreak.projector(timer);

      expect(result).toBe(true);
    });

    it('should return false for short break', () => {
      const timer = createMockTimer({ purpose: 'break', isLongBreak: false });
      const result = selectors.selectIsLongBreak.projector(timer);

      expect(result).toBe(false);
    });

    it('should return false for work session', () => {
      const timer = createMockTimer({ purpose: 'work' });
      const result = selectors.selectIsLongBreak.projector(timer);

      expect(result).toBe(false);
    });

    it('should return false when isLongBreak is undefined', () => {
      const timer = createMockTimer({ purpose: 'break' }); // isLongBreak is undefined
      const result = selectors.selectIsLongBreak.projector(timer);

      expect(result).toBe(false);
    });
  });

  describe('selectTimeElapsed', () => {
    it('should select elapsed time', () => {
      const timer = createMockTimer({ elapsed: 300000 });
      const result = selectors.selectTimeElapsed.projector(timer);

      expect(result).toBe(300000);
    });
  });

  describe('selectTimeDuration', () => {
    it('should select timer duration', () => {
      const timer = createMockTimer({ duration: 1800000 });
      const result = selectors.selectTimeDuration.projector(timer);

      expect(result).toBe(1800000);
    });
  });

  describe('selectTimeRemaining', () => {
    it('should calculate time remaining', () => {
      const elapsed = 300000;
      const duration = 1500000;
      const result = selectors.selectTimeRemaining.projector(elapsed, duration);

      expect(result).toBe(1200000);
    });

    it('should return 0 when elapsed exceeds duration', () => {
      const elapsed = 1600000;
      const duration = 1500000;
      const result = selectors.selectTimeRemaining.projector(elapsed, duration);

      expect(result).toBe(0);
    });

    it('should handle zero duration', () => {
      const elapsed = 300000;
      const duration = 0;
      const result = selectors.selectTimeRemaining.projector(elapsed, duration);

      expect(result).toBe(0);
    });
  });

  describe('selectProgress', () => {
    it('should calculate progress percentage', () => {
      const elapsed = 750000;
      const duration = 1500000;
      const result = selectors.selectProgress.projector(elapsed, duration);

      expect(result).toBe(50);
    });

    it('should return 0 for zero duration', () => {
      const elapsed = 300000;
      const duration = 0;
      const result = selectors.selectProgress.projector(elapsed, duration);

      expect(result).toBe(0);
    });

    it('should handle 100% progress', () => {
      const elapsed = 1500000;
      const duration = 1500000;
      const result = selectors.selectProgress.projector(elapsed, duration);

      expect(result).toBe(100);
    });

    it('should handle progress over 100%', () => {
      const elapsed = 1800000;
      const duration = 1500000;
      const result = selectors.selectProgress.projector(elapsed, duration);

      expect(result).toBe(120);
    });
  });

  describe('selectIsRunning', () => {
    it('should return true when timer is running with work purpose', () => {
      const timer = createMockTimer({ isRunning: true, purpose: 'work' });
      const result = selectors.selectIsRunning.projector(timer);

      expect(result).toBe(true);
    });

    it('should return true when timer is running with break purpose', () => {
      const timer = createMockTimer({ isRunning: true, purpose: 'break' });
      const result = selectors.selectIsRunning.projector(timer);

      expect(result).toBe(true);
    });

    it('should return false when timer is running but purpose is null', () => {
      const timer = createMockTimer({ isRunning: true, purpose: null });
      const result = selectors.selectIsRunning.projector(timer);

      expect(result).toBe(false);
    });

    it('should return false when timer is not running', () => {
      const timer = createMockTimer({ isRunning: false, purpose: 'work' });
      const result = selectors.selectIsRunning.projector(timer);

      expect(result).toBe(false);
    });
  });

  describe('selectIsSessionCompleted', () => {
    it('should return true when current screen is SessionDone', () => {
      const result = selectors.selectIsSessionCompleted.projector(
        FocusScreen.SessionDone,
      );

      expect(result).toBe(true);
    });

    it('should return false when current screen is not SessionDone', () => {
      const result = selectors.selectIsSessionCompleted.projector(FocusScreen.Main);

      expect(result).toBe(false);
    });
  });
});
