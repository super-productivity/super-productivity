import { TaskMultiDragService } from '../../features/tasks/task-multi-drag.service';
/* eslint-disable @typescript-eslint/naming-convention */
import {
  afterNextRender,
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  HostListener,
  inject,
  Injector,
  input,
  linkedSignal,
  OnDestroy,
  output,
  signal,
  untracked,
} from '@angular/core';
import { NavigationStart, Router, RouterModule } from '@angular/router';
import { NavItemComponent } from './nav-item/nav-item.component';
import { NavListTreeComponent } from './nav-list/nav-list-tree.component';
import { NavItem } from './magic-side-nav.model';
import { LS } from '../../core/persistence/storage-keys.const';
import { MagicNavConfigService } from './magic-nav-config.service';
import { lsSetItem, readBoolLS, readNumberLSBounded } from '../../util/ls-util';
import { getPointerPosition } from '../../util/get-pointer-position';
import { MatMenuModule } from '@angular/material/menu';
import { NavMatMenuComponent } from './nav-mat-menu/nav-mat-menu.component';
import { TaskService } from '../../features/tasks/task.service';
import { LayoutService } from '../layout/layout.service';
import { magicSideNavAnimations } from './magic-side-nav.animations';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { filter, take } from 'rxjs/operators';
import { Subscription } from 'rxjs';
import { ScheduleExternalDragService } from '../../features/schedule/schedule-week/schedule-external-drag.service';
import { Log } from '../../core/log';
import { TODAY_TAG } from '../../features/tag/tag.const';
import { DragDropRegistry } from '@angular/cdk/drag-drop';
import { CdkTrapFocus, FocusMonitor } from '@angular/cdk/a11y';
import { WorkContextType } from '../../features/work-context/work-context.model';
import { HISTORY_STATE } from '../../app.constants';
import { isTouchActive } from '../../util/input-intent';
import { SwipeDirective } from '../../ui/swipe-gesture/swipe.directive';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../t.const';

// 56px = 24px icon + 16px (var(--s2)) padding on each side, so the left-aligned
// nav icons sit centered in the collapsed rail.
const COLLAPSED_WIDTH = 56;
const MOBILE_NAV_WIDTH = 300;
const FOCUS_DELAY_MS = 10;
const INITIAL_ENTER_ANIMATION_DURATION_MS = 425;
// `--transition-duration-l` (375ms) plus a 50ms buffer — the duration the panel
// animates its width over (`--sidenav-transition-duration` in the stylesheet).
// The timeout is a fixed timer rather than a `transitionend` listener, so the
// buffer is what keeps it from firing before the width has settled and clipping
// the last of the collapse; the two numbers have to move together.
const SIDENAV_WIDTH_ANIMATION_DURATION_MS = 425;

