import {
  Directive,
  HostListener,
  output,
  input,
  NgZone,
  inject,
  OnDestroy,
} from '@angular/core';

import { DRAG_DELAY_FOR_TOUCH } from '../../app.constants';

/**
 * If the touch has been held longer than this before moving,
 * treat it as a drag intent (e.g. cdkDragStartDelay) rather than a swipe.
 * Must be less than DRAG_DELAY_FOR_TOUCH so the CDK drag can take over.
 */
const PAN_MAX_START_DELAY = DRAG_DELAY_FOR_TOUCH - 100;

export interface PanEvent {
  deltaX: number;
  deltaY: number;
  deltaTime: number;
  isFinal: boolean;
  eventType: number;
  target: EventTarget | null;
  clientX: number;
  clientY: number;
  preventDefault: () => void;
}

/**
 * Pan gesture directive for touch interactions
 * Detects pan movements in all directions
 */
@Directive({
  selector: '[panGesture]',
  standalone: true,
})
export class PanDirective implements OnDestroy {
  readonly panstart = output<PanEvent>();
  readonly panend = output<void>();
  readonly pancancel = output<void>();
  readonly panleft = output<PanEvent>();
  readonly panright = output<PanEvent>();

  // Configuration
  readonly panThreshold = input(10); // Minimum distance to start panning

  private _startX = 0;
  private _startY = 0;
  private _startTime = 0;
  private _isPanning = false;
  private _touchIdentifier: number | null = null;
  private _isScrolling = false;
  private _scrollTimeout: ReturnType<typeof setTimeout> | null = null;
  private _scrollListener: (() => void) | null = null;
  private _scrollableParent: HTMLElement | null = null;

  private readonly _ngZone = inject(NgZone);

  ngOnDestroy(): void {
    this._cleanup();
  }

  private _cleanup(): void {
    // Clean up any pending timeout when directive is destroyed
    if (this._scrollTimeout) {
      clearTimeout(this._scrollTimeout);
      this._scrollTimeout = null;
    }

    // Remove scroll listener if attached
    if (this._scrollListener && this._scrollableParent) {
      this._scrollableParent.removeEventListener('scroll', this._scrollListener);
      this._scrollListener = null;
      this._scrollableParent = null;
    }
  }

  private _findScrollableParent(element: HTMLElement): HTMLElement | null {
    let parent = element.parentElement;
    while (parent) {
      const style = window.getComputedStyle(parent);
      if (
        style.overflow === 'auto' ||
        style.overflow === 'scroll' ||
        style.overflowY === 'auto' ||
        style.overflowY === 'scroll'
      ) {
        return parent;
      }
      parent = parent.parentElement;
    }
    return document.documentElement; // Fallback to document scroll
  }

  private _attachScrollListener(element: HTMLElement): void {
    // Only attach if we haven't already
    if (this._scrollListener) {
      return;
    }

    this._scrollableParent = this._findScrollableParent(element);
    if (!this._scrollableParent) {
      return;
    }

    this._scrollListener = () => {
      this._isScrolling = true;

      // Clear any existing timeout
      if (this._scrollTimeout) {
        clearTimeout(this._scrollTimeout);
      }

      // Set scrolling to false after scroll stops
      this._scrollTimeout = setTimeout(() => {
        this._isScrolling = false;
      }, 150);
    };

    this._scrollableParent.addEventListener('scroll', this._scrollListener, {
      passive: true,
    });
  }

  @HostListener('touchstart', ['$event'])
  onTouchStart(event: TouchEvent): void {
    // Reset if we have a stale touchIdentifier
    if (this._touchIdentifier !== null) {
      this._reset();
    }

    const touch = event.touches[0];
    if (!touch) {
      return;
    }

    // Attach scroll listener on demand when touch starts
    this._attachScrollListener(event.target as HTMLElement);

    this._touchIdentifier = touch.identifier;
    this._startX = touch.clientX;
    this._startY = touch.clientY;
    this._startTime = Date.now();
    this._isPanning = false;
  }

