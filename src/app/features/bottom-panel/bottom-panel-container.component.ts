import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  NgZone,
  OnDestroy,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { TaskDetailPanelComponent } from '../tasks/task-detail-panel/task-detail-panel.component';
import { NotesComponent } from '../note/notes/notes.component';
import { IssuePanelComponent } from '../issue-panel/issue-panel.component';
import { TaskViewCustomizerPanelComponent } from '../task-view-customizer/task-view-customizer-panel/task-view-customizer-panel.component';
import { PluginPanelContainerComponent } from '../../plugins/ui/plugin-panel-container/plugin-panel-container.component';
import { fadeAnimation } from '../../ui/animations/fade.ani';
import { taskDetailPanelTaskChangeAnimation } from '../tasks/task-detail-panel/task-detail-panel.ani';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { TaskService } from '../tasks/task.service';
import { Log } from '../../core/log';
import { PanelContentService, PanelContentType } from '../panels/panel-content.service';
import { BottomPanelStateService } from '../../core-ui/bottom-panel-state.service';
import { IS_TOUCH_ONLY } from '../../util/is-touch-only';

export interface BottomPanelData {
  panelContent: PanelContentType;
}

// Panel height constants
const PANEL_HEIGHTS = {
  MAX_HEIGHT: 0.8,
  MIN_HEIGHT: 0.2,
  MAX_HEIGHT_ABSOLUTE: 0.98,
  TASK_PANEL_HEIGHT: 0.6,
  OTHER_PANEL_HEIGHT: 0.9,
  VELOCITY_THRESHOLD: 0.5, // px/ms — minimum flick velocity for momentum snap
  DISMISS_DISTANCE_RATIO: 0.35, // fraction of start height to trigger dismiss on release
  INITIAL_ANIMATION_BLOCK_DURATION: 300, // ms
  SNAP_BACK_DURATION: 220, // ms — return-to-rest transition
  DISMISS_DURATION: 240, // ms — slide-out transition before dismiss
  EXPAND_DURATION: 260, // ms — flick-up expand transition
  GESTURE_START_THRESHOLD: 6, // px — content gesture only commits after this much movement
} as const;

const KEYBOARD_DETECT_THRESHOLD = 100; // px - minimum height change to detect keyboard
const KEYBOARD_SAFE_HEIGHT_MIN = 200; // px - minimal safe panel height while keyboard visible
const KEYBOARD_SAFE_HEIGHT_RATIO = 0.85; // fraction of visual viewport height
const KEYBOARD_RESIZE_DEBOUNCE_MS = 100; // ms - debounce viewport resize events

