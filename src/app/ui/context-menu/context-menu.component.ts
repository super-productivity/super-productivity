import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  input,
  OnInit,
  viewChild,
} from '@angular/core';
import { FocusMonitor, InputModalityDetector } from '@angular/cdk/a11y';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { MatIconButton } from '@angular/material/button';
import { isTouchActive } from '../../util/input-intent';
import { UI_LONG_PRESS_DURATION, UI_LONG_PRESS_MOVE_TOLERANCE_PX } from '../ui.const';
import { performHapticFeedback } from '../../util/haptic-feedback';

/**
 * Opens `menu` at the pointer on right-click or long-press, and on a click of
 * `leftClickTriggerEl`.
 */
@Component({
  selector: 'context-menu',
  imports: [MatMenuTrigger],
  templateUrl: './context-menu.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
})
export class ContextMenuComponent implements OnInit {
  leftClickTriggerEl = input<HTMLElement | MatMenuItem | MatIconButton | undefined>();
  rightClickTriggerEl = input.required<HTMLElement | MatMenuItem | MatIconButton>();
  // A menu, not a template of items: MatMenu's arrow keys only reach items
  // written in the template that holds its <mat-menu> (#11403).
  menu = input.required<MatMenu>();
  allowedSelectors = input<string>('');
  isEnabled = input<boolean>(true);
  // Opens the menu on a stationary touch long-press of the right-click trigger.
  // Off by default: most triggers sit in drag lists where long-press means drag.
  // Read once on init, like the trigger elements: bind a constant.
  isTouchLongPress = input<boolean>(false);

