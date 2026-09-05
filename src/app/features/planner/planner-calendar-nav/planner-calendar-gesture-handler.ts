/** Height of one week row where there is room for six of them. */
export const ROW_HEIGHT = 40;
// 6, not 5: the expanded grid anchors to the week containing the 1st, and a
// month starting late in the week spans 6 rows (Aug 2026 starts on a Saturday).
// At 5 the month's last day had no cell at all — no task dot, not tappable
// (#9449).
export const WEEKS_SHOWN = 6;
export const DAYS_IN_VIEW = WEEKS_SHOWN * 7;
// Rows shrink rather than being dropped where six of them do not fit, so the
// grid always spans the whole month. Below this a date is neither legible nor
// reliably tappable, and the calendar stays collapsed instead (`canExpand`).
export const MIN_ROW_HEIGHT = 24;

const SNAP_VELOCITY = 0.3;
const SNAP_DURATION = 200;
const SLIDE_DURATION = 150;
const SWIPE_THRESHOLD = 50;
const SWIPE_VELOCITY_THRESHOLD = 0.3;
const DIRECTION_RATIO = 1.5;

export interface CalendarGestureCallbacks {
  getActiveWeekIndex(): number;
  getIsExpanded(): boolean;
  /**
   * Re-read the layout. The component observes the box it measures against, but
   * cannot see the rows' own top move (the month label wrapping, say), so the
   * geometry is refreshed once at the start of anything that acts on it.
   */
  measure(): void;
  /**
   * Height of the fully expanded grid, already clamped to the room available.
   * The collapsed height is always `ROW_HEIGHT`: a collapsed strip is one row
   * in a viewport that has room for one, so it never shrinks with the grid.
   */
  getExpandedHeight(): number;
  /** Row height the grid renders at once expanded; collapsed is always `ROW_HEIGHT`. */
  getRowHeight(): number;
  /** False where not even `MIN_ROW_HEIGHT` rows fit, leaving nothing to expand into. */
  canExpand(): boolean;
  onExpandChanged(expanded: boolean): void;
  onVerticalSwipe(isDown: boolean): void;
  onHorizontalSwipe(dir: 1 | -1): void;
  detectChanges(): void;
}

export class CalendarGestureHandler {
  private _touchStartY = 0;
  private _touchStartX = 0;
  private _touchStartTime = 0;
  private _gestureClaimed: 'v' | 'h' | null = null;
  private _touchOnHandle = false;
  private _isDragging = false;
  private _isSnapping = false;
  private _touchActive = false;
  private _dragStartHeight = 0;
  private _dragActiveIdx = 0;
  /** Sampled once per drag: reading it per touchmove interleaves layout reads with writes. */
  private _dragExpandedHeight = ROW_HEIGHT * WEEKS_SHOWN;
  private _prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(
    private _el: HTMLElement,
    private _getWeeksEl: () => HTMLElement | undefined,
    private _cb: CalendarGestureCallbacks,
  ) {
    _el.addEventListener('touchstart', this._onTouchStart, { passive: true });
    _el.addEventListener('touchmove', this._onTouchMove, { passive: false });
    _el.addEventListener('touchend', this._onTouchEnd);
    _el.addEventListener('touchcancel', this._onTouchCancel);
  }

  destroy(): void {
    this._el.removeEventListener('touchstart', this._onTouchStart);
    this._el.removeEventListener('touchmove', this._onTouchMove);
    this._el.removeEventListener('touchend', this._onTouchEnd);
    this._el.removeEventListener('touchcancel', this._onTouchCancel);
  }

