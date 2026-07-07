/**
 * Largest share of the pre-keyboard viewport height we accept as a real
 * on-screen keyboard height.
 *
 * iOS reports a bogus, near-full-screen keyboard frame in `keyboardWillShow`
 * for some third-party input methods (e.g. Sogou on iOS 18 — issue #8778).
 * Written verbatim to `--keyboard-height`, that value flings the fixed
 * add-task bar (`bottom: calc(var(--keyboard-height) + …)`) to the top of the
 * screen. A real keyboard — even a tall third-party one with a candidate /
 * toolbar bar, in portrait or landscape — stays comfortably under this
 * fraction, so anything above it is the known bad frame.
 *
 * shortcut: a fixed fraction, not a measurement. A `visualViewport`-derived
 * obscured-area reading would be more precise, but is unreliable under
 * Capacitor's `resize: 'native'` (the whole web view resizes, so the visual
 * viewport shrinks in lock-step and reports ~0 obscured). If real keyboards
 * ever approach this ceiling, revisit with a measured value.
 */
export const MAX_IOS_KEYBOARD_HEIGHT_FRACTION = 0.6;

/**
 * Clamp the iOS keyboard height reported by the Capacitor Keyboard plugin to a
 * physically plausible range before it drives layout CSS variables.
 *
 * `referenceHeight` is the viewport height captured *before* the keyboard
 * appeared (the full usable height). The result is never negative and never
 * exceeds `referenceHeight * maxFraction`. A non-positive or unknown reference
 * height disables the ceiling (we only floor at 0): without a baseline we
 * cannot judge plausibility, and clamping against a bad baseline would be
 * worse than passing the value through.
 */
export const sanitizeIosKeyboardHeight = (
  reportedHeight: number,
  referenceHeight: number,
  maxFraction = MAX_IOS_KEYBOARD_HEIGHT_FRACTION,
): number => {
  const floored = reportedHeight > 0 ? reportedHeight : 0;
  if (referenceHeight > 0) {
    return Math.min(floored, referenceHeight * maxFraction);
  }
  return floored;
};
