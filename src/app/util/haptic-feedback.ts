/**
 * Short tactile confirmation for touch gestures, Android app only.
 *
 * Goes through the native shell's `View.performHapticFeedback`, which follows
 * the system "touch feedback" setting, rather than `navigator.vibrate`, which
 * would ignore it. Reads `window` lazily: online-only mode can run this bundle
 * in an older APK without the method, where this is a no-op.
 *
 * Call only from a local user gesture, never from effects or state changes —
 * remote/replayed ops must not buzz the device.
 */
export type HapticFeedbackType = 'confirm' | 'threshold' | 'longPress';

interface HapticAndroidInterface {
  performHapticFeedback?(type: HapticFeedbackType): void;
}

export const performHapticFeedback = (type: HapticFeedbackType): void => {
  const android = (window as { SUPAndroid?: HapticAndroidInterface }).SUPAndroid;
  try {
    android?.performHapticFeedback?.(type);
  } catch {
    // Feedback is cosmetic; a failing bridge call must never break the gesture.
  }
};
