import { DRAG_DELAY_FOR_TOUCH } from '../../app.constants';

/** Width of the strip along the drawer's edge where an opening swipe may start. */
export const EDGE_SWIPE_ZONE_PX = 20;
/** Inward travel that opens the drawer. */
export const EDGE_SWIPE_OPEN_DISTANCE_PX = 40;
/** Movement below this is not yet a direction. Matches PanDirective's threshold. */
const EDGE_SWIPE_SLOP_PX = 10;
/** Held this long before moving, the touch is a drag (cdkDragStartDelay), as in PanDirective. */
const EDGE_SWIPE_MAX_START_DELAY_MS = DRAG_DELAY_FOR_TOUCH - 100;

export interface EdgeSwipeOpenOptions {
  /** Viewport width, read on each touchstart so rotation needs no handling. */
  getViewportWidth: () => number;
  /** Whether a touch on this target, inside the edge strip, may open the drawer. */
  canStart: (target: EventTarget | null) => boolean;
  onOpen: () => void;
  now?: () => number;
}

/**
 * Opens the right-anchored mobile drawer on a leftward swipe that starts at the
 * right screen edge (#4464). Register the handlers as capture listeners on the
 * document: while the touch is tracked, touchmove propagation is stopped so the
 * swipe-block under the finger (task swipe-left opens the context menu) does not
 * pan as well. A touch that turns vertical, rightward or into a long-press drag
 * is released to the elements below it.
 */
export class EdgeSwipeOpenDetector {
  private _touchId: number | null = null;
  private _startX = 0;
  private _startY = 0;
  private _startTime = 0;
  private _hasMoved = false;
  // The drawer opened during this touch: keep its remaining moves from the
  // task below so it does not pan under the drawer.
  private _hasOpened = false;

  constructor(private readonly _opts: EdgeSwipeOpenOptions) {}

  readonly onTouchStart = (event: TouchEvent): void => {
    this._reset();
    if (event.touches.length !== 1) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    if (touch.clientX < this._opts.getViewportWidth() - EDGE_SWIPE_ZONE_PX) return;
    if (!this._opts.canStart(event.target)) return;

    this._touchId = touch.identifier;
    this._startX = touch.clientX;
    this._startY = touch.clientY;
    this._startTime = this._now();
  };

  readonly onTouchMove = (event: TouchEvent): void => {
    if (this._touchId === null) return;
    const touch = this._findTouch(event.touches);
    if (!touch) return;

    if (this._hasOpened) {
      event.stopPropagation();
      return;
    }

    const deltaX = touch.clientX - this._startX;
    const deltaY = touch.clientY - this._startY;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    if (!this._hasMoved && (absX >= EDGE_SWIPE_SLOP_PX || absY >= EDGE_SWIPE_SLOP_PX)) {
      this._hasMoved = true;
      if (this._now() - this._startTime > EDGE_SWIPE_MAX_START_DELAY_MS) {
        this._reset();
        return;
      }
    }

    // Vertical (scroll) or rightward: not an opening swipe.
    if ((absY >= EDGE_SWIPE_SLOP_PX && absY > absX) || deltaX >= EDGE_SWIPE_SLOP_PX) {
      this._reset();
      return;
    }

    event.stopPropagation();

    if (-deltaX >= EDGE_SWIPE_OPEN_DISTANCE_PX && absX > absY * 1.5) {
      this._hasOpened = true;
      this._opts.onOpen();
    }
  };

  readonly onTouchEnd = (event: TouchEvent): void => {
    if (this._touchId === null) return;
    if (this._findTouch(event.changedTouches)) this._reset();
  };

  readonly onTouchCancel = (): void => {
    this._reset();
  };

  private _findTouch(list: TouchList): Touch | null {
    for (let i = 0; i < list.length; i++) {
      if (list[i].identifier === this._touchId) return list[i];
    }
    return null;
  }

  private _now(): number {
    return this._opts.now ? this._opts.now() : Date.now();
  }

  private _reset(): void {
    this._touchId = null;
    this._hasMoved = false;
    this._hasOpened = false;
  }
}

/** True if the element or an ancestor scrolls horizontally: its swipes are scrolls. */
export const isInHorizontalScroller = (target: EventTarget | null): boolean => {
  let el = target instanceof Element ? target : null;
  while (el && el !== document.body && el !== document.documentElement) {
    if (el.scrollWidth > el.clientWidth) {
      const overflowX = getComputedStyle(el).overflowX;
      if (overflowX === 'auto' || overflowX === 'scroll') return true;
    }
    el = el.parentElement;
  }
  return false;
};