  snapTo(requestExpanded: boolean, activeIdx?: number): void {
    const weeksEl = this._getWeeksEl();
    if (!weeksEl) return;
    const innerEl = weeksEl.firstElementChild as HTMLElement;
    if (activeIdx !== undefined) this._dragActiveIdx = activeIdx;

    // A viewport too short for six legible rows leaves nothing to expand into.
    // Reporting expanded there would desync the flag from the geometry: the
    // calendar still looks collapsed while horizontal swipes take the expanded
    // branch and jump whole months.
    this._cb.measure();
    const expanded = requestExpanded && this._cb.canExpand();

    const snapDur = this._animDuration(SNAP_DURATION);
    const targetHeight = expanded ? this._cb.getExpandedHeight() : ROW_HEIGHT;
    const idx = this._dragActiveIdx;
    const targetOffset = expanded ? 0 : -idx * ROW_HEIGHT;

    // Rows take their post-snap height now, not when the flag flips at the end
    // of the animation. `targetOffset` counts in whole rows, so animating to it
    // while the rows on screen are still the other height points the window at
    // the wrong week for the duration: collapsing from index 2 at 29px rows
    // travelled to -80px and landed on week 3 before jumping back.
    weeksEl.style.setProperty(
      '--row-height',
      `${expanded ? this._cb.getRowHeight() : ROW_HEIGHT}px`,
    );

    if (snapDur === 0) {
      // Apply the target rather than clearing, for the same reason the animated
      // branch below keeps its inline styles: Angular skips the DOM write when
      // the bound signal value has not changed, which would leave the element
      // with no max-height at all and drop the responsive row clamp.
      weeksEl.style.transition = '';
      weeksEl.style.maxHeight = targetHeight + 'px';
      if (innerEl) {
        innerEl.style.transition = '';
        innerEl.style.transform = `translateY(${targetOffset}px)`;
      }
      this._cb.onExpandChanged(expanded);
      this._cb.detectChanges();
      this._isDragging = false;
      this._isSnapping = false;
      return;
    }

    this._isSnapping = true;

    weeksEl.style.transition = `max-height ${snapDur}ms ease`;
    weeksEl.style.maxHeight = targetHeight + 'px';
    if (innerEl) {
      innerEl.style.transition = `transform ${snapDur}ms ease`;
      innerEl.style.transform = `translateY(${targetOffset}px)`;
    }

    setTimeout(() => {
      try {
        // Keep inline styles at target values instead of clearing them.
        // Clearing would rely on Angular's style binding to re-apply,
        // but Angular skips the DOM write when the signal value hasn't changed,
        // leaving the element without maxHeight (visually stuck open).
        weeksEl.style.transition = '';
        weeksEl.style.maxHeight = targetHeight + 'px';
        if (innerEl) {
          innerEl.style.transition = '';
          innerEl.style.transform = `translateY(${targetOffset}px)`;
        }

        this._cb.onExpandChanged(expanded);
        this._cb.detectChanges();
      } finally {
        this._isDragging = false;
        this._isSnapping = false;
      }
    }, snapDur + 10);
  }

  slideContent(direction: 1 | -1, onUpdate: () => void, axis: 'x' | 'y'): void {
    const weeksEl = this._getWeeksEl();
    if (!weeksEl) return;
    const innerEl = weeksEl.firstElementChild as HTMLElement;
    if (!innerEl) return;
    this._isSnapping = true;

    const slideDur = this._animDuration(SLIDE_DURATION);

    if (slideDur === 0) {
      onUpdate();
      this._cb.detectChanges();
      this._isSnapping = false;
      return;
    }

    const sign = axis === 'x' ? -direction : direction;
    const out = `${sign * 100}%`;
    const slideOut = axis === 'x' ? `${out} 0` : `0 ${out}`;

    innerEl.style.transition = `translate ${slideDur}ms ease-out`;
    innerEl.style.translate = slideOut;

    setTimeout(() => {
      try {
        innerEl.style.transition = 'none';
        onUpdate();
        this._cb.detectChanges();

        const inv = `${-sign * 100}%`;
        const slideIn = axis === 'x' ? `${inv} 0` : `0 ${inv}`;
        innerEl.style.translate = slideIn;

        // Force reflow so the position change applies before transition
        void innerEl.offsetWidth;

        innerEl.style.transition = `translate ${slideDur}ms ease-out`;
        innerEl.style.translate = '0 0';

        setTimeout(() => {
          innerEl.style.transition = '';
          innerEl.style.translate = '';
          this._isSnapping = false;
        }, slideDur + 10);
      } catch (e) {
        this._isSnapping = false;
        throw e;
      }
    }, slideDur + 10);
  }

  private _animDuration(base: number): number {
    return this._prefersReducedMotion ? 0 : base;
  }

  private _onTouchStart = (e: TouchEvent): void => {
    if (this._isSnapping) return;
    const touch = e.touches[0];
    this._touchStartY = touch.clientY;
    this._touchStartX = touch.clientX;
    this._touchStartTime = Date.now();
    this._gestureClaimed = null;
    this._isDragging = false;
    this._touchActive = true;
    this._touchOnHandle = !!(e.target as HTMLElement).closest('.handle');
  };

