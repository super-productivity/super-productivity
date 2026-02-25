import { inject, Injectable } from '@angular/core';
import { createEffect, ofType } from '@ngrx/effects';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import { Action, Store } from '@ngrx/store';
import { combineLatest, EMPTY, of } from 'rxjs';
import { skipWhileApplyingRemoteOps } from '../../../util/skip-during-sync.operator';
import {
  distinctUntilChanged,
  filter,
  map,
  pairwise,
  switchMap,
  take,
  tap,
  throttleTime,
  withLatestFrom,
} from 'rxjs/operators';
import * as actions from './focus-mode.actions';
import { showFocusOverlay } from './focus-mode.actions';
import * as selectors from './focus-mode.selectors';
import { FocusModeStrategyFactory } from '../focus-mode-strategies';
import { GlobalConfigService } from '../../config/global-config.service';
import { TaskService } from '../../tasks/task.service';
import { playSound } from '../../../util/play-sound';
import { IS_ELECTRON } from '../../../app.constants';
import { setCurrentTask, unsetCurrentTask } from '../../tasks/store/task.actions';
import { selectLastCurrentTask, selectTaskById } from '../../tasks/store/task.selectors';
import { openIdleDialog } from '../../idle/store/idle.actions';
import { LS } from '../../../core/persistence/storage-keys.const';
import {
  selectFocusModeConfig,
  selectIsFocusModeEnabled,
  selectPomodoroConfig,
} from '../../config/store/global-config.reducer';
import { FocusModeConfig } from '../../config/global-config.model';
import { updateGlobalConfigSection } from '../../config/store/global-config.actions';
import {
  FocusModeMode,
  FocusScreen,
  getBreakCycle,
  TimerState,
} from '../focus-mode.model';
import { BannerService } from '../../../core/banner/banner.service';
import { Banner, BannerId } from '../../../core/banner/banner.model';
import { T } from '../../../t.const';
import { MetricService } from '../../metric/metric.service';
import { FocusModeStorageService } from '../focus-mode-storage.service';
import { TakeABreakService } from '../../take-a-break/take-a-break.service';

const SESSION_DONE_SOUND = 'positive.ogg';
const TICK_SOUND = 'tick.mp3';

@Injectable()
export class FocusModeEffects {
  private actions$ = inject(LOCAL_ACTIONS);
  private store = inject(Store);
  private strategyFactory = inject(FocusModeStrategyFactory);
  private globalConfigService = inject(GlobalConfigService);
  private taskService = inject(TaskService);
  private bannerService = inject(BannerService);
  private metricService = inject(MetricService);
  private storageService = inject(FocusModeStorageService);
  private takeABreakService = inject(TakeABreakService);

  // Auto-show overlay when task is selected (if sync session with tracking is enabled)
  // Skip showing overlay if isStartInBackground is enabled
  // Only triggers when focus mode feature is enabled
  // Fix #6521: Use currentTaskId$ as the driver and config as a gate check (withLatestFrom)
  // so that config changes don't re-trigger the overlay
  autoShowOverlay$ = createEffect(() =>
    this.taskService.currentTaskId$.pipe(
      skipWhileApplyingRemoteOps(),
      // currentTaskId$ is local UI state (not synced), so distinctUntilChanged is sufficient
      distinctUntilChanged(),
      filter((id) => !!id),
      withLatestFrom(
        this.store.select(selectFocusModeConfig),
        this.store.select(selectIsFocusModeEnabled),
      ),
      filter(
        ([_id, cfg, isFocusModeEnabled]) =>
          isFocusModeEnabled &&
          !!cfg?.isSyncSessionWithTracking &&
          !cfg?.isStartInBackground,
      ),
      map(() => actions.showFocusOverlay()),
    ),
  );

  // Sync: When tracking starts → start/unpause focus session
  // Only triggers when isSyncSessionWithTracking is enabled and focus mode feature is enabled
  // Fix #6521: Use currentTaskId$ as the driver and config as a gate check (withLatestFrom)
  // so that config changes don't re-trigger session start
  syncTrackingStartToSession$ = createEffect(() =>
    this.taskService.currentTaskId$.pipe(
      skipWhileApplyingRemoteOps(),
      // currentTaskId$ is local UI state (not synced), so distinctUntilChanged is sufficient
      distinctUntilChanged(),
      filter((taskId) => !!taskId),
      withLatestFrom(
        this.store.select(selectFocusModeConfig),
        this.store.select(selectIsFocusModeEnabled),
      ),
      filter(
        ([_taskId, cfg, isFocusModeEnabled]) =>
          isFocusModeEnabled && !!cfg?.isSyncSessionWithTracking,
      ),
      withLatestFrom(
        this.store.select(selectors.selectTimer),
        this.store.select(selectors.selectMode),
        this.store.select(selectors.selectCurrentScreen),
        this.store.select(selectors.selectPausedTaskId),
        // Bug #5995 Fix: Get the LATEST value of isResumingBreak here
        // to avoid using stale value from outer closure
        this.store.select(selectors.selectIsResumingBreak),
      ),
      switchMap(
        ([[_taskId, cfg], timer, mode, currentScreen, pausedTaskId, isResumingBreak]) => {
          // If session is paused (purpose is 'work' but not running), resume it
          if (timer.purpose === 'work' && !timer.isRunning) {
            return of(actions.unPauseFocusSession());
          }
          // If break is active, handle based on state and cause
          // Bug #5995 Fix: Don't skip breaks that were just resumed
          if (timer.purpose === 'break') {
            // Check store flag to distinguish between break resume and manual tracking start
            if (isResumingBreak) {
              // Clear flag after processing to prevent false positives
              // Don't skip the break - just clear the flag
              return of(actions.clearResumingBreakFlag());
            }
            // User manually started tracking during break
            // Skip the break to sync with tracking (bug #5875 fix)
            return of(actions.skipBreak({ pausedTaskId }));
          }
          // If no session active, start a new one (only from Main screen)
          if (timer.purpose === null && currentScreen === FocusScreen.Main) {
            const strategy = this.strategyFactory.getStrategy(mode);
            const duration = strategy.initialSessionDuration;
            return of(
              actions.startFocusSession({
                duration,
                isManualSessionCompletion: !!cfg?.isManualBreakStart,
              }),
            );
          }
          return EMPTY;
        },
      ),
    ),
  );

