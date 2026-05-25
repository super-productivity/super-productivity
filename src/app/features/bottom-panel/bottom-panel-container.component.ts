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
import { BodyClass } from '../../app.constants';

export interface BottomPanelData {
  panelContent: PanelContentType;
}

const PANEL_HEIGHTS = {
  MAX_HEIGHT: 0.8,
  MAX_HEIGHT_ABSOLUTE: 0.98,
  TASK_PANEL_HEIGHT: 0.6,
  OTHER_PANEL_HEIGHT: 0.9,
  // Upward fling → expand to MAX_HEIGHT.
  VELOCITY_THRESHOLD: 0.5, // px/ms
  // Downward dismiss uses drag projection (Apple WWDC18 "Designing Fluid
  // Interfaces" / Android BottomSheetBehavior pattern): predict where the
  // finger would have ended up given current velocity, dismiss only if
  // that projected point clears the close zone.
  //
  //   projectedDrag = dragDistance + velocity × CLOSE_PROJECTION_MS
  //
  // Two gates protect against accidental dismiss:
  //  1. Velocity floor — finger must still be moving downward fast enough
  //     to count as a fling. Defeats hold-and-release ("slowed to a hold")
  //     and pure slow-drag-then-lift.
  //  2. Projected distance — projected end-position must land past
  //     CLOSE_PROJECTED_DISTANCE_VH of viewport.
  // Both required. A held finger has v ≈ 0 → fails (1). A slow continuous
  // drag-to-resize → fails (1). Only a deliberate flick passes.
  CLOSE_VELOCITY_FLOOR: 0.4, // px/ms — Vaul reference value for "fast swipe"
  CLOSE_PROJECTION_MS: 250, // momentum horizon — between Android's 100 and iOS's ~499
  CLOSE_PROJECTED_DISTANCE_VH: 0.3, // projected drag must clear this fraction of viewport
  CLOSE_ANIMATION_MIN_DURATION: 70, // ms — fast flings get near-instant dismissal
  CLOSE_ANIMATION_MAX_DURATION: 280, // ms — slow drags still close briskly
  EXPAND_ANIMATION_DURATION: 280,
  INITIAL_ANIMATION_BLOCK_DURATION: 300,
} as const;

