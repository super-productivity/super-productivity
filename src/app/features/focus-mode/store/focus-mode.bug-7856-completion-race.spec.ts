/**
 * Completion-race test for GitHub issue #7856 (companion to focus-mode.bug-7856.spec).
 * https://github.com/super-productivity/super-productivity/issues/7856
 *
 * The resume-tick fix (AndroidFocusModeEffects.resyncFocusTimerOnResume$) dispatches a
 * `tick()` on app resume. When a Pomodoro/Countdown session ran PAST its duration while
 * the app was backgrounded, the native foreground service ALSO completes: it decrements
 * `remainingMs` to 0 on its main-looper handler and fires ACTION_TIMER_COMPLETE
 * (FocusModeForegroundService.onTimerComplete). CapacitorMainActivity registers that
 * broadcast receiver onCreate..onDestroy — NOT onResume/onPause — so the native
 * completion is delivered (not dropped) even while backgrounded, and is bridged into
 * `onFocusModeTimerComplete$` -> handleNativeTimerComplete$ -> completeFocusSession.
 *
 * On resume, therefore, BOTH a `tick()` and a native completeFocusSession are in play.
 * Whether the bridged native call executes while still backgrounded (native wins, before
 * the resume tick) or is deferred until the WebView unfreezes (it races the tick) is
 * platform-dependent WebView behaviour and can only be confirmed on-device.
 *
 * This spec pins the JS-side invariant that must hold in EITHER ordering: exactly one
 * clean completion — never a double-dispatch, never a dropped completion. It walks the
 * REAL reducer through both orderings, and ties the two effect guards to their real code
 * (no re-encoded predicates):
 *   - handleNativeTimerComplete$'s guard is the exported `shouldHandleNativeTimerComplete`
 *     used here directly (unit-covered in android-focus-mode.effects.spec.ts). The native
 *     event dispatches `completeFocusSession({ isManual: false, completedDuration })` only
 *     while that guard holds, with completedDuration capped at `timer.duration`.
 *   - detectSessionCompletion$ dispatches `completeFocusSession({ isManual: false })` with
 *     NO completedDuration on the running->stopped transition, and stays silent once idle.
 *     Both are covered by the real effect in focus-mode.effects.spec.ts (describe
 *     'detectSessionCompletion$'); here we apply the action it is proven to emit and assert
 *     the resulting reducer state.
 *
 * The one observable difference between the two orderings — the logged session length —
 * is asserted explicitly and is benign (see the final test).
 */

import { focusModeReducer, initialState } from './focus-mode.reducer';
import * as a from './focus-mode.actions';
import { FocusModeMode, FocusModeState } from '../focus-mode.model';
import { shouldHandleNativeTimerComplete } from '../../android/store/android-focus-mode.effects';

const MIN = 60_000;
const DURATION = 25 * MIN;

/** A running 25-min Pomodoro work session whose last in-app tick was `lastTickAgoMs` ago. */
const runningWorkSession = (lastTickAgoMs: number): FocusModeState => ({
  ...initialState,
  mode: FocusModeMode.Pomodoro,
  timer: {
    isRunning: true,
    startedAt: Date.now() - lastTickAgoMs,
    elapsed: lastTickAgoMs,
    duration: DURATION,
    purpose: 'work',
  },
});

/** What detectSessionCompletion$ dispatches once the tick stops an over-run work timer. */
const completionFromTickPath = (): ReturnType<typeof a.completeFocusSession> =>
  a.completeFocusSession({ isManual: false });

/** What handleNativeTimerComplete$ dispatches; completedDuration is capped at duration. */
const completionFromNativePath = (
  cappedDuration: number,
): ReturnType<typeof a.completeFocusSession> =>
  a.completeFocusSession({ isManual: false, completedDuration: cappedDuration });

