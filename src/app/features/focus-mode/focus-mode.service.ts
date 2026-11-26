import { computed, inject, Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { filter, tap } from 'rxjs/operators';
import * as actions from './store/focus-mode.actions';
import * as selectors from './store/focus-mode.selectors';
import { GlobalConfigService } from '../config/global-config.service';
import { selectFocusModeConfig } from '../config/store/global-config.reducer';
import { FocusModeMode, getCountdownDurationForTask } from './focus-mode.model';
import { FocusModeStrategyFactory } from './focus-mode-strategies';
import { TaskCopy } from '../tasks/task.model';
import { GlobalTrackingIntervalService } from '../../core/global-tracking-interval/global-tracking-interval.service';

@Injectable({
  providedIn: 'root',
})
export class FocusModeService {
  private _store = inject(Store);
  private _globalConfigService = inject(GlobalConfigService);
  private _globalTrackingInterval = inject(GlobalTrackingIntervalService);
  private _strategyFactory = inject(FocusModeStrategyFactory);
  private _timer = this._store.selectSignal(selectors.selectTimer);

  // State signals
  currentScreen = this._store.selectSignal(selectors.selectCurrentScreen);
  mainState = this._store.selectSignal(selectors.selectMainState);
  mode = this._store.selectSignal(selectors.selectMode);
  isOverlayShown = this._store.selectSignal(selectors.selectIsOverlayShown);
  currentCycle = this._store.selectSignal(selectors.selectCurrentCycle);

  // Timer signals
  isRunning = this._store.selectSignal(selectors.selectIsRunning);
  timeElapsed = this._store.selectSignal(selectors.selectTimeElapsed);
  timeRemaining = this._store.selectSignal(selectors.selectTimeRemaining);
  progress = this._store.selectSignal(selectors.selectProgress);
  sessionDuration = this._store.selectSignal(selectors.selectTimeDuration);

  // Session signals
  isSessionRunning = this._store.selectSignal(selectors.selectIsSessionRunning);
  isSessionPaused = this._store.selectSignal(selectors.selectIsSessionPaused);
  isSessionCompleted = this._store.selectSignal(selectors.selectIsSessionCompleted);

  // Break signals
  isBreakActive = this._store.selectSignal(selectors.selectIsBreakActive);
  isLongBreak = this._store.selectSignal(selectors.selectIsLongBreak);

  // Config signals
  pomodoroConfig = this._globalConfigService.pomodoroConfig;
  focusModeConfig = this._store.selectSignal(selectFocusModeConfig);

  // Overtime
  isInOvertime = this._store.selectSignal(selectors.selectIsInOvertime);

  // Compatibility aliases (TODO: remove when components are updated)
  isBreakLong = this.isLongBreak;

  // Additional compatibility signals
  lastSessionTotalDurationOrTimeElapsedFallback = this._store.selectSignal(
    selectors.selectLastSessionDuration,
  );

  // UI helper signals
  isCountTimeDown = computed(() => this.mode() !== FocusModeMode.Flowtime);

  // Observable versions for compatibility
  sessionProgress$ = this._store.select(selectors.selectProgress);
  currentSessionTime$ = this._store.select(selectors.selectTimeElapsed);
  timeToGo$ = this._store.select(selectors.selectTimeRemaining);

  // Single timer that updates the store at 1-second intervals for smooth UI
  constructor() {
    // Reuse the shared global 1-second interval to coalesce both ticks
    // into the same event loop turn, reducing change detection overhead
    this._globalTrackingInterval.globalInterval$
      .pipe(
        filter(() => this.isRunning() === true),
        tap(() => this._store.dispatch(actions.tick())),
        takeUntilDestroyed(),
      )
      .subscribe();
  }

  /** Open the rich focus-mode overlay. Used by the header button. */
  openOverlay(): void {
    this._store.dispatch(actions.showFocusOverlay());
  }

  /**
   * Start a session for `task` right away in the last-used mode and show the
   * overlay, skipping the setup screen. Returns false (and does nothing) when a
   * session or break is already active or the user opted into the preparation
   * screen — callers then fall back to just opening the overlay.
   */
  tryStartSessionForTask(task: TaskCopy): boolean {
    if (this._timer().purpose !== null || this.focusModeConfig()?.isShowPreparation) {
      return false;
    }
    const mode = this.mode();
    const defaultDuration =
      this._strategyFactory.getStrategy(mode).initialSessionDuration;
    const duration =
      mode === FocusModeMode.Countdown
        ? getCountdownDurationForTask(defaultDuration, task)
        : defaultDuration;
    // the startFocusSession effect activates tracking for taskId
    this._store.dispatch(actions.startFocusSession({ duration, taskId: task.id }));
    this._store.dispatch(actions.showFocusOverlay());
    return true;
  }
}
