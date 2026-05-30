import { parseNativeFocusModeData } from './android-focus-mode.effects';

// The effects themselves are conditionally created behind IS_ANDROID_WEB_VIEW
// (false under Karma), so we test the exported pure helper directly and
// re-implement the cold-start decision branch inline — mirroring
// android-foreground-tracking.effects.spec.ts.

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
