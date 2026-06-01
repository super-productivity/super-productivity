/**
 * Reducer test for GitHub issue #7856
 * https://github.com/super-productivity/super-productivity/issues/7856
 *
 * Bug (Android): after the app sits in the background for several minutes, the
 * in-app Pomodoro/Focus countdown differs from the Android notification timer.
 * The difference is roughly the time spent away (2 min, 10 min, ...). There is
 * no drift while the app stays in the foreground.
 *
 * These tests are a DIAGNOSIS aid, not the fix. They pin down the JS half of the
 * mechanism so we can be confident about the root cause and about what the fix
 * must do:
 *
 *   1. The in-app remaining time lives in `state.timer.elapsed` and only changes
 *      when a `tick` action is dispatched. The tick is driven solely by
 *      `GlobalTrackingIntervalService.globalInterval$` (see
 *      focus-mode.service.ts), an RxJS `interval(1000)` that Chromium/Android
 *      freezes for a backgrounded WebView. While frozen, no tick fires, so the
 *      displayed value is STALE — it drifts from wall-clock truth by exactly the
 *      background duration. (Test A.)
 *
 *   2. The reducer itself is wall-clock based (`elapsed = Date.now() - startedAt`),
 *      so a SINGLE tick after resume snaps the countdown back to the truth. The
 *      fix therefore only needs to *fire a tick on resume* (mirroring how time
 *      tracking re-syncs via `androidInterface.onResume$`); it does not need to
 *      pull a value from native. (Test B.)
 *
 *   3. If the session would have elapsed past its duration while backgrounded,
 *      the resume tick must still complete it cleanly. (Test C — guards the one
 *      behavioural risk of a resume-tick fix.)
 *
 * The native notification half (it keeps counting accurately on the
 * foreground-service main-looper handler) is Kotlin and is not exercised here.
 */

import { focusModeReducer, initialState } from './focus-mode.reducer';
import * as a from './focus-mode.actions';
import { selectTimeRemaining } from './focus-mode.selectors';
import { FocusModeMode, FocusModeState } from '../focus-mode.model';

const MIN = 60_000;

/** Build a running 25-min Pomodoro work session that started `agoMs` ago. */
const runningSession = (agoMs: number): FocusModeState => ({
  ...initialState,
  mode: FocusModeMode.Pomodoro,
  timer: {
    isRunning: true,
    startedAt: Date.now() - agoMs,
    elapsed: agoMs,
    duration: 25 * MIN,
    purpose: 'work' as const,
  },
});

/** The value the in-app countdown actually displays. */
const displayedRemaining = (state: FocusModeState): number =>
  selectTimeRemaining.projector(state.timer.elapsed, state.timer.duration);

describe('FocusMode Bug #7856: in-app timer drifts from notification after backgrounding', () => {
  beforeEach(() => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date(2023, 0, 1, 10, 0, 0));
    localStorage.clear();
  });

  afterEach(() => {
    jasmine.clock().uninstall();
  });

  it('A: freezes the in-app countdown while backgrounded (no ticks fire) → drift = background duration', () => {
    // Session has been running for 5 min and was just ticked, so the display is correct.
    let state = runningSession(5 * MIN);
    state = focusModeReducer(state, a.tick());
    expect(displayedRemaining(state)).toBe(20 * MIN);

    // App goes to background: the WebView interval is frozen, so NO tick fires
    // for the next 10 minutes of real time.
    jasmine.clock().tick(10 * MIN);

    // The notification (native handler, wall-clock) would now show 10 min
    // remaining. But the in-app value is still the stale pre-background value.
    const trueRemaining = state.timer.duration - (Date.now() - state.timer.startedAt!);
    expect(trueRemaining).toBe(10 * MIN);
    expect(displayedRemaining(state)).toBe(20 * MIN); // <-- 10 min adrift = the bug
  });

  it('B: a single tick on resume reconciles the in-app countdown to wall-clock truth (the fix mechanism)', () => {
    let state = runningSession(5 * MIN);
    state = focusModeReducer(state, a.tick());
    expect(displayedRemaining(state)).toBe(20 * MIN);

    // 10 min in the background, no ticks...
    jasmine.clock().tick(10 * MIN);
    expect(displayedRemaining(state)).toBe(20 * MIN); // still stale

    // ...then resume fires exactly ONE tick (what the fix would dispatch).
    state = focusModeReducer(state, a.tick());

    expect(displayedRemaining(state)).toBe(10 * MIN); // snapped to truth
    expect(state.timer.isRunning).toBe(true);
  });

  it('C: resume tick completes the session cleanly if it elapsed past its duration while backgrounded', () => {
    // 24 min elapsed, 1 min remaining, last ticked at that point.
    let state = runningSession(24 * MIN);
    state = focusModeReducer(state, a.tick());
    expect(displayedRemaining(state)).toBe(1 * MIN);

    // Backgrounded for 10 min — the 25-min session ran out 9 min ago.
    jasmine.clock().tick(10 * MIN);

    // Resume tick: must stop the timer and report the true completed duration,
    // not keep ticking and not under-report.
    state = focusModeReducer(state, a.tick());

    expect(state.timer.isRunning).toBe(false);
    expect(state.timer.elapsed).toBe(34 * MIN);
    expect(state.lastCompletedDuration).toBe(34 * MIN);
  });

  // The resume re-sync effect (AndroidFocusModeEffects.resyncFocusTimerOnResume$)
  // dispatches `tick()` unconditionally. These two guarantee that is safe — the
  // reducer must NOT advance a paused or idle timer.
  it('D: a resume tick must NOT advance a PAUSED session (paused time is not lost)', () => {
    let state = runningSession(5 * MIN);
    state = focusModeReducer(state, a.tick());
    state = focusModeReducer(state, a.pauseFocusSession({ pausedTaskId: null }));
    expect(state.timer.isRunning).toBe(false);
    const remainingWhilePaused = displayedRemaining(state);

    // 10 min pass while paused-and-backgrounded, then resume fires a tick.
    jasmine.clock().tick(10 * MIN);
    const afterTick = focusModeReducer(state, a.tick());

    expect(afterTick).toBe(state); // untouched
    expect(displayedRemaining(afterTick)).toBe(remainingWhilePaused);
  });

  it('E: a resume tick is a no-op when no session is active (idle)', () => {
    jasmine.clock().tick(10 * MIN);
    expect(focusModeReducer(initialState, a.tick())).toBe(initialState);
  });
});
