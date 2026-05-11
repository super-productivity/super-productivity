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
import * as selectors from './focus-mode.selectors';
import { FocusModeStrategyFactory } from '../focus-mode-strategies';
import { GlobalConfigService } from '../../config/global-config.service';
import { TaskService } from '../../tasks/task.service';
import { playSound } from '../../../util/play-sound';
import { startWhiteNoise, stopWhiteNoise } from '../../../util/white-noise';
import { IS_ELECTRON } from '../../../app.constants';
import { NotifyModel } from '../../../core/notify/notify.model';
import { NotifyService } from '../../../core/notify/notify.service';
import { setCurrentTask, unsetCurrentTask } from '../../tasks/store/task.actions';
import { selectLastCurrentTask, selectTaskById } from '../../tasks/store/task.selectors';
import { openIdleDialog } from '../../idle/store/idle.actions';
import { LS } from '../../../core/persistence/storage-keys.const';
import {
  selectFocusModeConfig,
  selectIsFocusModeEnabled,
  selectPomodoroConfig,
} from '../../config/store/global-config.reducer';
import { updateGlobalConfigSection } from '../../config/store/global-config.actions';
import { FocusModeMode, FocusScreen, getBreakCycle } from '../focus-mode.model';
import { MetricService } from '../../metric/metric.service';
import { FocusModeStorageService } from '../focus-mode-storage.service';
import { TakeABreakService } from '../../take-a-break/take-a-break.service';
import { T } from '../../../t.const';

const SESSION_DONE_SOUND = 'positive.mp3';
const TICK_SOUND = 'tick.mp3';
/** Focus-mode ambient sounds play at 40% of the user's main volume to avoid being intrusive. */
const FOCUS_SOUND_VOLUME_FACTOR = 0.4;
const FOCUS_SESSION_NOTIFICATION_TAG = 'FOCUS_MODE_SESSION_COMPLETE';
const FOCUS_BREAK_NOTIFICATION_TAG = 'FOCUS_MODE_BREAK_COMPLETE';

@Injectable()
export class FocusModeEffects {
  private actions$ = inject(LOCAL_ACTIONS);
  private store = inject(Store);
  private strategyFactory = inject(FocusModeStrategyFactory);
  private globalConfigService = inject(GlobalConfigService);
  private taskService = inject(TaskService);
  private metricService = inject(MetricService);
  private storageService = inject(FocusModeStorageService);
  private takeABreakService = inject(TakeABreakService);
  private notifyService = inject(NotifyService);

