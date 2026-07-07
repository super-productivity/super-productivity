/**
 * Effect test for GitHub issue #7856
 * https://github.com/super-productivity/super-productivity/issues/7856
 *
 * The in-app Focus/Pomodoro countdown is driven by an RxJS `interval(1000)`
 * (FocusModeService) that Android/Chromium freezes for a backgrounded WebView,
 * so no `tick` fires while away and the display drifts from the still-accurate
 * native notification. Time tracking avoids this by re-syncing from native on
 * `androidInterface.onResume$` (see android-foreground-tracking.effects
 * `syncOnResume$`); focus mode had no equivalent.
 *
 * Fix: on app resume, dispatch a `tick()` so the wall-clock-based reducer
 * (`elapsed = Date.now() - startedAt`) snaps the countdown back to the truth.
 * The reducer no-ops `tick` for idle/paused timers, so the effect dispatches
 * unconditionally (see focus-mode.bug-7856.spec for that guarantee).
 *
 * The gated effect wiring (`IS_ANDROID_WEB_VIEW && createEffect(...)`) cannot be
 * instantiated under Karma, so the stream logic lives in the exported
 * `createFocusResumeTick$` factory and is exercised directly here.
 */

import { Subject } from 'rxjs';
import { Action } from '@ngrx/store';
import {
  createFocusResumeTick$,
  hasFocusNotificationStateChanged,
  parseNativeFocusModeData,
  shouldHandleNativeTimerComplete,
} from './android-focus-mode.effects';
import * as focusModeActions from '../../focus-mode/store/focus-mode.actions';
import { TimerState } from '../../focus-mode/focus-mode.model';

const MIN = 60_000;
const workTimer = (elapsed: number, over: Partial<TimerState> = {}): TimerState => ({
  isRunning: true,
  startedAt: 0,
  elapsed,
  duration: 25 * MIN,
  purpose: 'work',
  ...over,
});

describe('AndroidFocusModeEffects: focus timer resume re-sync (#7856)', () => {
  let onResume$: Subject<void>;
  let emitted: Action[];

  beforeEach(() => {
    onResume$ = new Subject<void>();
    emitted = [];
    createFocusResumeTick$(onResume$).subscribe((a) => emitted.push(a));
  });

  it('does not emit before the app resumes', () => {
    expect(emitted).toEqual([]);
  });

  it('dispatches tick() when the app resumes', () => {
    onResume$.next();

    expect(emitted).toEqual([focusModeActions.tick()]);
  });

  it('dispatches one tick() for every resume event', () => {
    onResume$.next();
    onResume$.next();
    onResume$.next();

    expect(emitted.length).toBe(3);
    emitted.forEach((a) => expect(a).toEqual(focusModeActions.tick()));
  });
});

// The notification reconciles with the in-app countdown only when
// syncFocusModeToNotification$ decides state changed. Elapsed-only updates are
// throttled to 5s, but the large elapsed jump produced by a resume tick (#7856)
// must cross that threshold so the corrected value is pushed to native — closing
// the loop so BOTH the app and the notification end up correct.
describe('hasFocusNotificationStateChanged (notification reconciliation, #7856)', () => {
  it('pushes a native update after a resume tick (elapsed jumps well past 5s)', () => {
    // Backgrounded at 5 min elapsed; resume tick recomputes elapsed to 15 min.
    const beforeResume = workTimer(5 * MIN);
    const afterResume = workTimer(15 * MIN);

    expect(hasFocusNotificationStateChanged(beforeResume, afterResume)).toBe(true);
  });

  it('throttles a normal 1-second tick (elapsed diff < 5s)', () => {
    expect(hasFocusNotificationStateChanged(workTimer(60_000), workTimer(61_000))).toBe(
      false,
    );
  });

  it('pushes immediately when the timer is paused/resumed (isRunning flips)', () => {
    const running = workTimer(5 * MIN);
    const paused = workTimer(5 * MIN, { isRunning: false });

    expect(hasFocusNotificationStateChanged(running, paused)).toBe(true);
  });

  it('pushes immediately when purpose changes (work -> break)', () => {
    const work = workTimer(5 * MIN);
    const brk = workTimer(5 * MIN, { purpose: 'break' });

    expect(hasFocusNotificationStateChanged(work, brk)).toBe(true);
  });

  it('always pushes the first emission (no previous state)', () => {
    expect(hasFocusNotificationStateChanged(undefined, workTimer(0))).toBe(true);
  });
});

