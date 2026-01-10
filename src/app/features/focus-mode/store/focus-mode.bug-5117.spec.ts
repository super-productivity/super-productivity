/**
 * Bug reproduction test for GitHub issue #5117
 * https://github.com/super-productivity/super-productivity/issues/5117
 *
 * Bug: Flowtime focus mode stops counting up at 25:00 minutes (or whatever
 * the Countdown duration was set to).
 *
 * User reproduction steps:
 * 1. Tap start focus session
 * 2. Open the Countdown tab
 * 3. Set countdown to 5 minutes (but do not start the session)
 * 4. Open the Flowtime tab
 * 5. Start focus session counting up from 0
 *
 * Expected: Timer counts indefinitely
 * Actual: Timer stops at 5 minutes (the Countdown value)
 */

import { FocusModeMode, FocusModeState } from '../focus-mode.model';
import * as actions from './focus-mode.actions';
import { focusModeReducer, initialState } from './focus-mode.reducer';

describe('Bug #5117: Flowtime timer stops at Countdown duration', () => {
  let initialTime: number;

  beforeEach(() => {
    initialTime = Date.now();
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date(initialTime));
  });

  afterEach(() => {
    jasmine.clock().uninstall();
  });

  it('should reproduce the bug: Flowtime timer stops at previously set Countdown duration', () => {
    // Step 1: Start in default state (could be any mode)
    let state = { ...initialState };

    // Step 2: Switch to Countdown mode
    state = focusModeReducer(
      state,
      actions.setFocusModeMode({ mode: FocusModeMode.Countdown }),
    );
    expect(state.mode).toBe(FocusModeMode.Countdown);

    // Step 3: Set countdown duration to 5 minutes (but do NOT start session)
    const fiveMinutes = 5 * 60 * 1000;
    state = focusModeReducer(
      state,
      actions.setFocusSessionDuration({ focusSessionDuration: fiveMinutes }),
    );
    expect(state.timer.duration).toBe(fiveMinutes);
    expect(state.timer.purpose).toBeNull(); // Session not started

    // Step 4: Switch to Flowtime mode
    state = focusModeReducer(
      state,
      actions.setFocusModeMode({ mode: FocusModeMode.Flowtime }),
    );
    expect(state.mode).toBe(FocusModeMode.Flowtime);

    // NOTE: At this point, state.timer.duration is still 5 minutes!
    // This is the bug - the duration was not reset when switching to Flowtime
    console.log('Duration after switching to Flowtime:', state.timer.duration);

    // Step 5: Start Flowtime session with duration: 0
    state = focusModeReducer(state, actions.startFocusSession({ duration: 0 }));
    expect(state.timer.isRunning).toBe(true);
    expect(state.timer.purpose).toBe('work');
    expect(state.timer.duration).toBe(0); // Should be 0 for Flowtime

    // Simulate 6 minutes passing (past the 5-minute Countdown value)
    const sixMinutes = 6 * 60 * 1000;
    jasmine.clock().tick(sixMinutes);

    // Process tick
    state = focusModeReducer(state, actions.tick());

    // Timer should still be running at 6 minutes
    expect(state.timer.isRunning).toBe(true);
    expect(state.timer.elapsed).toBeGreaterThanOrEqual(sixMinutes);
    expect(state.timer.purpose).toBe('work');
  });

  it('should verify that startFocusSession creates a new timer (potential fix confirmation)', () => {
    // This test verifies that startFocusSession({ duration: 0 }) creates a fresh timer
    // If this passes, the bug is likely NOT in the reducer but in what calls startFocusSession

    let state = { ...initialState };

    // Set up a "contaminated" state with Countdown duration
    state = focusModeReducer(
      state,
      actions.setFocusModeMode({ mode: FocusModeMode.Countdown }),
    );
    state = focusModeReducer(
      state,
      actions.setFocusSessionDuration({ focusSessionDuration: 5 * 60 * 1000 }),
    );

    // Switch to Flowtime
    state = focusModeReducer(
      state,
      actions.setFocusModeMode({ mode: FocusModeMode.Flowtime }),
    );

    // The timer.duration is still 5 minutes at this point (before starting session)
    const durationBeforeStart = state.timer.duration;
    console.log('Duration before startFocusSession:', durationBeforeStart);

    // Start session with explicit duration: 0
    state = focusModeReducer(state, actions.startFocusSession({ duration: 0 }));

    // Verify new timer was created with duration: 0
    expect(state.timer.duration).toBe(0);
    expect(state.timer.isRunning).toBe(true);

    // Run for 10 minutes
    jasmine.clock().tick(10 * 60 * 1000);
    state = focusModeReducer(state, actions.tick());

    expect(state.timer.isRunning).toBe(true);
    expect(state.timer.elapsed).toBeGreaterThanOrEqual(10 * 60 * 1000);
  });

  it('should test what happens if startFocusSession is called WITHOUT duration parameter', () => {
    // This tests if the bug could be caused by calling startFocusSession({})
    // instead of startFocusSession({ duration: 0 })

    let state = { ...initialState };

    // Set up Countdown duration
    state = focusModeReducer(
      state,
      actions.setFocusModeMode({ mode: FocusModeMode.Countdown }),
    );
    state = focusModeReducer(
      state,
      actions.setFocusSessionDuration({ focusSessionDuration: 5 * 60 * 1000 }),
    );

    // Switch to Flowtime
    state = focusModeReducer(
      state,
      actions.setFocusModeMode({ mode: FocusModeMode.Flowtime }),
    );

    // Start session WITHOUT passing duration (should use default 25 min)
    state = focusModeReducer(state, actions.startFocusSession({}));

    // What duration does the timer have?
    console.log(
      'Duration when startFocusSession called without duration:',
      state.timer.duration,
    );

    // According to the reducer: duration ?? FOCUS_MODE_DEFAULTS.SESSION_DURATION
    // If duration is undefined, it uses 25 minutes default!
    expect(state.timer.duration).toBe(25 * 60 * 1000); // This would be the bug!

    // Run for 26 minutes
    jasmine.clock().tick(26 * 60 * 1000);
    state = focusModeReducer(state, actions.tick());

    // Timer would stop at 25 minutes if duration wasn't 0
    console.log('Timer running after 26 min:', state.timer.isRunning);
    console.log('Timer elapsed:', state.timer.elapsed);
  });

  it('should test effect-driven session start (simulating syncTrackingStartToSession$)', () => {
    // The effects use strategy.initialSessionDuration to start sessions
    // FlowtimeStrategy.initialSessionDuration is 0, so this should work
    // But what if the effect uses the wrong strategy?

    let state = { ...initialState };

    // Simulate: mode is Flowtime but duration was set from Countdown earlier
    state = {
      ...state,
      mode: FocusModeMode.Flowtime,
      timer: {
        ...state.timer,
        duration: 5 * 60 * 1000, // "contaminated" from Countdown
      },
    };

    // Start session with duration: 0 (as FlowtimeStrategy would provide)
    state = focusModeReducer(state, actions.startFocusSession({ duration: 0 }));

    expect(state.timer.duration).toBe(0);

    // Run for 10 minutes
    jasmine.clock().tick(10 * 60 * 1000);
    state = focusModeReducer(state, actions.tick());

    expect(state.timer.isRunning).toBe(true);
  });

  describe('Component simulation - exact user flow', () => {
    /**
     * This test simulates the exact behavior of FocusModeMainComponent
     * to identify if there's a race condition or timing issue
     */
    it('should simulate component startSession() behavior', () => {
      let state = { ...initialState };

      // Simulate component state
      let displayDuration = 25 * 60 * 1000; // Default

      // Helper: simulate component effect that sets displayDuration
      const updateDisplayDuration = (focusModeState: FocusModeState): void => {
        const duration = focusModeState.timer.duration; // sessionDuration signal
        const mode = focusModeState.mode;

        if (mode === FocusModeMode.Flowtime) {
          displayDuration = 0;
          return;
        }

        if (duration > 0) {
          displayDuration = duration;
          return;
        }

        if (mode === FocusModeMode.Countdown) {
          displayDuration = 5 * 60 * 1000; // Simulated stored value
        }
      };

      // Step 1: Initial state (assume Countdown mode)
      state = focusModeReducer(
        state,
        actions.setFocusModeMode({ mode: FocusModeMode.Countdown }),
      );
      updateDisplayDuration(state);
      console.log('Step 1 - Countdown mode, displayDuration:', displayDuration);

      // Step 2: User sets duration to 5 minutes via slider
      state = focusModeReducer(
        state,
        actions.setFocusSessionDuration({ focusSessionDuration: 5 * 60 * 1000 }),
      );
      updateDisplayDuration(state);
      console.log('Step 2 - Set 5 min, displayDuration:', displayDuration);
      console.log('Step 2 - timer.duration:', state.timer.duration);

      // Step 3: User switches to Flowtime
      state = focusModeReducer(
        state,
        actions.setFocusModeMode({ mode: FocusModeMode.Flowtime }),
      );
      // IMPORTANT: Does the effect run immediately? In Angular, it should.
      updateDisplayDuration(state);
      console.log('Step 3 - Flowtime mode, displayDuration:', displayDuration);
      console.log('Step 3 - timer.duration:', state.timer.duration);
      console.log('Step 3 - mode:', state.mode);

      // Step 4: User clicks play button - simulating startSession()
      const modeAtClickTime = state.mode;
      const durationToDispatch =
        modeAtClickTime === FocusModeMode.Flowtime ? 0 : displayDuration;

      console.log('Step 4 - modeAtClickTime:', modeAtClickTime);
      console.log('Step 4 - durationToDispatch:', durationToDispatch);

      state = focusModeReducer(
        state,
        actions.startFocusSession({ duration: durationToDispatch }),
      );

      console.log('After startFocusSession:');
      console.log('- timer.duration:', state.timer.duration);
      console.log('- timer.isRunning:', state.timer.isRunning);

      // Verify the session was started correctly
      expect(durationToDispatch).toBe(0);
      expect(state.timer.duration).toBe(0);

      // Run for 6 minutes
      jasmine.clock().tick(6 * 60 * 1000);
      state = focusModeReducer(state, actions.tick());

      console.log('After 6 minutes:');
      console.log('- timer.elapsed:', state.timer.elapsed);
      console.log('- timer.isRunning:', state.timer.isRunning);

      expect(state.timer.isRunning).toBe(true);
      expect(state.timer.elapsed).toBeGreaterThanOrEqual(6 * 60 * 1000);
    });

    /**
     * Test the scenario where timer.duration from Countdown bleeds into tick
     * BEFORE startFocusSession resets it - a potential race condition
     */
    it('should test hypothetical race condition: tick before startFocusSession', () => {
      let state = { ...initialState };

      // Set up Countdown with 5 min duration
      state = focusModeReducer(
        state,
        actions.setFocusModeMode({ mode: FocusModeMode.Countdown }),
      );
      state = focusModeReducer(
        state,
        actions.setFocusSessionDuration({ focusSessionDuration: 5 * 60 * 1000 }),
      );

      // Switch to Flowtime
      state = focusModeReducer(
        state,
        actions.setFocusModeMode({ mode: FocusModeMode.Flowtime }),
      );

      // At this point:
      // - mode = Flowtime
      // - timer.duration = 5 minutes (from Countdown!)
      // - timer.isRunning = false
      // - timer.purpose = null

      console.log('=== Before session starts ===');
      console.log('mode:', state.mode);
      console.log('timer.duration:', state.timer.duration);
      console.log('timer.isRunning:', state.timer.isRunning);
      console.log('timer.purpose:', state.timer.purpose);

      // The timer.duration is "contaminated" but since isRunning is false
      // and purpose is null, tick() should have no effect
      state = focusModeReducer(state, actions.tick());

      // tick should not affect idle timer
      expect(state.timer.isRunning).toBe(false);

      // Now start the session properly
      state = focusModeReducer(state, actions.startFocusSession({ duration: 0 }));

      expect(state.timer.duration).toBe(0);
      expect(state.timer.isRunning).toBe(true);

      // This is the correct state - duration is reset by startFocusSession
    });
  });

  describe('Selector behavior analysis', () => {
    it('should analyze selector outputs during bug scenario', () => {
      // Build state that simulates the bug scenario
      let state = { ...initialState };

      // Set Countdown mode and duration
      state = focusModeReducer(
        state,
        actions.setFocusModeMode({ mode: FocusModeMode.Countdown }),
      );
      state = focusModeReducer(
        state,
        actions.setFocusSessionDuration({ focusSessionDuration: 5 * 60 * 1000 }),
      );

      // Switch to Flowtime (duration not reset)
      state = focusModeReducer(
        state,
        actions.setFocusModeMode({ mode: FocusModeMode.Flowtime }),
      );

      console.log('=== BEFORE SESSION START ===');
      console.log('state.timer.duration:', state.timer.duration);
      console.log('state.mode:', state.mode);

      // Simulate what selectors would return
      const focusModeState: FocusModeState = state;
      const timer = focusModeState.timer;
      const mode = focusModeState.mode;

      // selectTimeElapsed
      const timeElapsed = timer.elapsed;
      console.log('selectTimeElapsed:', timeElapsed);

      // selectTimeDuration
      const timeDuration = timer.duration;
      console.log('selectTimeDuration:', timeDuration);

      // selectTimeRemaining = Math.max(0, duration - elapsed)
      const timeRemaining = Math.max(0, timeDuration - timeElapsed);
      console.log('selectTimeRemaining:', timeRemaining);

      // isCountTimeDown = mode !== FocusModeMode.Flowtime
      const isCountTimeDown = mode !== FocusModeMode.Flowtime;
      console.log('isCountTimeDown:', isCountTimeDown);

      // What would be displayed?
      const displayedTime = isCountTimeDown ? timeRemaining : timeElapsed;
      console.log('displayedTime:', displayedTime);

      // At this point, before session starts, duration is 5 min
      // But isCountTimeDown is false (mode is Flowtime)
      // So it would display timeElapsed (0)
      expect(isCountTimeDown).toBe(false);

      // Now start the session with duration: 0
      state = focusModeReducer(state, actions.startFocusSession({ duration: 0 }));

      console.log('=== AFTER SESSION START ===');
      console.log('state.timer.duration:', state.timer.duration);
      console.log('state.timer.isRunning:', state.timer.isRunning);

      // After session starts, duration should be 0
      expect(state.timer.duration).toBe(0);

      // Run for 6 minutes
      jasmine.clock().tick(6 * 60 * 1000);
      state = focusModeReducer(state, actions.tick());

      console.log('=== AFTER 6 MINUTES ===');
      console.log('state.timer.elapsed:', state.timer.elapsed);
      console.log('state.timer.duration:', state.timer.duration);
      console.log('state.timer.isRunning:', state.timer.isRunning);

      // Check selector outputs
      const elapsedAfter = state.timer.elapsed;
      const durationAfter = state.timer.duration;
      const remainingAfter = Math.max(0, durationAfter - elapsedAfter);
      const isCountDownAfter = state.mode !== FocusModeMode.Flowtime;
      const displayedAfter = isCountDownAfter ? remainingAfter : elapsedAfter;

      console.log('elapsedAfter:', elapsedAfter);
      console.log('durationAfter:', durationAfter);
      console.log('remainingAfter:', remainingAfter);
      console.log('isCountDownAfter:', isCountDownAfter);
      console.log('displayedAfter:', displayedAfter);

      // Timer should still be running
      expect(state.timer.isRunning).toBe(true);
      expect(elapsedAfter).toBeGreaterThanOrEqual(6 * 60 * 1000);
    });

    it('should test what happens if timer.duration was NOT reset by startFocusSession', () => {
      // This simulates a hypothetical bug where duration isn't reset
      let state: FocusModeState = {
        ...initialState,
        mode: FocusModeMode.Flowtime,
        timer: {
          isRunning: true,
          startedAt: Date.now(),
          elapsed: 0,
          duration: 5 * 60 * 1000, // Bug: duration is 5 min instead of 0
          purpose: 'work',
        },
      };

      console.log('=== SIMULATED BUG STATE ===');
      console.log('timer.duration:', state.timer.duration);
      console.log('mode:', state.mode);

      // Run for 5 minutes
      jasmine.clock().tick(5 * 60 * 1000);
      state = focusModeReducer(state, actions.tick());

      console.log('=== AFTER 5 MINUTES ===');
      console.log('timer.elapsed:', state.timer.elapsed);
      console.log('timer.isRunning:', state.timer.isRunning);

      // With the bug, timer would stop because elapsed >= duration
      // THIS IS THE BUG!
      if (!state.timer.isRunning) {
        console.log('BUG CONFIRMED: Timer stopped at duration limit!');
      }

      // Check what time would be displayed
      const isCountDown = state.mode !== FocusModeMode.Flowtime;
      const displayed = isCountDown
        ? Math.max(0, state.timer.duration - state.timer.elapsed)
        : state.timer.elapsed;

      console.log('isCountDown:', isCountDown);
      console.log('displayed time:', displayed);

      // With buggy state:
      // - isCountDown = false (Flowtime)
      // - displayed = elapsed = ~5 minutes
      // - timer.isRunning = false
      // So display would show ~5:00 and freeze!
    });
  });
});
