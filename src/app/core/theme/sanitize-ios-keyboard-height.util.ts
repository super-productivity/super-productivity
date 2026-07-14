/**
 * Largest share of the current layout viewport height we accept as a real
 * on-screen keyboard height.
 *
 * iOS reports a bogus, near-full-screen keyboard frame in `keyboardWillShow`
 * for some third-party input methods (e.g. Sogou on iOS 18 — issue #8778).
 * Used as a layout offset, that value can fling fixed surfaces to the top of
 * the screen. A real keyboard — even a tall third-party one with a candidate /
 * toolbar bar, in portrait or landscape — stays comfortably under this
 * fraction, so anything above it is the known bad frame.
 *
 * This is only a short-lived fallback ceiling. Once VisualViewport reports the
 * visible area, the iOS viewport resolver uses that physically bounded browser
 * measurement without applying this heuristic.
 */
export const MAX_IOS_KEYBOARD_HEIGHT_FRACTION = 0.6;

/**
 * Clamp the iOS keyboard height reported by the Capacitor Keyboard plugin to a
 * physically plausible range before it drives layout CSS variables.
 *
 * `referenceHeight` is the current non-resized layout viewport height. The result
 * is never negative and never
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