  readonly contextMenuTriggerEl = viewChild.required('contextMenuTriggerEl', {
    read: MatMenuTrigger,
  });
  contextMenuPosition: { x: string; y: string } = { x: '0px', y: '0px' };
  private _longPressTimeout: number | undefined;
  private _isDestroyed = false;
  private _returnFocusEl: HTMLElement | undefined;
  private _rightClickEl: HTMLElement | undefined;
  private readonly _focusMonitor = inject(FocusMonitor);
  private readonly _inputModality = inject(InputModalityDetector);

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this._isDestroyed = true;
      window.clearTimeout(this._longPressTimeout);
    });
  }

  ngOnInit(): void {
    const tEl = this.rightClickTriggerEl();
    const el = tEl instanceof HTMLElement ? tEl : (tEl as any)._elementRef.nativeElement;
    this._rightClickEl = el;

    // On touch devices, skip contextmenu/longpress to avoid conflicting
    // with cdkDragStartDelay. The context menu is still accessible via the
    // leftClickTriggerEl (three-dots / more_vert button), or via
    // isTouchLongPress, which tells a long-press from a drag by movement.
    el.addEventListener('contextmenu', (ev) => {
      if (!isTouchActive()) {
        this.openContextMenu(ev, el);
      } else if (this.isTouchLongPress()) {
        // The long-press handler below opens it; keep the browser's own
        // long-press menu or text selection out of the way.
        ev.preventDefault();
      }
    });
    el.addEventListener('longPressIOS', (ev) => {
      if (!isTouchActive()) {
        this.openContextMenu(ev, el);
      }
    });

    if (this.isTouchLongPress()) {
      this._initTouchLongPress(el);
    }

    const leftClickEl = this.leftClickTriggerEl();
    if (leftClickEl) {
      const htmlLeftClickEl =
        leftClickEl instanceof HTMLElement
          ? leftClickEl
          : (leftClickEl as any)._elementRef.nativeElement;
      htmlLeftClickEl.addEventListener('click', (ev) => {
        this.openContextMenu(ev, htmlLeftClickEl);
      });
    }
  }

  private _initTouchLongPress(el: HTMLElement): void {
    let start: { x: number; y: number } | undefined;
    let isOpenedByPress = false;

    el.addEventListener(
      'touchstart',
      (ev: TouchEvent) => {
        window.clearTimeout(this._longPressTimeout);
        isOpenedByPress = false;
        // A row that is animating out (e.g. in a closing drawer) is still in the
        // DOM and still receives touches after its component is destroyed.
        if (this._isDestroyed || ev.touches.length !== 1) {
          start = undefined;
          return;
        }
        start = { x: ev.touches[0].clientX, y: ev.touches[0].clientY };
        this._longPressTimeout = window.setTimeout(() => {
          isOpenedByPress = this.openContextMenu(ev, el);
          if (isOpenedByPress) {
            performHapticFeedback('longPress');
          }
        }, UI_LONG_PRESS_DURATION);
      },
      { passive: true },
    );
    el.addEventListener(
      'touchmove',
      (ev: TouchEvent) => {
        if (!start) {
          return;
        }
        const t = ev.touches[0];
        const distance = Math.abs(t.clientX - start.x) + Math.abs(t.clientY - start.y);
        if (distance >= UI_LONG_PRESS_MOVE_TOLERANCE_PX) {
          window.clearTimeout(this._longPressTimeout);
          start = undefined;
          // Holding on and then moving is a drag: let it have the gesture.
          if (isOpenedByPress) {
            isOpenedByPress = false;
            this.contextMenuTriggerEl().closeMenu();
          }
        }
      },
      { passive: true },
    );
    el.addEventListener('touchend', (ev: TouchEvent) => {
      window.clearTimeout(this._longPressTimeout);
      start = undefined;
      if (isOpenedByPress) {
        // Suppresses the click that would follow: it would navigate the row,
        // or land on the menu backdrop and close the menu again.
        ev.preventDefault();
        isOpenedByPress = false;
      }
    });
    el.addEventListener(
      'touchcancel',
      () => {
        window.clearTimeout(this._longPressTimeout);
        start = undefined;
        isOpenedByPress = false;
      },
      { passive: true },
    );
  }

  /** Bound to the hidden trigger's `menuClosed`. */
  onMenuClosed(): void {
    // Material returns focus to its trigger, which here is a hidden div that
    // cannot take it, so focus fell to <body>. Give it back to the element
    // that opened the menu instead.
    const openerEl = this._returnFocusEl;
    this._returnFocusEl = undefined;
    if (!openerEl) {
      return;
    }
    this._focusWithModality(openerEl);
    // A side-menu row's ⋮ shows only while the row is hovered (desktop), so it
    // may be gone by now: the row is the next best place.
    if (document.activeElement !== openerEl && this._rightClickEl) {
      this._focusWithModality(this._rightClickEl);
    }
  }

  // As Material's own restore: a plain focus() counts as 'program' focus,
  // which menu items and icon buttons highlight, so a menu closed by mouse
  // left its row grey. Tell the focus monitor how the menu was closed.
  private _focusWithModality(el: HTMLElement): void {
    const origin = this._inputModality.mostRecentModality ?? 'program';
    this._focusMonitor.focusVia(el, origin, { preventScroll: true });
  }

  private _getMenuPoint(
    event: TouchEvent | MouseEvent,
    openerEl: HTMLElement,
  ): { x: number; y: number } {
    if ('touches' in event) {
      return { x: event.touches[0].clientX, y: event.touches[0].clientY };
    }
    // A click from Enter or Space has no pointer (detail 0, at 0,0), which put
    // the menu in the window's corner: open it below its button instead.
    if (event.type === 'click' && event.detail === 0) {
      const rect = openerEl.getBoundingClientRect();
      return { x: rect.left, y: rect.bottom };
    }
    return { x: event.clientX, y: event.clientY };
  }

  private openContextMenu(
    event: TouchEvent | MouseEvent,
    openerEl: HTMLElement,
  ): boolean {
    // When disabled the menu must stay inert (e.g. the background menu is only
    // valid on the work-view, not on unrelated pages like Habits). See #7734.
    if (!this.isEnabled()) {
      return false;
    }

    // If allowedSelectors is provided, check if the target matches any of the selectors
    const allowedSelectors = this.allowedSelectors();
    if (allowedSelectors) {
      const target = event.target as HTMLElement;
      const selectors = allowedSelectors.split(',').map((s) => s.trim());

      // Check if the target matches any of the allowed selectors
      let isAllowed = false;
      for (const selector of selectors) {
        if (target.matches(selector)) {
          isAllowed = true;
          break;
        }
      }

      // If target doesn't match any selector, don't open the menu
      if (!isAllowed) {
        return false;
      }
    }

    event.preventDefault();
    event.stopPropagation();
    this._returnFocusEl = openerEl;
    const { x, y: rawY } = this._getMenuPoint(event, openerEl);
    this.contextMenuPosition.x = x + 'px';
    const safeAreaTop =
      parseInt(
        getComputedStyle(document.documentElement).getPropertyValue(
          '--safe-area-inset-top',
        ),
        10,
      ) || 0;
    this.contextMenuPosition.y = Math.max(rawY, safeAreaTop) + 'px';
    const contextMenuTriggerEl = this.contextMenuTriggerEl();
    contextMenuTriggerEl.menuData = {
      x: this.contextMenuPosition.x,
      y: this.contextMenuPosition.y,
    };
    contextMenuTriggerEl.openMenu();
    return true;
  }
}