const KEYBOARD_DETECT_THRESHOLD = 100;
const KEYBOARD_SAFE_HEIGHT_MIN = 200;
const KEYBOARD_SAFE_HEIGHT_RATIO = 0.85;
const KEYBOARD_RESIZE_DEBOUNCE_MS = 100;
const CSS_VAR_KEYBOARD_HEIGHT = '--keyboard-height';
const CSS_VAR_KEYBOARD_OVERLAY_OFFSET = '--keyboard-overlay-offset';
const CSS_VAR_VISUAL_VIEWPORT_HEIGHT = '--visual-viewport-height';

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
  readonly isDisableTaskPanelAni = signal(true);

  private _isDragging = false;
  // Active pointer for the current drag — rejects multi-touch and stale
  // pointerup/cancel events from other pointers.
  private _activePointerId: number | null = null;
  private _startY = 0;
  private _startHeight = 0;
  private _currentHeight = 0;
  // Rolling window of recent move samples for robust velocity at release.
  // A naive low-pass filter dilutes the peak fling speed because users
  // decelerate slightly as they lift their finger.
  private _velocitySamples: { y: number; t: number }[] = [];
  private _velocity = 0;
  private _disableAniTimeout?: number;
  private _closeAniTimeout?: number;
  private _expandAniTimeout?: number;
  private _cachedContainer: HTMLElement | null = null;

  private _isKeyboardWatcherInitialized = false;
  private _vvResizeTimer: number | null = null;
  private _bodyClassObserver: MutationObserver | null = null;
  private _keyboardAdjustedStyles: {
    height: string;
    maxHeight: string;
    bottom: string;
  } | null = null;

  private readonly _boundOnPointerDown = this._onPointerDown.bind(this);
  private readonly _boundOnPointerMove = this._onPointerMove.bind(this);
  private readonly _boundOnPointerUp = this._onPointerUp.bind(this);
  private readonly _boundOnPointerCancel = this._onPointerCancel.bind(this);
  private readonly _boundOnViewportResize = this._onViewportResize.bind(this);

  ngAfterViewInit(): void {
    this._bottomPanelState.isOpen.set(true);
    this._setupDragListeners();
    this._setupKeyboardWatcher();
    this._setInitialHeight();

    this._disableAniTimeout = window.setTimeout(() => {
      this.isDisableTaskPanelAni.set(false);
    }, PANEL_HEIGHTS.INITIAL_ANIMATION_BLOCK_DURATION);
  }

  ngOnDestroy(): void {
    this._removeDragListeners();
    this._removeKeyboardWatcher();
    window.clearTimeout(this._disableAniTimeout);
    window.clearTimeout(this._closeAniTimeout);
    window.clearTimeout(this._expandAniTimeout);
    this._cachedContainer = null;
    this._bottomPanelState.isOpen.set(false);
  }

  close(): void {
    this._bottomSheetRef.dismiss();
  }

  private _setupDragListeners(): void {
    const panelHeader = this.panelHeader()?.nativeElement;
    if (!panelHeader) return;

    // Run pointer listeners outside the Angular zone — drag state is not
    // bound in the template, so per-event change detection (60–120 Hz) is
    // pure overhead. Re-entry happens implicitly when close()/expand fire
    // through MatBottomSheetRef.
    this._ngZone.runOutsideAngular(() => {
      panelHeader.addEventListener('pointerdown', this._boundOnPointerDown);
      // Passive listeners — `touch-action: none` on the header already tells
      // the browser these touches don't scroll, so we never call
      // preventDefault on move events.
      document.addEventListener('pointermove', this._boundOnPointerMove);
      document.addEventListener('pointerup', this._boundOnPointerUp);
      document.addEventListener('pointercancel', this._boundOnPointerCancel);
    });
  }

  private _removeDragListeners(): void {
    const panelHeader = this.panelHeader()?.nativeElement;
    if (panelHeader) {
      panelHeader.removeEventListener('pointerdown', this._boundOnPointerDown);
    }
    document.removeEventListener('pointermove', this._boundOnPointerMove);
    document.removeEventListener('pointerup', this._boundOnPointerUp);
    document.removeEventListener('pointercancel', this._boundOnPointerCancel);
  }

  private _onPointerDown(event: PointerEvent): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    // Reject re-entrant pointerdown: a second touch landing during a drag
    // would otherwise reset _startY/_startHeight to the new pointer's
    // values, corrupting the in-progress gesture.
    if (this._activePointerId !== null) return;

    this._activePointerId = event.pointerId;
    // Pin subsequent move/up/cancel for this pointer to the header so the
    // browser routes them to us even if the finger leaves the header bounds.
    const target = event.currentTarget as HTMLElement | null;
    try {
      target?.setPointerCapture(event.pointerId);
    } catch {
      // Some platforms throw on invalid pointerId; the document-level
      // listeners still receive the events, so degrade gracefully.
    }

    event.preventDefault();
    this._startDrag(event.clientY);
  }

  private _startDrag(clientY: number): void {
    // If a close/expand animation is still in flight, cancel its dismissal
    // timer — the user has grabbed the panel again and the in-flight close
    // would otherwise dismiss the sheet mid-drag.
    window.clearTimeout(this._closeAniTimeout);
    window.clearTimeout(this._expandAniTimeout);

    this._isDragging = true;
    this._startY = clientY;
    this._velocity = 0;
    this._velocitySamples = [{ y: clientY, t: Date.now() }];
    const container = this._getSheetContainer();
    if (container) {
      // Clear any residual close-animation styles from a regrab.
      container.classList.remove('closing');
      container.style.transform = '';
      container.style.transition = '';

      this._startHeight = container.offsetHeight;
      this._currentHeight = this._startHeight;
      container.classList.add('dragging');
    }
    document.body.style.userSelect = 'none';
  }

  private _onPointerMove(event: PointerEvent): void {
    if (!this._isDragging) return;
    if (event.pointerId !== this._activePointerId) return;
    this._updateHeight(event.clientY);
  }

  private _updateHeight(clientY: number): void {
    const container = this._getSheetContainer();
    if (!container) return;

    const deltaY = this._startY - clientY;
    const newHeight = this._startHeight + deltaY;
    const viewportHeight = window.innerHeight;

    // Allow heights all the way down to zero so the panel can be dragged
    // off the bottom — closing happens on release based on threshold/velocity.
    const minHeight = 0;
    const maxHeight = viewportHeight * PANEL_HEIGHTS.MAX_HEIGHT_ABSOLUTE;
    const constrainedHeight = Math.min(Math.max(newHeight, minHeight), maxHeight);

    container.style.height = `${constrainedHeight}px`;
    container.style.maxHeight = `${constrainedHeight}px`;
    this._currentHeight = constrainedHeight;

    // Push a sample and trim to the last 80ms of motion. Velocity at
    // release is then computed from the oldest-still-fresh sample to the
    // newest, which keeps the peak fling speed even if the user decelerates
    // their finger in the last frame or two before lift-off.
    const now = Date.now();
    this._velocitySamples.push({ y: clientY, t: now });
    const cutoff = now - 80;
    while (this._velocitySamples.length > 2 && this._velocitySamples[0].t < cutoff) {
      this._velocitySamples.shift();
    }
    const first = this._velocitySamples[0];
    const last = this._velocitySamples[this._velocitySamples.length - 1];
    const dt = last.t - first.t;
    if (dt > 0) {
      this._velocity = (last.y - first.y) / dt;
    }
  }

  private _onPointerUp(event: PointerEvent): void {
    if (!this._isDragging) return;
    if (event.pointerId !== this._activePointerId) return;
    this._activePointerId = null;
    this._handleDragEnd();
  }

  private _onPointerCancel(event: PointerEvent): void {
    if (!this._isDragging) return;
    if (event.pointerId !== this._activePointerId) return;
    this._activePointerId = null;
    // Cancel = OS interrupted the gesture (system back-gesture, incoming
    // call, browser took over). The user did not intentionally release, so
    // we must not run the velocity-based close decision. Snap back to the
    // height the user dragged to and clear all drag state.
    this._isDragging = false;
    this._velocity = 0;
    document.body.style.userSelect = '';
    this._getSheetContainer()?.classList.remove('dragging');
  }

  private _handleDragEnd(): void {
    this._isDragging = false;
    document.body.style.userSelect = '';
    const container = this._getSheetContainer();
    if (!container) return;

    // If no pointermove arrived in the moments before lift-off the finger
    // was held still — treat as zero velocity. Otherwise the rolling window
    // would happily report whatever speed the finger had before the pause.
    const lastSample = this._velocitySamples[this._velocitySamples.length - 1];
    if (!lastSample || Date.now() - lastSample.t > 60) {
      this._velocity = 0;
    }

    const viewportHeight = window.innerHeight;

    // Upward fling → expand.
    if (this._velocity < -PANEL_HEIGHTS.VELOCITY_THRESHOLD) {
      container.classList.remove('dragging');
      this._animateExpand(container, viewportHeight);
      return;
    }

    // Downward close: must still be flinging fast enough AND project past
    // the close zone. See PANEL_HEIGHTS comments for the rationale.
    if (this._velocity >= PANEL_HEIGHTS.CLOSE_VELOCITY_FLOOR) {
      const dragDistance = this._startHeight - this._currentHeight;
      const momentum = this._velocity * PANEL_HEIGHTS.CLOSE_PROJECTION_MS;
      const projectedDrag = dragDistance + momentum;
      if (projectedDrag > viewportHeight * PANEL_HEIGHTS.CLOSE_PROJECTED_DISTANCE_VH) {
        // Hand off from .dragging to .closing in one step so the CSS
        // min-height never re-clamps between the two — would otherwise
        // cause a one-frame snap up to 20vh before the slide-off begins.
        container.classList.add('closing');
        container.classList.remove('dragging');
        this._animateClose(container);
        return;
      }
    }
    // Otherwise: leave the panel at whatever height the user released at —
    // they intentionally dragged to that size. No accidental close on slow
    // drags, even long ones, and no close on hold-and-release.
    container.classList.remove('dragging');
  }

  private _animateClose(container: HTMLElement): void {
    // Slide the panel off the bottom via translateY. The panel sits at
    // `bottom: 0`, so translating by its current rendered height moves it
    // exactly off-screen. Read offsetHeight directly: the inline height
    // and CSS min-height can disagree on the actual rendered height.
    const distance = Math.max(container.offsetHeight, 1);

    // For slow / distance-only closes, keep a friendly minimum speed so
    // the duration doesn't balloon. For real flings we use the measured
    // velocity directly — a 4 px/ms swing closes a 600px panel in 150ms.
    const flingSpeed = Math.abs(this._velocity);
    const speed = Math.max(flingSpeed, 0.6);

    let duration = distance / speed;
    duration = Math.min(
      Math.max(duration, PANEL_HEIGHTS.CLOSE_ANIMATION_MIN_DURATION),
      PANEL_HEIGHTS.CLOSE_ANIMATION_MAX_DURATION,
    );

    // Easing: slower releases get a soft ease-out (looks natural). Fast
    // flings use a near-linear curve so the panel actually moves at the
    // velocity the user gave it instead of decelerating immediately.
    const easing =
      flingSpeed > 1.8
        ? 'cubic-bezier(0.33, 0.0, 0.67, 1)'
        : 'cubic-bezier(0.22, 0.61, 0.36, 1)';

    // .closing keeps min-height: 0 in effect through the animation so the
    // CSS floor doesn't snap the panel back up to 20vh between dragend and
    // the transition starting. Caller (_handleDragEnd) already added it.
    container.style.transition = `transform ${duration}ms ${easing}`;
    void container.offsetHeight;
    container.style.transform = `translateY(${distance}px)`;

    window.clearTimeout(this._closeAniTimeout);
    this._closeAniTimeout = window.setTimeout(() => {
      this.close();
    }, duration);
  }

  private _animateExpand(container: HTMLElement, viewportHeight: number): void {
    const targetHeight = viewportHeight * PANEL_HEIGHTS.MAX_HEIGHT;
    const dur = PANEL_HEIGHTS.EXPAND_ANIMATION_DURATION;
    const easing = 'cubic-bezier(0.22, 0.61, 0.36, 1)';
    container.style.transition = `height ${dur}ms ${easing}, max-height ${dur}ms ${easing}`;
    container.style.height = `${targetHeight}px`;
    container.style.maxHeight = `${targetHeight}px`;

    window.clearTimeout(this._expandAniTimeout);
    this._expandAniTimeout = window.setTimeout(() => {
      container.style.transition = '';
    }, dur);
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

    if ('visualViewport' in window && window.visualViewport) {
      window.visualViewport.addEventListener('resize', this._boundOnViewportResize);
    }

    this._bodyClassObserver = new MutationObserver(() => this._onViewportResize());
    this._bodyClassObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
    });
  }

  private _removeKeyboardWatcher(): void {
    if (typeof window !== 'undefined' && window.visualViewport) {
      window.visualViewport.removeEventListener('resize', this._boundOnViewportResize);
    }
    this._bodyClassObserver?.disconnect();
    this._bodyClassObserver = null;
    if (this._vvResizeTimer) {
      window.clearTimeout(this._vvResizeTimer);
      this._vvResizeTimer = null;
    }
    this._restoreKeyboardAdjustedStyles();
  }

  private _onViewportResize(): void {
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

    const windowHeight = window.innerHeight;
    const viewportHeight = window.visualViewport?.height ?? windowHeight;
    const rootStyle = getComputedStyle(document.documentElement);
    const cssVisualViewportHeight = this._parseCssPx(
      rootStyle.getPropertyValue(CSS_VAR_VISUAL_VIEWPORT_HEIGHT),
    );
    const cssKeyboardHeight = this._parseCssPx(
      rootStyle.getPropertyValue(CSS_VAR_KEYBOARD_HEIGHT),
    );
    const cssKeyboardOverlayOffset = this._parseCssPx(
      rootStyle.getPropertyValue(CSS_VAR_KEYBOARD_OVERLAY_OFFSET),
    );
    const keyboardHeight = Math.max(windowHeight - viewportHeight, cssKeyboardHeight);
    const isIOS = document.body.classList.contains(BodyClass.isIOS);

    const isKeyboardVisible =
      document.body.classList.contains(BodyClass.isKeyboardVisible) ||
      keyboardHeight > KEYBOARD_DETECT_THRESHOLD;

    const container = this._getSheetContainer();
    if (!container) return;

    if (isKeyboardVisible) {
      this._captureKeyboardAdjustedStyles(container);

      const visibleHeight =
        cssVisualViewportHeight > 0 ? cssVisualViewportHeight : viewportHeight;
      const safeHeight = Math.max(
        KEYBOARD_SAFE_HEIGHT_MIN,
        visibleHeight * KEYBOARD_SAFE_HEIGHT_RATIO,
      );

      // CDK bottom sheets are fixed overlays outside the app shell, so they
      // need their own keyboard offset on iOS where the WebView may not resize.
      container.style.setProperty(
        'bottom',
        `${isIOS ? cssKeyboardOverlayOffset : 0}px`,
        'important',
      );
      container.style.setProperty('max-height', `${safeHeight}px`, 'important');

      if (container.offsetHeight > safeHeight) {
        container.style.setProperty('height', `${safeHeight}px`, 'important');
      }
    } else {
      this._restoreKeyboardAdjustedStyles();
    }
  }

  private _captureKeyboardAdjustedStyles(container: HTMLElement): void {
    if (this._keyboardAdjustedStyles) {
      return;
    }

    this._keyboardAdjustedStyles = {
      height: container.style.height,
      maxHeight: container.style.maxHeight,
      bottom: container.style.bottom,
    };
  }

  private _restoreKeyboardAdjustedStyles(): void {
    if (!this._keyboardAdjustedStyles) {
      return;
    }

    const container = this._getSheetContainer();
    if (container) {
      container.style.height = this._keyboardAdjustedStyles.height;
      container.style.maxHeight = this._keyboardAdjustedStyles.maxHeight;
      container.style.bottom = this._keyboardAdjustedStyles.bottom;
    }
    this._keyboardAdjustedStyles = null;
  }

  private _parseCssPx(value: string): number {
    if (!value.trim().endsWith('px')) {
      return 0;
    }
    const parsedValue = Number.parseFloat(value);
    return Number.isFinite(parsedValue) ? parsedValue : 0;
  }
}
