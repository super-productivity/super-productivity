import {
  afterNextRender,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  contentChild,
  DestroyRef,
  Directive,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  model,
  output,
  TemplateRef,
  untracked,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import {
  classifyGesture,
  getPanOffset,
  getReleaseDirection,
  getSettleDurationMs,
  getVelocityX,
  SwipePagerDirection,
  VELOCITY_WINDOW_MS,
} from './swipe-pager-gesture';
import { isTouchActive } from '../../util/input-intent';
import { BodyClass } from '../../app.constants';

export interface SwipePagerPageContext<T> {
  $implicit: T;
  isCurrent: boolean;
}

/**
 * Marks the page template of a `swipe-pager`. Bind it to the current page so
 * the template's `let-page` is typed: `<ng-template [swipePagerPage]="page()" let-p>`.
 */
@Directive({
  selector: 'ng-template[swipePagerPage]',
  standalone: true,
})
export class SwipePagerPageDirective<T> {
  readonly swipePagerPage = input<T>();
  readonly templateRef = inject<TemplateRef<SwipePagerPageContext<T>>>(TemplateRef);

  static ngTemplateContextGuard<T>(
    _dir: SwipePagerPageDirective<T>,
    ctx: unknown,
  ): ctx is SwipePagerPageContext<T> {
    return true;
  }
}

interface PageSlot<T> {
  key: unknown;
  item: T;
  offset: -1 | 0 | 1;
}

const SETTLE_EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
/** Extra wait before finishing a settle whose transitionend never fired. */
const SETTLE_FALLBACK_SLACK_MS = 50;
/** Prewarm no later than this, even if the main thread never goes idle. */
const PREWARM_TIMEOUT_MS = 2000;
/** Where requestIdleCallback is missing (older Safari): after the open settles. */
const PREWARM_FALLBACK_DELAY_MS = 500;
/** Button presses arriving mid-animation are played after it, up to this many. */
const MAX_QUEUED_STEPS = 3;
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Horizontally paged content that follows the finger: a pan drags the current
 * page aside with its neighbour sliding in, and the release settles on one of
 * them. The pager only moves pages; the host sets `current` to the page that
 * `navigate` emits.
 *
 * Neighbour pages are rendered only once `isWarm` is true. The pager sets it
 * when idle after the first render while touch is the active input (so the
 * first pan does not pay for rendering them mid-gesture), on the first touch,
 * or on a `go()` call. A host can skip computing neighbours for mouse users by
 * passing `prev`/`next` only while warm.
 *
 * Neighbours are inert and share the vertical scroll position of the current
 * page; overflow is clipped without creating a scroll container, so sticky
 * headers inside the pages keep working.
 */
@Component({
  selector: 'swipe-pager',
  standalone: true,
  imports: [NgTemplateOutlet],
  templateUrl: './swipe-pager.component.html',
  styleUrl: './swipe-pager.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SwipePagerComponent<T> {
  readonly prev = input<T | null>(null);
  readonly current = input.required<T>();
  readonly next = input<T | null>(null);
  /** Identifies a page across navigations, so its view is kept and moved. */
  readonly trackKey = input<(item: T) => unknown>((item) => item);
  readonly isEnabled = input<boolean>(true);
  readonly isWarm = model<boolean>(false);
  /** The page settled on; the host makes it `current`. */
  readonly navigate = output<T>();

  readonly pageTpl = contentChild.required(SwipePagerPageDirective<T>);

  private readonly _track = viewChild.required<ElementRef<HTMLElement>>('track');
  private readonly _host: HTMLElement = inject(ElementRef).nativeElement;
  private readonly _injector = inject(Injector);
  private readonly _cdr = inject(ChangeDetectorRef);

  readonly slots = computed<PageSlot<T>[]>(() => {
    const keyOf = this.trackKey();
    const slots: PageSlot<T>[] = [];
    const add = (item: T | null, offset: PageSlot<T>['offset']): void => {
      if (item !== null && item !== undefined) {
        slots.push({ key: keyOf(item), item, offset });
      }
    };
    if (this.isWarm()) {
      add(this.prev(), -1);
    }
    add(this.current(), 0);
    if (this.isWarm()) {
      add(this.next(), 1);
    }
    return slots;
  });

  private readonly _currentKey = computed(() => this.trackKey()(this.current()));

  private _state: 'idle' | 'pending' | 'panning' | 'ignored' | 'settling' = 'idle';
  private _touchId: number | null = null;
  private _startX = 0;
  private _startY = 0;
  /** Event timestamps, not Date.now(): a busy main thread must not age a touch. */
  private _startTime = 0;
  private _offsetX = 0;
  private _samples: { x: number; t: number }[] = [];
  private _queuedSteps: SwipePagerDirection[] = [];
  /** Bumped by every settle and reset, so callbacks of a superseded one no-op. */
  private _settleId = 0;
  private _settleFromKey: unknown;
  private _cancelSettleListeners?: () => void;
  private _prewarmHandle?: number;

  constructor() {
    const host = this._host;
    host.addEventListener('touchstart', this._onTouchStart, { passive: true });
    // Not passive: once a pan is claimed, preventDefault stops vertical drift.
    host.addEventListener('touchmove', this._onTouchMove, { passive: false });
    host.addEventListener('touchend', this._onTouchEnd);
    host.addEventListener('touchcancel', this._onTouchCancel);
    inject(DestroyRef).onDestroy(() => {
      host.removeEventListener('touchstart', this._onTouchStart);
      host.removeEventListener('touchmove', this._onTouchMove);
      host.removeEventListener('touchend', this._onTouchEnd);
      host.removeEventListener('touchcancel', this._onTouchCancel);
      this._cancelSettleListeners?.();
      if (this._prewarmHandle !== undefined) {
        if (typeof cancelIdleCallback === 'function') {
          cancelIdleCallback(this._prewarmHandle);
        } else {
          window.clearTimeout(this._prewarmHandle);
        }
      }
    });
    afterNextRender(() => this._schedulePrewarm());

    // The host changed the page under a running settle (e.g. a "today" button
    // or a midnight rollover): the animation is towards a page that is no
    // longer the neighbour, so drop it instead of navigating from the new one.
    effect(() => {
      const key = this._currentKey();
      untracked(() => {
        if (this._state === 'settling' && key !== this._settleFromKey) {
          this._queuedSteps = [];
          this._resetTrack();
        }
      });
    });
  }

  /** Animates to a neighbour page, e.g. from a prev/next button. */
  go(direction: SwipePagerDirection): void {
    if (this._state === 'settling') {
      if (this._queuedSteps.length < MAX_QUEUED_STEPS) {
        this._queuedSteps.push(direction);
      }
      return;
    }
    if (this._state !== 'idle') {
      return;
    }
    if (!this.isWarm()) {
      this.isWarm.set(true);
      afterNextRender(() => this.go(direction), { injector: this._injector });
      return;
    }
    if (!this._hasPage(direction)) {
      this._queuedSteps = [];
      return;
    }
    this._offsetX = 0;
    this._settle(direction, 0);
  }

  private _schedulePrewarm(): void {
    const prewarm = (): void => {
      this._prewarmHandle = undefined;
      if (this.isEnabled() && isTouchActive() && !this.isWarm()) {
        this.isWarm.set(true);
      }
    };
    this._prewarmHandle =
      typeof requestIdleCallback === 'function'
        ? requestIdleCallback(prewarm, { timeout: PREWARM_TIMEOUT_MS })
        : window.setTimeout(prewarm, PREWARM_FALLBACK_DELAY_MS);
  }

  private _onTouchStart = (ev: TouchEvent): void => {
    if (this._state === 'settling') {
      return;
    }
    if (ev.touches.length > 1) {
      // A second finger (pinch) is never a page swipe.
      if (this._state === 'panning') {
        this._settle(0, 0);
      } else {
        this._state = 'ignored';
      }
      return;
    }
    const touch = ev.touches[0];
    if (!touch || !this.isEnabled()) {
      return;
    }
    if (!this.isWarm()) {
      this.isWarm.set(true);
    }
    this._touchId = touch.identifier;
    this._startX = touch.clientX;
    this._startY = touch.clientY;
    this._startTime = ev.timeStamp;
    this._samples = [];
    this._state = 'pending';
  };

  private _onTouchMove = (ev: TouchEvent): void => {
    if (this._state !== 'pending' && this._state !== 'panning') {
      return;
    }
    const touch = this._findTouch(ev.touches);
    if (!touch) {
      return;
    }
    if (!this.isEnabled()) {
      // E.g. a task drag started into the host: let go of the page.
      if (this._state === 'panning') {
        this._settle(0, 0);
      } else {
        this._state = 'ignored';
      }
      return;
    }

    if (this._state === 'pending') {
      const claim = classifyGesture(
        touch.clientX - this._startX,
        touch.clientY - this._startY,
        ev.timeStamp - this._startTime,
      );
      if (claim === null) {
        return;
      }
      if (claim === 'other') {
        this._state = 'ignored';
        return;
      }
      this._state = 'panning';
      // Start following from here, so the page does not jump by the threshold.
      this._startX = touch.clientX;
      const track = this._track().nativeElement;
      track.style.transition = 'none';
      track.style.willChange = 'transform';
    }

    if (ev.cancelable) {
      ev.preventDefault();
    }
    this._addSample(touch.clientX, ev.timeStamp);
    this._offsetX = getPanOffset(
      touch.clientX - this._startX,
      this._hasPage(-1),
      this._hasPage(1),
    );
    this._applyOffset(this._offsetX);
  };

  private _onTouchEnd = (ev: TouchEvent): void => {
    const touch = this._findTouch(ev.changedTouches);
    if (!touch) {
      return;
    }
    this._touchId = null;
    if (this._state !== 'panning') {
      if (this._state !== 'settling') {
        this._state = 'idle';
      }
      return;
    }
    this._addSample(touch.clientX, ev.timeStamp);
    const velocityX = getVelocityX(this._samples);
    const direction = getReleaseDirection({
      deltaX: this._offsetX,
      velocityX,
      width: this._host.clientWidth,
      hasPrev: this._hasPage(-1),
      hasNext: this._hasPage(1),
    });
    this._settle(direction, velocityX);
  };

  private _onTouchCancel = (): void => {
    this._touchId = null;
    if (this._state === 'panning') {
      this._settle(0, 0);
    } else if (this._state !== 'settling') {
      this._state = 'idle';
    }
  };

  private _settle(direction: SwipePagerDirection | 0, velocityX: number): void {
    this._cancelSettleListeners?.();
    const settleId = ++this._settleId;
    this._state = 'settling';
    this._settleFromKey = this._currentKey();
    // Read now, not when the release happens later: the neighbour that slides
    // in is the page to navigate to.
    const targetItem =
      direction === 1 ? this.next() : direction === -1 ? this.prev() : null;
    const width = this._host.clientWidth;
    const target = -direction * width;
    const duration = this._isMotionReduced()
      ? 0
      : getSettleDurationMs(target - this._offsetX, velocityX);
    const finish = (): void => {
      if (settleId === this._settleId) {
        this._finishSettle(targetItem);
      }
    };

    if (duration === 0) {
      finish();
      return;
    }

    const track = this._track().nativeElement;
    const onTransitionEnd = (ev: TransitionEvent): void => {
      if (ev.target === track && ev.propertyName === 'transform') {
        this._cancelSettleListeners?.();
        finish();
      }
    };
    const timeout = window.setTimeout(() => {
      this._cancelSettleListeners?.();
      finish();
    }, duration + SETTLE_FALLBACK_SLACK_MS);
    track.addEventListener('transitionend', onTransitionEnd);
    this._cancelSettleListeners = () => {
      track.removeEventListener('transitionend', onTransitionEnd);
      window.clearTimeout(timeout);
      this._cancelSettleListeners = undefined;
    };

    track.style.willChange = 'transform';
    track.style.transition = `transform ${duration}ms ${SETTLE_EASING}`;
    this._applyOffset(target);
  }

  private _finishSettle(targetItem: T | null): void {
    if (targetItem === null || targetItem === undefined) {
      this._resetTrack();
      return;
    }
    const settleId = this._settleId;
    const focusIndex = this._focusIndexInCurrentPage();
    // The page change below is this settle's own, not one to abort for.
    this._settleFromKey = this.trackKey()(targetItem);
    // The host swaps `current`; the pages are keyed, so the neighbour's view is
    // moved into the centre slot. Reset the track only once that has rendered,
    // otherwise the old page flashes back for a frame.
    this.navigate.emit(targetItem);
    this._cdr.markForCheck();
    afterNextRender(
      () => {
        if (settleId !== this._settleId) {
          return;
        }
        this._resetTrack();
        this._restoreFocus(focusIndex);
        const queued = this._queuedSteps.shift();
        if (queued) {
          this.go(queued);
        }
      },
      { injector: this._injector },
    );
  }

  private _resetTrack(): void {
    this._cancelSettleListeners?.();
    this._settleId++;
    const track = this._track().nativeElement;
    track.style.transition = 'none';
    track.style.transform = '';
    track.style.willChange = '';
    this._offsetX = 0;
    this._samples = [];
    this._state = 'idle';
  }

  // The old page turns inert once the new one is current, which drops focus to
  // the document. Keep keyboard users on the matching control of the new page.
  private _focusIndexInCurrentPage(): number {
    const page = this._currentPageEl();
    const active = document.activeElement;
    if (!page || !active || !page.contains(active)) {
      return -1;
    }
    return Array.from(page.querySelectorAll(FOCUSABLE)).indexOf(active);
  }

  private _restoreFocus(index: number): void {
    if (index === -1) {
      return;
    }
    const focusables = this._currentPageEl()?.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (focusables?.length) {
      focusables[Math.min(index, focusables.length - 1)].focus({ preventScroll: true });
    }
  }

  private _currentPageEl(): HTMLElement | null {
    return this._track().nativeElement.querySelector(':scope > .page:not([inert])');
  }

  private _isMotionReduced(): boolean {
    return (
      !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ||
      document.body.classList.contains(BodyClass.isDisableAnimations)
    );
  }

  private _addSample(x: number, t: number): void {
    this._samples.push({ x, t });
    while (this._samples.length > 2 && t - this._samples[0].t > VELOCITY_WINDOW_MS) {
      this._samples.shift();
    }
  }

  private _applyOffset(offsetX: number): void {
    this._track().nativeElement.style.transform = `translate3d(${offsetX}px, 0, 0)`;
  }

  private _hasPage(direction: SwipePagerDirection): boolean {
    const item = direction === 1 ? this.next() : this.prev();
    return item !== null && item !== undefined;
  }

  private _findTouch(touches: TouchList): Touch | null {
    for (let i = 0; i < touches.length; i++) {
      if (touches[i].identifier === this._touchId) {
        return touches[i];
      }
    }
    return null;
  }
}
