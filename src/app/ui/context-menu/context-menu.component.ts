import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  input,
  OnInit,
  TemplateRef,
  viewChild,
} from '@angular/core';
import {
  MatMenu,
  MatMenuContent,
  MatMenuItem,
  MatMenuTrigger,
} from '@angular/material/menu';
import { MatIconButton } from '@angular/material/button';
import { NgTemplateOutlet } from '@angular/common';
import { isTouchActive } from '../../util/input-intent';
import { UI_LONG_PRESS_DURATION, UI_LONG_PRESS_MOVE_TOLERANCE_PX } from '../ui.const';
import { performHapticFeedback } from '../../util/haptic-feedback';

@Component({
  selector: 'context-menu',
  imports: [MatMenu, MatMenuTrigger, MatMenuContent, NgTemplateOutlet],
  templateUrl: './context-menu.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
})
export class ContextMenuComponent implements OnInit {
  leftClickTriggerEl = input<HTMLElement | MatMenuItem | MatIconButton | undefined>();
  rightClickTriggerEl = input.required<HTMLElement | MatMenuItem | MatIconButton>();
  contextMenu = input.required<TemplateRef<any>>();
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

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this._isDestroyed = true;
      window.clearTimeout(this._longPressTimeout);
    });
  }

  ngOnInit(): void {
    const tEl = this.rightClickTriggerEl();
    const el = tEl instanceof HTMLElement ? tEl : (tEl as any)._elementRef.nativeElement;

    // On touch devices, skip contextmenu/longpress to avoid conflicting
    // with cdkDragStartDelay. The context menu is still accessible via the
    // leftClickTriggerEl (three-dots / more_vert button), or via
    // isTouchLongPress, which tells a long-press from a drag by movement.
    el.addEventListener('contextmenu', (ev) => {
      if (!isTouchActive()) {
        this.openContextMenu(ev);
      } else if (this.isTouchLongPress()) {
        // The long-press handler below opens it; keep the browser's own
        // long-press menu or text selection out of the way.
        ev.preventDefault();
      }
    });
    el.addEventListener('longPressIOS', (ev) => {
      if (!isTouchActive()) {
        this.openContextMenu(ev);
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
        this.openContextMenu(ev);
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
          isOpenedByPress = this.openContextMenu(ev);
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

  private openContextMenu(event: TouchEvent | MouseEvent): boolean {
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
    this.contextMenuPosition.x =
      ('touches' in event ? event.touches[0].clientX : event.clientX) + 'px';
    const rawY = 'touches' in event ? event.touches[0].clientY : event.clientY;
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
