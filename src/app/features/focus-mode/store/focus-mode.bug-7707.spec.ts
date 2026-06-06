/**
 * Reducer test for GitHub issue #7707
 * https://github.com/super-productivity/super-productivity/issues/7707
 *
 * Bug: In focus mode, pressing "-" to decrease the timer down to 0 leaves the
 * timer ticking instead of completing. Same outcome when starting a non-Flowtime
 * session with duration 0.
 *
 * Root cause: the `tick` reducer guarded completion with `duration > 0`, which
 * was intended to keep Flowtime running forever but also silently disabled
 * completion for any Pomodoro/Countdown session whose duration had been
 * adjusted (or started at) 0. The fix narrows that exception to Flowtime
 * *work* sessions, so Flowtime breaks (which run with a real positive duration)
 * still auto-complete.
 */

import { focusModeReducer, initialState } from './focus-mode.reducer';
import * as a from './focus-mode.actions';
import { FocusModeMode } from '../focus-mode.model';

describe('FocusMode Bug #7707: timer keeps ticking after duration adjusted to 0', () => {
  beforeEach(() => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date(2023, 0, 1, 10, 0, 0));
    localStorage.clear();
  });

  afterEach(() => {
    jasmine.clock().uninstall();
  });

  it('should complete the work session when "-" drives duration to 0 mid-session', () => {
    // Session started 1 min ago; user has been focusing for that minute.
    const startedAt = Date.now() - 60_000;
    const state = {
      ...initialState,
      mode: FocusModeMode.Pomodoro,
      timer: {
        isRunning: true,
        startedAt,
        elapsed: 60_000,
        duration: 120_000, // 2 min session, 1 min remaining
        purpose: 'work' as const,
      },
    };

    // User repeatedly presses "-" until duration is clamped to 0.
    const afterAdjust = focusModeReducer(
      state,
      a.adjustRemainingTime({ amountMs: -120_000 }),
    );
    expect(afterAdjust.timer.duration).toBe(0);
    expect(afterAdjust.timer.isRunning).toBe(true);

    // One tick later: timer completes and reports the real elapsed work time.
    jasmine.clock().tick(1000);
    const afterTick = focusModeReducer(afterAdjust, a.tick());

    expect(afterTick.timer.isRunning).toBe(false);
    expect(afterTick.timer.elapsed).toBe(61_000);
    expect(afterTick.lastCompletedDuration).toBe(61_000);
  });

  it('should complete a Countdown session started with duration 0', () => {
    const startedAt = Date.now();
    const state = {
      ...initialState,
      mode: FocusModeMode.Countdown,
      timer: {
        isRunning: true,
        startedAt,
        elapsed: 0,
        duration: 0,
        purpose: 'work' as const,
      },
    };

    jasmine.clock().tick(1000);
    const result = focusModeReducer(state, a.tick());

    expect(result.timer.isRunning).toBe(false);
    expect(result.lastCompletedDuration).toBe(1000);
  });

  it('should still run forever in Flowtime work session', () => {
    const startedAt = Date.now();
    const state = {
      ...initialState,
      mode: FocusModeMode.Flowtime,
      timer: {
        isRunning: true,
        startedAt,
        elapsed: 0,
        duration: 0,
        purpose: 'work' as const,
      },
    };

    jasmine.clock().tick(3_600_000); // 1h
    const result = focusModeReducer(state, a.tick());

    expect(result.timer.isRunning).toBe(true);
    expect(result.timer.elapsed).toBe(3_600_000);
  });

  it('should still auto-complete a Flowtime break when its duration elapses', () => {
    // Flowtime breaks are started via offerFlowtimeBreak → startBreak with a
    // real positive duration. They must auto-stop on tick even though
    // state.mode === Flowtime.
    const breakDuration = 5 * 60 * 1000; // 5 min
    const startedAt = Date.now() - breakDuration;
    const state = {
      ...initialState,
      mode: FocusModeMode.Flowtime,
      timer: {
        isRunning: true,
        startedAt,
        elapsed: breakDuration,
        duration: breakDuration,
        purpose: 'break' as const,
        isLongBreak: false,
      },
    };

    jasmine.clock().tick(1000);
    const result = focusModeReducer(state, a.tick());

    expect(result.timer.isRunning).toBe(false);
    expect(result.timer.purpose).toBe('break');
  });
});