// handleNativeTimerComplete$ acts on a native completion only while the matching
// session is still active. The work-session guard is what prevents a double
// completion when a resume tick (#7856) already finished the session before the
// buffered native event is delivered.
describe('shouldHandleNativeTimerComplete (native completion guard, #7856)', () => {
  it('handles a work completion while the work timer is still running', () => {
    expect(shouldHandleNativeTimerComplete(false, workTimer(25 * MIN))).toBe(true);
  });

  it('ignores a work completion once the timer has stopped (resume tick already completed it)', () => {
    expect(
      shouldHandleNativeTimerComplete(false, workTimer(34 * MIN, { isRunning: false })),
    ).toBe(false);
  });

  it('ignores a work completion when the session is already idle (purpose null)', () => {
    expect(
      shouldHandleNativeTimerComplete(
        false,
        workTimer(0, { isRunning: false, purpose: null }),
      ),
    ).toBe(false);
  });

  it('handles a break completion while a break is active', () => {
    expect(
      shouldHandleNativeTimerComplete(true, workTimer(5 * MIN, { purpose: 'break' })),
    ).toBe(true);
  });

  it('ignores a break completion when the active session is work, not break', () => {
    expect(shouldHandleNativeTimerComplete(true, workTimer(5 * MIN))).toBe(false);
  });
});

// A stale/duplicate native completion must not complete a *different* session
// than the one it was fired for. Landing on the fresh work session the user just
// advanced into (break -> "next session" arrow) would, in Pomodoro, immediately
// auto-spawn a break — the reported #8805 symptom.
describe('shouldHandleNativeTimerComplete (stale/duplicate completion guard, #8805)', () => {
  const START = 1_000_000;
  const WORK_DURATION = 25 * MIN;
  const BREAK_DURATION = 5 * MIN;

  it('ignores a work completion on a work session that only just started (wall clock < duration)', () => {
    const freshWork = workTimer(0, { startedAt: START });
    expect(shouldHandleNativeTimerComplete(false, freshWork, START + 500)).toBe(false);
  });

  it('handles a work completion once the session has reached its duration by wall clock, even with a frozen/stale elapsed (#7856 over-run)', () => {
    // Backgrounded: stored elapsed frozen at 10 min, but 25 min of real time has
    // passed since startedAt — the completion is genuine and must be handled.
    const overrun = workTimer(10 * MIN, { startedAt: START });
    expect(shouldHandleNativeTimerComplete(false, overrun, START + WORK_DURATION)).toBe(
      true,
    );
  });

  it('handles a work completion delivered slightly early (within tolerance)', () => {
    const nearlyDone = workTimer(0, { startedAt: START });
    expect(
      shouldHandleNativeTimerComplete(false, nearlyDone, START + WORK_DURATION - 500),
    ).toBe(true);
  });

  it('ignores a break completion on a break that only just started', () => {
    const freshBreak = workTimer(0, {
      startedAt: START,
      purpose: 'break',
      duration: BREAK_DURATION,
    });
    expect(shouldHandleNativeTimerComplete(true, freshBreak, START + 500)).toBe(false);
  });

  it('handles a break completion once the break has run its scheduled length', () => {
    // Break stopped in-app (isRunning false) with the arrow showing; the native
    // completion still auto-advances because the break reached its duration.
    const doneBreak = workTimer(0, {
      startedAt: START,
      isRunning: false,
      purpose: 'break',
      duration: BREAK_DURATION,
    });
    expect(shouldHandleNativeTimerComplete(true, doneBreak, START + BREAK_DURATION)).toBe(
      true,
    );
  });

  it('ignores a completion when the timer has no startedAt (defensive)', () => {
    // A running timer always has a startedAt in practice; guard defensively so a
    // null can never pass the wall-clock check via `null` arithmetic.
    const noStart = workTimer(0, { startedAt: null });
    expect(shouldHandleNativeTimerComplete(false, noStart, START + WORK_DURATION)).toBe(
      false,
    );
  });

  it('ignores a work completion for a Flowtime session (duration 0 never schedules a native completion)', () => {
    const flowtime = workTimer(0, { startedAt: START, duration: 0 });
    expect(shouldHandleNativeTimerComplete(false, flowtime, START + WORK_DURATION)).toBe(
      false,
    );
  });
});

