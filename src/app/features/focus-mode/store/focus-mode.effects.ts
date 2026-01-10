import { inject, Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { combineLatest, EMPTY, of } from 'rxjs';
import {
  distinctUntilChanged,
  filter,
  map,
  pairwise,
  switchMap,
  take,
  tap,
  withLatestFrom,
} from 'rxjs/operators';
import * as actions from './focus-mode.actions';
import { cancelFocusSession, showFocusOverlay } from './focus-mode.actions';
import * as selectors from './focus-mode.selectors';
import { FocusModeStrategyFactory } from '../focus-mode-strategies';
import { GlobalConfigService } from '../../config/global-config.service';
import { TaskService } from '../../tasks/task.service';
import { playSound } from '../../../util/play-sound';
import { IS_ELECTRON } from '../../../app.constants';
import { setCurrentTask, unsetCurrentTask } from '../../tasks/store/task.actions';
import { selectTaskById } from '../../tasks/store/task.selectors';
import { openIdleDialog } from '../../idle/store/idle.actions';
import { LS } from '../../../core/persistence/storage-keys.const';
import {
  selectFocusModeConfig,
  selectIsFocusModeEnabled,
  selectPomodoroConfig,
} from '../../config/store/global-config.reducer';
import { FocusModeConfig } from '../../config/global-config.model';
import { updateGlobalConfigSection } from '../../config/store/global-config.actions';
import { FocusModeMode, FocusScreen, TimerState } from '../focus-mode.model';
import { BannerService } from '../../../core/banner/banner.service';
import { Banner, BannerId } from '../../../core/banner/banner.model';
import { T } from '../../../t.const';
import { MetricService } from '../../metric/metric.service';
import { FocusModeStorageService } from '../focus-mode-storage.service';

const SESSION_DONE_SOUND = 'positive.ogg';
const TICK_SOUND = 'tick.mp3';

@Injectable()
export class FocusModeEffects {
  private actions$ = inject(Actions);
  private store = inject(Store);
  private strategyFactory = inject(FocusModeStrategyFactory);
  private globalConfigService = inject(GlobalConfigService);
  private taskService = inject(TaskService);
  private bannerService = inject(BannerService);
  private metricService = inject(MetricService);
  private storageService = inject(FocusModeStorageService);

  // Auto-show overlay when task is selected (if sync session with tracking is enabled)
  // Skip showing overlay if isStartInBackground is enabled
  // Only triggers when focus mode feature is enabled
  autoShowOverlay$ = createEffect(() =>
    combineLatest([
      this.store.select(selectFocusModeConfig),
      this.store.select(selectIsFocusModeEnabled),
    ]).pipe(
      switchMap(([cfg, isFocusModeEnabled]) =>
        isFocusModeEnabled && cfg?.isSyncSessionWithTracking && !cfg?.isStartInBackground
          ? this.taskService.currentTaskId$.pipe(
              distinctUntilChanged(),
              filter((id) => !!id),
              map(() => actions.showFocusOverlay()),
            )
          : EMPTY,
      ),
    ),
  );

  // Sync: When tracking starts → start/unpause focus session
  // Only triggers when isSyncSessionWithTracking is enabled and focus mode feature is enabled
  syncTrackingStartToSession$ = createEffect(() =>
    combineLatest([
      this.store.select(selectFocusModeConfig),
      this.store.select(selectIsFocusModeEnabled),
    ]).pipe(
      switchMap(([cfg, isFocusModeEnabled]) =>
        isFocusModeEnabled && cfg?.isSyncSessionWithTracking
          ? this.taskService.currentTaskId$.pipe(
              distinctUntilChanged(),
              filter((taskId) => !!taskId),
              withLatestFrom(
                this.store.select(selectors.selectTimer),
                this.store.select(selectors.selectMode),
                this.store.select(selectors.selectCurrentScreen),
                this.store.select(selectors.selectPausedTaskId),
              ),
              switchMap(([_taskId, timer, mode, currentScreen, pausedTaskId]) => {
                // If session is paused (purpose is 'work' but not running), resume it
                if (timer.purpose === 'work' && !timer.isRunning) {
                  return of(actions.unPauseFocusSession());
                }
                // If break is active (running or paused), skip it to sync with tracking
                // This fixes bug #5875: pressing time tracking button during break
                if (timer.purpose === 'break') {
                  return of(actions.skipBreak({ pausedTaskId }));
                }
                // If no session active, start a new one (only from Main screen)
                if (timer.purpose === null && currentScreen === FocusScreen.Main) {
                  const strategy = this.strategyFactory.getStrategy(mode);
                  const duration = strategy.initialSessionDuration;
                  return of(actions.startFocusSession({ duration }));
                }
                return EMPTY;
              }),
            )
          : EMPTY,
      ),
    ),
  );

  // Sync: When tracking stops → pause focus session
  // Uses pairwise to capture the previous task ID before it's lost
  // Only triggers when focus mode feature is enabled
  syncTrackingStopToSession$ = createEffect(() =>
    this.taskService.currentTaskId$.pipe(
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
          timer.purpose === 'work' &&
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
          timer.purpose === 'work' &&
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
      filter(
        ([_action, cfg, timer, pausedTaskId, currentTaskId]) =>
          !!cfg?.isSyncSessionWithTracking &&
          timer.purpose === 'work' &&
          !currentTaskId &&
          !!pausedTaskId,
      ),
      switchMap(([_action, _cfg, _timer, pausedTaskId]) =>
        this.store.select(selectTaskById, { id: pausedTaskId! }).pipe(
          take(1),
          map((task) => (task ? setCurrentTask({ id: pausedTaskId! }) : null)),
        ),
      ),
      filter((action): action is ReturnType<typeof setCurrentTask> => action !== null),
    ),
  );

  // Sync: When focus session starts → start tracking (if not already tracking)
  // Checks that the paused task still exists before starting tracking
  syncSessionStartToTracking$ = createEffect(() =>
    this.actions$.pipe(
      ofType(actions.startFocusSession),
      withLatestFrom(
        this.store.select(selectFocusModeConfig),
        this.store.select(selectors.selectPausedTaskId),
        this.taskService.currentTaskId$,
      ),
      filter(
        ([_action, cfg, pausedTaskId, currentTaskId]) =>
          !!cfg?.isSyncSessionWithTracking && !currentTaskId && !!pausedTaskId,
      ),
      switchMap(([_action, _cfg, pausedTaskId]) =>
        this.store.select(selectTaskById, { id: pausedTaskId! }).pipe(
          take(1),
          map((task) => (task ? setCurrentTask({ id: pausedTaskId! }) : null)),
        ),
      ),
      filter((action): action is ReturnType<typeof setCurrentTask> => action !== null),
    ),
  );

  // Detect when work session timer completes and dispatch completeFocusSession
  // Only triggers when timer STOPS (isRunning becomes false) with elapsed >= duration
  detectSessionCompletion$ = createEffect(() =>
    this.store.select(selectors.selectTimer).pipe(
      withLatestFrom(this.store.select(selectors.selectMode)),
      // Only consider emissions where timer just stopped running
      distinctUntilChanged(
        ([prevTimer], [currTimer]) => prevTimer.isRunning === currTimer.isRunning,
      ),
      filter(
        ([timer, mode]) =>
          timer.purpose === 'work' &&
          !timer.isRunning &&
          timer.duration > 0 &&
          timer.elapsed >= timer.duration &&
          mode !== FocusModeMode.Flowtime, // Flowtime sessions should never auto-complete
      ),
      map(() => actions.completeFocusSession({ isManual: false })),
    ),
  );

  // Detect when break timer completes and show notification (no auto-complete)
  detectBreakTimeUp$ = createEffect(
    () =>
      this.store.select(selectors.selectTimer).pipe(
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

  // Effect 2: Stop tracking on manual session end (bug #5875 fix)
  stopTrackingOnManualEnd$ = createEffect(() =>
    this.actions$.pipe(
      ofType(actions.completeFocusSession),
      withLatestFrom(
        this.store.select(selectFocusModeConfig),
        this.taskService.currentTaskId$,
      ),
      filter(
        ([action, config, taskId]) =>
          !!action.isManual && !!config?.isSyncSessionWithTracking && !!taskId,
      ),
      map(() => unsetCurrentTask()),
    ),
  );

  // Effect 3: Auto-start break after session completion
  autoStartBreakOnSessionComplete$ = createEffect(() =>
    this.actions$.pipe(
      ofType(actions.completeFocusSession),
      withLatestFrom(
        this.store.select(selectors.selectMode),
        this.store.select(selectors.selectCurrentCycle),
        this.store.select(selectFocusModeConfig),
        this.taskService.currentTaskId$,
      ),
      filter(([_, mode, __, config]) => {
        const strategy = this.strategyFactory.getStrategy(mode);
        return strategy.shouldStartBreakAfterSession && !config?.isManualBreakStart;
      }),
      switchMap(([_, mode, cycle, config, currentTaskId]) => {
        const strategy = this.strategyFactory.getStrategy(mode);
        const breakInfo = strategy.getBreakDuration(cycle);
        const shouldPauseTracking = config?.isPauseTrackingDuringBreak && currentTaskId;
        const actionsArr: any[] = [];

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
      withLatestFrom(this.store.select(selectors.selectMode)),
      filter(([_, mode]) => {
        const strategy = this.strategyFactory.getStrategy(mode);
        return strategy.shouldAutoStartNextSession;
      }),
      map(([_, mode]) => {
        const strategy = this.strategyFactory.getStrategy(mode);
        return actions.startFocusSession({ duration: strategy.initialSessionDuration });
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
      withLatestFrom(this.store.select(selectors.selectMode)),
      switchMap(([action, mode]) => {
        const strategy = this.strategyFactory.getStrategy(mode);
        const actionsToDispatch: any[] = [];

        // Resume task tracking if we paused it during break
        if (action.pausedTaskId) {
          actionsToDispatch.push(setCurrentTask({ id: action.pausedTaskId }));
        }

        // Auto-start next session if configured
        if (strategy.shouldAutoStartNextSession) {
          const duration = strategy.initialSessionDuration;
          actionsToDispatch.push(actions.startFocusSession({ duration }));
        }

        return actionsToDispatch.length > 0 ? of(...actionsToDispatch) : EMPTY;
      }),
    ),
  );

  // Handle session cancellation
  cancelSession$ = createEffect(() =>
    this.actions$.pipe(
      ofType(actions.cancelFocusSession),
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
  setTaskBarProgress$ =
    IS_ELECTRON &&
    createEffect(
      () =>
        this.store.select(selectors.selectProgress).pipe(
          withLatestFrom(this.store.select(selectors.selectIsRunning)),
          tap(([progress, isRunning]) => {
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

  // Update banner when session or break state changes
  // Only shows banner when focus mode feature is enabled
  updateBanner$ = createEffect(
    () =>
      combineLatest([
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
      ]).pipe(
        tap(
          ([
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

            // In background mode, also show banner when paused
            const useIconButtons = focusModeConfig?.isStartInBackground;
            const shouldShowBanner =
              isSessionRunning ||
              isOnBreak ||
              isSessionCompleted ||
              (useIconButtons && isSessionPaused);

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

              const translateParams =
                mode === FocusModeMode.Pomodoro ? { cycleNr: cycle || 1 } : undefined;

              this.bannerService.open({
                id: BannerId.FocusMode,
                ico: icon,
                msg: translationKey,
                translateParams,
                timer$,
                progress$,
                // Hide dismiss button in icon button mode (banner-only mode)
                isHideDismissBtn: useIconButtons,
                ...(useIconButtons
                  ? this._getIconButtonActions(
                      timer,
                      isOnBreak,
                      isSessionCompleted,
                      isBreakTimeUp,
                      focusModeConfig,
                    )
                  : this._getTextButtonActions(isSessionCompleted)),
              });
            } else {
              this.bannerService.dismiss(BannerId.FocusMode);
            }
          },
        ),
      ),
    { dispatch: false },
  );

  private _getTextButtonActions(
    isSessionCompleted: boolean,
  ): Pick<Banner, 'action' | 'action2' | 'action3'> {
    return {
      action2: {
        label: T.F.FOCUS_MODE.B.TO_FOCUS_OVERLAY,
        fn: () => {
          this.store.dispatch(showFocusOverlay());
        },
      },
      // Only show Cancel button when session is not completed
      ...(isSessionCompleted
        ? {}
        : {
            action: {
              label: T.G.CANCEL,
              fn: () => {
                this.store.dispatch(cancelFocusSession());
              },
            },
          }),
    };
  }

  private _getIconButtonActions(
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
              combineLatest([
                this.store.select(selectors.selectMode),
                this.store.select(selectors.selectPausedTaskId),
              ])
                .pipe(take(1))
                .subscribe(([mode, pausedTaskId]) => {
                  const strategy = this.strategyFactory.getStrategy(mode);
                  // Skip break (with pausedTaskId to resume tracking)
                  this.store.dispatch(actions.skipBreak({ pausedTaskId }));
                  // Only manually start session if strategy doesn't auto-start
                  // (Pomodoro auto-starts via skipBreak$ effect)
                  if (!strategy.shouldAutoStartNextSession) {
                    this.store.dispatch(
                      actions.startFocusSession({
                        duration: strategy.initialSessionDuration,
                      }),
                    );
                  }
                });
            } else {
              // Session completed - check if we should start a break or new session
              combineLatest([
                this.store.select(selectors.selectMode),
                this.store.select(selectors.selectCurrentCycle),
              ])
                .pipe(take(1))
                .subscribe(([mode, cycle]) => {
                  const strategy = this.strategyFactory.getStrategy(mode);

                  // If manual break start is enabled and mode supports breaks, start a break
                  if (
                    focusModeConfig?.isManualBreakStart &&
                    strategy.shouldStartBreakAfterSession
                  ) {
                    const breakInfo = strategy.getBreakDuration(cycle ?? 1);
                    if (breakInfo) {
                      const currentTaskId = this.taskService.currentTaskId();
                      const shouldPauseTracking =
                        focusModeConfig?.isPauseTrackingDuringBreak && currentTaskId;

                      if (shouldPauseTracking) {
                        this.store.dispatch(unsetCurrentTask());
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
                      }),
                    );
                  }
                });
            }
          },
        }
      : {
          label: isPaused ? T.F.FOCUS_MODE.B.RESUME : T.F.FOCUS_MODE.B.PAUSE,
          icon: isPaused ? 'play_arrow' : 'pause',
          fn: () => {
            if (isPaused) {
              this.store.dispatch(actions.unPauseFocusSession());
            } else {
              // Pass current task ID so it can be restored on resume
              const currentTaskId = this.taskService.currentTaskId();
              this.store.dispatch(
                actions.pauseFocusSession({ pausedTaskId: currentTaskId }),
              );
            }
          },
        };

    // End session button - complete for work, skip for break (while running)
    // Hide when session is completed or break time is up (Start button takes priority)
    const endAction = shouldShowStartButton
      ? undefined
      : isOnBreak
        ? {
            label: T.F.FOCUS_MODE.SKIP_BREAK,
            icon: 'skip_next',
            fn: () => {
              this.store
                .select(selectors.selectPausedTaskId)
                .pipe(take(1))
                .subscribe((pausedTaskId) => {
                  this.store.dispatch(actions.skipBreak({ pausedTaskId }));
                });
            },
          }
        : {
            label: T.F.FOCUS_MODE.B.END_SESSION,
            icon: 'done_all',
            fn: () => {
              this.store.dispatch(actions.completeFocusSession({ isManual: true }));
            },
          };

    // Open overlay button
    const overlayAction = {
      label: T.F.FOCUS_MODE.B.TO_FOCUS_OVERLAY,
      icon: 'fullscreen',
      fn: () => {
        this.store.dispatch(showFocusOverlay());
      },
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
