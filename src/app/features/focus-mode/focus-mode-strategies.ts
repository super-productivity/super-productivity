import { Injectable, inject } from '@angular/core';
import {
  FocusModeStrategy,
  FocusScreen,
  FocusModeMode,
  FOCUS_MODE_DEFAULTS,
} from './focus-mode.model';
import { GlobalConfigService } from '../config/global-config.service';
import { FocusModeStorageService } from './focus-mode-storage.service';

@Injectable({ providedIn: 'root' })
export class PomodoroStrategy implements FocusModeStrategy {
  private globalConfigService = inject(GlobalConfigService);

  get initialSessionDuration(): number {
    const config = this.globalConfigService.pomodoroConfig();
    return config?.duration ?? FOCUS_MODE_DEFAULTS.SESSION_DURATION;
  }

  getBreakDuration(cycle: number): { duration: number; isLong: boolean } {
    const config = this.globalConfigService.pomodoroConfig();
    const cyclesBeforeLong =
      config?.cyclesBeforeLongerBreak ?? FOCUS_MODE_DEFAULTS.CYCLES_BEFORE_LONG_BREAK;
    // Long break after every Nth session (e.g., after sessions 4, 8, 12...)
    const isLong = cycle % cyclesBeforeLong === 0;

    const duration = isLong
      ? (config?.longerBreakDuration ?? FOCUS_MODE_DEFAULTS.LONG_BREAK_DURATION)
      : (config?.breakDuration ?? FOCUS_MODE_DEFAULTS.SHORT_BREAK_DURATION);

    return { duration, isLong };
  }

  getNextScreenAfterTaskSelection(skipPreparation: boolean): {
    screen: FocusScreen;
    duration?: number;
  } {
    const duration = this.initialSessionDuration; // Reuse the getter

    return {
      screen: skipPreparation ? FocusScreen.Main : FocusScreen.Preparation,
      duration,
    };
  }

  readonly shouldStartBreakAfterSession = true; // Always have breaks in Pomodoro
  readonly shouldAutoStartNextSession = true; // Auto-continue after break
}

@Injectable({ providedIn: 'root' })
export class FlowtimeStrategy implements FocusModeStrategy {
  readonly initialSessionDuration = 0; // Flowtime doesn't have a fixed duration
  readonly shouldStartBreakAfterSession = false;
  readonly shouldAutoStartNextSession = false;

  getBreakDuration(): null {
    return null; // No automatic breaks in Flowtime
  }

  getNextScreenAfterTaskSelection(skipPreparation: boolean): {
    screen: FocusScreen;
    duration?: number;
  } {
    return {
      screen: skipPreparation ? FocusScreen.Main : FocusScreen.Preparation,
      duration: 0, // Flowtime doesn't have a fixed duration
    };
  }
}

@Injectable({ providedIn: 'root' })
export class CountdownStrategy implements FocusModeStrategy {
  private storage = inject(FocusModeStorageService);

  get initialSessionDuration(): number {
    const lastDuration = this.storage.getLastCountdownDuration() ?? 0;
    return lastDuration || FOCUS_MODE_DEFAULTS.SESSION_DURATION;
  }

  readonly shouldStartBreakAfterSession = false;
  readonly shouldAutoStartNextSession = false;

  getBreakDuration(): null {
    return null; // No automatic breaks in Countdown mode
  }

  getNextScreenAfterTaskSelection(skipPreparation: boolean): {
    screen: FocusScreen;
    duration?: number;
  } {
    // Countdown mode always uses duration selection
    return {
      screen: FocusScreen.DurationSelection,
    };
  }
}

@Injectable({ providedIn: 'root' })
export class FocusModeStrategyFactory {
  private pomodoroStrategy = inject(PomodoroStrategy);
  private flowtimeStrategy = inject(FlowtimeStrategy);
  private countdownStrategy = inject(CountdownStrategy);

  getStrategy(mode: FocusModeMode): FocusModeStrategy {
    switch (mode) {
      case FocusModeMode.Pomodoro:
        return this.pomodoroStrategy;
      case FocusModeMode.Flowtime:
        return this.flowtimeStrategy;
      case FocusModeMode.Countdown:
        return this.countdownStrategy;
      default:
        return this.countdownStrategy;
    }
  }
}
