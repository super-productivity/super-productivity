import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  OnDestroy,
  output,
  signal,
  untracked,
} from '@angular/core';
import { fadeAnimation } from '../../ui/animations/fade.ani';
import { DomSanitizer, SafeStyle } from '@angular/platform-browser';
import { LanguageService } from '../../core/language/language.service';
import { IS_TOUCH_PRIMARY } from '../../util/is-mouse-primary';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';
import { filter, map, startWith, switchMap } from 'rxjs/operators';
import { of, Subscription, timer } from 'rxjs';
import { SwipeDirective } from '../../ui/swipe-gesture/swipe.directive';
import { CssString, StyleObject, StyleObjectToString } from '../../util/styles';
import { LS } from '../../core/persistence/storage-keys.const';
import { readNumberLSBounded } from '../../util/ls-util';
import { MatIconModule } from '@angular/material/icon';
import { MatRippleModule } from '@angular/material/core';
import { RightPanelContentComponent } from './right-panel-content.component';
import { TaskService } from '../tasks/task.service';
import { LayoutService } from '../../core-ui/layout/layout.service';
import { Store } from '@ngrx/store';
import { hidePluginPanel } from '../../core-ui/layout/store/layout.actions';
import {
  INITIAL_LAYOUT_STATE,
  selectLayoutFeatureState,
} from '../../core-ui/layout/store/layout.reducer';
import { isInputElement } from '../../util/dom-element';
import { BottomPanelStateService } from '../../core-ui/bottom-panel-state.service';
import { slideRightPanelAni } from './slide-right-panel-out.ani';
import { BottomPanelContainerComponent } from '../bottom-panel/bottom-panel-container.component';
import { MatBottomSheet, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { PanelContentService } from '../panels/panel-content.service';
// Right panel resize constants
const RIGHT_PANEL_CONFIG = {
  DEFAULT_WIDTH: 320,
  MIN_WIDTH: 250,
  MAX_WIDTH: '50%',
  RESIZABLE: true,
  CLOSE_THRESHOLD: 200,
} as const;

// Performance and interaction constants
const DRAG_CONFIG = {
  THROTTLE_MS: 16, // ~60fps for smooth dragging
  THRESHOLD_PX: 5, // pixels of movement to start drag
} as const;

// Helper function for max width calculation
const getMaxWidthInPixels = (maxWidth: number | string): number => {
  if (typeof maxWidth === 'string' && maxWidth.endsWith('%')) {
    const percentage = parseFloat(maxWidth);
    // Calculate based on main content container width (viewport minus side nav)
    const mainContent = document.querySelector('.main-content') as HTMLElement;
    const containerWidth = mainContent ? mainContent.clientWidth : window.innerWidth;
    return (containerWidth * percentage) / 100;
  }
  return typeof maxWidth === 'number' ? maxWidth : parseFloat(maxWidth.toString());
};

// Helper function to validate and clamp width within bounds
const clampWidth = (width: number, maxWidth: number | string): number => {
  const maxWidthInPixels = getMaxWidthInPixels(maxWidth);
  return Math.max(RIGHT_PANEL_CONFIG.MIN_WIDTH, Math.min(maxWidthInPixels, width));
};

@Component({
  selector: 'right-panel',
  templateUrl: './right-panel.component.html',
  styleUrls: ['./right-panel.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [fadeAnimation, slideRightPanelAni],
  imports: [SwipeDirective, MatIconModule, MatRippleModule, RightPanelContentComponent],
  host: {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    '[class.isOpen]': 'isOpen()',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    '[class.resizing]': 'isResizing()',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    '[class.windowResizing]': 'isWindowResizing()',
  },
  standalone: true,
})
export class RightPanelComponent implements AfterViewInit, OnDestroy {
  private _layoutService = inject(LayoutService);
  private _domSanitizer = inject(DomSanitizer);
  private _languageService = inject(LanguageService);
  private _router = inject(Router);
  private _taskService = inject(TaskService);
  private _store = inject(Store);
  private _bottomPanelState = inject(BottomPanelStateService);
  private _panelContentService = inject(PanelContentService);

  readonly sideWidth = input<number>(40);
  readonly wasClosed = output<void>();

  readonly isRTL = this._languageService.isLangRTL;

  // Convert observables to signals to match right-panel-content logic
  private readonly _selectedTask = toSignal(this._taskService.selectedTask$, {
    initialValue: null,
  });

  private readonly _taskDetailPanelTargetPanel = toSignal(
    this._taskService.taskDetailPanelTargetPanel$,
    { initialValue: null },
  );

  private readonly _layoutFeatureState = toSignal(
    this._store.select(selectLayoutFeatureState),
    {
      initialValue: INITIAL_LAYOUT_STATE,
    },
  );

  private readonly _currentRoute = toSignal(
    this._router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
      startWith(this._router.url),
    ),
    { initialValue: this._router.url },
  );

  // Determine if there is content to show in any panel
  private readonly _hasPanelContent = computed<boolean>(() =>
    this._panelContentService.getCanOpen(),
  );

  // Get isOpen for the right side panel (desktop/non-xs only)
  readonly isOpen = computed<boolean>(() => {
    // If bottom sheet is open, keep right panel closed for mutual exclusion
    if (this._bottomPanelState.isOpen()) return false;
    return this._hasPanelContent() && !this._layoutService.isXs();
  });

  // Resize functionality
  readonly currentWidth = signal<number>(RIGHT_PANEL_CONFIG.DEFAULT_WIDTH);
  readonly isResizing = signal(false);
  readonly isWindowResizing = signal(false);
  private readonly _startX = signal(0);
  private readonly _startWidth = signal(0);

  // Store bound functions to prevent memory leaks
  private readonly _boundOnPointerMove = this._handlePointerMove.bind(this);
  private readonly _boundOnPointerUp = this._handlePointerUp.bind(this);
  private readonly _boundOnWindowResize = this._throttledWindowResize.bind(this);
  private _bottomSheet = inject(MatBottomSheet);
  private _bottomSheetRef: MatBottomSheetRef<BottomPanelContainerComponent> | null = null;
  private _bottomSheetSubscription: Subscription | null = null;

  // Track listener state to prevent double attachment/removal
  private _isListenersAttached = false;

  // Performance optimization for drag events
  private _lastDragTime = 0;
  private _lastResizeTime = 0;
  private _windowResizeDebounceTimer: number | undefined;

  // Close button drag detection
  private _closeButtonDragStart = { x: 0, y: 0 };
  private _isCloseButtonDragCandidate = false;

  // Computed panel width for CSS binding
  readonly panelWidth = computed(() => this.currentWidth());

  readonly sideStyle = computed<SafeStyle>(() => {
    const styles =
      this._getWidthRelatedStyles() +
      (this._shouldSkipAnimation() ? ' transition: none;' : '');
    return this._domSanitizer.bypassSecurityTrustStyle(styles);
  });

  // Skip animations during navigation using RxJS
  private readonly _skipAnimationDuringNav = toSignal(
    this._router.events.pipe(
      filter(
        (event) => event instanceof NavigationStart || event instanceof NavigationEnd,
      ),
      map((event) => event instanceof NavigationStart),
      // When navigation starts, immediately return true
      // When navigation ends, delay returning false by 100ms
      switchMap((isNavigating) =>
        isNavigating ? of(true) : timer(100).pipe(map(() => false)),
      ),
      startWith(false), // Start with animations enabled
    ),
    { initialValue: false },
  );

  // Computed signal that determines if animations should be skipped
  private readonly _shouldSkipAnimation = computed(() => this._skipAnimationDuringNav());

  // Effect to handle bottom sheet opening/closing on xs screens
  private _bottomSheetEffect = effect(() => {
    const isXs = this._layoutService.isXs();
    const hasContent = this._hasPanelContent();

    untracked(() => {
      // Close bottom sheet immediately when switching from xs to non-xs screens
      if (!isXs && this._bottomSheetRef) {
        this._bottomSheetRef.dismiss();
        this._bottomSheetRef = null;
        return;
      }

      // Only handle bottom sheet on xs screens
      if (isXs) {
        if (hasContent && !this._bottomSheetRef) {
          // Open bottom sheet

          this._bottomSheetRef = this._bottomSheet.open(BottomPanelContainerComponent, {
            hasBackdrop: true,
            closeOnNavigation: false,
            panelClass: 'bottom-panel-sheet',
            // Let CSS handle positioning and height
          });

          // Handle bottom sheet dismissal
          this._bottomSheetSubscription = this._bottomSheetRef
            .afterDismissed()
            .subscribe(() => {
              this._bottomSheetRef = null;
              this._bottomSheetSubscription = null;
              this.close();
            });
        } else if (!hasContent && this._bottomSheetRef) {
          // Close bottom sheet
          this._bottomSheetRef.dismiss();
          this._bottomSheetRef = null;
        }
      }
    });
  });

  ngAfterViewInit(): void {
    this._initializeWidth();
    // Add window resize listener for percentage-based max width
    window.addEventListener('resize', this._boundOnWindowResize);
  }

  ngOnDestroy(): void {
    // Clean up resize state if active (emergency cleanup)
    if (this.isResizing()) {
      this._handleDragEnd();
    }

    // Clean up window resize debounce timer
    if (this._windowResizeDebounceTimer) {
      window.clearTimeout(this._windowResizeDebounceTimer);
      this._windowResizeDebounceTimer = undefined;
    }

    // Remove window resize listener
    window.removeEventListener('resize', this._boundOnWindowResize);

    // Clean up bottom sheet if open
    if (this._bottomSheetRef) {
      this._bottomSheetRef.dismiss();
      this._bottomSheetRef = null;
    }

    // Clean up bottom sheet subscription
    if (this._bottomSheetSubscription) {
      this._bottomSheetSubscription.unsubscribe();
      this._bottomSheetSubscription = null;
    }
  }

  private _throttledWindowResize(): void {
    // Throttle resize events for better performance
    const now = Date.now();
    if (now - this._lastResizeTime < DRAG_CONFIG.THROTTLE_MS * 2) return; // 32ms throttle
    this._lastResizeTime = now;

    this._handleWindowResize();
  }

  private _handleWindowResize(): void {
    // Set window resizing state to prevent scrollbar conflicts
    this.isWindowResizing.set(true);

    // Clear previous debounce timer
    if (this._windowResizeDebounceTimer) {
      window.clearTimeout(this._windowResizeDebounceTimer);
    }

    // Only recalculate if using percentage-based max width
    if (
      typeof RIGHT_PANEL_CONFIG.MAX_WIDTH === 'string' &&
      RIGHT_PANEL_CONFIG.MAX_WIDTH.endsWith('%')
    ) {
      // Defer measurement until after the layout settles to avoid reading stale widths
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const newMaxWidthInPixels = getMaxWidthInPixels(RIGHT_PANEL_CONFIG.MAX_WIDTH);
          if (newMaxWidthInPixels < RIGHT_PANEL_CONFIG.MIN_WIDTH) {
            return;
          }

          const currentWidth = this.currentWidth();

          // If current width exceeds new max width, clamp it
          if (currentWidth > newMaxWidthInPixels) {
            const clampedWidth = Math.max(
              RIGHT_PANEL_CONFIG.MIN_WIDTH,
              newMaxWidthInPixels,
            );
            this.currentWidth.set(clampedWidth);
            this._saveWidthToStorage();
          }
        });
      });
    }

    // Debounce: wait 300ms after last resize event to unset flag
    this._windowResizeDebounceTimer = window.setTimeout(() => {
      this.isWindowResizing.set(false);
      this._windowResizeDebounceTimer = undefined;
    }, 300);
  }

  close(): void {
    // FORCE blur because otherwise task notes won't save
    if (IS_TOUCH_PRIMARY) {
      const activeElement = document.activeElement as HTMLElement;
      if (activeElement && isInputElement(activeElement)) {
        activeElement.blur();
      }
    }

    // Delegate to task service and layout service to close the panel
    this._taskService.setSelectedId(null);
    this._layoutService.hideNotes();
    this._layoutService.hideAddTaskPanel();
    this._layoutService.hideTaskViewCustomizerPanel();
    this._layoutService.hideScheduleDayPanel();
    this._store.dispatch(hidePluginPanel());

    this.wasClosed.emit();
  }

  private _getWidthRelatedStyles(): CssString {
    const isOpen = this.isOpen();

    // Use the current panel width for resize functionality
    const px = this.panelWidth();
    const widthVal = px > 0 ? `${px}px` : `${this.sideWidth()}%`;

    const styles: StyleObject = { width: isOpen ? widthVal : '0' };

    return StyleObjectToString(styles);
  }

  // Resize functionality methods
  onResizePointerDown(event: PointerEvent): void {
    if (!RIGHT_PANEL_CONFIG.RESIZABLE || this._isListenersAttached) return;

    this.isResizing.set(true);
    this._layoutService.isPanelResizing.set(true);
    this._activePointerId = event.pointerId;
    this._startX.set(event.clientX);
    this._startWidth.set(this.currentWidth());

    // Improve pointer capture for consistent drag behavior
    const targetEl = event.target as Element | null;
    if (targetEl) {
      try {
        targetEl.setPointerCapture(event.pointerId);
        this._activePointerCaptureEl = targetEl;
      } catch {
        // ignore capture errors (e.g., non-capturable targets)
      }
    }

    this._attachResizeListeners(event.pointerType === 'touch');

    this._isCloseButtonDragCandidate = false;
    event.preventDefault();
  }

  // Mouse-specific resize logic removed; unified in pointer handlers

  private _handleDragEnd(): void {
    if (!this.isResizing() && !this._isListenersAttached) return;

    this.isResizing.set(false);
    this._layoutService.isPanelResizing.set(false);
    this._isListenersAttached = false;
    this._detachResizeListeners();

    // Save width to localStorage with error handling
    this._saveWidthToStorage();
  }

  private _activePointerId: number | null = null;
  private _activePointerCaptureEl: Element | null = null;

  private _handlePointerMove(event: PointerEvent): void {
    if (!this.isResizing()) return;
    if (this._activePointerId !== null && event.pointerId !== this._activePointerId)
      return;

    const now = Date.now();
    if (now - this._lastDragTime < DRAG_CONFIG.THROTTLE_MS) {
      event.preventDefault();
      return;
    }
    this._lastDragTime = now;

    const deltaX = this._startX() - event.clientX;
    const potentialWidth = this._startWidth() + deltaX;
    const isCollapsing = deltaX < 0;

    if (potentialWidth < RIGHT_PANEL_CONFIG.CLOSE_THRESHOLD && isCollapsing) {
      this.isResizing.set(false);
      this._isListenersAttached = false;
      this._detachResizeListeners();
      this.close();
      event.preventDefault();
      return;
    }

    const newWidth = clampWidth(potentialWidth, RIGHT_PANEL_CONFIG.MAX_WIDTH);
    this.currentWidth.set(newWidth);
    event.preventDefault();
  }

  private _handlePointerUp(event: PointerEvent): void {
    if (this._activePointerId !== null && event.pointerId !== this._activePointerId)
      return;
    if (!this.isResizing() && !this._isListenersAttached) return;

    this.isResizing.set(false);
    this._layoutService.isPanelResizing.set(false);
    this._isListenersAttached = false;
    this._activePointerId = null;
    if (this._activePointerCaptureEl) {
      try {
        this._activePointerCaptureEl.releasePointerCapture(event.pointerId);
      } catch {
        // ignore release errors
      }
      this._activePointerCaptureEl = null;
    }

    this._detachResizeListeners();

    this._saveWidthToStorage();
  }

  // Pointer support for edge close handle drag-to-resize
  onCloseButtonPointerDown(event: PointerEvent): void {
    this._closeButtonDragStart = { x: event.clientX, y: event.clientY };
    this._isCloseButtonDragCandidate = true;

    const onMove = (moveEvent: PointerEvent): void => {
      if (!this._isCloseButtonDragCandidate) return;
      const deltaX = Math.abs(moveEvent.clientX - this._closeButtonDragStart.x);
      const deltaY = Math.abs(moveEvent.clientY - this._closeButtonDragStart.y);
      if (deltaX > DRAG_CONFIG.THRESHOLD_PX || deltaY > DRAG_CONFIG.THRESHOLD_PX) {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        // Start pointer-based resize session
        this.onResizePointerDown(moveEvent);
      }
      moveEvent.preventDefault();
    };

    const onUp = (): void => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      this._isCloseButtonDragCandidate = false;
    };

    document.addEventListener('pointermove', onMove, { passive: false });
    document.addEventListener('pointerup', onUp, { passive: true });

    event.preventDefault();
  }

  // Centralized listener/body style handling to keep logic tidy
  private _attachResizeListeners(isTouch: boolean): void {
    this._isListenersAttached = true;
    document.addEventListener('pointermove', this._boundOnPointerMove, {
      passive: false,
    });
    document.addEventListener('pointerup', this._boundOnPointerUp, { passive: true });
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    if (isTouch) {
      document.body.style.setProperty('touch-action', 'none');
    }
  }

  private _detachResizeListeners(): void {
    document.removeEventListener('pointermove', this._boundOnPointerMove);
    document.removeEventListener('pointerup', this._boundOnPointerUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.body.style.setProperty('touch-action', '');
  }

  onCloseButtonPointerUp(event: PointerEvent): void {
    if (this.isResizing()) {
      this._isCloseButtonDragCandidate = false;
      return;
    }
    const dx = Math.abs(event.clientX - this._closeButtonDragStart.x);
    const dy = Math.abs(event.clientY - this._closeButtonDragStart.y);
    if (dx < DRAG_CONFIG.THRESHOLD_PX && dy < DRAG_CONFIG.THRESHOLD_PX) {
      this.close();
    }
    this._isCloseButtonDragCandidate = false;
  }

  private _saveWidthToStorage(): void {
    try {
      localStorage.setItem(LS.RIGHT_PANEL_WIDTH, this.currentWidth().toString());
    } catch (error) {
      console.warn('Failed to save right panel width to localStorage:', error);
    }
  }

  private _initializeWidth(): void {
    try {
      const maxWidthInPixels = getMaxWidthInPixels(RIGHT_PANEL_CONFIG.MAX_WIDTH);

      // Load saved width from localStorage or use default
      const savedWidth = readNumberLSBounded(
        LS.RIGHT_PANEL_WIDTH,
        RIGHT_PANEL_CONFIG.MIN_WIDTH,
        maxWidthInPixels,
      );

      const width = savedWidth ?? RIGHT_PANEL_CONFIG.DEFAULT_WIDTH;

      // Additional validation
      if (!Number.isFinite(width) || width < RIGHT_PANEL_CONFIG.MIN_WIDTH) {
        console.warn('Invalid right panel width detected, using default');
        this.currentWidth.set(RIGHT_PANEL_CONFIG.DEFAULT_WIDTH);
        return;
      }

      // Ensure width doesn't exceed current max width (important for percentage-based max width)
      const validatedWidth = clampWidth(width, RIGHT_PANEL_CONFIG.MAX_WIDTH);
      this.currentWidth.set(validatedWidth);
    } catch (error) {
      console.warn('Failed to initialize right panel width:', error);
      this.currentWidth.set(RIGHT_PANEL_CONFIG.DEFAULT_WIDTH);
    }
  }

  protected readonly IS_TOUCH_PRIMARY = IS_TOUCH_PRIMARY;
}