  // Sync: When tracking starts → resume/skip-break or auto-spawn a new session.
  //
  // Sync (always): if a session/break is in progress, keep it in lockstep with
  // tracking — resume paused work, skip a stale break, etc.
  //
  // Auto-spawn (opt-in via `autoStartFocusOnPlay`): if no session is active and
  // the user has opted in, start a new session quietly. The overlay is NOT
  // dispatched — surface comes from the existing banner / future indicator.
  // Inside the overlay we still respect `isSkipPreparation` so #7384's
  // rocket-prep flow keeps working for users who entered via F-key.
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
      filter(([_taskId, _cfg, isFocusModeEnabled]) => isFocusModeEnabled),
      withLatestFrom(
        this.store.select(selectors.selectTimer),
        this.store.select(selectors.selectMode),
        this.store.select(selectors.selectCurrentScreen),
        this.store.select(selectors.selectIsOverlayShown),
        // Bug #5995 Fix: Get the LATEST value of isResumingBreak here
        // to avoid using stale value from outer closure
        this.store.select(selectors.selectIsResumingBreak),
      ),
      switchMap(
        ([
          [_taskId, cfg],
          timer,
          mode,
          currentScreen,
          isOverlayShown,
          isResumingBreak,
        ]) => {
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
            // Bug #6726 fix: Don't pass pausedTaskId — the user already chose a new task
            return of(actions.skipBreak({ pausedTaskId: undefined }));
          }
          // No session active: auto-spawn only when the user opted in.
          if (timer.purpose === null && currentScreen === FocusScreen.Main) {
            if (!cfg?.autoStartFocusOnPlay) {
              return EMPTY;
            }
            // Bug #7384: respect isSkipPreparation only inside the overlay
            // (preparation screen is overlay-bound). For the quiet auto-spawn
            // path there's no overlay → no rocket → bypass the prep gate.
            if (isOverlayShown && !cfg?.isSkipPreparation) {
              return EMPTY;
            }
            const strategy = this.strategyFactory.getStrategy(mode);
            const duration = strategy.initialSessionDuration;
            return of(
              actions.startFocusSession({
                duration,
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
        this.store.select(selectors.selectTimer),
        this.store.select(selectIsFocusModeEnabled),
      ),
      filter(
        ([[prevTaskId, currTaskId], timer, isFocusModeEnabled]) =>
          isFocusModeEnabled &&
          (timer.purpose === 'work' || timer.purpose === 'break') &&
          timer.isRunning &&
          !!prevTaskId &&
          !currTaskId, // Was tracking (prevTaskId exists) and now stopped (currTaskId is null)
      ),
      map(([[prevTaskId]]) => actions.pauseFocusSession({ pausedTaskId: prevTaskId })),
    ),
  );

  // Sync: When focus session pauses → stop tracking
  // Skip when currentTaskId is already null (pause originated from tracking stop,
  // which already cleared it); redundant dispatch would clobber lastCurrentTaskId.
  syncSessionPauseToTracking$ = createEffect(() =>
    this.actions$.pipe(
      ofType(actions.pauseFocusSession),
      withLatestFrom(
        this.store.select(selectors.selectTimer),
        this.taskService.currentTaskId$,
      ),
      filter(
        ([action, timer, currentTaskId]) =>
          (timer.purpose === 'work' || timer.purpose === 'break') &&
          !!action.pausedTaskId &&
          !!currentTaskId,
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
        if (timer.purpose !== 'work' && timer.purpose !== 'break') {
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
        this.store.select(selectors.selectPausedTaskId),
        this.taskService.currentTaskId$,
        this.store.select(selectLastCurrentTask),
      ),
      filter(
        ([_action, pausedTaskId, currentTaskId, lastCurrentTask]) =>
          !currentTaskId && (!!pausedTaskId || !!lastCurrentTask),
      ),
      switchMap(([_action, pausedTaskId, _currentTaskId, lastCurrentTask]) => {
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
  // Guard: skip auto-completion when overtime is enabled (user pausing during overtime
  // should not trigger session completion)
  detectSessionCompletion$ = createEffect(() =>
    this.store.select(selectors.selectTimer).pipe(
      skipWhileApplyingRemoteOps(),
      withLatestFrom(
        this.store.select(selectors.selectMode),
        this.store.select(selectors.selectIsOvertimeEnabled),
      ),
      // Only consider emissions where timer just stopped running
      distinctUntilChanged(
        ([prevTimer], [currTimer]) => prevTimer.isRunning === currTimer.isRunning,
      ),
      filter(
        ([timer, mode, _isOvertimeEnabled]) =>
          timer.purpose === 'work' &&
          !timer.isRunning &&
          timer.duration > 0 &&
          timer.elapsed >= timer.duration &&
          mode !== FocusModeMode.Flowtime &&
          !_isOvertimeEnabled,
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
        withLatestFrom(this.store.select(selectFocusModeConfig)),
        tap(([timer, focusModeConfig]) => {
          this._notifyUser(
            false,
            focusModeConfig?.isNotifyOnBreakDone
              ? this._getBreakCompleteNotification(timer.isLongBreak === true)
              : undefined,
          );
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
        if (!config?.isPauseTrackingDuringBreak) {
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
        // - Auto: autoStartBreakOnSessionComplete$
        // - Manual: FocusModeService.startAfterSessionComplete()
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

  // Effect 3b: Offer Flowtime breaks when user explicitly ends their session
  // Triggers on endFlowtimeSession — NOT pauseFocusSession (which is fired by
  // sync-stop, idle, and the regular pause button)
  offerFlowtimeBreakOnSessionEnd$ = createEffect(() =>
    this.actions$.pipe(
      ofType(actions.endFlowtimeSession),
      withLatestFrom(
        this.store.select(selectors.selectMode),
        this.store.select(selectors.selectTimer),
      ),
      filter(([_action, mode, timer]) => {
        if (mode !== FocusModeMode.Flowtime) return false;
        if (timer.purpose !== 'work') return false;
        return true;
      }),
      switchMap(([action, mode, timer]) => {
        const strategy = this.strategyFactory.getStrategy(mode);
        const breakInfo = strategy.getBreakDuration(timer.elapsed);

        if (!strategy.shouldStartBreakAfterSession || !breakInfo) {
          return [actions.completeFocusSession({ isManual: true })];
        }

        return [
          actions.offerFlowtimeBreak({
            duration: breakInfo.duration,
            isLongBreak: breakInfo.isLong,
            pausedTaskId: action.pausedTaskId,
          }),
        ];
      }),
    ),
  );

  // Effect 4: Notification side effect (non-dispatching)
  notifyOnSessionComplete$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(actions.completeFocusSession),
        withLatestFrom(
          this.store.select(selectors.selectMode),
          this.store.select(selectFocusModeConfig),
        ),
        tap(([action, mode, focusModeConfig]) =>
          this._notifyUser(
            false,
            !action.isManual && focusModeConfig?.isNotifyOnFocusSessionDone
              ? this._getSessionCompleteNotification(mode)
              : undefined,
          ),
        ),
      ),
    { dispatch: false },
  );

  // Overtime: set _isOvertimeEnabled when a Pomodoro session starts with isManualBreakStart
  setOvertimeOnSessionStart$ = createEffect(() =>
    this.actions$.pipe(
      ofType(actions.startFocusSession),
      withLatestFrom(
        this.store.select(selectors.selectMode),
        this.store.select(selectFocusModeConfig),
      ),
      map(([_, mode, config]) =>
        actions.setOvertimeEnabled({
          enabled: mode === FocusModeMode.Pomodoro && !!config?.isManualBreakStart,
        }),
      ),
    ),
  );

  // Overtime: one-shot notification when timer first crosses the duration mark
  notifyOnOvertimeStart$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(actions.startFocusSession),
        switchMap(() =>
          this.store.select(selectors.selectTimer).pipe(
            filter(
              (timer) =>
                timer.isRunning &&
                timer.purpose === 'work' &&
                timer.duration > 0 &&
                timer.elapsed >= timer.duration,
            ),
            withLatestFrom(
              this.store.select(selectors.selectMode),
              this.store.select(selectFocusModeConfig),
            ),
            take(1),
            tap(([, mode, focusModeConfig]) =>
              this._notifyUser(
                false,
                focusModeConfig?.isNotifyOnFocusSessionDone
                  ? this._getSessionCompleteNotification(mode)
                  : undefined,
              ),
            ),
          ),
        ),
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
  // Bug #6726 fix: Don't override if user is already tracking a different task
  resumeTrackingOnBreakComplete$ = createEffect(() =>
    this.actions$.pipe(
      ofType(actions.completeBreak),
      filter((action) => !!action.pausedTaskId),
      withLatestFrom(this.taskService.currentTaskId$),
      filter(([_, currentTaskId]) => !currentTaskId),
      map(([action]) => setCurrentTask({ id: action.pausedTaskId! })),
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
        this.taskService.currentTaskId$,
      ),
      switchMap(([action, mode, config, currentTaskId]) => {
        const strategy = this.strategyFactory.getStrategy(mode);
        const actionsToDispatch: any[] = [];

        // Resume task tracking if we paused it during break
        // Bug #6726 fix: Don't override if user is already tracking a different task
        if (action.pausedTaskId && !currentTaskId) {
          actionsToDispatch.push(setCurrentTask({ id: action.pausedTaskId }));
        }

        // Auto-start next session if configured
        if (strategy.shouldAutoStartNextSession) {
          const duration = strategy.initialSessionDuration;
          actionsToDispatch.push(
            actions.startFocusSession({
              duration,
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

  // Stop tracking when exiting break to planning
  // Without this, tracking continues running orphaned after the focus session is reset
  stopTrackingOnExitBreakToPlanning$ = createEffect(() =>
    this.actions$.pipe(
      ofType(actions.exitBreakToPlanning),
      withLatestFrom(this.taskService.currentTaskId$),
      filter(([_, currentTaskId]) => !!currentTaskId),
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
        // Flowtime sessions are logged when the break is offered, even if the
        // user declines the break and never starts it.
        ofType(actions.completeFocusSession, actions.offerFlowtimeBreak),
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
          if (focusModeConfig?.focusModeSound === 'tick' && soundVolume > 0) {
            playSound(TICK_SOUND, Math.round(soundVolume * FOCUS_SOUND_VOLUME_FACTOR));
          }
        }),
      ),
    { dispatch: false },
  );

  // Manage white noise loop during focus sessions
  whiteNoiseSound$ = createEffect(
    () =>
      combineLatest([
        this.store.select(selectors.selectTimer),
        this.store.select(selectFocusModeConfig),
      ]).pipe(
        skipWhileApplyingRemoteOps(),
        map(([timer, focusModeConfig]) => {
          const soundVolume = this.globalConfigService.sound()?.volume || 0;
          return (
            focusModeConfig?.focusModeSound === 'whiteNoise' &&
            timer.isRunning &&
            timer.purpose === 'work' &&
            timer.elapsed > 0 &&
            soundVolume > 0
          );
        }),
        distinctUntilChanged(),
        tap((shouldPlay) => {
          if (shouldPlay) {
            const soundVolume = this.globalConfigService.sound()?.volume || 0;
            startWhiteNoise(Math.round(soundVolume * FOCUS_SOUND_VOLUME_FACTOR));
          } else {
            stopWhiteNoise();
          }
        }),
      ),
    { dispatch: false },
  );

  private _notifyUser(isHideBar = false, desktopNotification?: NotifyModel): void {
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

    if (desktopNotification && !IS_ELECTRON) {
      void this.notifyService.notifyDesktop(desktopNotification);
    }
  }

  private _getSessionCompleteNotification(mode: FocusModeMode): NotifyModel {
    return {
      tag: FOCUS_SESSION_NOTIFICATION_TAG,
      renotify: true,
      title:
        mode === FocusModeMode.Pomodoro
          ? T.F.FOCUS_MODE.POMODORO_SESSION_COMPLETED
          : T.F.FOCUS_MODE.SESSION_COMPLETED,
    };
  }

  private _getBreakCompleteNotification(isLongBreak: boolean): NotifyModel {
    return {
      tag: FOCUS_BREAK_NOTIFICATION_TAG,
      renotify: true,
      title: T.F.POMODORO.BREAK_IS_DONE,
      body: isLongBreak ? T.F.FOCUS_MODE.LONG_BREAK : T.F.FOCUS_MODE.SHORT_BREAK,
    };
  }
}