  // Sync: When tracking stops → pause focus session (both work and break)
  // Uses pairwise to capture the previous task ID before it's lost
  // Only triggers when focus mode feature is enabled
  // Bug #5954 fix: Also pause breaks when tracking stops
  syncTrackingStopToSession$ = createEffect(() =>
    this.taskService.currentTaskId$.pipe(
      // CRITICAL: Prevent cascading dispatches during sync that cause app freeze.
      // Without this, rapid currentTaskId changes from remote ops trigger pairwise()
      // which dispatches pauseFocusSession repeatedly, overwhelming the store.
      skipWhileApplyingRemoteOps(),
      pairwise(),
      withLatestFrom(
        this.store.select(selectFocusModeConfig),
        this.store.select(selectors.selectTimer),
        this.store.select(selectIsFocusModeEnabled),
      ),
      filter(
        ([[prevTaskId, currTaskId], cfg, timer, isFocusModeEnabled]) =>
          isFocusModeEnabled &&
          !!cfg?.isSyncSessionWithTracking &&
          (timer.purpose === 'work' || timer.purpose === 'break') &&
          timer.isRunning &&
          !!prevTaskId &&
          !currTaskId, // Was tracking (prevTaskId exists) and now stopped (currTaskId is null)
      ),
      map(([[prevTaskId]]) => actions.pauseFocusSession({ pausedTaskId: prevTaskId })),
    ),
  );

  // Sync: When focus session pauses → stop tracking
  // Note: This effect fires AFTER the reducer runs, and the pausedTaskId is already stored
  // in the action/reducer, so we just need to dispatch unsetCurrentTask
  syncSessionPauseToTracking$ = createEffect(() =>
    this.actions$.pipe(
      ofType(actions.pauseFocusSession),
      withLatestFrom(
        this.store.select(selectFocusModeConfig),
        this.store.select(selectors.selectTimer),
      ),
      filter(
        ([action, cfg, timer]) =>
          !!cfg?.isSyncSessionWithTracking &&
          (timer.purpose === 'work' || timer.purpose === 'break') &&
          !!action.pausedTaskId,
      ),
      map(() => unsetCurrentTask()),
    ),
  );

  // Sync: When focus session resumes → start tracking
  // Checks that the paused task still exists before resuming tracking
  syncSessionResumeToTracking$ = createEffect(() =>
    this.actions$.pipe(
      ofType(actions.unPauseFocusSession),
      withLatestFrom(
        this.store.select(selectFocusModeConfig),
        this.store.select(selectors.selectTimer),
        this.store.select(selectors.selectPausedTaskId),
        this.taskService.currentTaskId$,
      ),
      switchMap(([_action, cfg, timer, pausedTaskId, currentTaskId]) => {
        if (
          !cfg?.isSyncSessionWithTracking ||
          (timer.purpose !== 'work' && timer.purpose !== 'break')
        ) {
          return EMPTY;
        }
        // Bug #6534 Fix: Clear _isResumingBreak flag when not resuming tracking during break.
        // Without this, the flag stays stale and causes syncTrackingStartToSession$
        // to treat the next manual tracking start as a break resume.
        if (timer.purpose === 'break' && cfg?.isPauseTrackingDuringBreak) {
          return of(actions.clearResumingBreakFlag());
        }
        if (currentTaskId || !pausedTaskId) {
          return EMPTY;
        }
        return this.store.select(selectTaskById, { id: pausedTaskId }).pipe(
          take(1),
          filter((task) => !!task),
          map(() => setCurrentTask({ id: pausedTaskId })),
        );
      }),
    ),
  );

