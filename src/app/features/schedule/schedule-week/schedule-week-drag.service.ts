import { CdkDragMove, CdkDragRelease, CdkDragStart } from '@angular/cdk/drag-drop';
import { inject, Injectable, Signal, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { PlannerActions } from '../../planner/store/planner.actions';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import {
  FH,
  SCHEDULE_TASK_MIN_DURATION_IN_MS,
  SVEType,
  T_ID_PREFIX,
} from '../schedule.const';
import { remindOptionToMilliseconds } from '../../tasks/util/remind-option-to-milliseconds';
import { TaskCopy, TaskReminderOptionId } from '../../tasks/task.model';
import { GlobalConfigService } from '../../config/global-config.service';
import { DEFAULT_GLOBAL_CONFIG } from '../../config/default-global-config.const';
import { calculateTimeFromYPosition } from '../schedule-utils';
import { IS_TOUCH_PRIMARY } from '../../../util/is-mouse-primary';
import type { DragPreviewContext } from './schedule-week-drag.types';
import type { ScheduleEvent } from '../schedule.model';
import { selectTodayTaskIds } from '../../work-context/store/work-context.selectors';
import { first } from 'rxjs/operators';

interface PointerPosition {
  x: number;
  y: number;
}

const DRAG_CLONE_CLASS = 'drag-clone';
const DRAG_OVER_CLASS = 'drag-over';

@Injectable()
export class ScheduleWeekDragService {
  // Central drag state handler so the component can remain mostly declarative.
  private readonly _store = inject(Store);
  private readonly _globalConfigService = inject(GlobalConfigService);

  private readonly _isShiftMode = signal(false);
  readonly isShiftMode: Signal<boolean> = this._isShiftMode.asReadonly();

  private readonly _dragPreviewContext = signal<DragPreviewContext>(null);
  readonly dragPreviewContext: Signal<DragPreviewContext> =
    this._dragPreviewContext.asReadonly();

  private readonly _dragPreviewStyle = signal<string | null>(null);
  readonly dragPreviewStyle: Signal<string | null> = this._dragPreviewStyle.asReadonly();

  private readonly _currentDragEvent = signal<ScheduleEvent | null>(null);
  readonly currentDragEvent: Signal<ScheduleEvent | null> =
    this._currentDragEvent.asReadonly();

  private readonly _isDragging = signal(false);
  readonly isDragging: Signal<boolean> = this._isDragging.asReadonly();

  private readonly _showShiftKeyInfo = signal(false);
  readonly showShiftKeyInfo: Signal<boolean> = this._showShiftKeyInfo.asReadonly();

  // Track the task ID being hovered over for reorder preview
  private readonly _dragOverTaskId = signal<string | null>(null);
  readonly dragOverTaskId: Signal<string | null> = this._dragOverTaskId.asReadonly();

  private _prevDragOverEl: HTMLElement | null = null;
  private _dragCloneEl: HTMLElement | null = null;
  private _lastDropCol: HTMLElement | null = null;
  private _lastDropScheduleEvent: HTMLElement | null = null;
  private _lastPointerPosition: PointerPosition | null = null;
  private _lastCalculatedTimestamp: number | null = null;
  private _shiftInfoTimeoutId: number | undefined;
  // Use accessors instead of direct references to prevent holding stale DOM nodes
  // between Angular re-renders. This ensures we always query the current DOM state.
  private _gridContainerAccessor: (() => HTMLElement | null) | null = null;
  private _daysToShowAccessor: (() => readonly string[]) | null = null;

  destroy(): void {
    this._clearShiftInfoTimeout();
    this._resetDragRelatedVars();
    this._gridContainerAccessor = null;
    this._daysToShowAccessor = null;
  }

  // External preview control methods for schedule-day-panel integration
  showExternalPreview(event: ScheduleEvent, style: string, timestamp: number): void {
    this._isDragging.set(true);
    this._currentDragEvent.set(event);
    this._dragPreviewStyle.set(style);
    this._dragPreviewContext.set({ kind: 'time', timestamp });
  }

  updateExternalPreview(style: string, timestamp: number): void {
    if (!this._isDragging()) {
      return;
    }
    this._dragPreviewStyle.set(style);
    this._dragPreviewContext.set({ kind: 'time', timestamp });
  }

  hideExternalPreview(): void {
    this._isDragging.set(false);
    this._currentDragEvent.set(null);
    this._dragPreviewStyle.set(null);
    this._dragPreviewContext.set(null);
  }

  setGridContainer(accessor: () => HTMLElement | null): void {
    // Resolve the container lazily so we don't hold on to stale DOM nodes between renders.
    this._gridContainerAccessor = accessor;
  }

  setDaysToShowAccessor(accessor: () => readonly string[]): void {
    this._daysToShowAccessor = accessor;
  }

  setShiftMode(isShiftMode: boolean): void {
    if (this._isShiftMode() !== isShiftMode) {
      this._isShiftMode.set(isShiftMode);
    }
  }

  handleDragStarted(ev: CdkDragStart<ScheduleEvent>): void {
    this._isDragging.set(true);
    this._currentDragEvent.set(ev.source.data);
    this._dragPreviewContext.set(null);
    this._dragOverTaskId.set(null);
    this._lastDropCol = null;
    this._lastDropScheduleEvent = null;
    this._lastPointerPosition = null;
    this._lastCalculatedTimestamp = null;

    // Show shift key tooltip on non-touch devices to educate users about the feature,
    // then auto-hide after 3 seconds to avoid cluttering the interface.
    if (!IS_TOUCH_PRIMARY) {
      this._showShiftKeyInfo.set(true);
      this._shiftInfoTimeoutId = window.setTimeout(() => {
        this._showShiftKeyInfo.set(false);
        this._shiftInfoTimeoutId = undefined;
      }, 3000);
    }

    const nativeEl = ev.source.element.nativeElement;

    // Hide the original drag-preview element so only our custom preview is visible
    nativeEl.style.opacity = '0';

    const cloneEl = this._dragCloneEl;
    if (cloneEl) {
      cloneEl.remove();
      this._dragCloneEl = null;
    }
  }

  handleDragMoved(ev: CdkDragMove<ScheduleEvent>): void {
    if (!this._isDragging()) {
      return;
    }

    // Disable pointer events on the dragged element so elementFromPoint
    // can detect what's underneath it, not the drag preview itself.
    ev.source.element.nativeElement.style.pointerEvents = 'none';
    const pointer: PointerPosition = {
      x: ev.pointerPosition.x,
      y: ev.pointerPosition.y,
    };
    const targetEl = this._updatePointerCaches(pointer);
    if (!targetEl) {
      return;
    }

    const gridContainer = this._gridContainer();
    if (!gridContainer) {
      return;
    }

    const gridRect = gridContainer.getBoundingClientRect();
    const targetDay = this._getDayUnderPointer(pointer.x, pointer.y);
    const isWithinGrid = this._isWithinGrid(pointer, gridRect);

    if (this.isShiftMode()) {
      this._handleShiftDragMove(targetEl, pointer, gridRect, targetDay, isWithinGrid);
    } else {
      this._handleTimeDragMove(pointer, gridRect, targetDay, isWithinGrid);
    }
  }

  handleDragReleased(ev: CdkDragRelease): void {
    const prevEl = this._prevDragOverEl;
    if (prevEl) {
      prevEl.classList.remove(DRAG_OVER_CLASS);
      this._prevDragOverEl = null;
    }

    const dropPoint = this._lastPointerPosition ?? this._extractDropPoint(ev.event);
    const cloneEl = this._dragCloneEl;
    if (cloneEl) {
      cloneEl.remove();
      this._dragCloneEl = null;
    }

    this._isDragging.set(false);
    const nativeEl = ev.source.element.nativeElement;

    this._dragPreviewContext.set(null);
    this._currentDragEvent.set(null);
    this._dragPreviewStyle.set(null);
    this._dragOverTaskId.set(null);

    // make original element visible again and re-enable pointer events
    nativeEl.style.opacity = '';
    nativeEl.style.pointerEvents = '';

    const { columnTarget, scheduleEventTarget } = this._resolveDropTargets(ev);
    const sourceEvent = ev.source.data;
    const task = this._pluckTaskFromEvent(sourceEvent);
    const sourceTaskId = nativeEl.id.replace(T_ID_PREFIX, '');
    const targetTaskId = scheduleEventTarget
      ? scheduleEventTarget.id.replace(T_ID_PREFIX, '')
      : '';
    const canMoveBefore =
      !!scheduleEventTarget &&
      sourceTaskId.length > 0 &&
      targetTaskId.length > 0 &&
      sourceTaskId !== targetTaskId;

    // Guard: nothing to do without a task
    if (!task) {
      this._resetDragRelatedVars();
      nativeEl.style.transform = 'translate3d(0, 0, 0)';
      ev.source.reset();
      return;
    }

    const dispatchMoveBefore = (): void => {
      this._store.dispatch(
        PlannerActions.moveBeforeTask({
          fromTask: task,
          toTaskId: targetTaskId,
        }),
      );
    };

    // Handle drop scenarios in priority order using if-else chain:
    if (this.isShiftMode() && canMoveBefore) {
      // 1. Shift mode + hovering over another task → reorder
      dispatchMoveBefore();
    } else if (columnTarget) {
      // 2. Dropped on a column → schedule or plan for day
      const wasHandled = this._handleColumnDrop({ task, columnTarget, dropPoint });
      // 3. Column drop failed but hovering over task → reorder as fallback
      if (!wasHandled && canMoveBefore) {
        dispatchMoveBefore();
      }
    } else if (canMoveBefore) {
      // 4. No column but hovering over another task → reorder
      dispatchMoveBefore();
    } else if (dropPoint && this._isOutsideGrid(dropPoint)) {
      // 5. Dropped outside grid → unschedule and remove from today
      this._handleUnschedule(task, sourceEvent);
    }

    // Clear timestamp and other drag-related vars AFTER drop is processed
    this._resetDragRelatedVars();
    // reset to original (now new) position
    nativeEl.style.transform = 'translate3d(0, 0, 0)';
    ev.source.reset();
  }

  refreshPreviewForCurrentPointer(): void {
    if (!this._isDragging()) {
      return;
    }
    const pointer = this._lastPointerPosition;
    if (!pointer) {
      return;
    }
    const gridContainer = this._gridContainer();
    if (!gridContainer) {
      return;
    }
    const gridRect = gridContainer.getBoundingClientRect();
    const targetDay = this._getDayUnderPointer(pointer.x, pointer.y);
    const targetEl =
      this._updatePointerCaches(pointer) ??
      this._lastDropCol ??
      this._lastDropScheduleEvent;
    const isWithinGrid = this._isWithinGrid(pointer, gridRect);

    if (this.isShiftMode()) {
      if (targetEl) {
        this._handleShiftDragMove(targetEl, pointer, gridRect, targetDay, isWithinGrid);
      } else {
        this._dragPreviewContext.set(null);
      }
    } else {
      this._handleTimeDragMove(pointer, gridRect, targetDay, isWithinGrid);
    }
  }

  private _gridContainer(): HTMLElement | null {
    if (!this._gridContainerAccessor) {
      return null;
    }
    try {
      return this._gridContainerAccessor();
    } catch {
      return null;
    }
  }

  private _daysToShow(): readonly string[] {
    if (!this._daysToShowAccessor) {
      return [];
    }
    try {
      // `daysToShow` is an Angular signal; invoking the accessor keeps us in sync.
      return this._daysToShowAccessor() ?? [];
    } catch {
      return [];
    }
  }

  private _clearShiftInfoTimeout(): void {
    if (this._shiftInfoTimeoutId) {
      window.clearTimeout(this._shiftInfoTimeoutId);
      this._shiftInfoTimeoutId = undefined;
    }
  }

  private _resetDragRelatedVars(): void {
    this._lastDropCol = null;
    this._lastDropScheduleEvent = null;
    this._lastPointerPosition = null;
    this._lastCalculatedTimestamp = null;
    this._prevDragOverEl = null;
    this._dragCloneEl = null;
  }

  // Prevent treating drag preview elements as valid drop targets,
  // since they're just visual indicators and not actual schedule slots.
  private _isPreviewElement(element: Element | null): boolean {
    if (!(element instanceof HTMLElement)) {
      return false;
    }
    return (
      element.classList.contains(DRAG_CLONE_CLASS) ||
      element.classList.contains('custom-drag-preview') ||
      element.classList.contains('cdk-drag-preview') ||
      !!element.closest('.cdk-drag-preview')
    );
  }

  private _sanitizeScheduleEventTarget(target: HTMLElement | null): HTMLElement | null {
    if (!target || this._isPreviewElement(target)) {
      return null;
    }
    return target;
  }

  private _updatePointerCaches(pointer: PointerPosition): HTMLElement | null {
    // Cache drop targets during drag moves so we can reuse them on release
    // without expensive re-querying, especially when pointer hasn't moved.
    this._lastPointerPosition = pointer;
    const elementsAtPoint = document.elementsFromPoint(pointer.x, pointer.y);
    const interactiveElements = elementsAtPoint.filter(
      (el): el is HTMLElement => el instanceof HTMLElement && !this._isPreviewElement(el),
    );

    if (interactiveElements.length) {
      this._lastDropCol =
        interactiveElements.find((el) => el.classList.contains('col')) || null;
      const scheduleEventCandidate =
        interactiveElements.find((el) => el.tagName.toLowerCase() === 'schedule-event') ||
        null;
      const sanitizedScheduleEvent =
        this._sanitizeScheduleEventTarget(scheduleEventCandidate);
      this._lastDropScheduleEvent = sanitizedScheduleEvent;
      const targetEl = sanitizedScheduleEvent ?? interactiveElements[0];
      return this._isPreviewElement(targetEl) ? null : targetEl;
    }

    const fallback = document.elementFromPoint(
      pointer.x,
      pointer.y,
    ) as HTMLElement | null;
    if (fallback && !this._isPreviewElement(fallback)) {
      return fallback;
    }
    return null;
  }

  private _handleShiftDragMove(
    targetEl: HTMLElement,
    pointer: PointerPosition,
    gridRect: DOMRect,
    targetDay: string,
    isWithinGrid: boolean,
  ): void {
    this._lastCalculatedTimestamp = null;

    if (isWithinGrid) {
      // Create preview (we don't use the timestamp in shift mode, but still create the visual)
      this._createDragPreview(targetDay, pointer.y, gridRect);

      if (targetEl.classList.contains('col')) {
        this._dragPreviewContext.set({
          kind: 'shift-column',
          day: targetDay,
          isEndOfDay: targetEl.classList.contains('end-of-day'),
        });
        this._dragOverTaskId.set(null);
      } else {
        this._dragPreviewContext.set(null);
        // Extract task ID from hovered schedule event element
        const isTaskElement =
          targetEl.classList.contains(SVEType.Task) ||
          targetEl.classList.contains(SVEType.SplitTask) ||
          targetEl.classList.contains(SVEType.SplitTaskPlannedForDay) ||
          targetEl.classList.contains(SVEType.TaskPlannedForDay);

        if (isTaskElement && targetEl.id.startsWith(T_ID_PREFIX)) {
          const taskId = targetEl.id.replace(T_ID_PREFIX, '');
          this._dragOverTaskId.set(taskId);
          this._dragPreviewContext.set({ kind: 'shift-task', taskId });
        } else {
          this._dragOverTaskId.set(null);
        }
      }
    } else {
      this._dragPreviewStyle.set(null);
      this._dragPreviewContext.set(null);
      this._dragOverTaskId.set(null);
    }

    const prevEl = this._prevDragOverEl;
    if (prevEl && prevEl !== targetEl) {
      prevEl.classList.remove(DRAG_OVER_CLASS);
    }
    if (prevEl !== targetEl) {
      this._prevDragOverEl = targetEl;
      if (
        targetEl.classList.contains(SVEType.Task) ||
        targetEl.classList.contains(SVEType.SplitTask) ||
        targetEl.classList.contains(SVEType.SplitTaskPlannedForDay) ||
        targetEl.classList.contains(SVEType.TaskPlannedForDay) ||
        targetEl.classList.contains('col')
      ) {
        targetEl.classList.add(DRAG_OVER_CLASS);
      }
    }
  }

  private _handleTimeDragMove(
    pointer: PointerPosition,
    gridRect: DOMRect,
    targetDay: string,
    isWithinGrid: boolean,
  ): void {
    const prevEl = this._prevDragOverEl;
    if (prevEl) {
      prevEl.classList.remove(DRAG_OVER_CLASS);
      this._prevDragOverEl = null;
    }

    // Clear drag-over task ID in time mode
    this._dragOverTaskId.set(null);

    if (isWithinGrid) {
      // Create preview and get the adjusted timestamp that accounts for cursor centering
      const adjustedTimestamp = this._createDragPreview(targetDay, pointer.y, gridRect);

      // Cache adjusted timestamp for drop operations
      this._lastCalculatedTimestamp = adjustedTimestamp;

      if (adjustedTimestamp) {
        this._dragPreviewContext.set({ kind: 'time', timestamp: adjustedTimestamp });
      } else {
        this._dragPreviewContext.set(null);
      }
    } else {
      // Show different label based on whether task has scheduled time
      const task = this._pluckTaskFromEvent(this._currentDragEvent());
      const label = task?.dueWithTime ? '✖ Unschedule Time' : '✖ Unschedule from Today';
      this._dragPreviewContext.set({ kind: 'unschedule', label });
      this._lastCalculatedTimestamp = null;
    }
  }

  private _isWithinGrid(pointer: PointerPosition, gridRect: DOMRect): boolean {
    return (
      pointer.y >= gridRect.top &&
      pointer.y <= gridRect.bottom &&
      pointer.x >= gridRect.left &&
      pointer.x <= gridRect.right
    );
  }

  private _createDragPreview(
    targetDay: string,
    pointerY: number,
    gridRect: DOMRect,
  ): number | null {
    const relativeY = pointerY - gridRect.top;
    const totalRows = 24 * FH;
    const rowHeight = gridRect.height / totalRows;
    const rowSpan = this._calculateRowSpan(this._currentDragEvent());

    // Center the cursor on the preview by offsetting by half the rowSpan.
    // This makes the cursor appear more centered on the preview element
    // rather than at the very top edge.
    const rowOffset = Math.floor(rowSpan / 2);
    const row = Math.max(1, Math.round(relativeY / rowHeight) + 1 - rowOffset);

    const dayIndex = this._daysToShow().findIndex((day) => day === targetDay);
    const col = dayIndex + 2;

    const gridStyle = [
      `grid-row: ${row} / span ${rowSpan}`,
      `grid-column: ${col} / span 1`,
    ].join('; ');

    this._dragPreviewStyle.set(gridStyle);

    // Calculate the adjusted timestamp based on where the preview's top edge is positioned,
    // not where the cursor is. This ensures the time badge and drop time match the visual.
    const offsetRows = row - 1;
    const offsetY = offsetRows * rowHeight;
    const adjustedY = gridRect.top + offsetY;
    return calculateTimeFromYPosition(adjustedY, gridRect, targetDay);
  }

  // Calculate preview height based on task duration so users can see
  // how much space the task will occupy before dropping it.
  private _calculateRowSpan(event: ScheduleEvent | null): number {
    if (!event) {
      return 6;
    }
    // Use timeLeftInHours which already accounts for timeSpent
    return Math.max(Math.round(event.timeLeftInHours * FH), 1);
  }

  private _getDayUnderPointer(x: number, y: number): string {
    const elementsAtPoint = document.elementsFromPoint(x, y) as HTMLElement[];
    const colEl = elementsAtPoint.find(
      (el) => el?.classList?.contains('col') && el.hasAttribute('data-day'),
    ) as HTMLElement | undefined;
    if (colEl) {
      const day = colEl.getAttribute('data-day');
      if (day) {
        return day;
      }
    }

    const days = this._daysToShow();
    return days.length ? days[0] : '';
  }

  private _resolveDropTargets(ev: CdkDragRelease): {
    columnTarget: HTMLElement | null;
    scheduleEventTarget: HTMLElement | null;
  } {
    let columnTarget = this._lastDropCol;
    let scheduleEventTarget = this._lastDropScheduleEvent;

    if (
      (!columnTarget || !scheduleEventTarget) &&
      ev.event.target instanceof HTMLElement
    ) {
      const fallback = ev.event.target as HTMLElement;
      if (!columnTarget) {
        columnTarget = fallback.closest('.col') as HTMLElement | null;
      }
      if (!scheduleEventTarget) {
        scheduleEventTarget = fallback.closest('schedule-event') as HTMLElement | null;
      }
    }

    scheduleEventTarget = this._sanitizeScheduleEventTarget(scheduleEventTarget);

    return { columnTarget, scheduleEventTarget };
  }

  private _calculateTimeFromDrop(
    dropPoint: PointerPosition,
    targetDay: string,
  ): number | null {
    const gridContainer = this._gridContainer();
    if (!gridContainer) {
      return null;
    }
    const gridRect = gridContainer.getBoundingClientRect();

    // Apply the same offset adjustment as in _createDragPreview to ensure
    // the drop time matches where the preview was visually positioned.
    const relativeY = dropPoint.y - gridRect.top;
    const totalRows = 24 * FH;
    const rowHeight = gridRect.height / totalRows;
    const rowSpan = this._calculateRowSpan(this._currentDragEvent());
    const rowOffset = Math.floor(rowSpan / 2);
    const row = Math.max(1, Math.round(relativeY / rowHeight) + 1 - rowOffset);

    const offsetRows = row - 1;
    const offsetY = offsetRows * rowHeight;
    const adjustedY = gridRect.top + offsetY;

    return calculateTimeFromYPosition(adjustedY, gridRect, targetDay);
  }

  private _isOutsideGrid(dropPoint: PointerPosition): boolean {
    const gridContainer = this._gridContainer();
    if (!gridContainer) {
      return false;
    }
    const gridRect = gridContainer.getBoundingClientRect();
    return (
      dropPoint.y < gridRect.top ||
      dropPoint.y > gridRect.bottom ||
      dropPoint.x < gridRect.left ||
      dropPoint.x > gridRect.right
    );
  }

  private _scheduleTask(task: TaskCopy, scheduleTime: number): void {
    const hasExistingSchedule = !!task?.dueWithTime;
    const hasReminder = !!(task?.remindAt ?? task?.reminderId);
    const defaultReminderOption = this._getDefaultReminderOption();
    // Smart reminder logic: if task is brand new to scheduling, add a reminder based on user's default setting.
    // If it already has a reminder, update it. Otherwise, leave reminders unchanged.
    const remindAt =
      !hasExistingSchedule && !hasReminder
        ? remindOptionToMilliseconds(scheduleTime, defaultReminderOption)
        : hasReminder
          ? scheduleTime
          : undefined;

    const payload = {
      task,
      dueWithTime: scheduleTime,
      ...(typeof remindAt === 'number' ? { remindAt } : {}),
      isMoveToBacklog: false,
    };

    this._store.dispatch(
      hasExistingSchedule
        ? TaskSharedActions.reScheduleTaskWithTime(payload)
        : TaskSharedActions.scheduleTaskWithTime(payload),
    );

    // Ensure task has a minimum duration so it's visible on the schedule.
    // Without this, zero-duration tasks would be invisible or hard to interact with.
    if (!task.timeEstimate || task.timeEstimate <= 0) {
      const fallbackDuration = Math.max(SCHEDULE_TASK_MIN_DURATION_IN_MS, 15 * 60 * 1000);
      this._store.dispatch(
        TaskSharedActions.updateTask({
          task: {
            id: task.id,
            changes: { timeEstimate: fallbackDuration },
          },
        }),
      );
    }
  }

  private _getDefaultReminderOption(): TaskReminderOptionId {
    return (
      (this._globalConfigService.cfg()?.reminder
        ?.defaultTaskRemindOption as TaskReminderOptionId) ??
      DEFAULT_GLOBAL_CONFIG.reminder.defaultTaskRemindOption!
    );
  }

  private _extractDropPoint(
    event: MouseEvent | TouchEvent | PointerEvent,
  ): PointerPosition | null {
    if ('clientX' in event) {
      return { x: event.clientX, y: event.clientY };
    }
    if ('changedTouches' in event && event.changedTouches?.length) {
      const touch = event.changedTouches[0];
      return { x: touch.clientX, y: touch.clientY };
    }
    if ('touches' in event && event.touches?.length) {
      const touch = event.touches[0];
      return { x: touch.clientX, y: touch.clientY };
    }
    return null;
  }

  private _pluckTaskFromEvent(event: ScheduleEvent | null): TaskCopy | null {
    if (!event || !event.data) {
      return null;
    }

    switch (event.type) {
      case SVEType.Task:
      case SVEType.ScheduledTask:
      case SVEType.SplitTask:
      case SVEType.TaskPlannedForDay:
      case SVEType.SplitTaskPlannedForDay:
        return event.data as TaskCopy;
      default:
        return null;
    }
  }

  private _handleColumnDrop({
    task,
    columnTarget,
    dropPoint,
  }: {
    task: TaskCopy;
    columnTarget: HTMLElement;
    dropPoint: PointerPosition | null;
  }): boolean {
    const isMoveToEndOfDay = columnTarget.classList.contains('end-of-day');
    const targetDay =
      columnTarget.getAttribute('data-day') ||
      (dropPoint ? this._getDayUnderPointer(dropPoint.x, dropPoint.y) : null);

    if (!targetDay) {
      return false;
    }

    if (this.isShiftMode()) {
      this._store.dispatch(
        PlannerActions.planTaskForDay({
          task,
          day: targetDay,
          isAddToTop: !isMoveToEndOfDay,
        }),
      );
      return true;
    }

    // Reuse cached timestamp if available to avoid recalculating from pointer position.
    const scheduleTime =
      this._lastCalculatedTimestamp ??
      (dropPoint ? this._calculateTimeFromDrop(dropPoint, targetDay) : null);

    if (scheduleTime != null) {
      this._scheduleTask(task, scheduleTime);
      return true;
    }

    this._store.dispatch(
      PlannerActions.planTaskForDay({
        task,
        day: targetDay,
        isAddToTop: !isMoveToEndOfDay,
      }),
    );
    return true;
  }

  private _handleUnschedule(task: TaskCopy, sourceEvent: ScheduleEvent): void {
    // Check if task has scheduled time - unschedule it
    // This also removes from planner days (but not from today tag)
    if (task.dueWithTime) {
      this._store.dispatch(
        TaskSharedActions.unscheduleTask({
          id: task.id,
          isLeaveInToday: true,
        }),
      );
    }
    // apparently our today list is put together by tasks with a dueDay and by tasks inside TODAY_TAG.taskIds
    else if (task.dueDay) {
      this._store.dispatch(
        TaskSharedActions.unscheduleTask({
          id: task.id,
        }),
      );
    } else {
      this._store
        .select(selectTodayTaskIds)
        .pipe(first())
        .subscribe((todayTaskIds) => {
          if (todayTaskIds.includes(task.id)) {
            this._store.dispatch(
              TaskSharedActions.removeTasksFromTodayTag({
                taskIds: [task.id],
              }),
            );
          }
        });
    }
  }
}
