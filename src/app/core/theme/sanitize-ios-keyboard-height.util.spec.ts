import {
  MAX_IOS_KEYBOARD_HEIGHT_FRACTION,
  sanitizeIosKeyboardHeight,
} from './sanitize-ios-keyboard-height.util';

describe('sanitizeIosKeyboardHeight', () => {
  // Typical iPhone portrait viewport.
  const SCREEN = 812;
  const CEILING = SCREEN * MAX_IOS_KEYBOARD_HEIGHT_FRACTION;

  it('passes a normal native keyboard height through unchanged', () => {
    // Native iOS keyboard ~300px sits well under the ceiling.
    expect(sanitizeIosKeyboardHeight(300, SCREEN)).toBe(300);
  });

  it('passes a tall third-party keyboard (with candidate bar) through unchanged', () => {
    // ~55% of screen — still plausible, must not be clamped.
    expect(sanitizeIosKeyboardHeight(440, SCREEN)).toBe(440);
  });

  it('clamps a bogus near-full-screen height to the ceiling (Sogou / #8778)', () => {
    // The reported frame that flings the add-task bar to the top of the screen.
    expect(sanitizeIosKeyboardHeight(780, SCREEN)).toBe(CEILING);
  });

  it('clamps a height exactly equal to the screen height', () => {
    expect(sanitizeIosKeyboardHeight(SCREEN, SCREEN)).toBe(CEILING);
  });

  it('floors a negative reported height to 0', () => {
    expect(sanitizeIosKeyboardHeight(-10, SCREEN)).toBe(0);
  });

  it('floors NaN to 0', () => {
    expect(sanitizeIosKeyboardHeight(NaN, SCREEN)).toBe(0);
  });

  it('only floors (no ceiling) when the reference height is unknown', () => {
    // No baseline to judge plausibility → pass the positive value through.
    expect(sanitizeIosKeyboardHeight(780, 0)).toBe(780);
    expect(sanitizeIosKeyboardHeight(-5, 0)).toBe(0);
  });

  it('respects a custom max fraction', () => {
    expect(sanitizeIosKeyboardHeight(780, SCREEN, 0.5)).toBe(SCREEN * 0.5);
  });
});
