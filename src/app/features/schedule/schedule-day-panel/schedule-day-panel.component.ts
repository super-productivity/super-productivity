import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  NgZone,
  OnDestroy,
  signal,
  ViewChild,
} from '@angular/core';
import { Store } from '@ngrx/store';
import { ScheduleWeekComponent } from '../schedule-week/schedule-week.component';
import { DateService } from '../../../core/date/date.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { selectTimelineWorkStartEndHours } from '../../config/store/global-config.reducer';
import { GlobalTrackingIntervalService } from '../../../core/global-tracking-interval/global-tracking-interval.service';
import { mapScheduleDaysToScheduleEvents } from '../map-schedule-data/map-schedule-days-to-schedule-events';
import { FH, SVEType } from '../schedule.const';
import { calculateTimeFromYPosition } from '../schedule-utils';
import { DragDropRegistry } from '@angular/cdk/drag-drop';
import { PlannerActions } from '../../planner/store/planner.actions';
import { TaskWithSubTasks } from '../../tasks/task.model';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { Log } from '../../../core/log';
import { Subscription } from 'rxjs';
import { ScheduleExternalDragService } from '../schedule-week/schedule-external-drag.service';
import { ScheduleService } from '../schedule.service';
import { ScheduleEvent } from '../schedule.model';

const DEFAULT_MIN_DURATION = 15 * 60 * 1000;
const SCROLL_DELAY_MS = 100;
const SCROLL_TOP_OFFSET_PX = 50;
const MIN_PREVIEW_WIDTH_PX = 40;
const PREVIEW_WIDTH_PADDING_PX = 10;
const OPACITY_HIDDEN = '0';
const OPACITY_VISIBLE = '1';

type DropTimeSource =
  | 'preview-top-adjusted'
  | 'pointer-top-adjusted'
  | 'top-cache'
  | 'cached';

interface DropTimeCalculation {
  timestamp: number | null;
  source: DropTimeSource;
}