  @HostListener('touchmove', ['$event'])
  onTouchMove(event: TouchEvent): void {
    if (this._touchIdentifier === null) {
      return;
    }

    // Find matching touch
    let touch: Touch | null = null;
    for (let i = 0; i < event.touches.length; i++) {
      if (event.touches[i].identifier === this._touchIdentifier) {
        touch = event.touches[i];
        break;
      }
    }

    if (!touch) {
      return;
    }

    const currentX = touch.clientX;
    const currentY = touch.clientY;
    const deltaX = currentX - this._startX;
    const deltaY = currentY - this._startY;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    // Don't start panning if scrolling is detected
    if (this._isScrolling && !this._isPanning) {
      return;
    }

    // Check if we should start panning
    // Only start panning for primarily horizontal movements
    // Use a higher threshold for horizontal movement and ensure it's more horizontal than vertical
    if (!this._isPanning && absX >= this.panThreshold() && absX > absY * 1.5) {
      // If touch was held too long before moving, it's likely a drag, not a swipe
      if (Date.now() - this._startTime > PAN_MAX_START_DELAY) {
        this._reset();
        return;
      }
      // Additional check: if vertical movement is significant, likely scrolling
      if (absY > 20) {
        this._isScrolling = true;
        return;
      }

      this._isPanning = true;

      // Emit panstart when we first start panning
      const startEvent = this._createPanEvent(event, deltaX, deltaY, false, 1); // eventType: 1 = start
      this._ngZone.run(() => {
        this.panstart.emit(startEvent);
      });
    }

    if (this._isPanning) {
      // Prevent default to avoid scrolling
      event.preventDefault();
      // Stop propagation so parent PanDirectives (nested swipe-blocks) don't fire
      event.stopPropagation();

      const panEvent = this._createPanEvent(event, deltaX, deltaY, false, 2); // eventType: 2 = move

      // Emit continuous pan events
      // Run in Angular zone for event emission
      this._ngZone.run(() => {
        // Emit direction-specific events for horizontal pan
        if (absX > absY) {
          if (deltaX < 0) {
            this.panleft.emit(panEvent);
          } else {
            this.panright.emit(panEvent);
          }
        }
      });
    }
  }

  @HostListener('touchend', ['$event'])
  onTouchEnd(event: TouchEvent): void {
    if (this._touchIdentifier === null) {
      return;
    }

    // Find matching touch
    let touch: Touch | null = null;
    for (let i = 0; i < event.changedTouches.length; i++) {
      if (event.changedTouches[i].identifier === this._touchIdentifier) {
        touch = event.changedTouches[i];
        break;
      }
    }

    if (!touch) {
      return;
    }

    if (this._isPanning) {
      // Run in Angular zone for final event
      this._ngZone.run(() => {
        this.panend.emit();
      });
    }

    // Reset state
    this._reset();
  }

  @HostListener('touchcancel')
  onTouchCancel(): void {
    if (this._touchIdentifier === null) {
      return;
    }

    if (this._isPanning) {
      this._ngZone.run(() => {
        this.pancancel.emit();
      });
    }

    this._reset();
  }

  private _reset(): void {
    this._startX = 0;
    this._startY = 0;
    this._startTime = 0;
    this._isPanning = false;
    this._touchIdentifier = null;
    this._isScrolling = false;

    // Clean up scroll listener when touch interaction ends
    this._cleanup();
  }

  private _createPanEvent(
    originalEvent: TouchEvent,
    deltaX: number,
    deltaY: number,
    isFinal: boolean,
    eventType: number,
  ): PanEvent {
    const deltaTime = Date.now() - this._startTime;

    return {
      deltaX,
      deltaY,
      deltaTime,
      isFinal,
      eventType,
      target: originalEvent.target,
      clientX: this._startX + deltaX,
      clientY: this._startY + deltaY,
      preventDefault: () => originalEvent.preventDefault(),
    };
  }
}
