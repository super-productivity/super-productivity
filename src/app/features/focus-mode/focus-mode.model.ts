// Timer state - single source of truth
export interface TimerState {
  isRunning: boolean;
  startedAt: number | null;
  elapsed: number;
  duration: number;
  purpose: 'work' | 'break' | null;
  isLongBreak?: boolean;
}

export enum FocusMainUIState {
  Preparation = 'Preparation',
  Countdown = 'Countdown',
  InProgress = 'InProgress',
}

// UI screens enum
export enum FocusScreen {
  Main = 'Main',
  SessionDone = 'SessionDone',
  Break = 'Break',
}

export enum FocusModeMode {
  'Flowtime' = 'Flowtime',
  'Pomodoro' = 'Pomodoro',
  'Countdown' = 'Countdown',
}

// Simplified state structure
export interface FocusModeState {
  // The timer - single source of truth
  timer: TimerState;

  // The UI - what screen to show
  currentScreen: FocusScreen;
  mainState: FocusMainUIState;
  isOverlayShown: boolean;

  // Session metadata
  mode: FocusModeMode;
  currentCycle: number;
  lastCompletedDuration: number;

  // Task tracking during breaks
  pausedTaskId: string | null;

  // Internal flag: tracks if break resume is in progress
  _isResumingBreak: boolean;

  // Internal flag: when true, tick reducer won't auto-stop work timer at duration
  _isOvertimeEnabled: boolean;
}

// Mode strategy interface
export interface FocusModeStrategy {
  readonly initialSessionDuration: number;
  readonly shouldStartBreakAfterSession: boolean;
  readonly shouldAutoStartNextSession: boolean;
  getBreakDuration(cycle: number): { duration: number; isLong: boolean } | null;
}

// Helper functions and type guards for timer
export const isTimerRunning = (timer: TimerState): boolean => {
  return timer.isRunning && timer.purpose !== null;
};

export const isWorkSession = (timer: TimerState): boolean => {
  return timer.purpose === 'work';
};

export const isBreakSession = (timer: TimerState): boolean => {
  return timer.purpose === 'break';
};

/**
 * After incrementCycle, the current cycle is 1 too high for break calculation.
 * This returns the last completed session's cycle, clamped to a minimum of 1.
 */
export const getBreakCycle = (currentCycle: number): number =>
  Math.max(currentCycle - 1, 1);

// Constants for better maintainability
export const FOCUS_MODE_DEFAULTS = {
  SESSION_DURATION: 25 * 60 * 1000, // 25 minutes
  SHORT_BREAK_DURATION: 5 * 60 * 1000, // 5 minutes
  LONG_BREAK_DURATION: 15 * 60 * 1000, // 15 minutes
  CYCLES_BEFORE_LONG_BREAK: 4,
} as const;

/**
 * Default ambient focus sound volume, in percent of the main sound volume.
 * Matches the fixed 40% ratio used before `focusModeSoundVolume` existed.
 */
export const DEFAULT_FOCUS_MODE_SOUND_VOLUME = 40;

/**
 * Effective volume (0-100) for the focus-mode tick / white noise. The main
 * sound volume stays the master control: 0 there mutes focus sounds too.
 */
export const getFocusModeSoundVolume = (
  mainVolume: number | undefined | null,
  focusModeSoundVolume: number | undefined | null,
): number => {
  const main = mainVolume || 0;
  const relative = focusModeSoundVolume ?? DEFAULT_FOCUS_MODE_SOUND_VOLUME;
  return Math.round((main * Math.min(Math.max(relative, 0), 100)) / 100);
};
