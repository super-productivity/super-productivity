import {
  Directive,
  HostListener,
  Input,
  ElementRef,
  OnInit,
  inject,
  OnDestroy,
  Renderer2,
} from '@angular/core';
import { MatMenuTrigger } from '@angular/material/menu';
import { IS_TOUCH_PRIMARY } from '../../../util/is-mouse-primary';
import { Subscription } from 'rxjs';
import { lastMenuOpenTime, setLastMenuOpenTime } from './mat-menu-touch-monkey-patch';

/**
 * Directive to fix Angular Material menu submenu automatic selection on touch devices.
 * This prevents the submenu from immediately selecting an item when it opens under
 * the user's finger near screen edges.
 *
 * Issue: https://github.com/super-productivity/super-productivity/issues/4436
 * Related Angular Components issues:
 * - https://github.com/angular/components/issues/27508
 * - https://github.com/angular/components/pull/14538
 */
@Directive({
  selector: '[menuTouchFix]',
  standalone: true,
})
export class MenuTouchFixDirective implements OnInit, OnDestroy {
  private _elementRef = inject(ElementRef);
  private _renderer = inject(Renderer2);

  @Input() menuTouchFix?: MatMenuTrigger;

  private _touchStartTime: number = 0;
  private _isTouchDevice = IS_TOUCH_PRIMARY;
  private _preventNextClick = false;
  private _subscription?: Subscription;
  private _touchStartX: number = 0;
  private _touchStartY: number = 0;
  private _capturingClickHandler?: (event: MouseEvent) => void;

  ngOnInit(): void {
    if (!this._isTouchDevice) {
      return;
    }

    // Apply CSS class for touch devices
    this._renderer.addClass(this._elementRef.nativeElement, 'touch-menu-item');

    // Listen for menu open events if this is a trigger
    if (this.menuTouchFix) {
      this._subscription = this.menuTouchFix.menuOpened.subscribe(() => {
        this._applyTouchFix();
      });
    }

    // If this is a submenu trigger, add special handling
    const element = this._elementRef.nativeElement;
    if (element.hasAttribute('matMenuTriggerFor')) {
      this._renderer.setStyle(element, 'touch-action', 'manipulation');
    }

    // CRITICAL: Add capturing phase listener to intercept clicks BEFORE Angular template bindings
    // This is necessary because Angular's (click) bindings fire before @HostListener('click')
    this._capturingClickHandler = this._onCapturingClick.bind(this);
    element.addEventListener('click', this._capturingClickHandler, true); // true = capturing phase
  }

  ngOnDestroy(): void {
    this._subscription?.unsubscribe();

    // Clean up capturing phase listener
    if (this._capturingClickHandler) {
      this._elementRef.nativeElement.removeEventListener(
        'click',
        this._capturingClickHandler,
        true,
      );
    }
  }

  /**
   * Capturing phase click handler - runs BEFORE Angular template bindings.
   * This is the key to preventing immediate clicks when submenu opens under finger.
   */
  private _onCapturingClick(event: MouseEvent): void {
    const timeSinceMenuOpen = Date.now() - lastMenuOpenTime;
    const timeSinceTouchStart = Date.now() - this._touchStartTime;
    const element = this._elementRef.nativeElement;
    const isSubmenuTrigger = element.hasAttribute('matMenuTriggerFor');

    // Block clicks that happen too quickly after any menu/submenu opened
    // This prevents accidental selection when submenu appears under finger
    // Only apply aggressive blocking to submenu triggers
    if (
      event.isTrusted &&
      isSubmenuTrigger &&
      lastMenuOpenTime > 0 &&
      timeSinceMenuOpen < 350
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      // Schedule a delayed click if this was a legitimate tap (not too quick)
      if (timeSinceTouchStart >= 100) {
        this._scheduleDelayedClick(event, 350 - timeSinceMenuOpen);
      }
      return;
    }

    // Also block if touch just started (immediate taps) - only for submenu triggers
    if (event.isTrusted && isSubmenuTrigger && timeSinceTouchStart < 100) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
  }

