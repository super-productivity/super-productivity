/**
 * Pure computation behind the iOS keyboard layout CSS variables
 * (`--visual-viewport-height`, `--keyboard-overlay-offset`, `--keyboard-height`).
 *
 * Kept out of IosKeyboardService so the ordering rules below — which are the
 * whole reason the add-task bar does or does not jump when the keyboard opens
 * (#9779) — are testable without a device.
 */

import { sanitizeIosKeyboardHeight } from './sanitize-ios-keyboard-height.util';

/**
 * Below this difference a smaller visual viewport is measurement noise (URL
 * bar, rounding), not the keyboard.
 */
export const VIEWPORT_RESIZE_EPSILON_PX = 1;

export interface IosKeyboardViewportInput {
  /** Sanitized keyboard height from the Capacitor plugin; 0 while hidden. */
  keyboardHeight: number;
  /** Viewport height captured before the keyboard appeared; 0 when unknown. */
  baseHeight: number;
  /** `window.visualViewport.height`, or undefined where unsupported. */
  visualViewportHeight?: number;
  /**
   * True once the show animation finished (`keyboardDidShow`) AND the web view
   * has either resized around the keyboard or had its grace period to do so —
   * see IosKeyboardService. Under `resize: 'native'` the resize trails didShow
   * by ~200ms, so didShow alone is not "settled" (#9779).
   */
  isKeyboardSettled: boolean;
  /** True when the plugin reported an implausible frame that had to be clamped (#8778). */
  isKeyboardFrameUnreliable: boolean;
}

export interface IosKeyboardViewportVars {
  visualViewportHeightPx: number;
  keyboardOverlayOffsetPx: number;
  /**
   * Replacement for `--keyboard-height` when the plugin's frame was bogus and
   * the measured obscured area is the better number; null leaves it untouched.
   */
  correctedKeyboardHeightPx: number | null;
}

/** True when the visual viewport has actually shrunk around the keyboard. */
export const isVisualViewportResizedForKeyboard = (
  isKeyboardVisible: boolean,
  baseHeight: number,
  visualViewportHeight?: number,
): visualViewportHeight is number =>
  isKeyboardVisible &&
  visualViewportHeight !== undefined &&
  visualViewportHeight < baseHeight - VIEWPORT_RESIZE_EPSILON_PX;

export const computeIosKeyboardViewportVars = ({
  keyboardHeight,
  baseHeight,
  visualViewportHeight,
  isKeyboardSettled,
  isKeyboardFrameUnreliable,
}: IosKeyboardViewportInput): IosKeyboardViewportVars => {
  const isKeyboardVisible = keyboardHeight > 0;
  const isMeasured = isVisualViewportResizedForKeyboard(
    isKeyboardVisible,
    baseHeight,
    visualViewportHeight,
  );

  if (!isKeyboardVisible) {
    return {
      visualViewportHeightPx: Math.max(0, visualViewportHeight ?? baseHeight),
      keyboardOverlayOffsetPx: 0,
      correctedKeyboardHeightPx: null,
    };
  }

  if (isMeasured) {
    return {
      visualViewportHeightPx: Math.max(0, visualViewportHeight),
      // The web view already shrank around the keyboard, so a fixed element at
      // `bottom: 0` sits above it — offsetting again would move it twice (#8778).
      keyboardOverlayOffsetPx: 0,
      // Settled only: the obscured area changes on every frame of the shrink, so
      // correcting mid-animation would be a write (and a notification) per frame
      // for a value nobody needs before the keyboard is up (#9779). The clamped
      // frame from `keyboardWillShow` holds until then, which is the pre-#8778
      // behaviour and already safe.
      correctedKeyboardHeightPx:
        isKeyboardFrameUnreliable && isKeyboardSettled
          ? sanitizeIosKeyboardHeight(baseHeight - visualViewportHeight, baseHeight)
          : null,
    };
  }

  // Keyboard up, viewport not (yet) shrunk. Under Capacitor's `resize: 'native'`
  // — the mode this app configures — the shrink is still on its way, and acting
  // on the plugin's frame here is a prediction: it lifts the fixed add-task bar
  // by a whole keyboard height and shrinks the app shell, only for the measured
  // resize a few frames later to undo both. With `transition: bottom` on the bar
  // that prediction is what the user sees as the bar flying up and dropping back
  // (#9779). So hold the measured values until the keyboard has settled; only a
  // keyboard that has settled without resizing the web view (non-resizing iOS
  // modes) gets the frame-derived offset it needs.
  if (!isKeyboardSettled) {
    return {
      visualViewportHeightPx: Math.max(0, visualViewportHeight ?? baseHeight),
      keyboardOverlayOffsetPx: 0,
      correctedKeyboardHeightPx: null,
    };
  }

  return {
    visualViewportHeightPx: Math.max(0, baseHeight - keyboardHeight),
    keyboardOverlayOffsetPx: keyboardHeight,
    correctedKeyboardHeightPx: null,
  };
};
