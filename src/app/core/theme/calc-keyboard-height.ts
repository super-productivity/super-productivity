export interface KeyboardHeightInput {
  /** Current layout viewport height (window.innerHeight), CSS px. */
  innerHeight: number;
  /** window.visualViewport.height, CSS px, or null when the API is absent. */
  visualViewportHeight: number | null;
  /** Native-measured keyboard height (CSS px), 0 when closed. */
  nativeKeyboardHeight: number;
  /** window.innerHeight captured while the keyboard was last closed, CSS px. */
  baseInnerHeight: number;
}

/**
 * Resolve the on-screen keyboard height (CSS px) from two independent signals,
 * whichever reports coverage:
 *
 * - `obscured` — the part of the layout viewport hidden by the IME according to
 *   the Visual Viewport API. Correct on modern WebViews; reads 0 on e.g.
 *   Android 10 where the IME does not shrink the visual viewport.
 * - `nativeCovered` — the natively measured keyboard height, minus however much
 *   the layout viewport already shrank (`layoutShrink`). The subtraction keeps
 *   devices where `adjustResize` genuinely shrinks the viewport from being
 *   pushed up by a double offset (the fixed bar already sits above the IME).
 *
 * NOTE: `nativeKeyboardHeight` (screenHeight − visibleFrame.bottom on the native
 * side) includes the navigation-bar inset, not just the IME. The caller's
 * threshold (~100px, larger than a typical 24–48px navbar) is what discards that
 * phantom offset when the keyboard is closed — do not lower it without
 * subtracting the navbar inset here.
 */
export const calcKeyboardHeight = ({
  innerHeight,
  visualViewportHeight,
  nativeKeyboardHeight,
  baseInnerHeight,
}: KeyboardHeightInput): number => {
  const obscured = visualViewportHeight !== null ? innerHeight - visualViewportHeight : 0;
  const layoutShrink = Math.max(0, baseInnerHeight - innerHeight);
  const nativeCovered = Math.max(0, nativeKeyboardHeight - layoutShrink);
  return Math.max(obscured, nativeCovered);
};