  /**
   * Schedule a delayed click on the correct menu item element.
   */
  private _scheduleDelayedClick(event: MouseEvent, delay: number): void {
    // Find the actual menu item button (not a child element like icon)
    const menuItem = (event.target as HTMLElement).closest(
      '[mat-menu-item]',
    ) as HTMLElement | null;
    if (menuItem) {
      setTimeout(() => {
        // Check element is still in DOM before clicking
        if (document.body.contains(menuItem)) {
          menuItem.click();
        }
      }, delay);
    }
  }

  @HostListener('touchstart', ['$event'])
  onTouchStart(event: TouchEvent): void {
    if (!this._isTouchDevice || !event.touches.length) {
      return;
    }

    this._touchStartTime = Date.now();
    this._touchStartX = event.touches[0].clientX;
    this._touchStartY = event.touches[0].clientY;

    // For submenu triggers, add a delay before allowing interaction
    const element = this._elementRef.nativeElement;
    if (element.hasAttribute('matMenuTriggerFor')) {
      this._preventNextClick = true;

      // Allow clicks after a short delay
      setTimeout(() => {
        this._preventNextClick = false;
      }, 350); // Slightly longer delay for better UX
    }
  }

  @HostListener('touchend', ['$event'])
  onTouchEnd(event: TouchEvent): void {
    if (!this._isTouchDevice || !event.changedTouches.length) {
      return;
    }

    const touch = event.changedTouches[0];
    const deltaX = Math.abs(touch.clientX - this._touchStartX);
    const deltaY = Math.abs(touch.clientY - this._touchStartY);

    // If the touch moved significantly, it might be a scroll gesture
    if (deltaX > 10 || deltaY > 10) {
      this._preventNextClick = true;
      setTimeout(() => {
        this._preventNextClick = false;
      }, 100);
    }
  }

  @HostListener('click', ['$event'])
  onClick(event: MouseEvent): void {
    if (!this._isTouchDevice) {
      return;
    }

    // Only apply the 300ms delay to submenu triggers, not regular menu items
    const element = this._elementRef.nativeElement;
    const isSubmenuTrigger = element.hasAttribute('matMenuTriggerFor');

    // Prevent immediate clicks on submenu triggers only
    const timeSinceTouchStart = Date.now() - this._touchStartTime;
    if (isSubmenuTrigger && (this._preventNextClick || timeSinceTouchStart < 300)) {
      event.preventDefault();
      // Don't call stopPropagation() - we need the event to bubble for menu closing
      this._preventNextClick = false;

      // If this was a legitimate tap (not too quick), simulate the click after delay
      if (timeSinceTouchStart >= 100 && timeSinceTouchStart < 300) {
        this._scheduleDelayedClick(event, 350 - timeSinceTouchStart);
      }
    }
  }

  private _applyTouchFix(): void {
    // Record when the menu opened - shared via monkey patch module
    setLastMenuOpenTime(Date.now());

    // Use requestAnimationFrame to ensure DOM is ready
    requestAnimationFrame(() => {
      // Find the menu panel that just opened
      const menuPanels = document.querySelectorAll('.mat-mdc-menu-panel');
      const latestPanel = Array.from(menuPanels).pop() as HTMLElement;

      if (!latestPanel) {
        return;
      }

      // Add touch-specific class
      this._renderer.addClass(latestPanel, 'touch-menu-panel');

      const menuItems = latestPanel.querySelectorAll('.mat-mdc-menu-item');

      // Temporarily disable pointer events on menu items
      menuItems.forEach((item: Element) => {
        const element = item as HTMLElement;
        this._renderer.setStyle(element, 'pointer-events', 'none');
      });

      // Re-enable after animation completes
      setTimeout(() => {
        menuItems.forEach((item: Element) => {
          const element = item as HTMLElement;
          this._renderer.setStyle(element, 'pointer-events', '');
        });
      }, 350); // Slightly longer than animation duration for safety
    });
  }
}
