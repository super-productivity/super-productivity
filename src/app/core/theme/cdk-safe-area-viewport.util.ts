import { FlexibleConnectedPositionStrategy } from '@angular/cdk/overlay';
import { BodyClass } from '../../app.constants';
import { CSS_VAR_KEYBOARD_OVERLAY_OFFSET } from './keyboard-css-vars.const';

/**
 * Resolved inset tokens from `_css-variables.scss`:
 * `var(--safe-area-inset-*, env(safe-area-inset-*))`.
 *
 * Always read these, never the raw `--safe-area-inset-*`: on Android the
 * effective inset can come from `env()` alone (Capacitor SystemBars passes the
 * native insets through instead of injecting the vars), in which case reading
 * the injected var yields 0 (#8792).
 */
const CSS_VAR_RESOLVED_SAFE_AREA_TOP = '--safe-area-top';
const CSS_VAR_RESOLVED_SAFE_AREA_BOTTOM = '--safe-area-bottom';

const readPx = (el: Element, name: string): number =>
  parseInt(getComputedStyle(el).getPropertyValue(name), 10) || 0;

/**
 * Teach CDK about the native mobile insets, so connected overlays (menus,
 * selects, autocomplete panels) stay clear of the system bars and of the iOS
 * keyboard when the WebView does not shrink.
 *
 * Hooks the per-side *viewport margin* getters, CDK's own mechanism for
 * "keep overlays this far from the viewport edge" (`withViewportMargin`), and
 * not the viewport rect (`_getNarrowedViewportRect`). CDK derives the
 * container-relative CSS `bottom` of a bottom-anchored bounding box as
 * `viewport.height - origin.y + marginTop + marginBottom`, i.e. it adds the
 * margins back to return to full-viewport coordinates. Shrinking the rect
 * without declaring margins understates that `bottom` by `top + bottom` (both
 * insets, since both came off `viewport.height`), which pins an
 * 'above'-anchored panel's bottom edge that far *below* its trigger, i.e. down
 * into the very strip being reserved (#8792).
 *
 * The pin is independent of panel height, so a taller menu grows upward and
 * overlaps by exactly as much: with a 48px status bar and a 48px navigation
 * bar, measured on the real app, the panel's bottom sat ~3px above the screen
 * edge whether the menu had one item or two.
 *
 * Declaring margins instead makes the two terms cancel
 * (`(height - top - bottom) - origin.y + top + bottom`), which is why the
 * placement is then correct for any inset combination.
 *
 * `overlayContainerEl` is where IosKeyboardService writes the keyboard offset
 * (never `<html>`, see there); connected overlays live inside it.
 *
 * Idempotent: patching twice would add the inset twice.
 */
export const patchCdkViewportForSafeArea = (
  doc: Document,
  overlayContainerEl: HTMLElement,
): void => {
  const proto = FlexibleConnectedPositionStrategy.prototype as unknown as {
    _getViewportMarginTop: () => number;
    _getViewportMarginBottom: () => number;
    _spSafeAreaPatched?: boolean;
  };
  if (proto._spSafeAreaPatched) {
    return;
  }
  proto._spSafeAreaPatched = true;

  const originalTop = proto._getViewportMarginTop;
  const originalBottom = proto._getViewportMarginBottom;

  proto._getViewportMarginTop = function (this: unknown): number {
    return (
      originalTop.call(this) + readPx(doc.documentElement, CSS_VAR_RESOLVED_SAFE_AREA_TOP)
    );
  };
  proto._getViewportMarginBottom = function (this: unknown): number {
    const keyboardOverlayOffset =
      doc.body.classList.contains(BodyClass.isIOS) &&
      doc.body.classList.contains(BodyClass.isKeyboardVisible)
        ? readPx(overlayContainerEl, CSS_VAR_KEYBOARD_OVERLAY_OFFSET)
        : 0;
    return (
      originalBottom.call(this) +
      readPx(doc.documentElement, CSS_VAR_RESOLVED_SAFE_AREA_BOTTOM) +
      keyboardOverlayOffset
    );
  };
};