  // Sync: When focus session starts → start tracking (if not already tracking)
  // Checks that the paused task still exists before starting tracking
  // Bug #5954 fix: Falls back to lastCurrentTask if no pausedTaskId (e.g., after app restart)
  // Bug #5954 fix: Shows focus overlay if no valid (undone) task is available
  syncSessionStartToTracking$ = createEffect(() =>
    this.actions$.pipe(
      ofType(actions.startFocusSession),
      withLatestFrom(
        this.store.select(selectFocusModeConfig),
        this.store.select(selectors.selectPausedTaskId),
        this.taskService.currentTaskId$,
        this.store.select(selectLastCurrentTask),
      ),
      filter(
        ([_action, cfg, pausedTaskId, currentTaskId, lastCurrentTask]) =>
          !!cfg?.isSyncSessionWithTracking &&
          !currentTaskId &&
          (!!pausedTaskId || !!lastCurrentTask),
      ),
      switchMap(([_action, _cfg, pausedTaskId, _currentTaskId, lastCurrentTask]) => {
        // Prefer pausedTaskId, fall back to lastCurrentTask
        const taskIdToResume = pausedTaskId || lastCurrentTask?.id;
        if (!taskIdToResume) return EMPTY;

        return this.store.select(selectTaskById, { id: taskIdToResume }).pipe(
          take(1),
          map((task) =>
            task && !task.isDone
              ? setCurrentTask({ id: taskIdToResume })
              : actions.showFocusOverlay(),
          ),
        );
      }),
    ),
  );

  // Detect when work session timer completes and dispatch completeFocusSession
  // Only triggers when timer STOPS (isRunning becomes false) with elapsed >= duration
  // When isManualSessionCompletion is true, the tick reducer keeps the timer running past
  // duration, so this effect normally won't fire. The isManualSessionCompletion check here
  // is a safety guard for the pause-during-overtime edge case (Bug #6206 + overtime fix).
  detectSessionCompletion$ = createEffect(() =>
    this.store.select(selectors.selectTimer).pipe(
      skipWhileApplyingRemoteOps(),
      withLatestFrom(
        this.store.select(selectors.selectMode),
        this.store.select(selectors.selectIsManualSessionCompletion),
      ),
      // Only consider emissions where timer just stopped running
      distinctUntilChanged(
        ([prevTimer], [currTimer]) => prevTimer.isRunning === currTimer.isRunning,
      ),
      filter(
        ([timer, mode, isManualSessionCompletion]) =>
          timer.purpose === 'work' &&
          !timer.isRunning &&
          timer.duration > 0 &&
          timer.elapsed >= timer.duration &&
          mode !== FocusModeMode.Flowtime &&
          !isManualSessionCompletion,
      ),

      map(() => actions.completeFocusSession({ isManual: false })),
    ),
  );

  // Detect when break timer completes and show notification (no auto-complete)
  detectBreakTimeUp$ = createEffect(
    () =>
      this.store.select(selectors.selectTimer).pipe(
        skipWhileApplyingRemoteOps(),
        filter(
          (timer) =>
            timer.purpose === 'break' &&
            !timer.isRunning &&
            timer.duration > 0 &&
            timer.elapsed >= timer.duration,
        ),
        distinctUntilChanged(
          (prev, curr) =>
            prev.elapsed === curr.elapsed && prev.startedAt === curr.startedAt,
        ),
        tap(() => {
          this._notifyUser();
        }),
      ),
    { dispatch: false },
  );

  // Session completion effects - split into separate concerns for better maintainability

  // Effect 1: Increment cycle for Pomodoro mode
  incrementCycleOnSessionComplete$ = createEffect(() =>
    this.actions$.pipe(
      ofType(actions.completeFocusSession),
      withLatestFrom(this.store.select(selectors.selectMode)),
      filter(([_, mode]) => mode === FocusModeMode.Pomodoro),
      map(() => actions.incrementCycle()),
    ),
  );

  // Effect 2: Stop tracking on session end when no break auto-starts
  // Bug #5875 fix: Stop tracking on manual session end
  // Bug #5954 fix: Only stop tracking if isPauseTrackingDuringBreak is enabled
  // Bug #5996 fix: Also stop tracking on automatic completion for modes without auto-break
  // Bug #5737 fix: Store pausedTaskId before unsetting to avoid race condition
  stopTrackingOnSessionEnd$ = createEffect(() =>
    this.actions$.pipe(
      ofType(actions.completeFocusSession),
      withLatestFrom(
        this.store.select(selectFocusModeConfig),
        this.store.select(selectors.selectMode),
        this.taskService.currentTaskId$,
      ),
      filter(([action, config, mode, taskId]) => {
        if (!config?.isSyncSessionWithTracking || !config?.isPauseTrackingDuringBreak) {
          return false;
        }
        if (!taskId) {
          return false;
        }
        // For manual completion, always stop tracking
        if (action.isManual) {
          return true;
        }
        // Bug #6510 fix: For automatic completion, only stop tracking if no break will start.
        // When a break will start (auto or manual), tracking pause is deferred to break-start:
        // - Auto: autoStartBreakOnSessionComplete$ (line 368)
        // - Manual: _handleStartAfterSessionComplete() / startBreakManually()
        const strategy = this.strategyFactory.getStrategy(mode);
        const breakWillStart = strategy.shouldStartBreakAfterSession;
        return !breakWillStart;
      }),
      // Bug #5737 fix: Store pausedTaskId before unsetting current task
      // This ensures the task can be resumed after break even with manual "End Session"
      switchMap(([_action, _config, _mode, taskId]) =>
        of(actions.setPausedTaskId({ pausedTaskId: taskId }), unsetCurrentTask()),
      ),
    ),
  );

