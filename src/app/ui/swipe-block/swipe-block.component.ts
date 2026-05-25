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
import { isTouchActive } from '../../util/input-intent';

/** Scale factor so the swipe block reaches full width at 50% pan distance */
const PAN_SCALE_FACTOR = 2;

/** Left offset for the strikethrough line in px (right of the checkmark) */
const STRIKETHROUGH_LEFT_PX = 48;

/** Right margin so the strikethrough doesn't reach the edge */
const STRIKETHROUGH_RIGHT_PX = 40;

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
  readonly swipeRight = output<void>();
  readonly swipeRightTriggered = output<boolean>();
  readonly swipeLeft = output<void>();

  readonly isTouchActive = isTouchActive;

  readonly isPanHelperVisible = signal(false);
  readonly isPreventPointerEventsWhilePanning = signal(false);
  private _isLockPanLeft = false;
  private _isLockPanRight = false;
  private _isActionTriggered = false;
  private _isStrikethroughPositioned = false;

  readonly strikethroughEl = viewChild<ElementRef>('strikethroughEl');
  readonly blockRightEl = viewChild<ElementRef>('blockRightEl');
  readonly innerWrapperEl = viewChild<ElementRef>('innerWrapperEl');

  private readonly _renderer = inject(Renderer2);
  private readonly _elementRef = inject(ElementRef);
  private _currentPanTimeout?: number;
  private _panHelperVisibilityTimeout?: number;
  private readonly _snapBackHideDelayMs = 200;
  private _cachedWidth = 0;
  private _cachedHostLeft = 0;
  private _displayValueEl: HTMLElement | null = null;
  private _decorationColorRgb: string = '';
  private _firstLineEl: HTMLElement | null = null;
  private _baseOpacity: number = 0;

  ngOnDestroy(): void {
    window.clearTimeout(this._currentPanTimeout);
    if (this._panHelperVisibilityTimeout) {
      window.clearTimeout(this._panHelperVisibilityTimeout);
    }
  }

  onPanStart(ev: PanEvent): void {
    if (!isTouchActive() || !this.canSwipe()) {
      return;
    }
    this._resetAfterPan();
    const targetEl = ev.target as HTMLElement | null;
    if (
      Math.abs(ev.deltaY) > Math.abs(ev.deltaX) ||
      ev.isFinal ||
      targetEl?.closest('inline-input')
    ) {
      this._hidePanHelper();
      return;
    }
    this._showPanHelper();
    this.isPreventPointerEventsWhilePanning.set(true);
    const hostRect = this._elementRef.nativeElement.getBoundingClientRect();
    this._cachedWidth = hostRect.width;
    this._cachedHostLeft = hostRect.left;
    this._isStrikethroughPositioned = false;
  }

  onPanEnd(): void {
    if (!isTouchActive() || (!this._isLockPanLeft && !this._isLockPanRight)) {
      return;
    }
    this.isPreventPointerEventsWhilePanning.set(false);
    if (this._currentPanTimeout) {
      window.clearTimeout(this._currentPanTimeout);
    }

    if (this._isActionTriggered) {
      if (this._isLockPanLeft) {
        this._completeLeftSwipe();
      } else if (this._isLockPanRight) {
        this._completeRightSwipe();
      }
    } else {
      this._abortSwipe();
    }
  }

  onPanCancel(): void {
    this._resetAfterPan(this._snapBackHideDelayMs);
  }

  handlePan(ev: PanEvent): void {
    if (!isTouchActive()) {
      return;
    }
    if (!this.innerWrapperEl()) {
      return;
    }

    this._isLockPanRight = ev.deltaX > 0;
    this._isLockPanLeft = ev.deltaX < 0;
    this.isPreventPointerEventsWhilePanning.set(true);

    if (this._isLockPanRight) {
      this._handlePanRight(ev);
    } else if (this._isLockPanLeft) {
      this._handlePanLeft(ev);
    }
  }

  // --- Right swipe (done / undo) ---

  private _handlePanRight(ev: PanEvent): void {
    const scale = this._calcScale(ev.deltaX);

    if (scale > 0.5) {
      if (!this._isActionTriggered) {
        this._isActionTriggered = true;
        this.swipeRightTriggered.emit(true);
      }
    } else {
      if (this._isActionTriggered) {
        this._isActionTriggered = false;
        this.swipeRightTriggered.emit(false);
      }
    }

    if (this.isDone()) {
      this._handleUndoPan(scale);
    } else {
      this._handleStrikethroughPan(ev);
    }

    // Clear right block
    const blockRightElRef = this.blockRightEl();
    if (blockRightElRef) {
      this._renderer.setStyle(blockRightElRef.nativeElement, 'width', '0');
      this._renderer.removeClass(blockRightElRef.nativeElement, 'isActive');
    }
  }

  private _handleUndoPan(scale: number): void {
    if (!this._displayValueEl) {
      this._cacheUndoElements();
    }
    if (this._displayValueEl) {
      const decoOpacity = Math.max(0, 1 - scale);
      this._renderer.setStyle(
        this._displayValueEl,
        'text-decoration-color',
        `rgba(${this._decorationColorRgb}, ${decoOpacity})`,
      );
      this._renderer.setStyle(this._displayValueEl, 'transition', 'none');
    }
    if (this._firstLineEl) {
      const taskOpacity = this._baseOpacity + (1 - this._baseOpacity) * scale; // eslint-disable-line no-mixed-operators
      this._renderer.setStyle(this._firstLineEl, 'opacity', `${taskOpacity}`);
      this._renderer.setStyle(this._firstLineEl, 'transition', 'none');
    }
  }

  private _handleStrikethroughPan(ev: PanEvent): void {
    const strikethroughElRef = this.strikethroughEl();
    if (!strikethroughElRef) {
      return;
    }
    const el = strikethroughElRef.nativeElement;
    if (!this._isStrikethroughPositioned) {
      this._positionStrikethroughY();
      this._isStrikethroughPositioned = true;
    }
    const maxWidth =
      (this._cachedWidth || 0) - STRIKETHROUGH_LEFT_PX - STRIKETHROUGH_RIGHT_PX;
    const fingerX = ev.clientX - this._cachedHostLeft;
    const width = Math.max(0, Math.min(fingerX - STRIKETHROUGH_LEFT_PX, maxWidth));
    this._renderer.setStyle(el, 'width', `${width}px`);
    this._renderer.setStyle(el, 'transition', 'none');
    this._renderer.setStyle(el, 'opacity', '1');
  }

  // --- Left swipe (context menu) ---

  private _handlePanLeft(ev: PanEvent): void {
    const blockRightElRef = this.blockRightEl();
    const innerWrapperElRef = this.innerWrapperEl();
    if (!blockRightElRef || !innerWrapperElRef) {
      return;
    }
    const scale = this._calcScale(ev.deltaX);

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
    const strikethroughElRef = this.strikethroughEl();
    if (strikethroughElRef) {
      this._renderer.setStyle(strikethroughElRef.nativeElement, 'width', '0');
    }
  }

  // --- Swipe completion / abort ---

  private _completeLeftSwipe(): void {
    const blockRightElRef = this.blockRightEl();
    if (blockRightElRef) {
      this._renderer.setStyle(blockRightElRef.nativeElement, 'transform', `scaleX(1)`);
    }
    this._currentPanTimeout = window.setTimeout(() => {
      this.swipeLeft.emit();
      this._resetAfterPan(this._snapBackHideDelayMs);
    }, 100);
  }

  private _completeRightSwipe(): void {
    const isMarkingDone = !this.isDone();

    if (this.isDone() && this._displayValueEl) {
      this._renderer.setStyle(
        this._displayValueEl,
        'transition',
        'text-decoration-color 150ms ease',
      );
      this._renderer.setStyle(
        this._displayValueEl,
        'text-decoration-color',
        'transparent',
      );
      if (this._firstLineEl) {
        this._renderer.setStyle(this._firstLineEl, 'transition', 'opacity 150ms ease');
        this._renderer.setStyle(this._firstLineEl, 'opacity', '1');
      }
    } else {
      const strikethroughElRef = this.strikethroughEl();
      if (strikethroughElRef) {
        const el = strikethroughElRef.nativeElement;
        this._renderer.setStyle(
          el,
          'transition',
          'width 150ms cubic-bezier(0.4, 0, 0.2, 1)',
        );
        this._renderer.setStyle(
          el,
          'width',
          `calc(100% - ${STRIKETHROUGH_LEFT_PX + STRIKETHROUGH_RIGHT_PX}px)`,
        );
      }
    }
    this._currentPanTimeout = window.setTimeout(() => {
      this.swipeRight.emit();
      // When marking done, keep the gesture strikethrough visible until the
      // CSS isDone styling takes over (setDone dispatches ~200ms after emit).
      this._resetAfterPan(isMarkingDone ? 500 : this._snapBackHideDelayMs, isMarkingDone);
    }, 200);
  }

  private _abortSwipe(): void {
    if (this._isLockPanRight) {
      if (this.isDone() && this._displayValueEl) {
        this._abortUndoSwipe();
      } else {
        this._abortStrikethroughSwipe();
      }
    }
    this._resetAfterPan(this._snapBackHideDelayMs);
  }

  private _abortUndoSwipe(): void {
    if (!this._displayValueEl) {
      return;
    }
    // Use rAF to separate setting transition from removing the property,
    // otherwise the browser batches them and skips the transition animation.
    requestAnimationFrame(() => {
      if (!this._displayValueEl) {
        return;
      }
      this._renderer.setStyle(
        this._displayValueEl,
        'transition',
        'text-decoration-color 200ms ease',
      );
      this._renderer.removeStyle(this._displayValueEl, 'text-decoration-color');
      if (this._firstLineEl) {
        this._renderer.setStyle(this._firstLineEl, 'transition', 'opacity 200ms ease');
        this._renderer.removeStyle(this._firstLineEl, 'opacity');
      }
    });
  }

  private _abortStrikethroughSwipe(): void {
    const strikethroughElRef = this.strikethroughEl();
    if (!strikethroughElRef) {
      return;
    }
    const el = strikethroughElRef.nativeElement;
    this._renderer.setStyle(
      el,
      'transition',
      'width 200ms cubic-bezier(0.4, 0, 1, 1), opacity 150ms ease',
    );
    this._renderer.setStyle(el, 'width', '0');
    this._renderer.setStyle(el, 'opacity', '0');
  }

  // --- Helpers ---

  private _calcScale(deltaX: number): number {
    const raw = (Math.abs(deltaX) / (this._cachedWidth || 1)) * PAN_SCALE_FACTOR;
    return Math.min(1, Math.max(0, raw));
  }

  private _cacheUndoElements(): void {
    const hostEl: HTMLElement = this._elementRef.nativeElement;
    this._displayValueEl =
      (hostEl.querySelector('.task-title .display-value') as HTMLElement) ||
      (hostEl.querySelector('.title') as HTMLElement);
    if (this._displayValueEl) {
      const computed = window.getComputedStyle(this._displayValueEl).textDecorationColor;
      const match = computed.match(/(\d+),\s*(\d+),\s*(\d+)/);
      this._decorationColorRgb = match
        ? `${match[1]}, ${match[2]}, ${match[3]}`
        : '0, 0, 0';
    }
    this._firstLineEl =
      (hostEl.querySelector('.title-and-left-btns-wrapper') as HTMLElement) ||
      (hostEl.parentElement as HTMLElement);
    if (this._firstLineEl) {
      this._baseOpacity = parseFloat(window.getComputedStyle(this._firstLineEl).opacity);
    }
  }

  private _findTitleEl(): HTMLElement | null {
    const hostEl: HTMLElement = this._elementRef.nativeElement;
    return (
      (hostEl.querySelector('.task-title') as HTMLElement) ||
      (hostEl.querySelector('.title') as HTMLElement)
    );
  }

  private _positionStrikethroughY(): void {
    const strikethroughElRef = this.strikethroughEl();
    if (!strikethroughElRef) {
      return;
    }
    const titleEl = this._findTitleEl();
    if (titleEl) {
      const hostRect = this._elementRef.nativeElement.getBoundingClientRect();
      const titleRect = titleEl.getBoundingClientRect();
      const halfHeight = titleRect.height / 2;
      let centerY = titleRect.top - hostRect.top + halfHeight;

      // For multi-line titles with an even number of lines, the geometric center
      // falls between two lines of text. Offset by half a line-height so the
      // strikethrough goes through text rather than between lines.
      const textEl = titleEl.querySelector('.display-value') || titleEl;
      const lineHeight = parseFloat(window.getComputedStyle(textEl).lineHeight);
      if (lineHeight > 0) {
        const numLines = Math.round(titleRect.height / lineHeight);
        if (numLines > 1 && numLines % 2 === 0) {
          centerY -= lineHeight / 2;
        }
      }

      this._renderer.setStyle(strikethroughElRef.nativeElement, 'top', `${centerY}px`);
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

  private _resetAfterPan(
    hideDelay: number = 0,
    keepStrikethrough: boolean = false,
  ): void {
    if (this._currentPanTimeout) {
      window.clearTimeout(this._currentPanTimeout);
      this._currentPanTimeout = undefined;
    }
    const blockRightElRef = this.blockRightEl();
    const innerWrapperElRef = this.innerWrapperEl();
    const strikethroughElRef = this.strikethroughEl();
    this.isPreventPointerEventsWhilePanning.set(false);
    this._isLockPanLeft = false;
    this._isLockPanRight = false;

    // Reset triggered state and notify parent to clear animation signals.
    // When keepStrikethrough is true (marking done via swipe), keep the animation
    // signals alive so the checkmark stays visible until the store updates.
    if (this._isActionTriggered) {
      this._isActionTriggered = false;
      if (!keepStrikethrough) {
        this.swipeRightTriggered.emit(false);
      }
    }

    // Reset strikethrough div (skip when marking done so it bridges until the CSS isDone class)
    if (!keepStrikethrough && strikethroughElRef) {
      this._renderer.setStyle(strikethroughElRef.nativeElement, 'width', '0');
      this._renderer.setStyle(strikethroughElRef.nativeElement, 'opacity', '1');
      this._renderer.removeStyle(strikethroughElRef.nativeElement, 'transition');
    }

    // Reset undo-related styles
    if (this._displayValueEl) {
      this._renderer.removeStyle(this._displayValueEl, 'text-decoration-color');
      this._renderer.removeStyle(this._displayValueEl, 'transition');
      this._displayValueEl = null;
    }
    if (this._firstLineEl) {
      this._renderer.removeStyle(this._firstLineEl, 'opacity');
      this._renderer.removeStyle(this._firstLineEl, 'transition');
      this._firstLineEl = null;
    }

    // Reset right block
    if (blockRightElRef) {
      this._renderer.removeClass(blockRightElRef.nativeElement, 'isActive');
      this._renderer.setStyle(blockRightElRef.nativeElement, 'width', '0');
      this._renderer.removeStyle(blockRightElRef.nativeElement, 'transition');
      this._renderer.removeStyle(blockRightElRef.nativeElement, 'transform');
    }

    if (innerWrapperElRef) {
      this._renderer.removeStyle(innerWrapperElRef.nativeElement, 'transform');
    }
    this._hidePanHelper(hideDelay);
  }
}