@Component({
  selector: 'magic-side-nav',
  standalone: true,
  imports: [
    RouterModule,
    NavItemComponent,
    NavListTreeComponent,
    MatMenuModule,
    NavMatMenuComponent,
    SwipeDirective,
    CdkTrapFocus,
    TranslatePipe,
  ],
  templateUrl: './magic-side-nav.component.html',
  styleUrl: './magic-side-nav.component.scss',
  host: {
    '[style.width.px]': 'hostWidthSignal()',
    '[class.animate]': 'animateWidth()',
    '[class.initial-shell-enter]': 'playInitialShellEnter()',
    '[class.initial-enter]': 'playInitialEnter()',
    '[class.initializing]': '!areTransitionsReady()',
    '[class.resizing]': 'isResizing()',
  },
  animations: magicSideNavAnimations,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MagicSideNavComponent implements OnDestroy, AfterViewInit {
  private readonly _elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly _injector = inject(Injector);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _sideNavConfigService = inject(MagicNavConfigService);
  private readonly _taskService = inject(TaskService);
  private readonly _layoutService = inject(LayoutService);
  private readonly _dataInitStateService = inject(DataInitStateService);
  private readonly _router = inject(Router);
  private _dragDropRegistry = inject(DragDropRegistry);
  private _multiDrag = inject(TaskMultiDragService);
  private _externalDragService = inject(ScheduleExternalDragService);
  private readonly _focusMonitor = inject(FocusMonitor);
  private _pointerUpSubscription: Subscription | null = null;

  // Use service's computed signal directly
  readonly config = this._sideNavConfigService.navConfig;
  private readonly _isDataLoaded = toSignal(
    this._dataInitStateService.isAllDataLoadedInitially$,
    { initialValue: false },
  );
  readonly isDataLoaded = computed(
    () => this._isDataLoaded() && this._sideNavConfigService.areInitialTreesReady(),
  );
  readonly WorkContextType = WorkContextType;
  readonly T = T;
  readonly isMobile = this._layoutService.isXs;
  private readonly _initialState = this._getInitialState();

  activeWorkContextId = input<string | null>(null);

  // Externally controlled mobile overlay visibility
  mobileVisibleChange = output<boolean>();

  isFullMode = signal(this._initialState.isFullMode);
  showMobileMenuOverlay = signal(false);
  readonly isMobileNavOpen = computed(
    () => this.isMobile() && this.showMobileMenuOverlay(),
  );
  // Sticky: once opened, the mobile drawer is hidden rather than destroyed, so
  // later opens skip rebuilding every nav row (#10820). Boot still skips it.
  readonly isMobileNavRendered = linkedSignal<boolean, boolean>({
    source: this.isMobileNavOpen,
    computation: (isOpen, previous) => isOpen || !!previous?.value,
  });
  // True during the drawer's enter animation. Swipe is off so the touch from the
  // toggle button is not captured as a swipe, and taps are ignored so repeated
  // taps on a slow device do not hit the drawer row that slid under the
  // finger (#10820: "Create New Tag" opened instead).
  isOpeningMobileNav = signal(false);
  private _focusBeforeMobileNavOpen: HTMLElement | null = null;

  // Animate only for compactMode/fullMode toggle
  animateWidth = signal(false);
  areTransitionsReady = signal(false);
  playInitialShellEnter = signal(false);
  playInitialEnter = signal(false);
  private _hasPlayedInitialShellEnter = false;
  private _hasPlayedInitialEnter = false;
  private _animateTimeoutId: number | null = null;
  private _initialShellEnterTimeoutId: number | null = null;
  private _initialEnterTimeoutId: number | null = null;

  // Resize functionality
  currentWidth = signal(this._initialState.currentWidth);
  // Use values directly from config for min/max/thresholds
  isResizing = signal(false);
  startX = signal(0);
  startWidth = signal(0);

  // Computed values
  sidenavWidth = computed(() => {
    if (this.isMobile()) return MOBILE_NAV_WIDTH;
    if (!this.isFullMode()) return COLLAPSED_WIDTH;
    return this.currentWidth();
  });

  // Host width as computed signal: don't reserve space on mobile overlay
  readonly hostWidthSignal = computed(() => (this.isMobile() ? 0 : this.sidenavWidth()));

  // Commonly used derived state for template readability
  readonly showText = computed(() => this.isFullMode() || this.isMobile());

  // Keep stable references for event listeners to ensure proper cleanup
  private readonly _onDrag: (event: MouseEvent) => void = (event: MouseEvent) =>
    this._handleDrag(event);
  private readonly _onDragEnd: () => void = () => this._handleDragEnd();

  constructor() {
    let wasMobile = this.isMobile();
    effect(() => {
      const isMobile = this.isMobile();
      if (!wasMobile && isMobile) {
        untracked(() => this.showMobileMenuOverlay.set(false));
      }
      wasMobile = isMobile;
    });

    // Emit mobile visible changes to parent while in mobile mode
    effect(() => {
      if (this.isMobile()) {
        this.mobileVisibleChange.emit(this.showMobileMenuOverlay());
      }
    });

    // Lets app-level overlays (onboarding tips) step aside while the menu is open.
    effect(() => {
      this._layoutService.isMobileSideNavOpen.set(
        this.isMobile() && this.showMobileMenuOverlay(),
      );
    });

    // The drawer is no longer destroyed on close, so the focus trap does not
    // restore focus by itself; hand it back to where it was before opening.
    effect(() => {
      const isOpen = this.isMobileNavOpen();
      untracked(() => {
        if (isOpen) {
          this._focusBeforeMobileNavOpen = document.activeElement as HTMLElement | null;
          return;
        }
        const previous = this._focusBeforeMobileNavOpen;
        this._focusBeforeMobileNavOpen = null;
        // Resized to desktop: the drawer became the regular nav, keep focus there.
        if (!this.isMobile()) return;
        const active = document.activeElement as HTMLElement | null;
        if (active && this._elementRef.nativeElement.contains(active)) {
          // Blur first: with no focusable opener, focus would stay on a hidden row.
          active.blur();
          previous?.focus();
        }
      });
    });

    // Sync history state with mobile menu visibility status
    effect(() => {
      this.syncMobileNavHistory(this.showMobileMenuOverlay());
    });

    // Drop the focus ring on the menu button whichever way the menu closed.
    // Tapping a destination (`onItemClick`) and a route change both set the
    // signal directly instead of going through `toggleMobileNav()`, so this
    // watches the open to closed transition rather than a single caller.
    let wasMobileNavOpen = this.showMobileMenuOverlay();
    effect(() => {
      const isOpen = this.showMobileMenuOverlay();
      const wasOpen = wasMobileNavOpen;
      wasMobileNavOpen = isOpen;
      if (wasOpen && !isOpen) {
        untracked(() => {
          if (this.isMobile() && isTouchActive()) {
            this._restoreTouchFocusOrigin();
          }
        });
      }
    });

    effect(() => {
      const isFullMode = this.isFullMode();
      if (!this.isMobile()) {
        lsSetItem(LS.NAV_SIDEBAR_EXPANDED, isFullMode.toString());
      }
    });

    effect(() => {
      const width = this.currentWidth();
      if (!this.isMobile()) {
        lsSetItem(LS.NAV_SIDEBAR_WIDTH, width.toString());
      }
    });

    // Listen for focus trigger from LayoutService
    effect(() => {
      const trigger = this._layoutService.focusSideNavTrigger();
      if (trigger > 0) {
        // Small delay to ensure DOM is ready
        window.setTimeout(() => {
          this.toggleNavFocus();
        });
      }
    });

    effect(() => {
      const trigger = this._layoutService.toggleSideNavModeTrigger();
      if (trigger > 0) {
        untracked(() => {
          if (!this.isMobile()) this.toggleSideNavMode();
        });
      }
    });

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        this.areTransitionsReady.set(true);
      });
    });

    effect(() => {
      if (
        this._hasPlayedInitialShellEnter ||
        !this.areTransitionsReady() ||
        this.playInitialShellEnter() ||
        this._initialShellEnterTimeoutId != null
      ) {
        return;
      }

      this._hasPlayedInitialShellEnter = true;
      this.playInitialShellEnter.set(true);
      this._initialShellEnterTimeoutId = window.setTimeout(() => {
        this.playInitialShellEnter.set(false);
        this._initialShellEnterTimeoutId = null;
      }, INITIAL_ENTER_ANIMATION_DURATION_MS);
    });

    effect(() => {
      if (
        this._hasPlayedInitialEnter ||
        !this.areTransitionsReady() ||
        !this.isDataLoaded() ||
        this.playInitialEnter() ||
        this._initialEnterTimeoutId != null
      ) {
        return;
      }

      this._hasPlayedInitialEnter = true;
      this.playInitialEnter.set(true);
      this._initialEnterTimeoutId = window.setTimeout(() => {
        this.playInitialEnter.set(false);
        this._initialEnterTimeoutId = null;
      }, INITIAL_ENTER_ANIMATION_DURATION_MS);
    });

    this._router.events
      .pipe(
        filter((event): event is NavigationStart => event instanceof NavigationStart),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe(() => {
        if (this.isMobile() && this.showMobileMenuOverlay()) {
          this.showMobileMenuOverlay.set(false);
        }
      });
  }

  ngOnDestroy(): void {
    if (this._animateTimeoutId != null) {
      window.clearTimeout(this._animateTimeoutId);
      this._animateTimeoutId = null;
    }

    if (this._initialShellEnterTimeoutId != null) {
      window.clearTimeout(this._initialShellEnterTimeoutId);
      this._initialShellEnterTimeoutId = null;
    }

    if (this._initialEnterTimeoutId != null) {
      window.clearTimeout(this._initialEnterTimeoutId);
      this._initialEnterTimeoutId = null;
    }

    if (this._pointerUpSubscription) {
      this._pointerUpSubscription.unsubscribe();
      this._pointerUpSubscription = null;
    }
  }

  ngAfterViewInit(): void {
    // Listen for global pointer releases while a drag is active
    this._pointerUpSubscription = this._dragDropRegistry.pointerUp.subscribe((event) => {
      this._handlePointerUp(event);
    });
  }

  onNavKeyDown(event: KeyboardEvent): void {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      this._handleArrowNavigation(event);
    } else if (event.key === 'Escape') {
      this._handleEscapeKey(event);
    }
  }

  private _getInitialState(): {
    currentWidth: number;
    isFullMode: boolean;
  } {
    const config = this.config();
    const isMobile = this.isMobile();

    if (isMobile) {
      return {
        currentWidth: config.defaultWidth,
        isFullMode: config.fullModeByDefault,
      };
    }

    return {
      currentWidth:
        readNumberLSBounded(LS.NAV_SIDEBAR_WIDTH, config.minWidth, config.maxWidth) ??
        config.defaultWidth,
      isFullMode: readBoolLS(LS.NAV_SIDEBAR_EXPANDED, config.fullModeByDefault),
    };
  }

  toggleMobileNav(): void {
    // A second toggle while the drawer slides in is a repeated tap, not a
    // request to close. Closed by any other path (back, route, item), the
    // next tap opens it again.
    // shortcut: an earlier open's timer may end a quick reopen's guard early —
    // track and clear the timer if that ever shows up as a misfire.
    if (this.isOpeningMobileNav() && this.showMobileMenuOverlay()) return;
    const isOpening = !this.showMobileMenuOverlay();
    this.showMobileMenuOverlay.update((show) => !show);

    if (isOpening && this.isMobile()) {
      this.isOpeningMobileNav.set(true);
      // Count from the render that starts the slide-in: a slow first render
      // would otherwise use up the window before the drawer moves.
      afterNextRender(
        () => {
          window.setTimeout(() => {
            this.isOpeningMobileNav.set(false);
          }, 300); // Match animation duration (225ms) + buffer
        },
        { injector: this._injector },
      );
    }
  }

  /**
   * Re-announce the restored focus as touch, so the trigger does not keep a
   * focus ring after the menu closes.
   *
   * `cdkTrapFocusAutoCapture` returns focus to whatever was focused when the
   * trap opened, and a bare `focus()` call reaches the FocusMonitor as origin
   * `program`. Material paints a persistent 12% state layer for
   * `cdk-program-focused`, so the menu button stayed visibly highlighted after
   * a tap. Only the origin is wrong here: returning focus to the trigger is
   * what a keyboard or screen reader user needs, so the focus itself stays put
   * and this runs only while touch is the active input.
   *
   * Deferred because the trap restores focus only after the overlay is torn
   * down; read any earlier, `document.activeElement` is still inside the menu.
   */
  private _restoreTouchFocusOrigin(): void {
    window.setTimeout(() => {
      const el = document.activeElement;
      if (el instanceof HTMLElement && el !== document.body) {
        this._focusMonitor.focusVia(el, 'touch');
      }
    });
  }

  onMobileNavSwipeRight(): void {
    if (this.isMobile() && this.showMobileMenuOverlay()) {
      this.toggleMobileNav();
    }
  }

  /** Handle "back" button to hide mobile menu overlay */
  @HostListener('window:popstate') onBack(): void {
    // Bypasses the opening guard: a swallowed back would lose the history entry.
    if (this.isMobile() && this.showMobileMenuOverlay()) {
      this.showMobileMenuOverlay.set(false);
    }
  }

  /** Synchronize window history state with the visibility of the mobile menu overlay */
  syncMobileNavHistory(isVisible: boolean): void {
    if (!this.isMobile()) return;

    const historyState = window.history.state?.[HISTORY_STATE.MOBILE_NAVIGATION];
    const hasState = historyState !== undefined;

    // Mobile menu is hidden and already no state in history - nothing to do
    if (!isVisible && !hasState) return;

    // Mobile menu is visible - update history state
    if (isVisible) {
      const args = { state: { [HISTORY_STATE.MOBILE_NAVIGATION]: true }, title: '' };
      if (!hasState) window.history.pushState(args.state, args.title);
      else window.history.replaceState(args.state, args.title);
    }

    // Mobile menu is visible but still has state in history - restore it
    else window.history.back();
  }

  toggleSideNavMode(): void {
    this._enableWidthAnimation();
    const newFullMode = !this.isFullMode();
    this.isFullMode.set(newFullMode);
  }

  isGroupExpanded(item: NavItem): boolean {
    // Use the service as the source of truth for all expansion state
    if (item.id === 'projects') {
      return this._sideNavConfigService.isProjectsExpanded();
    } else if (item.id === 'tags') {
      return this._sideNavConfigService.isTagsExpanded();
    }
    // For other groups, default to expanded (or extend service to manage all groups)
    return true;
  }

  onItemClick(item: NavItem): void {
    if (item.type === 'tree') {
      // All groups now handled consistently through service
      if (item.action) {
        item.action();
      }
      return;
    }

    // Single dispatcher for everything but tree items
    this._sideNavConfigService.onNavItemClick(item);

    if (this.isMobile()) {
      this.showMobileMenuOverlay.set(false);
    }
  }

  // Resize functionality
  onResizeStart(event: MouseEvent): void {
    if (!this.config().resizable || this.isMobile()) return;

    this.isResizing.set(true);
    this._layoutService.isPanelResizing.set(true);
    this.startX.set(event.clientX);
    this.startWidth.set(this.isFullMode() ? this.currentWidth() : COLLAPSED_WIDTH);

    document.addEventListener('mousemove', this._onDrag);
    document.addEventListener('mouseup', this._onDragEnd);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    event.preventDefault();
  }

  private _handleDrag(event: MouseEvent): void {
    if (!this.isResizing()) return;

    const deltaX =
      // this.config().position === 'right'
      //   ? this.startX() - event.clientX
      event.clientX - this.startX();

    const potentialWidth = this.startWidth() + deltaX;
    const { collapseThreshold, expandThreshold, minWidth, maxWidth } = this.config();

    // Handle seamless mode transitions
    if (this.isFullMode()) {
      // Currently fullMode - check for compactMode threshold
      if (potentialWidth < collapseThreshold) {
        // Auto-switch to compactMode without releasing mouse
        this.isFullMode.set(false);

        // Reset starting point for continued dragging from compactMode state
        this.startWidth.set(COLLAPSED_WIDTH);
        this.startX.set(event.clientX);

        return;
      }

      // Normal resize when fullMode
      const newWidth = Math.max(minWidth, Math.min(maxWidth, potentialWidth));
      this.currentWidth.set(newWidth);
    } else {
      // Currently compactMode - check for fullMode threshold
      const compactModeWidth = COLLAPSED_WIDTH;
      const draggedWidth = compactModeWidth + deltaX;

      if (draggedWidth > expandThreshold) {
        // Auto-switch to fullMode without releasing mouse
        this.isFullMode.set(true);
        const newWidth = expandThreshold + 20; // Start slightly beyond threshold
        this.currentWidth.set(newWidth);

        // Reset starting point for continued dragging from fullMode state
        this.startWidth.set(this.currentWidth());
        this.startX.set(event.clientX);

        return;
      }
    }
  }

  private _handleDragEnd(): void {
    if (!this.isResizing()) return;

    this.isResizing.set(false);
    this._layoutService.isPanelResizing.set(false);
    document.removeEventListener('mousemove', this._onDrag);
    document.removeEventListener('mouseup', this._onDragEnd);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';

    // Final width already persisted continuously; no-op here
  }

  private _enableWidthAnimation(): void {
    if (this._animateTimeoutId != null) {
      window.clearTimeout(this._animateTimeoutId);
      this._animateTimeoutId = null;
    }
    this.animateWidth.set(true);
    // Slightly longer than --sidenav-transition-duration to ensure cleanup runs
    // after the width has settled instead of cutting it short
    this._animateTimeoutId = window.setTimeout(() => {
      this.animateWidth.set(false);
      this._animateTimeoutId = null;
    }, SIDENAV_WIDTH_ANIMATION_DURATION_MS);
  }

  private _handleArrowNavigation(event: KeyboardEvent): void {
    // Get all focusable elements in the nav
    const focusableElements = this._getFocusableNavElements();

    if (focusableElements.length === 0) {
      return;
    }

    const activeElement = document.activeElement as HTMLElement;
    const currentIndex = focusableElements.indexOf(activeElement);

    event.preventDefault();
    event.stopPropagation();

    let nextIndex: number;
    if (currentIndex === -1) {
      // No nav element focused, focus first element
      nextIndex = 0;
    } else if (event.key === 'ArrowDown') {
      nextIndex = (currentIndex + 1) % focusableElements.length;
    } else if (event.key === 'ArrowUp') {
      nextIndex = currentIndex === 0 ? focusableElements.length - 1 : currentIndex - 1;
    } else {
      return;
    }

    focusableElements[nextIndex]?.focus();
  }

  private _getFocusableNavElements(): HTMLElement[] {
    const nav = document.querySelector('.nav-sidenav');
    if (!nav) {
      return [];
    }

    // Get the sidenav toggle button first (if visible)
    const toggleButton = nav.querySelector('.mode-toggle') as HTMLElement;
    const focusableElements: HTMLElement[] = [];

    if (toggleButton) {
      const styles = window.getComputedStyle(toggleButton);
      if (styles.display !== 'none' && styles.visibility !== 'hidden') {
        toggleButton.setAttribute('tabindex', '0');
        focusableElements.push(toggleButton);
      }
    }

    // Get all nav-link elements (these are the actual clickable items)
    // Also get any mat-menu-item elements which are used for nav items
    const selector = '.nav-link, [mat-menu-item]';
    const allElements = Array.from(nav.querySelectorAll(selector)) as HTMLElement[];

    // Filter to only get elements within the nav-list
    const navList = nav.querySelector('.nav-list');
    if (!navList) {
      return focusableElements; // Return just the toggle if no nav list
    }

    const navListElements = allElements.filter((el) => {
      // Make sure the element is inside nav-list
      const isInNavList = navList.contains(el);

      // Check if it's actually interactive (button or link)
      const tagName = el.tagName.toLowerCase();
      const isInteractive = tagName === 'button' || tagName === 'a';

      // Check visibility
      const styles = window.getComputedStyle(el);
      const isVisible =
        styles.display !== 'none' &&
        styles.visibility !== 'hidden' &&
        styles.opacity !== '0';

      // Exclude settings buttons and other non-navigation buttons
      const isSettingsBtn = el.classList.contains('additional-btn');

      return isInNavList && isInteractive && isVisible && !isSettingsBtn;
    });

    // Set tabindex on nav list elements to make them focusable
    navListElements.forEach((el) => {
      if (!el.hasAttribute('tabindex') || el.getAttribute('tabindex') === '-1') {
        el.setAttribute('tabindex', '0');
      }
    });

    // Combine toggle button (if present) with nav list elements
    const allFocusable = [...focusableElements, ...navListElements];

    return allFocusable;
  }

  private _handleEscapeKey(event: KeyboardEvent): void {
    // Unfocus any currently focused navigation element
    const activeElement = document.activeElement as HTMLElement;
    const navSidebar = document.querySelector('.nav-sidenav');

    // Check if the currently focused element is within the navigation
    if (navSidebar && navSidebar.contains(activeElement)) {
      event.preventDefault();
      event.stopPropagation();

      if (this.isMobile() && this.showMobileMenuOverlay()) {
        this.showMobileMenuOverlay.set(false);
        return;
      }

      this._unfocusNavAndFocusTask();
    }
  }

  private _unfocusNavAndFocusTask(): void {
    const activeElement = document.activeElement as HTMLElement;
    if (activeElement?.blur) {
      activeElement.blur();
    }
    setTimeout(() => {
      this._taskService.focusFirstTaskIfVisible();
    }, FOCUS_DELAY_MS);
  }

  // Public method to toggle nav focus (for keyboard shortcuts)
  toggleNavFocus(): void {
    // Check if any nav element is currently focused
    const activeElement = document.activeElement as HTMLElement;
    const navSidebar = document.querySelector('.nav-sidenav');
    const isNavFocused = navSidebar && navSidebar.contains(activeElement);

    // If on mobile
    if (this.isMobile()) {
      if (this.showMobileMenuOverlay()) {
        // If mobile overlay is open and nav is focused, close it
        if (isNavFocused) {
          this.showMobileMenuOverlay.set(false);
          this._unfocusNavAndFocusTask();
        } else {
          // Mobile overlay is open but nav not focused, focus it
          this._focusFirstNavElement();
        }
      } else {
        // Mobile overlay is closed, open it and focus
        this.showMobileMenuOverlay.set(true);
        setTimeout(() => {
          this._focusFirstNavElement();
        });
      }
      return;
    }

    // Desktop behavior: toggle focus
    if (isNavFocused) {
      // Nav is already focused, unfocus it
      this._unfocusNavAndFocusTask();
    } else {
      // Nav is not focused, focus it
      this._focusFirstNavElement();
    }
  }

  private _focusFirstNavElement(): void {
    const focusableElements = this._getFocusableNavElements();
    if (focusableElements.length > 0) {
      focusableElements[0].focus();
    }
  }

  private _handlePointerUp(event: MouseEvent | TouchEvent): void {
    const ids = [...this._multiDrag.ids()];
    if (ids.length > 1) {
      if (this._multiDrag.isCancelled()) return;
      const position = getPointerPosition(event);
      const projectId = position
        ? document
            .elementFromPoint(position.x, position.y)
            ?.closest('nav-item[data-project-id]')
            ?.getAttribute('data-project-id')
        : null;
      if (projectId) {
        this._externalDragService.setCancelNextDrop(true);
        this._externalDragService
          .activeDragRef()
          ?.ended.pipe(take(1))
          .subscribe(() => {
            void this._multiDrag.moveToProject(projectId, ids);
          });
      }
      return;
    }
    const draggedTask = this._externalDragService.activeTask();

    // exclude recurring tasks
    if (!draggedTask || draggedTask.repeatCfgId) {
      return;
    }

    const pointerPos = getPointerPosition(event);
    if (!pointerPos) {
      return;
    }

    const navItemElement = document
      .elementFromPoint(pointerPos.x, pointerPos.y)
      ?.closest('nav-item');
    if (!navItemElement) {
      return;
    }

    if (navItemElement.hasAttribute('data-project-id')) {
      // Task is dropped on a project

      // Exclude subtasks dragged on projects
      if (draggedTask.parentId) {
        return;
      }

      const projectId = navItemElement.getAttribute('data-project-id');
      Log.debug('Task dropped on Project', { taskId: draggedTask.id, projectId });

      // We do not want to change the order of the task list if we drop
      // to a project or a tag in the main nav
      // As there is no way to to cancel a cdk drag action properly,
      // we mark the next drop action to be ignored
      this._externalDragService.setCancelNextDrop(true);

      // also we want the drag action to be finished, before we move the task
      // to a different project, otherwise the drag action might throw an error,
      // if the dom element is removed before the return animation has finished
      const dragref = this._externalDragService.activeDragRef();
      dragref?.ended.pipe(take(1)).subscribe(() => {
        this._taskService.moveToProject(draggedTask, projectId!);
      });
    } else if (navItemElement.hasAttribute('data-tag-id')) {
      // Task is dropped on a tag
      const tagId = navItemElement.getAttribute('data-tag-id');
      Log.debug('Task dropped on Tag', { taskId: draggedTask.id, tagId });

      this._externalDragService.setCancelNextDrop(true);

      // Special case: "Today" tag means to schedule task for today
      if (tagId === TODAY_TAG.id) {
        this._taskService.addToToday(draggedTask);
      } else {
        if (!draggedTask.tagIds.includes(tagId!)) {
          // tag not yet assigned to task, add it
          this._taskService.updateTags(draggedTask, [...draggedTask.tagIds, tagId!]);
        } else {
          // tag already assigned to task, remove it
          this._taskService.updateTags(
            draggedTask,
            draggedTask.tagIds.filter((t) => t !== tagId),
          );
        }
      }
    }

    this._externalDragService.setActiveTask(null);
  }
}