  // Effect 3: Auto-start break after session completion
  // Bug #6044 fix: Listen to incrementCycle instead of completeFocusSession to eliminate race condition
  // This ensures the cycle value is already incremented when we calculate break type
  autoStartBreakOnSessionComplete$ = createEffect(() =>
    this.actions$.pipe(
      ofType(actions.incrementCycle),
      withLatestFrom(
        this.store.select(selectors.selectMode),
        this.store.select(selectors.selectCurrentCycle),
        this.store.select(selectFocusModeConfig),
        this.taskService.currentTaskId$,
      ),
      filter(([_, mode, __, config]) => {
        // Only for Pomodoro mode (since only Pomodoro increments cycles)
        if (mode !== FocusModeMode.Pomodoro) return false;
        const strategy = this.strategyFactory.getStrategy(mode);
        return strategy.shouldStartBreakAfterSession && !config?.isManualBreakStart;
      }),
      switchMap(([_, mode, cycle, config, currentTaskId]) => {
        const strategy = this.strategyFactory.getStrategy(mode);
        // Cycle Adjustment needed, Cycle is 1 too high after incrementCycle
        // we want to get the last session's cycle
        const breakInfo = strategy.getBreakDuration(getBreakCycle(cycle));
        const shouldPauseTracking = config?.isPauseTrackingDuringBreak && currentTaskId;
        const actionsArr: Action[] = [];

        // Pause tracking during break if configured
        if (shouldPauseTracking) {
          actionsArr.push(unsetCurrentTask());
        }

        // Start break with appropriate duration
        if (breakInfo) {
          actionsArr.push(
            actions.startBreak({
              duration: breakInfo.duration,
              isLongBreak: breakInfo.isLong,
              pausedTaskId: shouldPauseTracking ? currentTaskId : undefined,
            }),
          );
        } else {
          // Fallback if no break info
          actionsArr.push(
            actions.startBreak({
              pausedTaskId: shouldPauseTracking ? currentTaskId : undefined,
            }),
          );
        }

        return of(...actionsArr);
      }),
    ),
  );

