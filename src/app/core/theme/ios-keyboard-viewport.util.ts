const VIEWPORT_RESIZE_EPSILON_PX = 1;

export interface IosKeyboardViewportInput {
  baseHeight: number;
  keyboardHeight: number;
  isKeyboardVisible: boolean;
  visualViewportHeight?: number;
  visualViewportOffsetTop?: number;
}

export interface IosKeyboardViewport {
  viewportHeight: number;
  keyboardOffset: number;
}

/**
 * Resolve the iOS keyboard geometry without coupling layout to native WebView
 * resizing. VisualViewport is authoritative once it shrinks; until then, the
 * sanitized plugin height is the bounded fallback. Fixed surfaces and the app
 * shell are anchored to the layout viewport, so the usable bottom edge is
 * VisualViewport.offsetTop + VisualViewport.height.
 */
export const resolveIosKeyboardViewport = ({
  baseHeight,
  keyboardHeight,
  isKeyboardVisible,
  visualViewportHeight,
  visualViewportOffsetTop = 0,
}: IosKeyboardViewportInput): IosKeyboardViewport => {
  const clampedBaseHeight = Math.max(0, baseHeight);
  const isVisualViewportResized =
    isKeyboardVisible &&
    visualViewportHeight !== undefined &&
    visualViewportHeight < clampedBaseHeight - VIEWPORT_RESIZE_EPSILON_PX;

  const clampToLayoutViewport = (value: number): number =>
    Math.min(clampedBaseHeight, Math.max(0, value));

  let keyboardOffset = 0;
  if (isKeyboardVisible) {
    keyboardOffset = isVisualViewportResized
      ? clampedBaseHeight -
        clampToLayoutViewport(visualViewportHeight + visualViewportOffsetTop)
      : clampToLayoutViewport(keyboardHeight);
  }

  const viewportHeight = isKeyboardVisible
    ? clampedBaseHeight - keyboardOffset
    : clampToLayoutViewport(visualViewportHeight ?? clampedBaseHeight);

  return {
    viewportHeight,
    keyboardOffset,
  };
};
