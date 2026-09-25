import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { IS_HYBRID_DEVICE, IS_TOUCH_PRIMARY } from '../../../util/is-mouse-primary';
import { isTouchActive } from '../../../util/input-intent';

/**
 * Shared timestamp tracking when any menu opens.
 * Only a fallback for elements that are not inside a stamped panel — the guards
 * read the open time of the panel the clicked item lives in, see
 * `getMenuOpenTimeFor`.
 */
export let lastMenuOpenTime = 0;

/**
 * Update the shared menu open timestamp. Called by the monkey patch.
 */
export const setLastMenuOpenTime = (time: number): void => {
  lastMenuOpenTime = time;
};

/** Per-panel open time, so one panel opening cannot mute another one's taps. */
const MENU_OPEN_TIME_ATTR = 'data-menu-open-time';

/**
 * Record when this panel opened, and keep the global fallback in step.
 *
 * Latest stamp wins: a trigger re-tapped while its panel is still animating
 * closed reuses the same panel element (Material skips `attach()` while the
 * overlay is still attached), so the MutationObserver never fires and only a
 * fresh stamp from the `_setIsOpen` override re-arms the guard for that reopen.
 */
export const stampMenuPanelOpen = (panel: HTMLElement, time = Date.now()): void => {
  panel.setAttribute(MENU_OPEN_TIME_ATTR, String(time));
  setLastMenuOpenTime(time);
};

/**
 * When the panel holding `el` opened.
 *
 * The touch guards below drop clicks that land within `TOUCH_DELAY_MS` of a
 * menu opening, to stop a submenu appearing under the finger from selecting
 * itself (#4436). Keyed to the panel rather than to "the last menu that opened
 * anywhere": a second panel can open between a tap's touchstart and its
 * synthesized click — a hover-opened submenu on a hybrid device, or any menu
 * opened by an unrelated timer — and a global timestamp then silently swallows
 * that perfectly deliberate tap.
 */
export const getMenuOpenTimeFor = (el: Element | null | undefined): number => {
  const stamped = el
    ?.closest(`[${MENU_OPEN_TIME_ATTR}]`)
    ?.getAttribute(MENU_OPEN_TIME_ATTR);
  return stamped ? Number(stamped) : lastMenuOpenTime;
};

const TOUCH_DELAY_MS = 300;

/**
 * True while a click on `el` still falls inside its own menu's guard window.
 *
 * The single decision both touch guards below ask — the document-level capture
 * listener and the `_checkDisabled` override — so neither can drift back to
 * asking "did *a* menu just open" instead of "did *this* menu just open".
 */
export const isWithinMenuOpenGuard = (
  el: Element | null | undefined,
  now = Date.now(),
): boolean => {
  const openTime = getMenuOpenTimeFor(el);
  return openTime > 0 && now - openTime < TOUCH_DELAY_MS;
};

/**
 * Monkey patch for Angular Material menu to fix automatic selection issue on touch devices
 * when submenu opens under user's finger near screen edges.
 *
 * Issue: https://github.com/super-productivity/super-productivity/issues/4436
 * Related: https://github.com/angular/components/issues/27508
 *
 * IMPORTANT: This patch depends on Angular Material internal APIs that may change between versions.
 * If Angular Material is updated and menus break on touch devices, check:
 *
 * 1. Run: npm run test:file src/app/features/tasks/task-context-menu/mat-menu-touch-monkey-patch.spec.ts
 *    - If tests fail, the internal APIs have changed
 *
 * 2. Current API dependencies (as of @angular/material 21.x):
 *    - MatMenuItem.prototype._checkDisabled(event) - click handler we override
 *    - MatMenuTrigger.prototype.openMenu() - we intercept to track timing
 *    - MatMenu.prototype._setIsOpen(isOpen) - covers click and hover reopens
 *    - MatMenu._allItems - QueryList of menu items
 *    - MatMenuItem._elementRef.nativeElement - DOM element access
 *
 * 3. History of API changes:
 *    - Pre-21.x: Used MatMenuItem.prototype._handleClick
 *    - 21.x+: Changed to MatMenuItem.prototype._checkDisabled
 */
