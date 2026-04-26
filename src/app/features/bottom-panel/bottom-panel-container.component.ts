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
  VELOCITY_THRESHOLD: 0.5, // px/ms — fling-to-close
  CLOSE_DISTANCE_RATIO: 0.25, // fraction of viewport — slow drag close
  DRAG_INTENT_THRESHOLD: 6, // px before content drag commits
  CLOSE_ANIMATION_MIN_DURATION: 120, // ms
  CLOSE_ANIMATION_MAX_DURATION: 320, // ms
  SNAP_BACK_DURATION: 260, // ms
  EXPAND_ANIMATION_DURATION: 280, // ms
  INITIAL_ANIMATION_BLOCK_DURATION: 300, // ms
} as const;

const DRAG_EASING = 'cubic-bezier(0.22, 0.61, 0.36, 1)';

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

  readonly panelContent = computed<PanelContentType | null>(() => {
    const dataContent = this.data?.panelContent ?? null;
    return dataContent ?? this._panelContentService.getCurrentPanelType();
  });
  readonly selectedTask = toSignal(this._taskService.selectedTask$, {
    initialValue: null,
  });
  readonly isDisableTaskPanelAni = signal(true); // Always start with animation disabled

  private _isDragging = false;
  private _isPotentialDrag = false;
  private _potentialStartX = 0;
  private _potentialStartY = 0;
  private _scrollableEl: HTMLElement | null = null;
  private _scrollableStartTop = 0;
  private _startY = 0;
  private _startHeight = 0;
  private _currentTranslateY = 0;
  private _lastY = 0;
  private _lastTime = 0;
  private _velocity = 0;
  private _disableAniTimeout?: number;
  private _closeAniTimeout?: number;
  private _cachedContainer: HTMLElement | null = null;

  // Mobile keyboard handling
  private _isKeyboardWatcherInitialized = false;
  private _originalHeight: string = '';
  private _vvResizeTimer: number | null = null;

  // Store bound functions to prevent memory leaks
  private readonly _boundOnPointerDown = this._onPointerDown.bind(this);
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
    window.clearTimeout(this._closeAniTimeout);
    this._cachedContainer = null; // Clear cached reference
    // Mark bottom panel as closed
    this._bottomPanelState.isOpen.set(false);
  }

  close(): void {
    this._bottomSheetRef.dismiss();
  }

  private _setupDragListeners(): void {
    const containerEl = this._elementRef.nativeElement as HTMLElement;
    if (!containerEl) return;

    // Listen anywhere on the panel — content-area drags only commit when the
    // inner scroller is at the top, so normal scrolling still works.
    containerEl.addEventListener('pointerdown', this._boundOnPointerDown);
    document.addEventListener('pointermove', this._boundOnPointerMove, {
      passive: false,
    });
    document.addEventListener('pointerup', this._boundOnPointerUp);
    document.addEventListener('pointercancel', this._boundOnPointerUp);
  }

  private _removeDragListeners(): void {
    const containerEl = this._elementRef.nativeElement as HTMLElement;
    if (containerEl) {
      containerEl.removeEventListener('pointerdown', this._boundOnPointerDown);
    }
    document.removeEventListener('pointermove', this._boundOnPointerMove);
    document.removeEventListener('pointerup', this._boundOnPointerUp);
    document.removeEventListener('pointercancel', this._boundOnPointerUp);
  }

  private _onPointerDown(event: PointerEvent): void {
    // Only react to primary button for mouse
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }
    if (this._isDragging || this._isPotentialDrag) return;

    const target = event.target as HTMLElement;
    if (this._isInteractiveTarget(target)) return;

    const isFromHeader = !!target.closest('.bottom-panel-header');
    if (isFromHeader) {
      event.preventDefault();
      this._beginDrag(event.clientY);
      return;
    }

    // Content-area: defer until movement direction is known
    this._isPotentialDrag = true;
    this._potentialStartX = event.clientX;
    this._potentialStartY = event.clientY;
    this._scrollableEl = this._findScrollableUnder(target);
    this._scrollableStartTop = this._scrollableEl?.scrollTop ?? 0;
    this._lastY = event.clientY;
    this._lastTime = Date.now();
  }

  private _beginDrag(clientY: number): void {
    this._isDragging = true;
    this._isPotentialDrag = false;
    this._startY = clientY;
    this._lastY = clientY;
    this._lastTime = Date.now();
    this._velocity = 0;
    this._currentTranslateY = 0;
    const container = this._getSheetContainer();
    if (container) {
      this._startHeight = container.offsetHeight;
      container.style.transition = '';
      container.classList.add('dragging');
    }
    document.body.style.userSelect = 'none';
  }

  private _onPointerMove(event: PointerEvent): void {
    if (this._isDragging) {
      event.preventDefault();
      this._updateDrag(event.clientY);
      return;
    }

    if (!this._isPotentialDrag) return;

    const dy = event.clientY - this._potentialStartY;
    const dx = event.clientX - this._potentialStartX;
    if (Math.abs(dy) < PANEL_HEIGHTS.DRAG_INTENT_THRESHOLD) return;

    // Mostly vertical, downward, and the content was at the top when the
    // gesture began → take over. Using the start position avoids racing the
    // browser's native scroll handler.
    const isDownward = dy > 0;
    const isMostlyVertical = Math.abs(dy) > Math.abs(dx);
    const contentWasAtTop = !this._scrollableEl || this._scrollableStartTop <= 0;

    if (isDownward && isMostlyVertical && contentWasAtTop) {
      event.preventDefault();
      // Use the original touch position so the drag feels continuous
      this._beginDrag(this._potentialStartY);
      this._updateDrag(event.clientY);
    } else {
      // Let the browser handle scroll/other gestures
      this._isPotentialDrag = false;
      this._scrollableEl = null;
    }
  }

  private _updateDrag(clientY: number): void {
    const container = this._getSheetContainer();
    if (!container) return;

    const offset = clientY - this._startY; // +down, -up
    const viewportHeight = window.innerHeight;

    if (offset <= 0) {
      // Drag up: grow height, no translate
      const minHeight = viewportHeight * PANEL_HEIGHTS.MIN_HEIGHT;
      const maxHeight = viewportHeight * PANEL_HEIGHTS.MAX_HEIGHT_ABSOLUTE;
      const newHeight = Math.min(
        Math.max(this._startHeight - offset, minHeight),
        maxHeight,
      );
      container.style.height = `${newHeight}px`;
      container.style.maxHeight = `${newHeight}px`;
      container.style.transform = '';
      this._currentTranslateY = 0;
    } else {
      // Drag down: translate the panel with the finger so it visibly moves
      container.style.height = `${this._startHeight}px`;
      container.style.maxHeight = `${this._startHeight}px`;
      container.style.transform = `translateY(${offset}px)`;
      this._currentTranslateY = offset;
    }

    // Velocity (px/ms; positive = downward)
    const currentTime = Date.now();
    const timeDiff = currentTime - this._lastTime;
    if (timeDiff > 0) {
      // Light low-pass filter to avoid spikes from a single jittery sample
      const instant = (clientY - this._lastY) / timeDiff;
      this._velocity = this._velocity * 0.5 + instant * 0.5;
    }
    this._lastY = clientY;
    this._lastTime = currentTime;
  }

  private _onPointerUp(): void {
    if (this._isPotentialDrag) {
      this._isPotentialDrag = false;
      this._scrollableEl = null;
    }
    if (!this._isDragging) return;
    this._handleDragEnd();
  }

  private _handleDragEnd(): void {
    this._isDragging = false;
    document.body.style.userSelect = '';
    const container = this._getSheetContainer();
    if (!container) return;

    const viewportHeight = window.innerHeight;
    const closeByDistance =
      this._currentTranslateY > viewportHeight * PANEL_HEIGHTS.CLOSE_DISTANCE_RATIO;
    const flingDown = this._velocity > PANEL_HEIGHTS.VELOCITY_THRESHOLD;
    const flingUp = this._velocity < -PANEL_HEIGHTS.VELOCITY_THRESHOLD;

    if (flingDown || closeByDistance) {
      this._animateClose(container, viewportHeight);
      return;
    }

    // Not closing — release dragging state so transitions re-enable.
    container.classList.remove('dragging');

    if (this._currentTranslateY > 0) {
      // Snap back to the start height/position
      this._animateSnapBack(container);
    } else if (flingUp) {
      // Fling up → expand to max height
      this._animateExpand(container, viewportHeight);
    }
    // else: user released at a height they chose; leave it.
  }

  private _animateClose(container: HTMLElement, viewportHeight: number): void {
    const remaining = Math.max(viewportHeight - this._currentTranslateY, 1);
    const speed = Math.max(Math.abs(this._velocity), 0.6); // px/ms floor for nice feel
    const duration = Math.min(
      Math.max(remaining / speed, PANEL_HEIGHTS.CLOSE_ANIMATION_MIN_DURATION),
      PANEL_HEIGHTS.CLOSE_ANIMATION_MAX_DURATION,
    );

    // Keep the dragging class so inner transitions stay disabled while we slide.
    container.style.transition = `transform ${duration}ms ${DRAG_EASING}`;
    // Force a layout flush so the transition takes effect from the current value
    void container.offsetHeight;
    container.style.transform = `translateY(${viewportHeight}px)`;

    window.clearTimeout(this._closeAniTimeout);
    this._closeAniTimeout = window.setTimeout(() => {
      this.close();
    }, duration);
  }

  private _animateSnapBack(container: HTMLElement): void {
    container.style.transition = `transform ${PANEL_HEIGHTS.SNAP_BACK_DURATION}ms ${DRAG_EASING}, height ${PANEL_HEIGHTS.SNAP_BACK_DURATION}ms ${DRAG_EASING}, max-height ${PANEL_HEIGHTS.SNAP_BACK_DURATION}ms ${DRAG_EASING}`;
    void container.offsetHeight;
    container.style.transform = 'translateY(0)';
    container.style.height = `${this._startHeight}px`;
    container.style.maxHeight = `${this._startHeight}px`;
    this._currentTranslateY = 0;

    window.setTimeout(() => {
      container.style.transition = '';
      container.style.transform = '';
    }, PANEL_HEIGHTS.SNAP_BACK_DURATION);
  }

  private _animateExpand(container: HTMLElement, viewportHeight: number): void {
    const targetHeight = viewportHeight * PANEL_HEIGHTS.MAX_HEIGHT;
    container.style.transition = `height ${PANEL_HEIGHTS.EXPAND_ANIMATION_DURATION}ms ${DRAG_EASING}, max-height ${PANEL_HEIGHTS.EXPAND_ANIMATION_DURATION}ms ${DRAG_EASING}`;
    container.style.height = `${targetHeight}px`;
    container.style.maxHeight = `${targetHeight}px`;

    window.setTimeout(() => {
      container.style.transition = '';
    }, PANEL_HEIGHTS.EXPAND_ANIMATION_DURATION);
  }

  private _findScrollableUnder(target: HTMLElement | null): HTMLElement | null {
    let el: HTMLElement | null = target;
    const root = this._elementRef.nativeElement as HTMLElement;
    while (el && el !== root && root.contains(el)) {
      const style = window.getComputedStyle(el);
      const overflowY = style.overflowY;
      if (
        (overflowY === 'auto' || overflowY === 'scroll') &&
        el.scrollHeight > el.clientHeight
      ) {
        return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  private _isInteractiveTarget(target: HTMLElement | null): boolean {
    if (!target) return false;
    return !!target.closest(
      'input, textarea, select, button, [contenteditable="true"], [contenteditable=""]',
    );
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
