import { computed, inject, Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { filter, tap } from 'rxjs/operators';
import * as actions from './store/focus-mode.actions';
import * as selectors from './store/focus-mode.selectors';
import { GlobalConfigService } from '../config/global-config.service';
import { selectFocusModeConfig } from '../config/store/global-config.reducer';
import { FocusModeMode } from './focus-mode.model';
import { GlobalTrackingIntervalService } from '../../core/global-tracking-interval/global-tracking-interval.service';

@Injectable({
  providedIn: 'root',
})
export class FocusModeService {
  private _store = inject(Store);
  private _globalConfigService = inject(GlobalConfigService);
  private _globalTrackingInterval = inject(GlobalTrackingIntervalService);

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

  // Break signals
  isBreakActive = this._store.selectSignal(selectors.selectIsBreakActive);
  isLongBreak = this._store.selectSignal(selectors.selectIsLongBreak);

  // Config signals
  pomodoroConfig = this._globalConfigService.pomodoroConfig;
  focusModeConfig = this._store.selectSignal(selectFocusModeConfig);

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
}
