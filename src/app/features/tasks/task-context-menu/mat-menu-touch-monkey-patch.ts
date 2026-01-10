import { MatMenuTrigger, MatMenuItem } from '@angular/material/menu';
import { IS_TOUCH_PRIMARY } from '../../../util/is-mouse-primary';

/**
 * Monkey patch for Angular Material menu to fix automatic selection issue on touch devices
 * when submenu opens under user's finger near screen edges.
 *
 * Issue: https://github.com/super-productivity/super-productivity/issues/4436
 * Related: https://github.com/angular/components/issues/27508
 */
export const applyMatMenuTouchMonkeyPatch = (): void => {
  if (!IS_TOUCH_PRIMARY) {
    return;
  }

  // Store original methods
  const originalOpenMenu = MatMenuTrigger.prototype.openMenu;
  const originalHandleClick = (MatMenuItem.prototype as any)._handleClick;

  // Track touch interactions
  let menuOpenTime = 0;
  const TOUCH_DELAY_MS = 300;

  // Override MatMenuTrigger.openMenu
  MatMenuTrigger.prototype.openMenu = function (this: MatMenuTrigger): void {
    menuOpenTime = Date.now();

    // Call original method
    originalOpenMenu.call(this);

    // Add delay for touch devices
    if (this.menu && (this.menu as any)._allItems) {
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

  // Override MatMenuItem._handleClick
  (MatMenuItem.prototype as any)._handleClick = function (
    this: MatMenuItem,
    event: MouseEvent,
  ): void {
    const currentTime = Date.now();
    const timeSinceMenuOpen = currentTime - menuOpenTime;

    // On touch devices, prevent clicks that happen too quickly after menu opens
    if (event.isTrusted && timeSinceMenuOpen < TOUCH_DELAY_MS) {
      event.preventDefault();
      // Don't call stopPropagation() - we need the event to bubble for menu closing

      // Retry the click after the delay period
      const element = (this as any)._elementRef?.nativeElement;
      setTimeout(() => {
        if (!this.disabled && element) {
          // Create a new click event that can properly bubble
          const newEvent = new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: window,
          });
          element.dispatchEvent(newEvent);
        }
      }, TOUCH_DELAY_MS - timeSinceMenuOpen);

      return;
    }

    // Call original method
    originalHandleClick.call(this, event);
  };

  // Add global touch event listener to track touch timing
  document.addEventListener(
    'touchstart',
    () => {
      menuOpenTime = Date.now();
    },
    { passive: true },
  );

  // Note: Menu positioning edge fixes are handled by the CSS touch fixes instead
  // to avoid conflicts with Angular Material's internal positioning strategy
};

/**
 * Call this function once during app initialization to apply the monkey patch
 */
export const initializeMatMenuTouchFix = (): void => {
  if (typeof window !== 'undefined' && IS_TOUCH_PRIMARY) {
    // Apply patch after Angular Material is loaded
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', applyMatMenuTouchMonkeyPatch);
    } else {
      // If DOM is already loaded, apply immediately
      setTimeout(applyMatMenuTouchMonkeyPatch, 0);
    }
  }
};
