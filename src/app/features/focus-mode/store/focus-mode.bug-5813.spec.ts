/**
 * Integration tests for GitHub issue #5813
 * https://github.com/super-productivity/super-productivity/issues/5813
 *
 * Bug: New Pomodoro Timer doesn't work if you change the time tracking interval
 *
 * Root cause: FocusModeService was using GlobalTrackingIntervalService.tick$
 * which emits at the configured trackingInterval (up to 100 seconds).
 * When users set a high tracking interval to reduce disk writes,
 * the Pomodoro timer would only update every N seconds instead of every second.
 *
 * Fix: FocusModeService now uses its own interval(1000) independent of
 * the global tracking interval.
 *
 * These tests verify:
 * 1. The reducer correctly calculates elapsed time based on Date.now() - startedAt
 * 2. Session completion is detected regardless of tick frequency
 * 3. Timer updates work correctly with various tick intervals
 */

import { FocusModeMode } from '../focus-mode.model';
import * as actions from './focus-mode.actions';
import { focusModeReducer, initialState } from './focus-mode.reducer';

describe('FocusMode Bug #5813: Timer works with high tracking interval', () => {
  let initialTime: number;

  beforeEach(() => {
    initialTime = Date.now();
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date(initialTime));
  });

  afterEach(() => {
    jasmine.clock().uninstall();
  });

  describe('Reducer: Timer elapsed calculation', () => {
    it('should calculate elapsed time correctly based on Date.now() - startedAt', () => {
      // Start a Pomodoro session
      let state = focusModeReducer(
        { ...initialState, mode: FocusModeMode.Pomodoro },
        actions.startFocusSession({ duration: 25 * 60 * 1000 }),
      );

      expect(state.timer.isRunning).toBe(true);
      expect(state.timer.startedAt).toBe(initialTime);
      expect(state.timer.elapsed).toBe(0);

      // Simulate 5 seconds passing
      jasmine.clock().tick(5000);
      state = focusModeReducer(state, actions.tick());

      // Elapsed should be ~5000ms (calculated from Date.now() - startedAt)
      expect(state.timer.elapsed).toBeGreaterThanOrEqual(5000);
      expect(state.timer.isRunning).toBe(true);
    });

    it('should handle infrequent ticks (simulating high tracking interval)', () => {
      // Start a 1-minute Pomodoro session
      const oneMinute = 60 * 1000;
      let state = focusModeReducer(
        { ...initialState, mode: FocusModeMode.Pomodoro },
        actions.startFocusSession({ duration: oneMinute }),
      );

      // Simulate 30 seconds passing with NO ticks (like high tracking interval)
      jasmine.clock().tick(30000);

      // Now dispatch a single tick
      state = focusModeReducer(state, actions.tick());

      // Even with just one tick, elapsed should correctly show ~30 seconds
      expect(state.timer.elapsed).toBeGreaterThanOrEqual(30000);
      expect(state.timer.isRunning).toBe(true);
    });

    it('should detect session completion even with infrequent ticks', () => {
      // Start a 10-second Pomodoro session (for faster testing)
      const tenSeconds = 10 * 1000;
      let state = focusModeReducer(
        { ...initialState, mode: FocusModeMode.Pomodoro },
        actions.startFocusSession({ duration: tenSeconds }),
      );

      expect(state.timer.isRunning).toBe(true);

      // Simulate 15 seconds passing with NO ticks (simulating 100s tracking interval)
      jasmine.clock().tick(15000);

      // Now dispatch a single tick - session should be detected as complete
      state = focusModeReducer(state, actions.tick());

      // Timer should stop when elapsed >= duration
      expect(state.timer.isRunning).toBe(false);
      expect(state.timer.elapsed).toBeGreaterThanOrEqual(tenSeconds);
      expect(state.lastCompletedDuration).toBeGreaterThanOrEqual(tenSeconds);
    });
  });

  describe('Scenario: User with 100s tracking interval', () => {
    it('should complete a 25-minute Pomodoro even if ticks are 100 seconds apart', () => {
      const twentyFiveMinutes = 25 * 60 * 1000;

      // Start a standard 25-minute Pomodoro session
      let state = focusModeReducer(
        { ...initialState, mode: FocusModeMode.Pomodoro },
        actions.startFocusSession({ duration: twentyFiveMinutes }),
      );

      expect(state.timer.isRunning).toBe(true);
      expect(state.timer.duration).toBe(twentyFiveMinutes);

      // Simulate ticks every 100 seconds (worst case: trackingInterval = 100000)
      const tickInterval = 100 * 1000; // 100 seconds
      let elapsedTime = 0;

      // Tick until we reach 25 minutes
      while (elapsedTime < twentyFiveMinutes) {
        jasmine.clock().tick(tickInterval);
        elapsedTime += tickInterval;
        state = focusModeReducer(state, actions.tick());

        if (elapsedTime < twentyFiveMinutes) {
          // Timer should still be running before completion
          expect(state.timer.isRunning).toBe(true);
          expect(state.timer.elapsed).toBeGreaterThanOrEqual(elapsedTime);
        }
      }

      // After 25+ minutes, session should be complete
      expect(state.timer.isRunning).toBe(false);
      expect(state.timer.elapsed).toBeGreaterThanOrEqual(twentyFiveMinutes);
      expect(state.lastCompletedDuration).toBeGreaterThanOrEqual(twentyFiveMinutes);
    });

    it('should show correct elapsed time at each tick regardless of interval', () => {
      const fiveMinutes = 5 * 60 * 1000;

      let state = focusModeReducer(
        { ...initialState, mode: FocusModeMode.Pomodoro },
        actions.startFocusSession({ duration: fiveMinutes }),
      );

      // First tick after 1 second (normal)
      jasmine.clock().tick(1000);
      state = focusModeReducer(state, actions.tick());
      expect(state.timer.elapsed).toBeGreaterThanOrEqual(1000);

      // Second tick after 100 seconds (high interval)
      jasmine.clock().tick(100000);
      state = focusModeReducer(state, actions.tick());
      expect(state.timer.elapsed).toBeGreaterThanOrEqual(101000);

      // Third tick after 1 second again
      jasmine.clock().tick(1000);
      state = focusModeReducer(state, actions.tick());
      expect(state.timer.elapsed).toBeGreaterThanOrEqual(102000);
    });
  });

  describe('Break timer with high tracking interval', () => {
    it('should complete break timer even with infrequent ticks', () => {
      const fiveMinuteBreak = 5 * 60 * 1000;

      // Start a break
      let state = focusModeReducer(
        initialState,
        actions.startBreak({ duration: fiveMinuteBreak, isLongBreak: false }),
      );

      expect(state.timer.isRunning).toBe(true);
      expect(state.timer.purpose).toBe('break');

      // Simulate 6 minutes passing with a single tick
      jasmine.clock().tick(6 * 60 * 1000);
      state = focusModeReducer(state, actions.tick());

      // Break should be detected as complete
      expect(state.timer.isRunning).toBe(false);
      expect(state.timer.elapsed).toBeGreaterThanOrEqual(fiveMinuteBreak);
    });
  });

  describe('Pause/Resume with high tracking interval', () => {
    it('should correctly resume timer after pause regardless of tracking interval', () => {
      const tenMinutes = 10 * 60 * 1000;

      // Start session
      let state = focusModeReducer(
        { ...initialState, mode: FocusModeMode.Pomodoro },
        actions.startFocusSession({ duration: tenMinutes }),
      );

      // Run for 2 minutes
      jasmine.clock().tick(2 * 60 * 1000);
      state = focusModeReducer(state, actions.tick());
      const elapsedBeforePause = state.timer.elapsed;

      expect(elapsedBeforePause).toBeGreaterThanOrEqual(2 * 60 * 1000);

      // Pause
      state = focusModeReducer(state, actions.pauseFocusSession({}));
      expect(state.timer.isRunning).toBe(false);

      // Time passes while paused (should not count)
      jasmine.clock().tick(5 * 60 * 1000);

      // Resume - should adjust startedAt to account for elapsed time
      state = focusModeReducer(state, actions.unPauseFocusSession());
      expect(state.timer.isRunning).toBe(true);

      // Tick after resume
      jasmine.clock().tick(1000);
      state = focusModeReducer(state, actions.tick());

      // Elapsed should be approximately elapsedBeforePause + 1 second
      // Not elapsedBeforePause + 5 minutes + 1 second
      const twoMinutes = 2 * 60 * 1000;
      expect(state.timer.elapsed).toBeLessThan(elapsedBeforePause + twoMinutes);
    });
  });
});