@Component({
  selector: 'bottom-panel-container',
  templateUrl: './bottom-panel-container.component.html',
  styleUrls: ['./bottom-panel-container.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [fadeAnimation, taskDetailPanelTaskChangeAnimation],
  imports: [
    MatIconModule,
    MatButtonModule,
    TaskDetailPanelComponent,
    NotesComponent,
    IssuePanelComponent,
    TaskViewCustomizerPanelComponent,
    PluginPanelContainerComponent,
  ],
  standalone: true,
})
export class BottomPanelContainerComponent implements AfterViewInit, OnDestroy {
  private _bottomSheetRef = inject(MatBottomSheetRef<BottomPanelContainerComponent>);
  private _elementRef = inject(ElementRef);
  private _taskService = inject(TaskService);
  private _bottomPanelState = inject(BottomPanelStateService);
  private _panelContentService = inject(PanelContentService);
  private _ngZone = inject(NgZone);
  readonly data = inject<BottomPanelData | null>(MAT_BOTTOM_SHEET_DATA, {
    optional: true,
  });

  readonly panelHeader = viewChild<ElementRef>('panelHeader');
  readonly panelContentEl = viewChild<ElementRef>('panelContent');

  readonly panelContent = computed<PanelContentType | null>(() => {
    const dataContent = this.data?.panelContent ?? null;
    return dataContent ?? this._panelContentService.getCurrentPanelType();
  });
  readonly selectedTask = toSignal(this._taskService.selectedTask$, {
    initialValue: null,
  });
  readonly isDisableTaskPanelAni = signal(true); // Always start with animation disabled

  private _isDragging = false;
  private _startY = 0;
  private _startHeight = 0;
  private _lastY = 0;
  private _lastTime = 0;
  private _velocity = 0;
  private _activePointerId: number | null = null;
  private _activePointerTarget: HTMLElement | null = null;
  // Content-area swipe detection (deferred — only commits if gesture is downward at scroll-top)
  private _pendingContentDrag = false;
  private _pendingStartY = 0;
  private _pendingScroller: HTMLElement | null = null;
  private _disableAniTimeout?: number;
  private _cachedContainer: HTMLElement | null = null;

  // Mobile keyboard handling
  private _isKeyboardWatcherInitialized = false;
  private _originalHeight: string = '';
  private _vvResizeTimer: number | null = null;

  // Store bound functions to prevent memory leaks
  private readonly _boundOnHeaderPointerDown = this._onHeaderPointerDown.bind(this);
  private readonly _boundOnContentPointerDown = this._onContentPointerDown.bind(this);
  private readonly _boundOnPointerMove = this._onPointerMove.bind(this);
  private readonly _boundOnPointerUp = this._onPointerUp.bind(this);
  private readonly _boundOnViewportResize = this._onViewportResize.bind(this);

  ngAfterViewInit(): void {
    // Mark bottom panel as open for mutual exclusion with right panel
    this._bottomPanelState.isOpen.set(true);
    this._setupDragListeners();
    this._setupKeyboardWatcher();
    this._setInitialHeight();

    // Re-enable animations after initial render is complete
    this._disableAniTimeout = window.setTimeout(() => {
      this.isDisableTaskPanelAni.set(false);
    }, PANEL_HEIGHTS.INITIAL_ANIMATION_BLOCK_DURATION);
  }

  ngOnDestroy(): void {
    this._removeDragListeners();
    this._removeKeyboardWatcher();
    window.clearTimeout(this._disableAniTimeout);
    this._cachedContainer = null; // Clear cached reference
    // Mark bottom panel as closed
    this._bottomPanelState.isOpen.set(false);
  }

  close(): void {
    this._bottomSheetRef.dismiss();
  }

  private _setupDragListeners(): void {
    const panelHeader = this.panelHeader()?.nativeElement as HTMLElement | undefined;
    const panelContent = this.panelContentEl()?.nativeElement as HTMLElement | undefined;

    if (panelHeader) {
      panelHeader.addEventListener('pointerdown', this._boundOnHeaderPointerDown);
    }
    // Content swipe-to-dismiss is only useful on touch and would otherwise
    // collide with mouse interactions (e.g. text selection inside notes).
    if (panelContent && IS_TOUCH_ONLY) {
      panelContent.addEventListener('pointerdown', this._boundOnContentPointerDown);
    }
    // Move/up listeners are attached to document so the gesture survives leaving the source el.
    document.addEventListener('pointermove', this._boundOnPointerMove, {
      passive: false,
    });
    document.addEventListener('pointerup', this._boundOnPointerUp);
    document.addEventListener('pointercancel', this._boundOnPointerUp);
  }

  private _removeDragListeners(): void {
    const panelHeader = this.panelHeader()?.nativeElement as HTMLElement | undefined;
    const panelContent = this.panelContentEl()?.nativeElement as HTMLElement | undefined;
    if (panelHeader) {
      panelHeader.removeEventListener('pointerdown', this._boundOnHeaderPointerDown);
    }
    if (panelContent) {
      panelContent.removeEventListener('pointerdown', this._boundOnContentPointerDown);
    }
    document.removeEventListener('pointermove', this._boundOnPointerMove);
    document.removeEventListener('pointerup', this._boundOnPointerUp);
    document.removeEventListener('pointercancel', this._boundOnPointerUp);
  }

  // Header gesture: commits immediately and supports both directions
  // (downward = drag-to-dismiss via translate, upward = expand via height).
  private _onHeaderPointerDown(event: PointerEvent): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    this._activePointerTarget = event.currentTarget as HTMLElement | null;
    this._startDrag(event);
  }

  // Content gesture: deferred. Only commits to a drag once we see the user
  // moving downward AND the underlying scroller is at the top — otherwise we
  // let native scrolling take over.
  private _onContentPointerDown(event: PointerEvent): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (this._isDragging) return;

    const target = event.target as HTMLElement | null;
    // Don't intercept gestures aimed at interactive controls or CDK drag
    // handles — they own their own pointer flow (text selection, drag-and-
    // drop, taps), and arming a competing gesture causes nondeterministic
    // breakage in those subsystems.
    if (this._isGestureExempt(target)) return;

    const scroller = this._findScrollerAt(target);
    // No point arming the gesture if the user is already scrolled inside content.
    if (scroller && scroller.scrollTop > 0) return;

    this._pendingContentDrag = true;
    this._pendingStartY = event.clientY;
    this._pendingScroller = scroller;
    this._activePointerId = event.pointerId;
    this._activePointerTarget = target;
  }

  private _isGestureExempt(target: HTMLElement | null): boolean {
    if (!target) return false;
    const closest = target.closest?.bind(target);
    if (!closest) return false;
    return !!closest(
      'input, textarea, select, button, [contenteditable="true"], [cdkDrag], [cdkDragHandle]',
    );
  }

  private _onPointerMove(event: PointerEvent): void {
    if (this._pendingContentDrag && event.pointerId === this._activePointerId) {
      const deltaY = event.clientY - this._pendingStartY;
      if (Math.abs(deltaY) < PANEL_HEIGHTS.GESTURE_START_THRESHOLD) return;

      const scrolledFromTop =
        this._pendingScroller && this._pendingScroller.scrollTop > 0;
      // Commit only on a downward gesture starting from scroll-top.
      if (deltaY > 0 && !scrolledFromTop) {
        this._pendingContentDrag = false;
        this._startDrag(event, this._pendingStartY);
        event.preventDefault();
      } else {
        // Upward or already scrolling — abandon, let native handlers run.
        this._pendingContentDrag = false;
        this._pendingScroller = null;
        this._activePointerId = null;
        this._activePointerTarget = null;
      }
      return;
    }

    if (!this._isDragging) return;
    event.preventDefault();
    this._updateDrag(event.clientY);
  }

  private _startDrag(event: PointerEvent, startY: number = event.clientY): void {
    this._isDragging = true;
    this._startY = startY;
    this._lastY = event.clientY;
    this._lastTime = performance.now();
    this._velocity = 0;
    this._activePointerId = event.pointerId;

    const container = this._getSheetContainer();
    if (container) {
      this._startHeight = container.offsetHeight;
      container.classList.add('dragging');
      // Kill any in-flight snap transition so the finger takes over instantly.
      container.style.transition = 'none';
      container.style.transform = 'translateY(0)';
    }
    document.body.style.userSelect = 'none';

    // Capture so we keep getting move/up even if the finger leaves the element.
    const captureTarget = this._activePointerTarget;
    if (captureTarget && typeof captureTarget.setPointerCapture === 'function') {
      try {
        captureTarget.setPointerCapture(event.pointerId);
      } catch {
        /* element may have been removed; safe to ignore */
      }
    }
    this._activePointerTarget = null;

    // Apply current frame immediately so there is no visual lag.
    this._updateDrag(event.clientY);
  }

  private _updateDrag(clientY: number): void {
    const container = this._getSheetContainer();
    if (!container) return;

    const deltaY = clientY - this._startY; // positive = moved down
    const viewportHeight = window.innerHeight;

    if (deltaY >= 0) {
      // Downward — translate (GPU-accelerated, no layout reflow).
      container.style.transform = `translateY(${deltaY}px)`;
      // Make sure any prior height growth is preserved at start height.
      container.style.height = `${this._startHeight}px`;
      container.style.maxHeight = `${this._startHeight}px`;
    } else {
      // Upward — grow height (top edge moves up; bottom stays anchored).
      const minHeight = viewportHeight * PANEL_HEIGHTS.MIN_HEIGHT;
      const maxHeight = viewportHeight * PANEL_HEIGHTS.MAX_HEIGHT_ABSOLUTE;
      const newHeight = Math.min(
        Math.max(this._startHeight - deltaY, minHeight),
        maxHeight,
      );
      container.style.transform = 'translateY(0)';
      container.style.height = `${newHeight}px`;
      container.style.maxHeight = `${newHeight}px`;
    }

    // Sliding-window velocity (px/ms). Positive = downward.
    const now = performance.now();
    const timeDiff = now - this._lastTime;
    if (timeDiff > 0) {
      this._velocity = (clientY - this._lastY) / timeDiff;
    }
    this._lastY = clientY;
    this._lastTime = now;
  }

  private _onPointerUp(event: PointerEvent): void {
    if (this._pendingContentDrag && event.pointerId === this._activePointerId) {
      this._pendingContentDrag = false;
      this._pendingScroller = null;
      this._activePointerId = null;
      this._activePointerTarget = null;
      return;
    }
    if (this._isDragging) {
      this._handleDragEnd();
    }
  }

  private _handleDragEnd(): void {
    this._isDragging = false;
    this._activePointerId = null;
    document.body.style.userSelect = '';
    const container = this._getSheetContainer();
    if (!container) return;

    container.classList.remove('dragging');

    const deltaY = this._lastY - this._startY; // positive = moved down
    const viewportHeight = window.innerHeight;
    const flickDown = this._velocity > PANEL_HEIGHTS.VELOCITY_THRESHOLD;
    const flickUp = this._velocity < -PANEL_HEIGHTS.VELOCITY_THRESHOLD;

    if (deltaY > 0) {
      // Was sliding down — decide dismiss vs snap-back.
      const draggedFraction = deltaY / Math.max(this._startHeight, 1);
      const shouldDismiss =
        flickDown || draggedFraction > PANEL_HEIGHTS.DISMISS_DISTANCE_RATIO;

      if (shouldDismiss) {
        // Animate fully off-screen, then dismiss the bottom sheet.
        container.style.transition = `transform ${PANEL_HEIGHTS.DISMISS_DURATION}ms cubic-bezier(0.32, 0.72, 0, 1)`;
        container.style.transform = `translateY(${this._startHeight}px)`;
        window.setTimeout(() => {
          this.close();
        }, PANEL_HEIGHTS.DISMISS_DURATION);
      } else {
        // Spring back to rest.
        container.style.transition = `transform ${PANEL_HEIGHTS.SNAP_BACK_DURATION}ms cubic-bezier(0.22, 1, 0.36, 1)`;
        container.style.transform = 'translateY(0)';
        window.setTimeout(() => {
          container.style.transition = '';
        }, PANEL_HEIGHTS.SNAP_BACK_DURATION);
      }
      return;
    }

    if (deltaY < 0 && flickUp) {
      // Flicked up — expand to max.
      const targetHeight = viewportHeight * PANEL_HEIGHTS.MAX_HEIGHT;
      container.style.transition = `height ${PANEL_HEIGHTS.EXPAND_DURATION}ms ease-out, max-height ${PANEL_HEIGHTS.EXPAND_DURATION}ms ease-out`;
      container.style.height = `${targetHeight}px`;
      container.style.maxHeight = `${targetHeight}px`;
      window.setTimeout(() => {
        container.style.transition = '';
      }, PANEL_HEIGHTS.EXPAND_DURATION);
      return;
    }

    // No-op: leave the panel at whatever height it was dragged to.
    container.style.transition = '';
  }

  private _findScrollerAt(start: HTMLElement | null): HTMLElement | null {
    const root = this.panelContentEl()?.nativeElement as HTMLElement | undefined;
    if (!root || !start) return null;
    let node: HTMLElement | null = start;
    while (node && node !== root.parentElement) {
      if (node.scrollHeight > node.clientHeight) {
        const overflowY = window.getComputedStyle(node).overflowY;
        if (overflowY === 'auto' || overflowY === 'scroll') return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  private _setInitialHeight(): void {
    const container = this._getSheetContainer();
    if (container) {
      const heightRatio =
        this.panelContent() === 'TASK'
          ? PANEL_HEIGHTS.TASK_PANEL_HEIGHT
          : PANEL_HEIGHTS.OTHER_PANEL_HEIGHT;
      const initialHeight = window.innerHeight * heightRatio;
      container.style.height = `${initialHeight}px`;
      container.style.maxHeight = `${initialHeight}px`;
    }
  }

  private _getSheetContainer(): HTMLElement | null {
    if (!this._cachedContainer) {
      try {
        this._cachedContainer = this._elementRef.nativeElement.closest(
          '.mat-bottom-sheet-container',
        );
      } catch (error) {
        Log.warn('Failed to find bottom sheet container:', error);
        return null;
      }
    }
    return this._cachedContainer;
  }

  private _setupKeyboardWatcher(): void {
    if (
      !IS_TOUCH_ONLY ||
      this._isKeyboardWatcherInitialized ||
      typeof window === 'undefined'
    ) {
      return;
    }
    this._isKeyboardWatcherInitialized = true;

    // Use Visual Viewport API if available (modern browsers)
    if ('visualViewport' in window && window.visualViewport) {
      window.visualViewport.addEventListener('resize', this._boundOnViewportResize);
    }
  }

  private _removeKeyboardWatcher(): void {
    if (typeof window !== 'undefined' && window.visualViewport) {
      window.visualViewport.removeEventListener('resize', this._boundOnViewportResize);
    }
    // Restore original height if it was stored
    if (this._originalHeight) {
      const container = this._getSheetContainer();
      if (container) {
        container.style.maxHeight = this._originalHeight;
        container.style.removeProperty('height');
      }
    }
  }

  private _onViewportResize(): void {
    // Debounce rapid viewport resize events while the keyboard animates
    if (this._vvResizeTimer) {
      window.clearTimeout(this._vvResizeTimer);
      this._vvResizeTimer = null;
    }
    this._vvResizeTimer = window.setTimeout(() => {
      this._vvResizeTimer = null;
      this._ngZone.run(() => {
        this._handleViewportResize();
      });
    }, KEYBOARD_RESIZE_DEBOUNCE_MS);
  }

  private _handleViewportResize(): void {
    if (typeof window === 'undefined') return;

    const visualViewport = window.visualViewport;
    if (!visualViewport) return;

    const windowHeight = window.innerHeight;
    const viewportHeight = visualViewport.height;
    const keyboardHeight = windowHeight - viewportHeight;

    // Check if keyboard is visible
    const isKeyboardVisible = keyboardHeight > KEYBOARD_DETECT_THRESHOLD;

    const container = this._getSheetContainer();
    if (!container) return;

    if (isKeyboardVisible) {
      // Store original height if not already stored
      if (!this._originalHeight) {
        this._originalHeight = container.style.maxHeight || '';
      }

      // Calculate safe height - be more conservative
      const safeHeight = Math.max(
        KEYBOARD_SAFE_HEIGHT_MIN,
        viewportHeight * KEYBOARD_SAFE_HEIGHT_RATIO,
      );

      // Use !important to override CSS max-height
      container.style.setProperty('max-height', `${safeHeight}px`, 'important');

      // Force current height if it exceeds the new max
      if (container.offsetHeight > safeHeight) {
        container.style.setProperty('height', `${safeHeight}px`, 'important');
      }
    } else {
      // Restore original height constraints when keyboard is hidden
      // Remove our forced styles
      container.style.removeProperty('max-height');
      container.style.removeProperty('height');

      // Clean up stored height
      this._originalHeight = '';
    }
  }
}
