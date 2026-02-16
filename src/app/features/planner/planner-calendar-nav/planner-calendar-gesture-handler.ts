export const ROW_HEIGHT = 40;
export const WEEKS_SHOWN = 5;
export const DAYS_IN_VIEW = WEEKS_SHOWN * 7;
export const MIN_HEIGHT = ROW_HEIGHT;
export const MAX_HEIGHT = ROW_HEIGHT * WEEKS_SHOWN;

const SNAP_MIDPOINT = (MIN_HEIGHT + MAX_HEIGHT) / 2;
const SNAP_VELOCITY = 0.3;
const SNAP_DURATION = 200;
const SLIDE_DURATION = 150;
const SWIPE_THRESHOLD = 50;
const SWIPE_VELOCITY_THRESHOLD = 0.3;
const DIRECTION_RATIO = 1.5;

export interface CalendarGestureCallbacks {
  getActiveWeekIndex(): number;
  getIsExpanded(): boolean;
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
  private _dragStartHeight = 0;
  private _dragActiveIdx = 0;

  constructor(
    private _el: HTMLElement,
    private _getWeeksEl: () => HTMLElement | undefined,
    private _cb: CalendarGestureCallbacks,
  ) {
    _el.addEventListener('touchstart', this._onTouchStart, { passive: true });
    _el.addEventListener('touchmove', this._onTouchMove, { passive: false });
    _el.addEventListener('touchend', this._onTouchEnd);
  }

  destroy(): void {
    this._el.removeEventListener('touchstart', this._onTouchStart);
    this._el.removeEventListener('touchmove', this._onTouchMove);
    this._el.removeEventListener('touchend', this._onTouchEnd);
  }

  snapTo(expanded: boolean, activeIdx?: number): void {
    const weeksEl = this._getWeeksEl();
    if (!weeksEl) return;
    const innerEl = weeksEl.firstElementChild as HTMLElement;
    if (activeIdx !== undefined) this._dragActiveIdx = activeIdx;
    this._isSnapping = true;

    const targetHeight = expanded ? MAX_HEIGHT : MIN_HEIGHT;
    const idx = this._dragActiveIdx;
    const targetOffset = expanded ? 0 : -idx * ROW_HEIGHT;

    weeksEl.style.transition = `max-height ${SNAP_DURATION}ms ease`;
    weeksEl.style.maxHeight = targetHeight + 'px';
    if (innerEl) {
      innerEl.style.transition = `transform ${SNAP_DURATION}ms ease`;
      innerEl.style.transform = `translateY(${targetOffset}px)`;
    }

    setTimeout(() => {
      try {
        weeksEl.style.transition = '';
        weeksEl.style.maxHeight = '';
        if (innerEl) {
          innerEl.style.transition = '';
          innerEl.style.transform = '';
        }

        this._cb.onExpandChanged(expanded);
        this._cb.detectChanges();
      } finally {
        this._isDragging = false;
        this._isSnapping = false;
      }
    }, SNAP_DURATION + 10);
  }

  slideContent(direction: 1 | -1, onUpdate: () => void, axis: 'x' | 'y'): void {
    const weeksEl = this._getWeeksEl();
    if (!weeksEl) return;
    const innerEl = weeksEl.firstElementChild as HTMLElement;
    if (!innerEl) return;
    this._isSnapping = true;

    const sign = axis === 'x' ? -direction : direction;
    const out = `${sign * 100}%`;
    const slideOut = axis === 'x' ? `${out} 0` : `0 ${out}`;

    innerEl.style.transition = `translate ${SLIDE_DURATION}ms ease-out`;
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

        innerEl.style.transition = `translate ${SLIDE_DURATION}ms ease-out`;
        innerEl.style.translate = '0 0';

        setTimeout(() => {
          innerEl.style.transition = '';
          innerEl.style.translate = '';
          this._isSnapping = false;
        }, SLIDE_DURATION + 10);
      } catch (e) {
        this._isSnapping = false;
        throw e;
      }
    }, SLIDE_DURATION + 10);
  }

  private _onTouchStart = (e: TouchEvent): void => {
    if (this._isSnapping) return;
    const touch = e.touches[0];
    this._touchStartY = touch.clientY;
    this._touchStartX = touch.clientX;
    this._touchStartTime = Date.now();
    this._gestureClaimed = null;
    this._isDragging = false;
    this._touchOnHandle = !!(e.target as HTMLElement).closest('.handle');
  };

  private _onTouchMove = (e: TouchEvent): void => {
    if (this._isSnapping) return;
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
    if (this._isSnapping) return;

    if (this._touchOnHandle) {
      if (e.cancelable) e.preventDefault();
      if (this._isDragging) {
        const touch = e.changedTouches[0];
        const deltaY = touch.clientY - this._touchStartY;
        const elapsed = Date.now() - this._touchStartTime;
        const velocity = deltaY / Math.max(elapsed, 1);
        const currentHeight = Math.max(
          MIN_HEIGHT,
          Math.min(MAX_HEIGHT, this._dragStartHeight + deltaY),
        );

        let snapExpanded: boolean;
        if (Math.abs(velocity) > SNAP_VELOCITY) {
          snapExpanded = velocity > 0;
        } else {
          snapExpanded = currentHeight > SNAP_MIDPOINT;
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

  private _startDrag(): void {
    this._isDragging = true;
    this._dragActiveIdx = this._cb.getActiveWeekIndex();
    this._dragStartHeight = this._cb.getIsExpanded() ? MAX_HEIGHT : MIN_HEIGHT;
  }

  private _updateDrag(deltaY: number): void {
    const newHeight = Math.max(
      MIN_HEIGHT,
      Math.min(MAX_HEIGHT, this._dragStartHeight + deltaY),
    );
    const weeksEl = this._getWeeksEl();
    if (!weeksEl) return;
    weeksEl.style.maxHeight = newHeight + 'px';

    const progress = (newHeight - MIN_HEIGHT) / (MAX_HEIGHT - MIN_HEIGHT);
    const offset = -this._dragActiveIdx * ROW_HEIGHT * (1 - progress);
    const innerEl = weeksEl.firstElementChild as HTMLElement;
    if (innerEl) {
      innerEl.style.transform = `translateY(${offset}px)`;
    }
  }
}