  private _onTouchMove = (e: TouchEvent): void => {
    if (!this._touchActive || this._isSnapping) return;
    const touch = e.touches[0];
    const deltaY = touch.clientY - this._touchStartY;

    if (this._touchOnHandle) {
      if (e.cancelable) e.preventDefault();
      if (!this._isDragging) {
        if (Math.abs(deltaY) < 5) return;
        this._startDrag();
      }
      this._updateDrag(deltaY);
      return;
    }

    if (this._gestureClaimed) {
      if (e.cancelable) e.preventDefault();
      return;
    }
    const absDeltaY = Math.abs(deltaY);
    const absDeltaX = Math.abs(touch.clientX - this._touchStartX);

    if (absDeltaY > absDeltaX * DIRECTION_RATIO) {
      if (e.cancelable) e.preventDefault();
      this._gestureClaimed = 'v';
    } else if (absDeltaX > absDeltaY * DIRECTION_RATIO) {
      if (e.cancelable) e.preventDefault();
      this._gestureClaimed = 'h';
    }
  };

  private _onTouchEnd = (e: TouchEvent): void => {
    if (!this._touchActive || this._isSnapping) return;
    this._touchActive = false;

    if (this._touchOnHandle) {
      if (e.cancelable) e.preventDefault();
      if (this._isDragging) {
        const touch = e.changedTouches[0];
        const deltaY = touch.clientY - this._touchStartY;
        const elapsed = Date.now() - this._touchStartTime;
        const velocity = deltaY / Math.max(elapsed, 1);
        const expandedHeight = this._dragExpandedHeight;
        const currentHeight = Math.max(
          ROW_HEIGHT,
          Math.min(expandedHeight, this._dragStartHeight + deltaY),
        );

        let snapExpanded: boolean;
        if (Math.abs(velocity) > SNAP_VELOCITY) {
          snapExpanded = velocity > 0;
        } else {
          snapExpanded = currentHeight > (ROW_HEIGHT + expandedHeight) / 2;
        }
        this.snapTo(snapExpanded);
      }
      return;
    }

    if (!this._gestureClaimed) return;
    const touch = e.changedTouches[0];
    const deltaY = touch.clientY - this._touchStartY;
    const deltaX = touch.clientX - this._touchStartX;
    const elapsed = Date.now() - this._touchStartTime;

    if (this._gestureClaimed === 'v') {
      const velocity = Math.abs(deltaY) / Math.max(elapsed, 1);
      const isSwipe =
        Math.abs(deltaY) > SWIPE_THRESHOLD || velocity > SWIPE_VELOCITY_THRESHOLD;
      if (isSwipe) {
        this._cb.onVerticalSwipe(deltaY > 0);
      }
    } else {
      const velocity = Math.abs(deltaX) / Math.max(elapsed, 1);
      const isSwipe =
        Math.abs(deltaX) > SWIPE_THRESHOLD || velocity > SWIPE_VELOCITY_THRESHOLD;
      if (isSwipe) {
        this._cb.onHorizontalSwipe(deltaX < 0 ? 1 : -1);
      }
    }
  };

  private _onTouchCancel = (): void => {
    this._touchActive = false;
    if (this._isDragging) {
      this._isDragging = false;
      this.snapTo(this._cb.getIsExpanded());
    }
  };

  private _startDrag(): void {
    this._isDragging = true;
    this._dragActiveIdx = this._cb.getActiveWeekIndex();
    this._cb.measure();
    // Clamped by the component, so a drag cannot open past the room available
    // even while `isExpanded` is stale against a shrunken box.
    this._dragExpandedHeight = this._cb.getExpandedHeight();
    this._dragStartHeight = this._cb.getIsExpanded()
      ? this._dragExpandedHeight
      : ROW_HEIGHT;
  }

  private _updateDrag(deltaY: number): void {
    const expandedHeight = this._dragExpandedHeight;
    const newHeight = Math.max(
      ROW_HEIGHT,
      Math.min(expandedHeight, this._dragStartHeight + deltaY),
    );
    const weeksEl = this._getWeeksEl();
    if (!weeksEl) return;
    weeksEl.style.maxHeight = newHeight + 'px';

    // Guarded: where the room is too tight to expand, the clamped expanded
    // height collapses onto ROW_HEIGHT and the range is 0, which would make
    // this NaN. translateY(NaNpx) is dropped silently by CSSOM.
    const range = expandedHeight - ROW_HEIGHT;
    const progress = range > 0 ? (newHeight - ROW_HEIGHT) / range : 0;
    const offset = -this._dragActiveIdx * ROW_HEIGHT * (1 - progress);
    const innerEl = weeksEl.firstElementChild as HTMLElement;
    if (innerEl) {
      innerEl.style.transform = `translateY(${offset}px)`;
    }
  }
}
