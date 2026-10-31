import {
  getCountdownDurationForTask,
  TimerState,
  FocusScreen,
  FocusModeMode,
  FocusModeState,
  FocusMainUIState,
  isTimerRunning,
  isWorkSession,
  isBreakSession,
  FOCUS_MODE_DEFAULTS,
  getFocusModeSoundVolume,
} from './focus-mode.model';

describe('FocusModeModel', () => {
  describe('isTimerRunning', () => {
    it('should return true when timer is running with work purpose', () => {
      const timer: TimerState = {
        isRunning: true,
        startedAt: Date.now(),
        elapsed: 0,
        duration: 1500000,
        purpose: 'work',
      };

      expect(isTimerRunning(timer)).toBe(true);
    });

    it('should return true when timer is running with break purpose', () => {
      const timer: TimerState = {
        isRunning: true,
        startedAt: Date.now(),
        elapsed: 0,
        duration: 300000,
        purpose: 'break',
      };

      expect(isTimerRunning(timer)).toBe(true);
    });

    it('should return false when timer is running but purpose is null', () => {
      const timer: TimerState = {
        isRunning: true,
        startedAt: Date.now(),
        elapsed: 0,
        duration: 1500000,
        purpose: null,
      };

      expect(isTimerRunning(timer)).toBe(false);
    });

    it('should return false when timer is not running', () => {
      const timer: TimerState = {
        isRunning: false,
        startedAt: null,
        elapsed: 0,
        duration: 1500000,
        purpose: 'work',
      };

      expect(isTimerRunning(timer)).toBe(false);
    });
  });

  describe('isWorkSession', () => {
    it('should return true when purpose is work', () => {
      const timer: TimerState = {
        isRunning: true,
        startedAt: Date.now(),
        elapsed: 0,
        duration: 1500000,
        purpose: 'work',
      };

      expect(isWorkSession(timer)).toBe(true);
    });

    it('should return false when purpose is break', () => {
      const timer: TimerState = {
        isRunning: true,
        startedAt: Date.now(),
        elapsed: 0,
        duration: 300000,
        purpose: 'break',
      };

      expect(isWorkSession(timer)).toBe(false);
    });

    it('should return false when purpose is null', () => {
      const timer: TimerState = {
        isRunning: false,
        startedAt: null,
        elapsed: 0,
        duration: 1500000,
        purpose: null,
      };

      expect(isWorkSession(timer)).toBe(false);
    });
  });

  describe('isBreakSession', () => {
    it('should return true when purpose is break', () => {
      const timer: TimerState = {
        isRunning: true,
        startedAt: Date.now(),
        elapsed: 0,
        duration: 300000,
        purpose: 'break',
      };

      expect(isBreakSession(timer)).toBe(true);
    });

    it('should return false when purpose is work', () => {
      const timer: TimerState = {
        isRunning: true,
        startedAt: Date.now(),
        elapsed: 0,
        duration: 1500000,
        purpose: 'work',
      };

      expect(isBreakSession(timer)).toBe(false);
    });

    it('should return false when purpose is null', () => {
      const timer: TimerState = {
        isRunning: false,
        startedAt: null,
        elapsed: 0,
        duration: 1500000,
        purpose: null,
      };

      expect(isBreakSession(timer)).toBe(false);
    });
  });

  describe('FOCUS_MODE_DEFAULTS', () => {
    it('should have correct default values', () => {
      expect(FOCUS_MODE_DEFAULTS.SESSION_DURATION).toBe(25 * 60 * 1000);
      expect(FOCUS_MODE_DEFAULTS.SHORT_BREAK_DURATION).toBe(5 * 60 * 1000);
      expect(FOCUS_MODE_DEFAULTS.LONG_BREAK_DURATION).toBe(15 * 60 * 1000);
      expect(FOCUS_MODE_DEFAULTS.CYCLES_BEFORE_LONG_BREAK).toBe(4);
    });
  });

  describe('FocusScreen enum', () => {
    it('should have all required screens', () => {
      expect(FocusScreen.Main).toBe('Main');
      expect(FocusScreen.SessionDone).toBe('SessionDone');
      expect(FocusScreen.Break).toBe('Break');
    });
  });

  describe('FocusModeMode enum', () => {
    it('should have all required modes', () => {
      expect(FocusModeMode.Flowtime).toBe('Flowtime');
      expect(FocusModeMode.Pomodoro).toBe('Pomodoro');
      expect(FocusModeMode.Countdown).toBe('Countdown');
    });
  });

  describe('TimerState interface', () => {
    it('should create valid timer state', () => {
      const timer: TimerState = {
        isRunning: true,
        startedAt: 1234567890,
        elapsed: 60000,
        duration: 1500000,
        purpose: 'work',
        isLongBreak: false,
      };

      expect(timer.isRunning).toBe(true);
      expect(timer.startedAt).toBe(1234567890);
      expect(timer.elapsed).toBe(60000);
      expect(timer.duration).toBe(1500000);
      expect(timer.purpose).toBe('work');
      expect(timer.isLongBreak).toBe(false);
    });
  });

  describe('FocusModeState interface', () => {
    it('should create valid focus mode state', () => {
      const timer: TimerState = {
        isRunning: false,
        startedAt: null,
        elapsed: 0,
        duration: 1500000,
        purpose: null,
      };

      const state: FocusModeState = {
        timer,
        currentScreen: FocusScreen.Main,
        mainState: FocusMainUIState.Preparation,
        isOverlayShown: false,
        mode: FocusModeMode.Pomodoro,
        currentCycle: 0,
        lastCompletedDuration: 0,
        pausedTaskId: null,
        _isResumingBreak: false,
        _isOvertimeEnabled: false,
      };

      expect(state.timer).toEqual(timer);
      expect(state.currentScreen).toBe(FocusScreen.Main);
      expect(state.mainState).toBe(FocusMainUIState.Preparation);
      expect(state.isOverlayShown).toBe(false);
      expect(state.mode).toBe(FocusModeMode.Pomodoro);
      expect(state.currentCycle).toBe(0);
      expect(state.lastCompletedDuration).toBe(0);
    });
  });

  describe('getFocusModeSoundVolume', () => {
    it('should default to 40% of the main volume when unset', () => {
      expect(getFocusModeSoundVolume(75, undefined)).toBe(30);
      expect(getFocusModeSoundVolume(75, null)).toBe(30);
    });

    it('should scale the main volume by the focus sound volume', () => {
      expect(getFocusModeSoundVolume(80, 100)).toBe(80);
      expect(getFocusModeSoundVolume(80, 25)).toBe(20);
    });

    it('should be 0 when either volume is 0', () => {
      expect(getFocusModeSoundVolume(0, 100)).toBe(0);
      expect(getFocusModeSoundVolume(undefined, 100)).toBe(0);
      expect(getFocusModeSoundVolume(80, 0)).toBe(0);
    });

    it('should clamp out-of-range focus sound volumes', () => {
      expect(getFocusModeSoundVolume(50, 150)).toBe(50);
      expect(getFocusModeSoundVolume(50, -10)).toBe(0);
    });
  });

  describe('getCountdownDurationForTask', () => {
    const MIN = 60_000;

    it('uses the remaining estimate when shorter than the default', () => {
      expect(
        getCountdownDurationForTask(25 * MIN, {
          timeEstimate: 20 * MIN,
          timeSpent: 5 * MIN,
        }),
      ).toBe(15 * MIN);
    });

    it('rounds the remaining estimate up to whole minutes', () => {
      expect(
        getCountdownDurationForTask(25 * MIN, {
          timeEstimate: 10 * MIN,
          timeSpent: 30_000,
        }),
      ).toBe(10 * MIN);
    });

    it('keeps the default when the estimate is longer, missing or used up', () => {
      expect(
        getCountdownDurationForTask(25 * MIN, { timeEstimate: 60 * MIN, timeSpent: 0 }),
      ).toBe(25 * MIN);
      expect(
        getCountdownDurationForTask(25 * MIN, { timeEstimate: 0, timeSpent: 0 }),
      ).toBe(25 * MIN);
      expect(
        getCountdownDurationForTask(25 * MIN, {
          timeEstimate: 10 * MIN,
          timeSpent: 12 * MIN,
        }),
      ).toBe(25 * MIN);
    });
  });
});
