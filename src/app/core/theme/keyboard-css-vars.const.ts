/**
 * CSS custom properties that carry the soft-keyboard geometry.
 *
 * Defaults live in `_css-variables.scss`. Android and mobile web write
 * `--keyboard-height` on `<html>` (GlobalThemeService); on iOS all three are
 * written on the CDK overlay container instead (IosKeyboardService).
 */
export const CSS_VAR_KEYBOARD_HEIGHT = '--keyboard-height';
export const CSS_VAR_KEYBOARD_OVERLAY_OFFSET = '--keyboard-overlay-offset';
export const CSS_VAR_VISUAL_VIEWPORT_HEIGHT = '--visual-viewport-height';
