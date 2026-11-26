/** Firefox reports a classic mouse wheel notch as about 3 lines. */
const WHEEL_LINE_HEIGHT_PX = 16;

/**
 * A wheel delta in CSS pixels, whatever unit the browser reported it in.
 * `DOM_DELTA_PAGE` is reachable from the Windows "one screen at a time"
 * setting and scales by the scrolled box's size along that axis.
 */
export const wheelDeltaPx = (
  delta: number,
  deltaMode: number,
  pageSize: number,
): number => {
  if (deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return delta * WHEEL_LINE_HEIGHT_PX;
  }
  if (deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return delta * pageSize;
  }
  return delta;
};