  // Effect 4: Notification side effect (non-dispatching)
  notifyOnSessionComplete$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(actions.completeFocusSession),
        tap(() => this._notifyUser()),
      ),
    { dispatch: false },
  );

  // Effect 5: Store pausedTaskId when session completes with manual break start
  // Bug #5954 fix: Ensures task can be resumed when break is skipped/completed
  // Bug #5974 fix: Store pausedTaskId regardless of isPauseTrackingDuringBreak setting
  // This allows tracking to resume when user manually stops tracking before starting break
  storePausedTaskOnManualBreakSession$ = createEffect(() =>
    this.actions$.pipe(
      ofType(actions.completeFocusSession),
      withLatestFrom(
        this.store.select(selectors.selectMode),
        this.store.select(selectFocusModeConfig),
        this.taskService.currentTaskId$,
      ),
      filter(([_, mode, config, currentTaskId]) => {
        const strategy = this.strategyFactory.getStrategy(mode);
        // Store pausedTaskId when manual break is enabled and there's a current task
        // Note: We store regardless of isPauseTrackingDuringBreak because:
        // - If isPauseTrackingDuringBreak=true: pausedTaskId is used to resume after break
        // - If isPauseTrackingDuringBreak=false: pausedTaskId is used to resume if user
        //   manually stopped tracking before starting the break (bug #5974)
        return (
          strategy.shouldStartBreakAfterSession &&
          !!config?.isManualBreakStart &&
          !!currentTaskId
        );
      }),
      map(([_, _mode, _config, currentTaskId]) =>
        actions.setPausedTaskId({ pausedTaskId: currentTaskId }),
      ),
    ),
  );

  // Break completion effects - split into separate concerns for better maintainability
  // Note: pausedTaskId is passed in action payload to avoid race condition
  // (reducer clears pausedTaskId before effect reads state)

  // Effect 1: Resume tracking after break
  resumeTrackingOnBreakComplete$ = createEffect(() =>
    this.actions$.pipe(
      ofType(actions.completeBreak),
      filter((action) => !!action.pausedTaskId),
      map((action) => setCurrentTask({ id: action.pausedTaskId! })),
    ),
  );

  // Effect 2: Auto-start next session after break
  autoStartSessionOnBreakComplete$ = createEffect(() =>
    this.actions$.pipe(
      ofType(actions.completeBreak),
      withLatestFrom(
        this.store.select(selectors.selectMode),
        this.store.select(selectFocusModeConfig),
      ),
      filter(([_, mode]) => {
        const strategy = this.strategyFactory.getStrategy(mode);
        return strategy.shouldAutoStartNextSession;
      }),
      map(([_, mode, config]) => {
        const strategy = this.strategyFactory.getStrategy(mode);
        return actions.startFocusSession({
          duration: strategy.initialSessionDuration,
          isManualSessionCompletion: !!config?.isManualBreakStart,
        });
      }),
    ),
  );

  // Effect 3: Notification side effect (non-dispatching)
  notifyOnBreakComplete$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(actions.completeBreak),
        tap(() => this._notifyUser()),
      ),
    { dispatch: false },
  );

  // Handle skip break
  // Note: pausedTaskId is passed in action payload to avoid race condition
  skipBreak$ = createEffect(() =>
    this.actions$.pipe(
      ofType(actions.skipBreak),
      withLatestFrom(
        this.store.select(selectors.selectMode),
        this.store.select(selectFocusModeConfig),
      ),
      switchMap(([action, mode, config]) => {
        const strategy = this.strategyFactory.getStrategy(mode);
        const actionsToDispatch: any[] = [];

        // Resume task tracking if we paused it during break
        if (action.pausedTaskId) {
          actionsToDispatch.push(setCurrentTask({ id: action.pausedTaskId }));
        }

        // Auto-start next session if configured
        if (strategy.shouldAutoStartNextSession) {
          const duration = strategy.initialSessionDuration;
          actionsToDispatch.push(
            actions.startFocusSession({
              duration,
              isManualSessionCompletion: !!config?.isManualBreakStart,
            }),
          );
        }

        return actionsToDispatch.length > 0 ? of(...actionsToDispatch) : EMPTY;
      }),
    ),
  );

  // Bug #6064 fix: Reset "without break" timer when focus mode break starts
  // This ensures Pomodoro breaks are correctly recognized as rest periods regardless of
  // whether task tracking is paused during breaks (isPauseTrackingDuringBreak setting)
  resetBreakTimerOnBreakStart$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(actions.startBreak),
        tap(() => {
          // Signal TakeABreakService to reset its timer
          // otherNoBreakTIme$ feeds into the break timer's tick stream
          this.takeABreakService.otherNoBreakTIme$.next(0);
        }),
      ),
    { dispatch: false },
  );

  // Handle session cancellation
  cancelSession$ = createEffect(() =>
    this.actions$.pipe(
      ofType(actions.cancelFocusSession),
      map(() => unsetCurrentTask()),
    ),
  );

  // Stop tracking when exiting break to planning (if sync enabled)
  // Without this, tracking continues running orphaned after the focus session is reset
  stopTrackingOnExitBreakToPlanning$ = createEffect(() =>
    this.actions$.pipe(
      ofType(actions.exitBreakToPlanning),
      withLatestFrom(
        this.store.select(selectFocusModeConfig),
        this.taskService.currentTaskId$,
      ),
      filter(
        ([_, config, currentTaskId]) =>
          !!config?.isSyncSessionWithTracking && !!currentTaskId,
      ),
      map(() => unsetCurrentTask()),
    ),
  );

  // Pause on idle
  pauseOnIdle$ = createEffect(() =>
    this.actions$.pipe(
      ofType(openIdleDialog),
      withLatestFrom(this.taskService.currentTaskId$),
      map(([_, currentTaskId]) =>
        actions.pauseFocusSession({ pausedTaskId: currentTaskId }),
      ),
    ),
  );

  logFocusSession$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(actions.completeFocusSession),
        withLatestFrom(this.store.select(selectors.selectLastSessionDuration)),
        tap(([, duration]) => {
          if (duration > 0) {
            this.metricService.logFocusSession(duration);
          }
        }),
      ),
    { dispatch: false },
  );

  // Persist mode to localStorage
  persistMode$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(actions.setFocusModeMode),
        tap(({ mode }) => {
          localStorage.setItem(LS.FOCUS_MODE_MODE, mode);
        }),
      ),
    { dispatch: false },
  );

  persistCountdownDuration$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(actions.setFocusSessionDuration),
        withLatestFrom(this.store.select(selectors.selectMode)),
        tap(([{ focusSessionDuration }, mode]) => {
          if (mode === FocusModeMode.Countdown && focusSessionDuration > 0) {
            this.storageService.setLastCountdownDuration(focusSessionDuration);
          }
        }),
      ),
    { dispatch: false },
  );

  syncDurationWithMode$ = createEffect(() =>
    this.actions$.pipe(
      ofType(actions.setFocusModeMode, actions.focusModeLoaded),
      withLatestFrom(
        this.store.select(selectors.selectTimer),
        this.store.select(selectors.selectMode),
      ),
      switchMap(([action, timer, storeMode]) => {
        const mode =
          action.type === actions.setFocusModeMode.type
            ? (action as ReturnType<typeof actions.setFocusModeMode>).mode
            : storeMode;

        if (timer.purpose !== null) {
          return EMPTY;
        }

        // Only sync on load if duration is not set (0) to avoid overwriting manual changes
        if (action.type === actions.focusModeLoaded.type && timer.duration > 0) {
          return EMPTY;
        }

        if (mode === FocusModeMode.Flowtime) {
          return EMPTY;
        }

        const strategy = this.strategyFactory.getStrategy(mode);
        const duration = strategy.initialSessionDuration;

        if (
          typeof duration !== 'number' ||
          duration <= 0 ||
          duration === timer.duration
        ) {
          return EMPTY;
        }

        return of(actions.setFocusSessionDuration({ focusSessionDuration: duration }));
      }),
    ),
  );

  // Sync duration when Pomodoro settings change (only for unstarted sessions)
  syncDurationWithPomodoroConfig$ = createEffect(() =>
    this.actions$.pipe(
      ofType(updateGlobalConfigSection),
      filter(({ sectionKey }) => sectionKey === 'pomodoro'),
      withLatestFrom(
        this.store.select(selectors.selectTimer),
        this.store.select(selectors.selectMode),
        this.store.select(selectPomodoroConfig),
      ),
      switchMap(([_action, timer, mode, pomodoroConfig]) => {
        // Only sync if session hasn't started yet
        if (timer.purpose !== null) {
          return EMPTY;
        }

        // Only sync for Pomodoro mode
        if (mode !== FocusModeMode.Pomodoro) {
          return EMPTY;
        }

        const newDuration = pomodoroConfig?.duration;

        // Only sync if duration is valid and divisible by 1000 (whole seconds)
        if (
          typeof newDuration !== 'number' ||
          newDuration <= 0 ||
          newDuration % 1000 !== 0 ||
          newDuration === timer.duration
        ) {
          return EMPTY;
        }

        return of(actions.setFocusSessionDuration({ focusSessionDuration: newDuration }));
      }),
    ),
  );

  // Electron-specific effects
  // Action-based effect to update Windows taskbar progress (fixes #6061)
  // Throttled to prevent excessive IPC calls (timer ticks every 1s)
  // Follows action-based pattern (CLAUDE.md Section 8) instead of selector-based
  setTaskBarProgress$ =
    IS_ELECTRON &&
    createEffect(
      () =>
        this.actions$.pipe(
          ofType(
            actions.tick,
            actions.startFocusSession,
            actions.pauseFocusSession,
            actions.unPauseFocusSession,
            actions.startBreak,
            actions.skipBreak,
            actions.completeBreak,
            actions.completeFocusSession,
            actions.cancelFocusSession,
          ),
          // Throttle to prevent excessive IPC calls (timer ticks every 1s)
          // Use leading + trailing to ensure immediate feedback and final state
          throttleTime(500, undefined, { leading: true, trailing: true }),
          withLatestFrom(
            this.store.select(selectors.selectProgress),
            this.store.select(selectors.selectIsRunning),
          ),
          tap(([_action, progress, isRunning]) => {
            window.ea.setProgressBar({
              progress: progress / 100,
              progressBarMode: isRunning ? 'normal' : 'pause',
            });
          }),
        ),
      { dispatch: false },
    );

  focusWindowOnBreakStart$ =
    IS_ELECTRON &&
    createEffect(
      () =>
        this.actions$.pipe(
          ofType(actions.startBreak),
          tap(() => {
            this._notifyUser(true);
          }),
        ),
      { dispatch: false },
    );

  // Update banner when focus mode actions occur
  // Action-based pattern preferred over selector-based (CLAUDE.md Section 8)
  // Throttled to prevent excessive banner updates (timer ticks every 1s)
  updateBanner$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(
          actions.tick,
          actions.startFocusSession,
          actions.pauseFocusSession,
          actions.unPauseFocusSession,
          actions.startBreak,
          actions.skipBreak,
          actions.completeBreak,
          actions.completeFocusSession,
          actions.cancelFocusSession,
          actions.hideFocusOverlay,
          actions.showFocusOverlay,
        ),
        // Throttle to prevent excessive banner updates (timer ticks every 1s)
        // Use leading + trailing to ensure first and last updates both trigger
        throttleTime(500, undefined, { leading: true, trailing: true }),
        withLatestFrom(
          this.store.select(selectors.selectIsSessionRunning),
          this.store.select(selectors.selectIsBreakActive),
          this.store.select(selectors.selectIsSessionCompleted),
          this.store.select(selectors.selectIsSessionPaused),
          this.store.select(selectors.selectMode),
          this.store.select(selectors.selectCurrentCycle),
          this.store.select(selectors.selectIsOverlayShown),
          this.store.select(selectors.selectTimer),
          this.store.select(selectFocusModeConfig),
          this.store.select(selectIsFocusModeEnabled),
        ),
        tap(
          ([
            _action,
            isSessionRunning,
            isOnBreak,
            isSessionCompleted,
            isSessionPaused,
            mode,
            cycle,
            isOverlayShown,
            timer,
            focusModeConfig,
            isFocusModeEnabled,
          ]) => {
            // Only show banner when overlay is hidden and focus mode feature is enabled
            if (isOverlayShown || !isFocusModeEnabled) {
              this.bannerService.dismiss(BannerId.FocusMode);
              return;
            }

            const shouldShowBanner =
              isSessionRunning || isOnBreak || isSessionCompleted || isSessionPaused;

            // Check if break time is up (needed for both banner display and button actions)
            const isBreakTimeUp =
              timer.purpose === 'break' &&
              !timer.isRunning &&
              timer.duration > 0 &&
              timer.elapsed >= timer.duration;

            if (shouldShowBanner) {
              // Determine banner message based on session type
              let translationKey: string;
              let icon: string;
              let timer$;
              let progress$;

              if (isSessionCompleted) {
                // Session is completed
                translationKey =
                  mode === FocusModeMode.Pomodoro
                    ? T.F.FOCUS_MODE.POMODORO_SESSION_COMPLETED
                    : T.F.FOCUS_MODE.SESSION_COMPLETED;
                icon = 'check_circle';
                timer$ = undefined; // No timer needed for completed state
                progress$ = undefined; // No progress bar needed
              } else if (isOnBreak) {
                if (isBreakTimeUp) {
                  // Break is done - time is up
                  translationKey = T.F.POMODORO.BREAK_IS_DONE;
                  icon = 'notifications';
                  timer$ = undefined; // No timer needed for done state
                  progress$ = undefined; // No progress bar needed
                } else {
                  // Break is still running
                  translationKey =
                    mode === FocusModeMode.Pomodoro
                      ? T.F.FOCUS_MODE.B.POMODORO_BREAK_RUNNING
                      : T.F.FOCUS_MODE.B.BREAK_RUNNING;
                  icon = 'free_breakfast';
                  timer$ = this.store.select(selectors.selectTimeRemaining);
                  progress$ = this.store.select(selectors.selectProgress);
                }
              } else {
                // Work session is active
                const isCountTimeUp = mode === FocusModeMode.Flowtime;
                translationKey =
                  mode === FocusModeMode.Pomodoro
                    ? T.F.FOCUS_MODE.B.POMODORO_SESSION_RUNNING
                    : T.F.FOCUS_MODE.B.SESSION_RUNNING;
                icon = 'center_focus_strong';
                timer$ = isCountTimeUp
                  ? this.store.select(selectors.selectTimeElapsed)
                  : this.store.select(selectors.selectTimeRemaining);
                progress$ = isCountTimeUp
                  ? undefined
                  : this.store.select(selectors.selectProgress);
              }

              // Bug #5954 fix: For breaks, use cycle - 1 since cycle is incremented on session complete
              // This ensures "Break #1" shows after "Session #1" instead of "Break #2"
              const translateParams =
                mode === FocusModeMode.Pomodoro
                  ? { cycleNr: isOnBreak ? Math.max(1, (cycle || 1) - 1) : cycle || 1 }
                  : undefined;

              this.bannerService.open({
                id: BannerId.FocusMode,
                ico: icon,
                msg: translationKey,
                translateParams,
                timer$,
                progress$,
                isHideDismissBtn: true,
                ...this._getBannerActions(
                  timer,
                  isOnBreak,
                  isSessionCompleted,
                  isBreakTimeUp,
                  focusModeConfig,
                ),
              });
            } else {
              this.bannerService.dismiss(BannerId.FocusMode);
            }
          },
        ),
      ),
    { dispatch: false },
  );

  /**
   * Handles starting a new session after break time is up
   */
  private _handleStartAfterBreak(): void {
    combineLatest([
      this.store.select(selectors.selectMode),
      this.store.select(selectors.selectPausedTaskId),
      this.store.select(selectFocusModeConfig),
    ])
      .pipe(take(1))
      .subscribe(([mode, pausedTaskId, config]) => {
        const strategy = this.strategyFactory.getStrategy(mode);
        // Skip break (with pausedTaskId to resume tracking)
        this.store.dispatch(actions.skipBreak({ pausedTaskId }));
        // Only manually start session if strategy doesn't auto-start
        // (Pomodoro auto-starts via skipBreak$ effect)
        if (!strategy.shouldAutoStartNextSession) {
          this.store.dispatch(
            actions.startFocusSession({
              duration: strategy.initialSessionDuration,
              isManualSessionCompletion: !!config?.isManualBreakStart,
            }),
          );
        }
      });
  }

  /**
   * Handles starting a break or new session after session completion
   */
  private _handleStartAfterSessionComplete(
    focusModeConfig: FocusModeConfig | undefined,
  ): void {
    combineLatest([
      this.store.select(selectors.selectMode),
      this.store.select(selectors.selectCurrentCycle),
      this.store.select(selectors.selectPausedTaskId),
    ])
      .pipe(take(1))
      .subscribe(([mode, cycle, pausedTaskId]) => {
        const strategy = this.strategyFactory.getStrategy(mode);

        // If manual break start is enabled and mode supports breaks, start a break
        if (
          focusModeConfig?.isManualBreakStart &&
          strategy.shouldStartBreakAfterSession
        ) {
          // Bug #6044 fix: cycle is already correct after incrementCycle
          // Cycle Adjustment needed, Cycle is 1 too high after incrementCycle
          // we want to get the last session's cycle
          // This matches the auto-start break logic to ensure consistent break timing
          const breakInfo = strategy.getBreakDuration(getBreakCycle(cycle));
          if (breakInfo) {
            const currentTaskId = this.taskService.currentTaskId();
            const shouldPauseTracking =
              focusModeConfig?.isPauseTrackingDuringBreak && currentTaskId;

            if (shouldPauseTracking) {
              this.store.dispatch(unsetCurrentTask());
            }

            // Bug #5974 fix: If isPauseTrackingDuringBreak is false and user manually
            // stopped tracking (pausedTaskId exists), resume tracking during break
            const shouldResumeTracking =
              !focusModeConfig?.isPauseTrackingDuringBreak &&
              !currentTaskId &&
              pausedTaskId;

            if (shouldResumeTracking) {
              this.store.dispatch(setCurrentTask({ id: pausedTaskId }));
            }

            this.store.dispatch(
              actions.startBreak({
                duration: breakInfo.duration,
                isLongBreak: breakInfo.isLong,
                pausedTaskId: shouldPauseTracking ? currentTaskId : undefined,
              }),
            );
          }
        } else {
          // Otherwise start a new session
          this.store.dispatch(
            actions.startFocusSession({
              duration: strategy.initialSessionDuration,
              isManualSessionCompletion: !!focusModeConfig?.isManualBreakStart,
            }),
          );
        }
      });
  }

  /**
   * Handles play/pause toggle for sessions and breaks
   */
  private _handlePlayPauseToggle(isPaused: boolean): void {
    if (isPaused) {
      this.store.dispatch(actions.unPauseFocusSession());
    } else {
      // Pass current task ID so it can be restored on resume
      const currentTaskId = this.taskService.currentTaskId();
      this.store.dispatch(actions.pauseFocusSession({ pausedTaskId: currentTaskId }));
    }
  }

  /**
   * Handles skipping the current break
   */
  private _handleSkipBreak(): void {
    this.store
      .select(selectors.selectPausedTaskId)
      .pipe(take(1))
      .subscribe((pausedTaskId) => {
        this.store.dispatch(actions.skipBreak({ pausedTaskId }));
      });
  }

  /**
   * Handles ending the current session manually
   */
  private _handleEndSession(): void {
    this.store.dispatch(actions.completeFocusSession({ isManual: true }));
  }

  /**
   * Handles opening the focus overlay
   */
  private _handleOpenOverlay(): void {
    this.store.dispatch(showFocusOverlay());
  }

  private _getBannerActions(
    timer: TimerState,
    isOnBreak: boolean,
    isSessionCompleted: boolean,
    isBreakTimeUp: boolean,
    focusModeConfig: FocusModeConfig | undefined,
  ): Pick<Banner, 'action' | 'action2' | 'action3'> {
    const isPaused = !timer.isRunning && timer.purpose !== null;

    // Show "Start" button when session completed OR break time is up
    // Otherwise show play/pause button
    const shouldShowStartButton = isSessionCompleted || isBreakTimeUp;

    const playPauseAction = shouldShowStartButton
      ? {
          label: T.F.FOCUS_MODE.B.START,
          icon: 'play_arrow',
          fn: () => {
            // When starting from break completion, first properly complete/skip the break
            // to resume task tracking and clean up state
            if (isBreakTimeUp) {
              this._handleStartAfterBreak();
            } else {
              // Session completed - check if we should start a break or new session
              this._handleStartAfterSessionComplete(focusModeConfig);
            }
          },
        }
      : {
          label: isPaused ? T.F.FOCUS_MODE.B.RESUME : T.F.FOCUS_MODE.B.PAUSE,
          icon: isPaused ? 'play_arrow' : 'pause',
          fn: () => this._handlePlayPauseToggle(isPaused),
        };

    // End session button - complete for work, skip for break (while running)
    // When session is completed (not break), show "End Focus Session" button
    const endAction =
      isSessionCompleted && !isBreakTimeUp
        ? {
            label: T.F.FOCUS_MODE.B.END_FOCUS_SESSION,
            icon: 'done_all',
            fn: () => {
              this.store.dispatch(actions.cancelFocusSession());
            },
          }
        : shouldShowStartButton
          ? undefined
          : isOnBreak
            ? {
                label: T.F.FOCUS_MODE.SKIP_BREAK,
                icon: 'skip_next',
                fn: () => this._handleSkipBreak(),
              }
            : {
                label: T.F.FOCUS_MODE.B.END_SESSION,
                icon: 'done_all',
                fn: () => this._handleEndSession(),
              };

    // Open overlay button
    const overlayAction = {
      label: T.F.FOCUS_MODE.B.TO_FOCUS_OVERLAY,
      icon: 'fullscreen',
      fn: () => this._handleOpenOverlay(),
    };

    return {
      action: playPauseAction,
      action2: endAction,
      action3: overlayAction,
    };
  }

  // Play ticking sound during focus sessions if enabled
  playTickSound$ = createEffect(
    () =>
      this.store.select(selectors.selectTimer).pipe(
        skipWhileApplyingRemoteOps(),
        filter(
          (timer) => timer.isRunning && timer.purpose === 'work' && timer.elapsed > 0,
        ),
        // Only emit when we cross a second boundary
        distinctUntilChanged(
          (prev, curr) =>
            Math.floor(prev.elapsed / 1000) === Math.floor(curr.elapsed / 1000),
        ),
        withLatestFrom(this.store.select(selectFocusModeConfig)),
        tap(([, focusModeConfig]) => {
          const soundVolume = this.globalConfigService.sound()?.volume || 0;
          if (focusModeConfig?.isPlayTick && soundVolume > 0) {
            // Play at reduced volume (40% of main volume) to not be too intrusive
            playSound(TICK_SOUND, Math.round(soundVolume * 0.4));
          }
        }),
      ),
    { dispatch: false },
  );

  private _notifyUser(isHideBar = false): void {
    const soundVolume = this.globalConfigService.sound()?.volume || 0;

    // Play sound if enabled
    if (soundVolume > 0) {
      playSound(SESSION_DONE_SOUND, soundVolume);
    }

    // Focus window if in Electron
    if (IS_ELECTRON) {
      window.ea.showOrFocus();
      window.ea.flashFrame();
      window.ea.setProgressBar({
        progress: 1,
        progressBarMode: isHideBar ? 'none' : 'normal',
      });
    }
  }
}
