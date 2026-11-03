import {
  Directive,
  ElementRef,
  HostListener,
  inject,
  OnDestroy,
  output,
} from '@angular/core';
import { UI_LONG_PRESS_DURATION, UI_LONG_PRESS_MOVE_TOLERANCE_PX } from '../ui.const';

@Directive({ selector: '[longPress]' })
export class LongPressDirective implements OnDestroy {
  readonly longPress = output<MouseEvent | TouchEvent>();

  private longPressTimeout: number | undefined;
  private touchStart: { x: number; y: number } | undefined;
  private readonly _el: HTMLElement = inject(ElementRef).nativeElement;

  // Not @HostListener: that would run change detection on every touchmove.
  constructor() {
    this._el.addEventListener('touchmove', this._onTouchMove, { passive: true });
    this._el.addEventListener('touchcancel', this._onTouchCancel, { passive: true });
  }

  @HostListener('touchstart', ['$event'])
  @HostListener('mousedown', ['$event'])
  onMouseDown(event: TouchEvent | MouseEvent): void {
    window.clearTimeout(this.longPressTimeout);
    const touch = 'touches' in event ? event.touches[0] : undefined;
    this.touchStart = touch ? { x: touch.clientX, y: touch.clientY } : undefined;
    this.longPressTimeout = window.setTimeout(() => {
      this.longPress.emit(event);
    }, UI_LONG_PRESS_DURATION);
  }

  @HostListener('touchend')
  @HostListener('mouseup')
  @HostListener('mouseleave')
  longPressInterupt(): void {
    window.clearTimeout(this.longPressTimeout);
    this.touchStart = undefined;
  }

  ngOnDestroy(): void {
    this._el.removeEventListener('touchmove', this._onTouchMove);
    this._el.removeEventListener('touchcancel', this._onTouchCancel);
    if (this.longPressTimeout) {
      window.clearTimeout(this.longPressTimeout);
    }
  }

  // A finger that slides away (to scroll, or to cancel the press) is not a
  // long-press, and neither is a touch the system cancels.
  private readonly _onTouchMove = (ev: TouchEvent): void => {
    const start = this.touchStart;
    const touch = ev.touches[0];
    if (!start || !touch) {
      return;
    }
    const distance =
      Math.abs(touch.clientX - start.x) + Math.abs(touch.clientY - start.y);
    if (distance >= UI_LONG_PRESS_MOVE_TOLERANCE_PX) {
      this.longPressInterupt();
    }
  };

  private readonly _onTouchCancel = (): void => this.longPressInterupt();
}
