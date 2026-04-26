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

const PANEL_HEIGHTS = {
  MAX_HEIGHT: 0.8,
  MIN_HEIGHT: 0.2,
  MAX_HEIGHT_ABSOLUTE: 0.98,
  TASK_PANEL_HEIGHT: 0.6,
  OTHER_PANEL_HEIGHT: 0.9,
  VELOCITY_THRESHOLD: 0.5, // px/ms
  CLOSE_DISTANCE_RATIO: 0.4, // close if dragged below this fraction of original height
  CLOSE_ANIMATION_MIN_DURATION: 70, // ms — fast flings get near-instant dismissal
  CLOSE_ANIMATION_MAX_DURATION: 280, // ms — slow drags still close briskly
  EXPAND_ANIMATION_DURATION: 280,
  INITIAL_ANIMATION_BLOCK_DURATION: 300,
} as const;

const KEYBOARD_DETECT_THRESHOLD = 100;
const KEYBOARD_SAFE_HEIGHT_MIN = 200;
const KEYBOARD_SAFE_HEIGHT_RATIO = 0.85;
const KEYBOARD_RESIZE_DEBOUNCE_MS = 100;

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
  private _cachedContainer: HTMLElement | null = null;

  private _isKeyboardWatcherInitialized = false;
  private _originalHeight: string = '';
  private _vvResizeTimer: number | null = null;

  private readonly _boundOnPointerDown = this._onPointerDown.bind(this);
  private readonly _boundOnPointerMove = this._onPointerMove.bind(this);
  private readonly _boundOnPointerUp = this._onPointerUp.bind(this);
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
    this._cachedContainer = null;
    this._bottomPanelState.isOpen.set(false);
  }

  close(): void {
    this._bottomSheetRef.dismiss();
  }

  private _setupDragListeners(): void {
    const panelHeader = this.panelHeader()?.nativeElement;
    if (!panelHeader) return;

    panelHeader.addEventListener('pointerdown', this._boundOnPointerDown);
    document.addEventListener('pointermove', this._boundOnPointerMove, {
      passive: false,
    });
    document.addEventListener('pointerup', this._boundOnPointerUp);
    document.addEventListener('pointercancel', this._boundOnPointerUp);
  }

  private _removeDragListeners(): void {
    const panelHeader = this.panelHeader()?.nativeElement;
    if (panelHeader) {
      panelHeader.removeEventListener('pointerdown', this._boundOnPointerDown);
    }
    document.removeEventListener('pointermove', this._boundOnPointerMove);
    document.removeEventListener('pointerup', this._boundOnPointerUp);
    document.removeEventListener('pointercancel', this._boundOnPointerUp);
  }

  private _onPointerDown(event: PointerEvent): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    this._startDrag(event.clientY);
  }

  private _startDrag(clientY: number): void {
    this._isDragging = true;
    this._startY = clientY;
    this._velocity = 0;
    this._velocitySamples = [{ y: clientY, t: Date.now() }];
    const container = this._getSheetContainer();
    if (container) {
      this._startHeight = container.offsetHeight;
      this._currentHeight = this._startHeight;
      container.classList.add('dragging');
    }
    document.body.style.userSelect = 'none';
  }

  private _onPointerMove(event: PointerEvent): void {
    if (!this._isDragging) return;
    event.preventDefault();
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
    while (
      this._velocitySamples.length > 2 &&
      this._velocitySamples[0].t < cutoff
    ) {
      this._velocitySamples.shift();
    }
    const first = this._velocitySamples[0];
    const last = this._velocitySamples[this._velocitySamples.length - 1];
    const dt = last.t - first.t;
    if (dt > 0) {
      this._velocity = (last.y - first.y) / dt;
    }
  }

  private _onPointerUp(): void {
    if (!this._isDragging) return;
    this._handleDragEnd();
  }

  private _handleDragEnd(): void {
    this._isDragging = false;
    document.body.style.userSelect = '';
    const container = this._getSheetContainer();
    if (!container) return;

    container.classList.remove('dragging');

    const viewportHeight = window.innerHeight;
    const flingDown = this._velocity > PANEL_HEIGHTS.VELOCITY_THRESHOLD;
    const flingUp = this._velocity < -PANEL_HEIGHTS.VELOCITY_THRESHOLD;
    const closeByDistance =
      this._currentHeight < this._startHeight * PANEL_HEIGHTS.CLOSE_DISTANCE_RATIO;

    if (flingDown || closeByDistance) {
      this._animateClose(container, viewportHeight);
      return;
    }

    if (flingUp) {
      this._animateExpand(container, viewportHeight);
    }
    // Otherwise: leave the panel at whatever height the user released at —
    // they intentionally dragged to that size.
  }

  private _animateClose(container: HTMLElement, viewportHeight: number): void {
    // Slide the panel off the bottom via translateY. The panel sits at
    // `bottom: 0`, so translating by its current height moves it exactly
    // off-screen.
    const distance = Math.max(this._currentHeight, 1);

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
    container.style.transition = `height ${PANEL_HEIGHTS.EXPAND_ANIMATION_DURATION}ms cubic-bezier(0.22, 0.61, 0.36, 1), max-height ${PANEL_HEIGHTS.EXPAND_ANIMATION_DURATION}ms cubic-bezier(0.22, 0.61, 0.36, 1)`;
    container.style.height = `${targetHeight}px`;
    container.style.maxHeight = `${targetHeight}px`;

    window.setTimeout(() => {
      container.style.transition = '';
    }, PANEL_HEIGHTS.EXPAND_ANIMATION_DURATION);
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
  }

  private _removeKeyboardWatcher(): void {
    if (typeof window !== 'undefined' && window.visualViewport) {
      window.visualViewport.removeEventListener('resize', this._boundOnViewportResize);
    }
    if (this._originalHeight) {
      const container = this._getSheetContainer();
      if (container) {
        container.style.maxHeight = this._originalHeight;
        container.style.removeProperty('height');
      }
    }
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

    const visualViewport = window.visualViewport;
    if (!visualViewport) return;

    const windowHeight = window.innerHeight;
    const viewportHeight = visualViewport.height;
    const keyboardHeight = windowHeight - viewportHeight;

    const isKeyboardVisible = keyboardHeight > KEYBOARD_DETECT_THRESHOLD;

    const container = this._getSheetContainer();
    if (!container) return;

    if (isKeyboardVisible) {
      if (!this._originalHeight) {
        this._originalHeight = container.style.maxHeight || '';
      }

      const safeHeight = Math.max(
        KEYBOARD_SAFE_HEIGHT_MIN,
        viewportHeight * KEYBOARD_SAFE_HEIGHT_RATIO,
      );

      container.style.setProperty('max-height', `${safeHeight}px`, 'important');

      if (container.offsetHeight > safeHeight) {
        container.style.setProperty('height', `${safeHeight}px`, 'important');
      }
    } else {
      container.style.removeProperty('max-height');
      container.style.removeProperty('height');
      this._originalHeight = '';
    }
  }
}