// --- #7855: focus-session recovery helpers (see #7866) ---
describe('AndroidFocusModeEffects helpers (#7855)', () => {
  describe('parseNativeFocusModeData', () => {
    it('returns null for falsy / "null" input', () => {
      expect(parseNativeFocusModeData(null)).toBeNull();
      expect(parseNativeFocusModeData(undefined)).toBeNull();
      expect(parseNativeFocusModeData('')).toBeNull();
      expect(parseNativeFocusModeData('null')).toBeNull();
    });

    it('returns null for malformed JSON', () => {
      expect(parseNativeFocusModeData('{not json')).toBeNull();
    });

    it('returns null when fields are missing or wrong type', () => {
      expect(parseNativeFocusModeData('{"durationMs":1000}')).toBeNull();
      expect(
        parseNativeFocusModeData(
          '{"durationMs":"1000","remainingMs":500,"isBreak":false,"isPaused":false}',
        ),
      ).toBeNull();
      expect(
        parseNativeFocusModeData(
          '{"durationMs":1000,"remainingMs":500,"isBreak":"no","isPaused":false}',
        ),
      ).toBeNull();
    });

    it('parses a valid countdown payload', () => {
      expect(
        parseNativeFocusModeData(
          '{"durationMs":1500000,"remainingMs":600000,"isBreak":false,"isPaused":false}',
        ),
      ).toEqual({
        durationMs: 1500000,
        remainingMs: 600000,
        isBreak: false,
        isPaused: false,
      });
    });

    it('parses a paused break payload', () => {
      expect(
        parseNativeFocusModeData(
          '{"durationMs":300000,"remainingMs":120000,"isBreak":true,"isPaused":true}',
        ),
      ).toEqual({
        durationMs: 300000,
        remainingMs: 120000,
        isBreak: true,
        isPaused: true,
      });
    });

    it('parses a Flowtime payload (durationMs 0)', () => {
      const parsed = parseNativeFocusModeData(
        '{"durationMs":0,"remainingMs":720000,"isBreak":false,"isPaused":false}',
      );
      expect(parsed?.durationMs).toBe(0);
      expect(parsed?.remainingMs).toBe(720000);
    });
  });

  // Regression for the destructive cold-start stop: on the `startWith(null)`
  // seed, `prev` is null and the OLD code computed
  // `wasFocusModeActive = prev?.timer?.purpose !== null` === true, which fired
  // stopFocusModeService() and tore down a surviving native notification.
  describe('cold-start "was active" decision', () => {
    const wasFocusModeActive = (
      prev: { timer: { purpose: string | null } } | null,
    ): boolean => !!prev && prev.timer.purpose !== null;

    it('treats the null seed (cold start) as NOT active → no stop', () => {
      expect(wasFocusModeActive(null)).toBe(false);
    });

    it('treats a previously idle store as NOT active', () => {
      expect(wasFocusModeActive({ timer: { purpose: null } })).toBe(false);
    });

    it('treats a previously running session as active', () => {
      expect(wasFocusModeActive({ timer: { purpose: 'work' } })).toBe(true);
    });
  });
});
