import { GlobalTrackingIntervalService } from '../../core/global-tracking-interval/global-tracking-interval.service';
import { TaskService } from '../tasks/task.service';
import { getTimerRemainingMs, TimerState } from './focus-mode.model';

/**
 * How much background time a resume may credit before its focus tick
 * auto-completes the running work session, or null when the tick cannot
 * complete one (Flowtime, overtime, paused/idle timer, break). The conditions
 * mirror the tick reducer's work auto-completion in focus-mode.reducer.ts; the
 * cap mirrors AndroidFocusModeEffects._completionDuration, so a resume and a
 * native completion credit the same time to the task.
 */
export const getFocusAutoCompleteCapMs = (
  timer: TimerState,
  isOvertimeEnabled: boolean,
): number | null =>
  timer.isRunning && timer.purpose === 'work' && timer.duration > 0 && !isOvertimeEnabled
    ? getTimerRemainingMs(timer)
    : null;

/**
 * Credit the backgrounded wall-clock gap (capped) to tick$ consumers (running
 * stopwatch counters, break tracking) with one wake-up tick, and flush it into
 * a syncTimeSpent op. The 1s interval is paused while a mobile app is
 * backgrounded (see createGlobalInterval$, #8243), so without this the gap
 * would never reach them. resetTrackingStart() drops any over-cap remainder
 * from the tick anchor so the restarted interval can't deliver it again.
 */
export const creditBackgroundTickGap = (
  globalTracking: GlobalTrackingIntervalService,
  taskService: TaskService,
  gapCapMs: number,
): void => {
  globalTracking.triggerWakeUpTick(gapCapMs);
  globalTracking.resetTrackingStart();
  taskService.flushAccumulatedTimeSpent();
};

export type ResumeGapCreditDeps = {
  globalTracking: GlobalTrackingIntervalService;
  taskService: TaskService;
  tickFocus: () => void;
};

/**
 * Credit a resume's background gap and catch the focus timer up with one tick.
 * The tick may complete a Pomodoro/Countdown and unset the current task, so
 * with a `focusAutoCompleteCapMs` the task is credited only up to the session
 * end; the remainder then goes to whatever the completion leaves tracked
 * (nothing while tracking pauses during breaks) (#10261, #10599).
 */
export const creditResumeGap = (
  deps: ResumeGapCreditDeps,
  gapCapMs: number,
  focusAutoCompleteCapMs: number | null,
): void => {
  if (focusAutoCompleteCapMs === null) {
    creditBackgroundTickGap(deps.globalTracking, deps.taskService, gapCapMs);
    deps.tickFocus();
    return;
  }
  const capMs = Math.min(focusAutoCompleteCapMs, gapCapMs);
  const credited = deps.globalTracking.triggerWakeUpTick(capMs);
  deps.taskService.flushAccumulatedTimeSpent();
  deps.tickFocus();
  if (credited.duration < capMs) {
    // The gap ended before the session; only the tick's own milliseconds are
    // left, and crediting them would add a near-zero op to every resume.
    deps.globalTracking.resetTrackingStart();
  } else {
    creditBackgroundTickGap(deps.globalTracking, deps.taskService, gapCapMs);
  }
};