describe('FocusMode Bug #7856: completion-while-backgrounded race (resume tick vs native complete)', () => {
  beforeEach(() => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date(2023, 0, 1, 10, 0, 0));
    localStorage.clear();
  });

  afterEach(() => {
    jasmine.clock().uninstall();
  });

  it('tick-wins ordering: the resume tick completes the session and the later native event is filtered out (one completion)', () => {
    // 25-min Pomodoro last ticked at 24 min, then backgrounded for 10 min -> 34 min of
    // real time elapsed (9 min past its end) by the time the app resumes.
    let state = runningWorkSession(24 * MIN);
    jasmine.clock().tick(10 * MIN);

    // The resume tick fires first.
    state = focusModeReducer(state, a.tick());

    // The reducer stops the work timer at its true over-run elapsed and marks the duration,
    // but does NOT clear `purpose` until completeFocusSession runs.
    expect(state.timer.isRunning).toBe(false);
    expect(state.timer.purpose).toBe('work');
    expect(state.lastCompletedDuration).toBe(34 * MIN);

    // The native completion event, arriving in this window, is rejected by the REAL
    // handleNativeTimerComplete$ guard because the tick already stopped the timer.
    expect(shouldHandleNativeTimerComplete(false, state.timer)).toBe(false);

    // detectSessionCompletion$ observes the running->stopped transition and dispatches
    // completeFocusSession (no completedDuration) -> the session ends idle. That emission
    // is covered by the real effect in focus-mode.effects.spec.ts ('detectSessionCompletion$
    // should dispatch completeFocusSession when timer completes'); here we apply it and
    // assert the resulting state.
    state = focusModeReducer(state, completionFromTickPath());
    expect(state.timer.purpose).toBeNull();
    expect(state.lastCompletedDuration).toBe(34 * MIN);

    // A native event delivered even later is still filtered (idle), and a late resume
    // tick is a no-op on the idle timer -> no double completion.
    expect(shouldHandleNativeTimerComplete(false, state.timer)).toBe(false);
    expect(focusModeReducer(state, a.tick())).toBe(state);
  });

  it('native-wins ordering: the native completion ends the session and the later resume tick is a no-op (one completion)', () => {
    let state = runningWorkSession(24 * MIN);
    jasmine.clock().tick(10 * MIN);

    // The native completion fires first, capped at the session duration.
    state = focusModeReducer(state, completionFromNativePath(DURATION));
    expect(state.timer.purpose).toBeNull();
    expect(state.lastCompletedDuration).toBe(DURATION);

    // detectSessionCompletion$ does NOT fire a second completion on the now-idle timer
    // (purpose null) -> verified against the real effect in focus-mode.effects.spec.ts
    // ('detectSessionCompletion$ should NOT dispatch when the session is already idle').

    // The resume tick, arriving after, is a no-op on the idle timer -> no double completion.
    expect(focusModeReducer(state, a.tick())).toBe(state);
  });

  it('documents the benign duration nondeterminism: tick-wins logs the over-run elapsed, native-wins logs the capped duration', () => {
    // Same physical scenario, two valid single-completion outcomes that differ ONLY in the
    // logged session length. Which one occurs depends on platform event ordering (see file
    // header). 34 min matches desktop/web behaviour (its interval is throttled the same way);
    // 25 min is the native cap. Neither double-completes nor drops the completion.
    const base = runningWorkSession(24 * MIN);
    jasmine.clock().tick(10 * MIN);

    const tickWins = focusModeReducer(
      focusModeReducer(base, a.tick()),
      completionFromTickPath(),
    );
    const nativeWins = focusModeReducer(base, completionFromNativePath(DURATION));

    expect(tickWins.lastCompletedDuration).toBe(34 * MIN);
    expect(nativeWins.lastCompletedDuration).toBe(DURATION);
    expect(tickWins.lastCompletedDuration).not.toBe(nativeWins.lastCompletedDuration);

    // Both orderings end in a single, clean, idle completion.
    expect(tickWins.timer.purpose).toBeNull();
    expect(nativeWins.timer.purpose).toBeNull();
  });
});