export const applyMatMenuTouchMonkeyPatch = (): void => {
  // Store original methods
  const originalOpenMenu = MatMenuTrigger.prototype.openMenu;
  const originalSetIsOpen = MatMenu.prototype._setIsOpen;
  const originalCheckDisabled = (MatMenuItem.prototype as any)._checkDisabled;

  // Hover opens call _openMenu(false), bypassing the public openMenu method.
  // Both paths reach _setIsOpen, even when reusing a still-attached panel.
  MatMenu.prototype._setIsOpen = function (this: MatMenu, isOpen: boolean): void {
    originalSetIsOpen.call(this, isOpen);
    if (isOpen) {
      const panel = document.getElementById(this.panelId);
      if (panel) {
        stampMenuPanelOpen(panel);
      }
    }
  };

  // Override MatMenuTrigger.openMenu
  MatMenuTrigger.prototype.openMenu = function (this: MatMenuTrigger): void {
    setLastMenuOpenTime(Date.now());

    // Call original method
    originalOpenMenu.call(this);

    // Add delay for touch devices
    if (isTouchActive() && this.menu && (this.menu as any)._allItems) {
      // Temporarily disable all menu items
      const items = (this.menu as any)._allItems.toArray();
      items.forEach((item) => {
        const element = item._elementRef.nativeElement as HTMLElement;
        element.style.pointerEvents = 'none';
      });

      // Re-enable after delay
      setTimeout(() => {
        items.forEach((item) => {
          const element = item._elementRef.nativeElement as HTMLElement;
          element.style.pointerEvents = '';
        });
      }, TOUCH_DELAY_MS);
    }
  };

  // Override MatMenuItem._checkDisabled (was _handleClick in older Angular Material versions)
  (MatMenuItem.prototype as any)._checkDisabled = function (
    this: MatMenuItem,
    event: MouseEvent,
  ): void {
    // On touch devices, prevent clicks that happen too quickly after THIS
    // item's own menu opened
    if (
      isTouchActive() &&
      event.isTrusted &&
      isWithinMenuOpenGuard(event.target as Element)
    ) {
      event.preventDefault();
      // stopImmediatePropagation prevents OTHER handlers on the SAME element from firing
      // (stopPropagation only prevents bubbling UP to parent elements)
      event.stopImmediatePropagation();
      return;
    }

    // Call original method for disabled check
    originalCheckDisabled.call(this, event);
  };

  // Use MutationObserver to detect when ANY menu panel appears (including submenus)
  // This is necessary because Angular Material 21 may not call openMenu() for submenus
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      const addedNodes = Array.from(mutation.addedNodes);
      for (const node of addedNodes) {
        if (node instanceof HTMLElement) {
          // Check if a menu panel was added (directly or as descendant)
          if (node.classList?.contains('mat-mdc-menu-panel')) {
            stampMenuPanelOpen(node);
          }
          node
            .querySelectorAll?.('.mat-mdc-menu-panel')
            .forEach((panel) => stampMenuPanelOpen(panel as HTMLElement));
        }
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // CRITICAL: Add document-level capturing listener to intercept clicks on menu items
  // BEFORE they reach Angular's event handlers. Adding capturing listener to the
  // target element itself doesn't work because Angular's handlers run at the same phase.
  document.addEventListener(
    'click',
    (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target) return;

      // Check if click is on a menu item (or inside one)
      const menuItem = target.closest('.mat-mdc-menu-item');
      if (!menuItem) return;

      // Block clicks that happen too quickly after THIS item's menu opened
      if (isTouchActive() && event.isTrusted && isWithinMenuOpenGuard(menuItem)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true, // CAPTURING phase - runs before target's handlers
  );

  // Note: Menu positioning edge fixes are handled by the CSS touch fixes instead
  // to avoid conflicts with Angular Material's internal positioning strategy
};

/**
 * Call this function once during app initialization to apply the monkey patch
 */
export const initializeMatMenuTouchFix = (): void => {
  if (typeof window !== 'undefined' && (IS_TOUCH_PRIMARY || IS_HYBRID_DEVICE)) {
    // Apply patch after Angular Material is loaded
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', applyMatMenuTouchMonkeyPatch);
    } else {
      // If DOM is already loaded, apply immediately
      setTimeout(applyMatMenuTouchMonkeyPatch, 0);
    }
  }
};
