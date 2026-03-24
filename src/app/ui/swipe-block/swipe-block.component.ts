import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  OnDestroy,
  output,
  Renderer2,
  signal,
  viewChild,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { PanDirective, PanEvent } from '../swipe-gesture/pan.directive';
import { IS_TOUCH_PRIMARY } from '../../util/is-mouse-primary';

/** Scale factor so the swipe block reaches full width at 50% pan distance */
const PAN_SCALE_FACTOR = 2;

@Component({
  selector: 'swipe-block',
  templateUrl: './swipe-block.component.html',
  styleUrl: './swipe-block.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [MatIcon, PanDirective],
})
export class SwipeBlockComponent implements OnDestroy {
  readonly isDone = input<boolean>(false);
  readonly canSwipe = input<boolean>(true);
  readonly excludeSelector = input<string>('');
  readonly swipeRight = output<void>();
  readonly swipeLeft = output<void>();

  readonly IS_TOUCH_PRIMARY = IS_TOUCH_PRIMARY;

  readonly isPanHelperVisible = signal(false);
  readonly isPreventPointerEventsWhilePanning = signal(false);
  private _isLockPanLeft = false;
  private _isLockPanRight = false;
  private _isActionTriggered = false;
  private _strikethroughY = 0;

  readonly strikethroughEl = viewChild<ElementRef>('strikethroughEl');
  readonly blockRightEl = viewChild<ElementRef>('blockRightEl');
  readonly innerWrapperEl = viewChild<ElementRef>('innerWrapperEl');

  private readonly _renderer = inject(Renderer2);
  private readonly _elementRef = inject(ElementRef);
  private _currentPanTimeout?: number;
  private _panHelperVisibilityTimeout?: number;
  private readonly _snapBackHideDelayMs = 200;
  private _cachedWidth = 0;

  ngOnDestroy(): void {
    window.clearTimeout(this._currentPanTimeout);
    if (this._panHelperVisibilityTimeout) {
      window.clearTimeout(this._panHelperVisibilityTimeout);
    }
  }

  onPanStart(ev: PanEvent): void {
    if (!IS_TOUCH_PRIMARY || !this.canSwipe()) {
      return;
    }
    this._resetAfterPan();
    const targetEl = ev.target as HTMLElement | null;
    const exclude = this.excludeSelector();
    if (
      (exclude && targetEl?.closest(exclude)) ||
      Math.abs(ev.deltaY) > Math.abs(ev.deltaX) ||
      ev.isFinal
    ) {
      this._hidePanHelper();
      return;
    }
    this._showPanHelper();
    this.isPreventPointerEventsWhilePanning.set(true);
    this._cachedWidth = this._elementRef.nativeElement.offsetWidth;

    // Calculate touch Y position relative to component for strikethrough
    const rect = this._elementRef.nativeElement.getBoundingClientRect();
    this._strikethroughY = ev.clientY - rect.top;
  }

  onPanEnd(): void {
    if (!IS_TOUCH_PRIMARY || (!this._isLockPanLeft && !this._isLockPanRight)) {
      return;
    }
    const blockRightElRef = this.blockRightEl();
    const strikethroughElRef = this.strikethroughEl();
    const hideDelay = this._snapBackHideDelayMs;

    this.isPreventPointerEventsWhilePanning.set(false);
    if (blockRightElRef) {
      this._renderer.removeStyle(blockRightElRef.nativeElement, 'transition');
    }

    if (this._currentPanTimeout) {
      window.clearTimeout(this._currentPanTimeout);
    }

    if (this._isActionTriggered) {
      if (this._isLockPanLeft) {
        if (blockRightElRef) {
          this._renderer.setStyle(
            blockRightElRef.nativeElement,
            'transform',
            `scaleX(1)`,
          );
        }
        this._currentPanTimeout = window.setTimeout(() => {
          this.swipeLeft.emit();
          this._resetAfterPan(hideDelay);
        }, 100);
      } else if (this._isLockPanRight) {
        // Strikethrough completion animation
        if (strikethroughElRef) {
          this._renderer.setStyle(
            strikethroughElRef.nativeElement,
            'transition',
            'width 150ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow 150ms ease',
          );
          this._renderer.setStyle(
            strikethroughElRef.nativeElement,
            'width',
            `calc(100% - var(--s4))`,
          );
          this._renderer.addClass(strikethroughElRef.nativeElement, 'isCompleting');
        }
        this._currentPanTimeout = window.setTimeout(() => {
          this.swipeRight.emit();
          this._resetAfterPan(hideDelay);
        }, 200);
      }
    } else {
      // Abort: retract strikethrough with animation
      if (this._isLockPanRight && strikethroughElRef) {
        this._renderer.setStyle(
          strikethroughElRef.nativeElement,
          'transition',
          'width 200ms cubic-bezier(0.4, 0, 1, 1), opacity 150ms ease',
        );
        this._renderer.setStyle(strikethroughElRef.nativeElement, 'width', '0');
        this._renderer.setStyle(strikethroughElRef.nativeElement, 'opacity', '0');
      }
      this._resetAfterPan(hideDelay);
    }
  }

  onPanCancel(): void {
    this._resetAfterPan(this._snapBackHideDelayMs);
  }