@Component({
  selector: 'schedule-day-panel',
  standalone: true,
  imports: [ScheduleWeekComponent],
  styleUrl: './schedule-day-panel.component.scss',
  templateUrl: './schedule-day-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScheduleDayPanelComponent implements AfterViewInit, OnDestroy {
  @ViewChild('scheduleWeek', { read: ElementRef }) scheduleWeekRef!: ElementRef;
  @ViewChild('scheduleWeek', { read: ScheduleWeekComponent })
  scheduleWeekComponent!: ScheduleWeekComponent;
  @ViewChild('dropZone', { read: ElementRef }) dropZoneRef!: ElementRef<HTMLElement>;

  private _store = inject(Store);
  private _dateService = inject(DateService);
  private _globalTrackingIntervalService = inject(GlobalTrackingIntervalService);
  private _dragDropRegistry = inject(DragDropRegistry);
  private _externalDragService = inject(ScheduleExternalDragService);
  private _cdr = inject(ChangeDetectorRef);
  private _ngZone = inject(NgZone);
  private _scheduleService = inject(ScheduleService);
  private _pointerUpSubscription: Subscription | null = null;
  private _activeExternalTask: TaskWithSubTasks | null = null;
  private readonly _globalPointerEvents = ['mousemove', 'touchmove'] as const;
  private readonly _globalPointerListenerOptions = { passive: true };

  // Drag preview properties
  dragPreviewTime = signal<string | null>(null);
  isDragging = signal(false);
  private lastCalculatedTimestamp: number | null = null;
  private _dragPointerOffsetY: number | null = null;
  private _lastKnownTopY: number | null = null;

  private _todayDateStr = toSignal(this._globalTrackingIntervalService.todayDateStr$, {
    initialValue: this._dateService.todayStr(Date.now()),
  });

  daysToShow = computed(() => {
    const d = this._todayDateStr();
    return d ? [d] : [];
  });

  scheduleDays = this._scheduleService.createScheduleDaysComputed(this.daysToShow);

  private _eventsAndBeyondBudget = computed(() => {
    const days = this.scheduleDays();
    return mapScheduleDaysToScheduleEvents(days, FH);
  });

  events = computed(() => this._eventsAndBeyondBudget().eventsFlat);

  hasNoEvents = computed(() => {
    const evs = this.events().filter((ev) => ev.type !== SVEType.LunchBreak);
    return !evs || evs.length === 0;
  });

  private _workStartEndHours = toSignal(
    this._store.select(selectTimelineWorkStartEndHours),
  );

  workStartEnd = computed(() => {
    const v = this._workStartEndHours();
    return (
      v && {
        workStartRow: Math.round(FH * v.workStart) + 1,
        workEndRow: Math.round(FH * v.workEnd) + 1,
      }
    );
  });

  currentTimeRow = computed(() => {
    // Trigger re-computation every 2 minutes
    this._scheduleService.scheduleRefreshTick();
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    // eslint-disable-next-line no-mixed-operators
    const hoursToday = hours + minutes / 60;
    return Math.round(hoursToday * FH);
  });

  // Effect to scroll to current time when the component initializes or current time changes
  constructor() {
    effect(() => {
      // Track current time row changes to trigger auto-scroll
      this.currentTimeRow();
      this._scheduleScrollToCurrentTime();
    });
  }

  ngAfterViewInit(): void {
    // Listen for global pointer releases while a drag is active so we can finalize drops.
    this._pointerUpSubscription = this._dragDropRegistry.pointerUp.subscribe((event) => {
      this._ngZone.run(() => this._handlePointerUp(event));
    });

    // Initial scroll to current time after view initialization
    this._scheduleScrollToCurrentTime();
  }

  ngOnDestroy(): void {
    if (this._pointerUpSubscription) {
      this._pointerUpSubscription.unsubscribe();
      this._pointerUpSubscription = null;
    }
    // Ensure preview styling is cleaned up
    this._applySchedulePreviewStyling(false);
    this._activeExternalTask = null;
  }

  onDragMove(event: MouseEvent | TouchEvent): void {
    const activeTask = this._externalDragService.activeTask();
    if (!activeTask) {
      if (this.isDragging()) {
        this._stopScheduleMode();
      }
      return;
    }

    this._activeExternalTask = activeTask;
    if (!this.isDragging()) {
      this._startScheduleMode();
    }

    // Try to use drag preview position, fallback to event coordinates for touch
    const previewEl = this._getDragPreview();
    const pointer = this._getPointerPosition(event);
    if (previewEl) {
      // Desktop: use drag preview top
      const previewRect = previewEl.getBoundingClientRect();
      const topY = this._resolveTopY(previewRect.top, pointer?.y ?? null);
      const timestamp = topY != null ? this._calculateTimeFromYPosition(topY) : null;
      this.lastCalculatedTimestamp = timestamp;
      this._updateDragPreviewTime(previewEl, timestamp);
    } else {
      // Touch devices: use touch coordinates directly
      if (pointer) {
        const topY = this._resolveTopY(null, pointer.y);
        const timestamp = topY != null ? this._calculateTimeFromYPosition(topY) : null;
        this.lastCalculatedTimestamp = timestamp;
        // Update preview time without preview element for touch
        if (timestamp != null) {
          this.dragPreviewTime.set(this._formatPreviewTime(timestamp));
        } else {
          this.dragPreviewTime.set(null);
        }
      }
    }
  }

  private _targetDay(): string | undefined {
    const [day] = this.daysToShow();
    return day;
  }

  private _calculateTimeFromYPosition(clientY: number): number | null {
    const containerElement = this.scheduleWeekRef?.nativeElement;
    const scheduleWeek = containerElement?.querySelector('.grid-container');

    if (!scheduleWeek) {
      return null;
    }

    const gridRect = scheduleWeek.getBoundingClientRect();
    const targetDay = this._targetDay();

    if (!targetDay) {
      return null;
    }

    return calculateTimeFromYPosition(clientY, gridRect, targetDay);
  }

  private _calculateDropTime(
    previewRect: DOMRect | null,
    pointerY: number | null,
  ): DropTimeCalculation {
    const topY = this._resolveTopY(previewRect?.top ?? null, pointerY);
    const timestampFromPosition =
      topY != null ? this._calculateTimeFromYPosition(topY) : null;
    const timestamp = timestampFromPosition ?? this.lastCalculatedTimestamp;
    const source: DropTimeSource =
      timestampFromPosition != null
        ? previewRect
          ? 'preview-top-adjusted'
          : pointerY != null
            ? 'pointer-top-adjusted'
            : 'top-cache'
        : 'cached';

    return { timestamp, source };
  }

  private _handlePointerUp(event: MouseEvent | TouchEvent): void {
    if (!this.isDragging()) {
      return;
    }

    // Treat any pointer release while the preview is active as a potential drop on the panel.
    const task = this._activeExternalTask ?? this._externalDragService.activeTask();
    const previewRect = this._getDragPreviewRect();
    const pointer = this._getPointerPosition(event);
    const isInside = this._isEffectiveTopWithinDropZone(previewRect, pointer);
    const dropCalculation = isInside
      ? this._calculateDropTime(previewRect, pointer?.y ?? null)
      : null;
    const dropTime = dropCalculation?.timestamp ?? null;
    const targetDay = this._targetDay();

    this._stopScheduleMode();
    this._externalDragService.setActiveTask(null);

    if (!task || !targetDay) {
      return;
    }

    let wasDroppedSuccessfully = false;

    if (dropTime !== null) {
      this.lastCalculatedTimestamp = dropTime;
      const targetDate = new Date(dropTime);
      Log.log('[ScheduleDayPanel] Drop calculation:', {
        source: dropCalculation?.source ?? 'cached',
        storedTimestamp: dropTime,
        targetTime: targetDate,
        formattedTime: this._formatTime(targetDate.getHours(), targetDate.getMinutes()),
      });
      this._store.dispatch(
        TaskSharedActions.scheduleTaskWithTime({
          task,
          dueWithTime: dropTime,
          isMoveToBacklog: false,
        }),
      );
      if (!task.timeEstimate || task.timeEstimate <= 0) {
        this._store.dispatch(
          TaskSharedActions.updateTask({
            task: { id: task.id, changes: { timeEstimate: DEFAULT_MIN_DURATION } },
          }),
        );
      }
      wasDroppedSuccessfully = true;
    } else if (isInside) {
      this._store.dispatch(
        PlannerActions.planTaskForDay({
          task,
          day: targetDay,
          isAddToTop: true,
        }),
      );
      wasDroppedSuccessfully = true;
    }

    // Disable snap-back animation when successfully dropped on panel
    if (wasDroppedSuccessfully) {
      this._disableSnapBackAnimation();
    }
  }

  private _getPointerPosition(
    event: MouseEvent | TouchEvent,
  ): { x: number; y: number } | null {
    if (!('touches' in event)) {
      return { x: event.clientX, y: event.clientY };
    }

    const touch = event.touches[0] ?? event.changedTouches?.[0];
    return touch ? { x: touch.clientX, y: touch.clientY } : null;
  }

  private _getDragPreviewRect(): DOMRect | null {
    return this._withDragPreview((preview) => preview.getBoundingClientRect());
  }

  private _isPointerWithinDropZone(pointer: { x: number; y: number }): boolean {
    const dropZoneEl = this.dropZoneRef?.nativeElement;
    if (!dropZoneEl) {
      return false;
    }

    const dropZoneRect = dropZoneEl.getBoundingClientRect();
    return (
      pointer.x >= dropZoneRect.left &&
      pointer.x <= dropZoneRect.right &&
      pointer.y >= dropZoneRect.top &&
      pointer.y <= dropZoneRect.bottom
    );
  }

  private _isEffectiveTopWithinDropZone(
    rect: DOMRect | null,
    pointer: { x: number; y: number } | null,
  ): boolean {
    const dropZoneEl = this.dropZoneRef?.nativeElement;
    if (!dropZoneEl) {
      return false;
    }

    const dropZoneRect = dropZoneEl.getBoundingClientRect();
    const topY = this._resolveTopY(rect?.top ?? null, pointer?.y ?? null);
    if (topY == null) {
      return false;
    }

    const horizontalOverlap = rect
      ? this._isPreviewHorizontallyAligned(rect, dropZoneRect)
      : pointer
        ? this._isPointerHorizontallyAligned(pointer, dropZoneRect)
        : false;

    return horizontalOverlap && topY >= dropZoneRect.top && topY <= dropZoneRect.bottom;
  }

  private _withDragPreview<T>(handler: (preview: HTMLElement) => T): T | null {
    const previewEl = this._getDragPreview();
    if (!previewEl) {
      return null;
    }
    return handler(previewEl);
  }

  private _getDragPreview(): HTMLElement | null {
    return document.querySelector('.cdk-drag-preview') as HTMLElement | null;
  }

  private _formatTime(hours: number, minutes: number): string {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  }

  private _formatPreviewTime(timestamp: number): string {
    const date = new Date(timestamp);
    return this._formatTime(date.getHours(), date.getMinutes());
  }

  private _resolveTopY(
    previewTop: number | null,
    pointerY: number | null,
  ): number | null {
    if (pointerY != null && previewTop != null && this._dragPointerOffsetY == null) {
      this._dragPointerOffsetY = pointerY - previewTop;
    }

    if (pointerY != null && this._dragPointerOffsetY != null) {
      const adjustedTop = pointerY - this._dragPointerOffsetY;
      this._lastKnownTopY = adjustedTop;
      return adjustedTop;
    }

    if (previewTop != null) {
      this._lastKnownTopY = previewTop;
      return previewTop;
    }

    if (pointerY != null) {
      return pointerY;
    }

    return this._lastKnownTopY;
  }

  private _isPreviewHorizontallyAligned(rect: DOMRect, dropZoneRect: DOMRect): boolean {
    return rect.right >= dropZoneRect.left && rect.left <= dropZoneRect.right;
  }

  private _isPointerHorizontallyAligned(
    pointer: { x: number; y: number },
    dropZoneRect: DOMRect,
  ): boolean {
    return pointer.x >= dropZoneRect.left && pointer.x <= dropZoneRect.right;
  }

  private _scheduleScrollToCurrentTime(): void {
    setTimeout(() => {
      this._scrollToCurrentTime();
    }, SCROLL_DELAY_MS);
  }

  private _findScrollContainer(): Element | null {
    const selectors = ['.side-inner', '.right-panel', '[class*="panel"]'];
    const el = this.scheduleWeekRef.nativeElement;

    for (const selector of selectors) {
      const container = el.closest(selector);
      if (container) {
        return container;
      }
    }
    return null;
  }

  private _scrollToCurrentTime(): void {
    if (!this.scheduleWeekRef?.nativeElement) {
      Log.warn('[ScheduleDayPanel] No scheduleWeekRef available');
      return;
    }

    const currentTimeElement =
      this.scheduleWeekRef.nativeElement.querySelector('.current-time');
    if (!currentTimeElement) {
      Log.warn('[ScheduleDayPanel] Current time element not found');
      return;
    }

    const scrollContainer = this._findScrollContainer();
    if (!scrollContainer) {
      Log.warn('[ScheduleDayPanel] No scrollable container found');
      return;
    }

    Log.log('[ScheduleDayPanel] Found scroll container:', scrollContainer.className);

    const containerRect = scrollContainer.getBoundingClientRect();
    const elementRect = currentTimeElement.getBoundingClientRect();
    const relativePosition = elementRect.top - containerRect.top;
    const targetScrollTop =
      scrollContainer.scrollTop + relativePosition - SCROLL_TOP_OFFSET_PX;

    Log.log('[ScheduleDayPanel] Scrolling to position:', Math.max(0, targetScrollTop));

    scrollContainer.scrollTo({
      top: Math.max(0, targetScrollTop),
    });
  }

  private _updateDragPreviewTime(previewEl: HTMLElement, timestamp: number | null): void {
    if (timestamp == null) {
      this.dragPreviewTime.set(null);
      this._clearTimeBadgeText(previewEl);
      return;
    }
    const timeStr = this._formatPreviewTime(timestamp);
    this.dragPreviewTime.set(timeStr);
    this._ensureTimeBadge(previewEl).textContent = timeStr;
  }

  private _startScheduleMode(): void {
    if (this.isDragging()) return;
    this.isDragging.set(true);
    this._dragPointerOffsetY = null;
    this._lastKnownTopY = null;
    this._applySchedulePreviewStyling(true);
    this._cdr.markForCheck();
    this._toggleGlobalPointerListeners(true);

    // Show custom drag preview in schedule-week component
    const task = this._activeExternalTask;
    if (task && this.scheduleWeekComponent) {
      const scheduleEvent = this._createScheduleEventFromTask(task);
      const style = this._calculateInitialPreviewStyle();
      const timestamp = this.lastCalculatedTimestamp || Date.now();
      this.scheduleWeekComponent.showExternalPreview(scheduleEvent, style, timestamp);
    }
  }

  private _stopScheduleMode(): void {
    if (!this.isDragging()) return;
    this.isDragging.set(false);
    this.dragPreviewTime.set(null);
    this.lastCalculatedTimestamp = null;
    this._dragPointerOffsetY = null;
    this._lastKnownTopY = null;
    this._activeExternalTask = null;
    this._applySchedulePreviewStyling(false);
    this._cdr.markForCheck();
    this._toggleGlobalPointerListeners(false);

    // Hide custom drag preview in schedule-week component
    if (this.scheduleWeekComponent) {
      this.scheduleWeekComponent.hideExternalPreview();
    }
  }

  private _toggleGlobalPointerListeners(isEnable: boolean): void {
    for (const eventName of this._globalPointerEvents) {
      if (isEnable) {
        document.addEventListener(
          eventName,
          this._onGlobalPointerMove,
          this._globalPointerListenerOptions,
        );
      } else {
        document.removeEventListener(eventName, this._onGlobalPointerMove);
      }
    }
  }

  private _onGlobalPointerMove = (ev: MouseEvent | TouchEvent): void => {
    const pointer = this._getPointerPosition(ev);
    if (!pointer) {
      return;
    }

    const previewRect = this._getDragPreviewRect();
    const isPointerInsideDropZone = this._isPointerWithinDropZone(pointer);

    if (!isPointerInsideDropZone) {
      // If pointer is not over the side panel/drop zone anymore, leave schedule mode
      this._ngZone.run(() => this._stopScheduleMode());
      return;
    }

    // Update time calculation continuously while dragging over the drop zone
    // This is especially important for touch devices
    this._ngZone.run(() => {
      const topY = this._resolveTopY(previewRect?.top ?? null, pointer.y);
      const timestamp = topY != null ? this._calculateTimeFromYPosition(topY) : null;
      this.lastCalculatedTimestamp = timestamp;

      if (timestamp != null) {
        this.dragPreviewTime.set(this._formatPreviewTime(timestamp));
        // Update badge on preview element if it exists (desktop)
        const previewEl = this._getDragPreview();
        if (previewEl) {
          const timeBadge = this._ensureTimeBadge(previewEl);
          timeBadge.textContent = this._formatPreviewTime(timestamp);
        }

        // Update custom preview position in schedule-week component
        if (this.scheduleWeekComponent) {
          const style = this._calculatePreviewStyleFromTime(timestamp);
          if (style) {
            this.scheduleWeekComponent.updateExternalPreview(style, timestamp);
          }
        }
      } else {
        this.dragPreviewTime.set(null);
      }
      this._cdr.markForCheck();
    });
  };

  // we're mutating the dom directly here to add some styling to the drag preview, since it is the most efficient way to do it
  private _applySchedulePreviewStyling(isEnable: boolean): void {
    this._withDragPreview((previewEl) => {
      const tagName = previewEl.tagName.toLowerCase();
      if (tagName === 'task') {
        this._applyTaskPreviewStyling(previewEl, isEnable);
      } else if (tagName === 'schedule-event') {
        this._applyScheduleEventPreviewStyling(previewEl, isEnable);
      }
    });
  }

  private _applyTaskPreviewStyling(previewEl: HTMLElement, isEnable: boolean): void {
    if (isEnable) {
      previewEl.classList.add('as-schedule-event-preview');
      previewEl.style.opacity = OPACITY_HIDDEN;
      this._setPreviewWidth(previewEl);
      const timeBadge = this._ensureTimeBadge(previewEl);
      timeBadge.textContent = this.dragPreviewTime() ?? '';
    } else {
      previewEl.classList.remove('as-schedule-event-preview');
      previewEl.style.opacity = OPACITY_VISIBLE;
      previewEl.style.removeProperty('width');
      this._removeTimeBadge(previewEl);
    }
  }

  private _setPreviewWidth(previewEl: HTMLElement): void {
    const containerElement = this.scheduleWeekRef?.nativeElement as
      | HTMLElement
      | undefined;
    const day = this._targetDay();

    if (!containerElement || !day) {
      return;
    }

    const colEl = containerElement.querySelector(
      `.grid-container .col[data-day="${day}"]`,
    ) as HTMLElement | null;

    if (!colEl) {
      return;
    }

    const colRect = colEl.getBoundingClientRect();
    previewEl.style.width = `${Math.max(MIN_PREVIEW_WIDTH_PX, colRect.width - PREVIEW_WIDTH_PADDING_PX)}px`;
  }

  private _ensureTimeBadge(previewEl: HTMLElement): HTMLElement {
    let timeBadge = previewEl.querySelector(
      '.drag-preview-time-badge',
    ) as HTMLElement | null;

    if (!timeBadge) {
      timeBadge = document.createElement('div');
      timeBadge.className = 'drag-preview-time-badge';
      previewEl.appendChild(timeBadge);
    }

    return timeBadge;
  }

  private _clearTimeBadgeText(previewEl: HTMLElement): void {
    const timeBadge = previewEl.querySelector(
      '.drag-preview-time-badge',
    ) as HTMLElement | null;
    if (timeBadge) {
      timeBadge.textContent = '';
    }
  }

  private _removeTimeBadge(previewEl: HTMLElement): void {
    const timeBadge = previewEl.querySelector('.drag-preview-time-badge');
    if (timeBadge) {
      timeBadge.remove();
    }
  }

  private _applyScheduleEventPreviewStyling(
    previewEl: HTMLElement,
    isEnable: boolean,
  ): void {
    previewEl.style.opacity = isEnable ? OPACITY_HIDDEN : OPACITY_VISIBLE;
  }

  private _createScheduleEventFromTask(task: TaskWithSubTasks): ScheduleEvent {
    const timeEstimate = task.timeEstimate || DEFAULT_MIN_DURATION;
    const timeInHours = timeEstimate / (60 * 60 * 1000);

    return {
      id: task.id,
      type: SVEType.Task,
      style: '',
      startHours: 0,
      timeLeftInHours: timeInHours,
      data: task,
    };
  }

  private _calculateInitialPreviewStyle(): string {
    // Start with a default position (e.g., row 1, column 2)
    const row = 1;
    const col = 2;
    const rowSpan = this._calculateRowSpanFromTask(this._activeExternalTask);
    return `grid-row: ${row} / span ${rowSpan}; grid-column: ${col} / span 1`;
  }

  private _calculatePreviewStyleFromTime(timestamp: number): string | null {
    const gridContainer = this.scheduleWeekRef?.nativeElement?.querySelector(
      '.grid-container',
    ) as HTMLElement | null;

    if (!gridContainer) {
      return null;
    }

    const date = new Date(timestamp);
    const hours = date.getHours();
    const minutes = date.getMinutes();
    // eslint-disable-next-line no-mixed-operators
    const hoursDecimal = hours + minutes / 60;

    // Calculate row based on time (FH rows per hour)
    const row = Math.round(hoursDecimal * FH) + 1;
    const col = 2; // First day column
    const rowSpan = this._calculateRowSpanFromTask(this._activeExternalTask);

    return `grid-row: ${row} / span ${rowSpan}; grid-column: ${col} / span 1`;
  }

  private _calculateRowSpanFromTask(task: TaskWithSubTasks | null): number {
    if (!task) {
      return 6; // Default fallback
    }
    const timeEstimate = task.timeEstimate || DEFAULT_MIN_DURATION;
    const timeInHours = timeEstimate / (60 * 60 * 1000);
    return Math.max(Math.round(timeInHours * FH), 1);
  }

  private _disableSnapBackAnimation(): void {
    // Immediately hide the drag preview to prevent snap-back animation
    const previewEl = this._getDragPreview();
    if (previewEl) {
      previewEl.remove();
    }
  }
}