  handlePan(ev: PanEvent): void {
    if (!IS_TOUCH_PRIMARY) {
      return;
    }
    const innerWrapperElRef = this.innerWrapperEl();
    const blockRightElRef = this.blockRightEl();
    const strikethroughElRef = this.strikethroughEl();
    if (!innerWrapperElRef) {
      return;
    }

    const isPanningRight = ev.deltaX > 0;
    const isPanningLeft = ev.deltaX < 0;

    this._isLockPanRight = isPanningRight;
    this._isLockPanLeft = isPanningLeft;

    this.isPreventPointerEventsWhilePanning.set(true);

    if (isPanningRight && strikethroughElRef) {
      // Strikethrough mode for right swipe
      const width = Math.abs(ev.deltaX);
      let scale = (width / (this._cachedWidth || 1)) * PAN_SCALE_FACTOR;
      scale = Math.min(1, Math.max(0, scale));

      if (scale > 0.5) {
        this._isActionTriggered = true;
        this._renderer.addClass(strikethroughElRef.nativeElement, 'isTriggered');
      } else {
        this._isActionTriggered = false;
        this._renderer.removeClass(strikethroughElRef.nativeElement, 'isTriggered');
      }

      this._renderer.setStyle(strikethroughElRef.nativeElement, 'width', `${width}px`);
      this._renderer.setStyle(
        strikethroughElRef.nativeElement,
        'top',
        `${this._strikethroughY}px`,
      );
      this._renderer.setStyle(strikethroughElRef.nativeElement, 'transition', 'none');
      this._renderer.setStyle(strikethroughElRef.nativeElement, 'opacity', '1');

      // Clear right block
      if (blockRightElRef) {
        this._renderer.setStyle(blockRightElRef.nativeElement, 'width', '0');
        this._renderer.removeClass(blockRightElRef.nativeElement, 'isActive');
      }
    } else if (isPanningLeft && blockRightElRef) {
      // Existing behavior for left swipe
      let scale = (Math.abs(ev.deltaX) / (this._cachedWidth || 1)) * PAN_SCALE_FACTOR;
      scale = Math.min(1, Math.max(0, scale));

      if (scale > 0.5) {
        this._isActionTriggered = true;
        this._renderer.addClass(blockRightElRef.nativeElement, 'isActive');
      } else {
        this._isActionTriggered = false;
        this._renderer.removeClass(blockRightElRef.nativeElement, 'isActive');
      }

      const moveBy = Math.abs(ev.deltaX);
      this._renderer.setStyle(blockRightElRef.nativeElement, 'width', `${moveBy}px`);
      this._renderer.setStyle(blockRightElRef.nativeElement, 'transition', 'none');
      this._renderer.setStyle(
        innerWrapperElRef.nativeElement,
        'transform',
        `translateX(${ev.deltaX}px)`,
      );

      // Clear strikethrough
      if (strikethroughElRef) {
        this._renderer.setStyle(strikethroughElRef.nativeElement, 'width', '0');
        this._renderer.removeClass(strikethroughElRef.nativeElement, 'isTriggered');
      }
    }
  }

  private _showPanHelper(): void {
    if (this._panHelperVisibilityTimeout) {
      window.clearTimeout(this._panHelperVisibilityTimeout);
      this._panHelperVisibilityTimeout = undefined;
    }
    this.isPanHelperVisible.set(true);
  }

  private _hidePanHelper(delayMs: number = 0): void {
    if (this._panHelperVisibilityTimeout) {
      window.clearTimeout(this._panHelperVisibilityTimeout);
    }
    if (delayMs > 0) {
      this._panHelperVisibilityTimeout = window.setTimeout(() => {
        this.isPanHelperVisible.set(false);
        this._panHelperVisibilityTimeout = undefined;
      }, delayMs);
    } else {
      this.isPanHelperVisible.set(false);
      this._panHelperVisibilityTimeout = undefined;
    }
  }

  private _resetAfterPan(hideDelay: number = 0): void {
    if (this._currentPanTimeout) {
      window.clearTimeout(this._currentPanTimeout);
      this._currentPanTimeout = undefined;
    }
    const blockRightElRef = this.blockRightEl();
    const innerWrapperElRef = this.innerWrapperEl();
    const strikethroughElRef = this.strikethroughEl();
    this.isPreventPointerEventsWhilePanning.set(false);
    this._isActionTriggered = false;
    this._isLockPanLeft = false;
    this._isLockPanRight = false;

    // Reset strikethrough
    if (strikethroughElRef) {
      this._renderer.removeClass(strikethroughElRef.nativeElement, 'isTriggered');
      this._renderer.removeClass(strikethroughElRef.nativeElement, 'isCompleting');
      this._renderer.setStyle(strikethroughElRef.nativeElement, 'width', '0');
      this._renderer.setStyle(strikethroughElRef.nativeElement, 'opacity', '1');
      this._renderer.removeStyle(strikethroughElRef.nativeElement, 'transition');
      this._renderer.removeStyle(strikethroughElRef.nativeElement, 'top');
    }

    // Reset right block
    if (blockRightElRef) {
      this._renderer.removeClass(blockRightElRef.nativeElement, 'isActive');
      this._renderer.setStyle(blockRightElRef.nativeElement, 'width', '0');
      this._renderer.removeStyle(blockRightElRef.nativeElement, 'transition');
      this._renderer.removeStyle(blockRightElRef.nativeElement, 'transform');
    }

    if (innerWrapperElRef) {
      this._renderer.setStyle(innerWrapperElRef.nativeElement, 'transform', ``);
    }
    this._hidePanHelper(hideDelay);
  }
}
