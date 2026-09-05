import { computed, inject, Injectable } from '@angular/core';
import { TaskFocusService } from './task-focus.service';
import { TaskService } from './task.service';
import { GlobalConfigService } from '../config/global-config.service';
import { checkKeyCombo } from '../../util/check-key-combo';
import { Log } from '../../core/log';
import { TaskComponent } from './task/task.component';
import { TaskContextMenuComponent } from './task-context-menu/task-context-menu.component';
import { TaskContextMenuInnerComponent } from './task-context-menu/task-context-menu-inner/task-context-menu-inner.component';
import { KeyboardConfig } from '@sp/keyboard-config';
import { isInputElement } from '../../util/dom-element';
import { getDomFocusedTaskId } from './get-dom-focused-task-id';
import { TaskMultiSelectService } from './task-multi-select.service';
import { TaskBulkActionService } from './task-bulk-action.service';

type TaskId = string;

const isNativeContextMenuKey = (ev: KeyboardEvent): boolean =>
  !ev.ctrlKey &&
  !ev.altKey &&
  !ev.metaKey &&
  !ev.shiftKey &&
  (ev.key === 'ContextMenu' || ev.key === 'Menu' || ev.code === 'ContextMenu');

/**
 * Available methods on the task component for keyboard shortcut delegation.
 * These correspond to actual methods implemented in the TaskComponent.
 */
type TaskComponentMethod = keyof TaskComponent;

/**
 * Service for handling global task keyboard shortcuts.
 *
 * This service provides comprehensive keyboard shortcut support for task management:
 * - Delegates shortcut actions to appropriate task component methods
 * - Manages context menu state to prevent conflicts with navigation shortcuts
 * - Supports conditional shortcut execution based on UI state
 * - Provides type-safe component interaction through well-defined interfaces
 *
 * Key features:
 * - Arrow navigation (disabled when context menus are open)
 * - Task editing shortcuts (title, tags, scheduling, etc.)
 * - Project and context management shortcuts
 * - Automatic context menu closing when executing shortcuts
 */
@Injectable({
  providedIn: 'root',
})
export class TaskShortcutService {
  private readonly _taskFocusService = inject(TaskFocusService);
  private readonly _taskService = inject(TaskService);
  private readonly _configService = inject(GlobalConfigService);
  private readonly _multiSelect = inject(TaskMultiSelectService);
  private readonly _bulkActions = inject(TaskBulkActionService);
  readonly isTimeTrackingEnabled = computed(
    () => this._configService.appFeatures().isTimeTrackingEnabled,
  );

  /**
   * Handles task-specific keyboard shortcuts if a task is currently focused.
   *
   * @param ev - The keyboard event
   * @returns True if the shortcut was handled, false otherwise
   */
  handleTaskShortcuts(ev: KeyboardEvent): boolean {
    const cfg = this._configService.cfg();
    if (!cfg) return false;

    const keys = cfg.keyboard;
    const focusedTaskId: TaskId | null = getDomFocusedTaskId();

    // Multi-selection: Esc clears; Shift+Arrow extends from the focused row;
    // the bulk-capable task shortcuts act on the whole selection. These run
    // before the focused-task gate so they also work when focus sits on the
    // selection bar or a dialog just closed. (ShortcutService already bails
    // out for inputs and open overlays, so Esc/typing there are untouched.)
    if (this._handleMultiSelectShortcuts(ev, keys, focusedTaskId)) {
      return true;
    }

    // Schedule for today (Shift+T). This is the one task shortcut wired to work
    // without a live <task> component, so it also fires from views that render
    // <planner-task> (the Planner overdue list). When a real <task> is focused
    // we delegate instead, because that path also keeps keyboard focus sane when
    // scheduling removes the row from the current list. (#8851)
    // Neither path changes the task's list position — that stays the context
    // menu's job, so #8592 keeps holding. (#9563)
    if (checkKeyCombo(ev, keys.taskScheduleToday)) {
      if (focusedTaskId) {
        this._handleTaskShortcut(focusedTaskId, 'scheduleForTodayWithFocus');
        ev.preventDefault();
        ev.stopPropagation();
        return true;
      }
      const idBasedTaskId = this._resolveTaskIdFromDom();
      if (idBasedTaskId) {
        this._taskService.scheduleForTodayById(idBasedTaskId);
        ev.preventDefault();
        ev.stopPropagation();
        return true;
      }
    }

    // Handle togglePlay specially - it works with focusedTaskId OR selectedTaskId
    // This allows starting time tracking from Schedule view where tasks are selected but not focused
    if (checkKeyCombo(ev, keys.togglePlay) && this.isTimeTrackingEnabled()) {
      if (focusedTaskId) {
        // Focused task exists - delegate to the task component
        this._handleTaskShortcut(focusedTaskId, 'togglePlayPause');
        ev.preventDefault();
        return true;
      }
      // If no focused task, return false to let ShortcutService handle global fallback
      return false;
    }

    // All other shortcuts require a focused task
    if (!focusedTaskId) {
      return false;
    }

    // Ctrl+C / Cmd+C: copy focused task title. Match on `code` (physical
    // position) so the shortcut still fires on non-Latin layouts, mirroring
    // how the browser's native copy is bound.
    if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && !ev.shiftKey && ev.code === 'KeyC') {
      const target = ev.target;
      const hasTextSelected = !!window.getSelection()?.toString();
      if (
        !(target instanceof HTMLElement && isInputElement(target)) &&
        !hasTextSelected
      ) {
        const taskComponent = this._taskFocusService.lastFocusedTaskComponent();
        // getDomFocusedTaskId() can derive focusedTaskId from the DOM before
        // lastFocusedTaskComponent has caught up — fall through to native copy
        // rather than copying a stale title.
        if (taskComponent?.task().id === focusedTaskId) {
          void navigator.clipboard?.writeText(taskComponent.task().title).catch((err) => {
            Log.warn('Failed to copy task title to clipboard:', err);
          });
          ev.preventDefault();
          return true;
        }
      }
    }

    const isShiftOrCtrlPressed = ev.shiftKey || ev.ctrlKey;

    // Check if the focused task's context menu is open - if so, skip arrow navigation shortcuts
    const isContextMenuOpen = this._isTaskContextMenuOpen(focusedTaskId);

    // Ctrl/Cmd+Enter on a focused (but not editing) task: same as the `a`
    // shortcut — create a new subtask. Must run before the plain-Enter
    // "edit title" handler below. A user-bound `togglePlay` is checked
    // earlier (line ~74), so remapping `togglePlay` to Mod+Enter takes
    // precedence over this hardcoded combo.
    if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
      this._handleTaskShortcut(focusedTaskId, 'addSubTask');
      ev.preventDefault();
      return true;
    }

    // Basic task actions that work through component delegation
    if (
      !isContextMenuOpen &&
      (checkKeyCombo(ev, keys.taskEditTitle) || ev.key === 'Enter')
    ) {
      this._handleTaskShortcut(focusedTaskId, 'focusTitleForEdit');
      ev.preventDefault();
      return true;
    }
    if (checkKeyCombo(ev, keys.taskToggleDetailPanelOpen)) {
      this._handleTaskShortcut(focusedTaskId, 'toggleShowDetailPanel');
      ev.preventDefault();
      return true;
    }
    if (checkKeyCombo(ev, keys.taskOpenNotesPanel)) {
      this._handleTaskShortcut(focusedTaskId, 'openNotesPanel');
      ev.preventDefault();
      return true;
    }
    if (checkKeyCombo(ev, keys.taskOpenNotesFullscreen)) {
      this._handleTaskShortcut(focusedTaskId, 'openNotesFullscreen');
      ev.preventDefault();
      return true;
    }
    if (checkKeyCombo(ev, keys.taskOpenEstimationDialog)) {
      this._handleTaskShortcut(focusedTaskId, 'estimateTime');
      ev.preventDefault();
      return true;
    }
    if (checkKeyCombo(ev, keys.taskSchedule)) {
      this._handleTaskShortcut(focusedTaskId, 'scheduleTask');
      ev.preventDefault();
      return true;
    }
    if (checkKeyCombo(ev, keys.taskScheduleTomorrow)) {
      this._handleTaskShortcut(focusedTaskId, 'scheduleTaskTomorrow');
      ev.preventDefault();
      return true;
    }
    if (checkKeyCombo(ev, keys.taskScheduleNextWeek)) {
      this._handleTaskShortcut(focusedTaskId, 'scheduleTaskNextWeek');
      ev.preventDefault();
      return true;
    }
    if (checkKeyCombo(ev, keys.taskScheduleNextMonth)) {
      this._handleTaskShortcut(focusedTaskId, 'scheduleTaskNextMonth');
      ev.preventDefault();
      return true;
    }
    if (checkKeyCombo(ev, keys.taskScheduleDeadline)) {
      this._handleTaskShortcut(focusedTaskId, 'openDeadlineDialog');
      ev.preventDefault();
      return true;
    }
    if (checkKeyCombo(ev, keys.taskUnschedule)) {
      this._handleTaskShortcut(focusedTaskId, 'unschedule');
      ev.preventDefault();
      return true;
    }
    if (checkKeyCombo(ev, keys.taskToggleDone)) {
      this._handleTaskShortcut(focusedTaskId, 'toggleDoneKeyboard');
      ev.preventDefault();
      return true;
    }
    if (checkKeyCombo(ev, keys.taskAddSubTask)) {
      this._handleTaskShortcut(focusedTaskId, 'addSubTask');
      ev.preventDefault();
      return true;
    }
    if (checkKeyCombo(ev, keys.taskDuplicate)) {
      this._handleTaskShortcut(focusedTaskId, 'duplicateTask');
      ev.preventDefault();
      return true;
    }
    if (checkKeyCombo(ev, keys.taskAddAttachment)) {
      this._handleTaskShortcut(focusedTaskId, 'addAttachment');
      ev.preventDefault();
      return true;
    }
    if (checkKeyCombo(ev, keys.taskDelete)) {
      this._handleTaskShortcut(focusedTaskId, 'deleteTask');
      ev.preventDefault();
      return true;
    }

    // Move to project / Open project menu for project selection (only for non-sub-tasks)
    if (!isContextMenuOpen && checkKeyCombo(ev, keys.taskMoveToProject)) {
      this._handleTaskShortcut(focusedTaskId, 'openProjectMenu');
      ev.preventDefault();
      return true;
    }

    // Edit tags
    if (checkKeyCombo(ev, keys.taskEditTags)) {
      this._handleTaskShortcut(focusedTaskId, 'editTags');
      ev.preventDefault();
      return true;
    }

    // Toggle context menu
    if (checkKeyCombo(ev, keys.taskOpenContextMenu) || isNativeContextMenuKey(ev)) {
      this._handleTaskShortcut(focusedTaskId, 'openContextMenu', ev);
      ev.preventDefault();
      return true;
    }

    // Move to backlog/today (only for project tasks, not sub-tasks)
    if (checkKeyCombo(ev, keys.moveToBacklog)) {
      this._handleTaskShortcut(focusedTaskId, 'moveToBacklogWithFocus');
      ev.preventDefault();
      ev.stopPropagation();
      return true;
    }

    // Navigation shortcuts - only work if context menu is not open
    if (
      !isContextMenuOpen &&
      ((!isShiftOrCtrlPressed && ev.key === 'ArrowUp') ||
        checkKeyCombo(ev, keys.selectPreviousTask))
    ) {
      this._handleTaskShortcut(focusedTaskId, 'handleArrowUp');
      ev.preventDefault();
      return true;
    }

    if (
      !isContextMenuOpen &&
      ((!isShiftOrCtrlPressed && ev.key === 'ArrowDown') ||
        checkKeyCombo(ev, keys.selectNextTask))
    ) {
      this._handleTaskShortcut(focusedTaskId, 'handleArrowDown');
      ev.preventDefault();
      return true;
    }

    // Arrow navigation for expand/collapse - only work if context menu is not open
    if (
      !isContextMenuOpen &&
      (ev.key === 'ArrowLeft' || checkKeyCombo(ev, keys.collapseSubTasks))
    ) {
      this._handleTaskShortcut(focusedTaskId, 'handleArrowLeft');
      ev.preventDefault();
      return true;
    }

    if (
      !isContextMenuOpen &&
      (ev.key === 'ArrowRight' || checkKeyCombo(ev, keys.expandSubTasks))
    ) {
      this._handleTaskShortcut(focusedTaskId, 'handleArrowRight');
      ev.preventDefault();
      return true;
    }

    // Task movement shortcuts
    if (checkKeyCombo(ev, keys.moveTaskUp)) {
      this._handleTaskShortcut(focusedTaskId, 'moveTaskUp');
      ev.preventDefault();
      ev.stopPropagation();
      return true;
    }

    if (checkKeyCombo(ev, keys.moveTaskDown)) {
      this._handleTaskShortcut(focusedTaskId, 'moveTaskDown');
      ev.preventDefault();
      ev.stopPropagation();
      return true;
    }

    if (checkKeyCombo(ev, keys.moveTaskToTop)) {
      this._handleTaskShortcut(focusedTaskId, 'moveTaskToTop');
      ev.preventDefault();
      ev.stopPropagation();
      return true;
    }

    if (checkKeyCombo(ev, keys.moveTaskToBottom)) {
      this._handleTaskShortcut(focusedTaskId, 'moveTaskToBottom');
      ev.preventDefault();
      ev.stopPropagation();
      return true;
    }

    return false;
  }

  private _handleMultiSelectShortcuts(
    ev: KeyboardEvent,
    keys: KeyboardConfig,
    focusedTaskId: TaskId | null,
  ): boolean {
    if (ev.key === 'Escape' && this._multiSelect.isActive()) {
      this._multiSelect.clear();
      ev.preventDefault();
      return true;
    }

    if (
      focusedTaskId &&
      ev.shiftKey &&
      !ev.ctrlKey &&
      !ev.metaKey &&
      !ev.altKey &&
      (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') &&
      // A user who bound a task shortcut to Shift+Arrow keeps it.
      !checkKeyCombo(ev, keys.moveTaskUp) &&
      !checkKeyCombo(ev, keys.moveTaskDown)
    ) {
      this._extendSelectionThrottled(ev.key === 'ArrowDown' ? 'down' : 'up');
      ev.preventDefault();
      return true;
    }

    if (!this._multiSelect.isActive()) {
      return false;
    }

    // A shortcut on a focused row that is *not* part of the selection acts on
    // that row alone (file-manager rule): drop the selection and fall through.
    if (focusedTaskId && !this._multiSelect.has(focusedTaskId)) {
      if (this._isBulkShortcut(ev, keys)) {
        this._multiSelect.clear();
      }
      return false;
    }

    // Bulk allowlist. Everything else keeps acting on the focused task only.
    const bulkHandlers: [string | null | undefined, () => unknown][] = [
      [keys.taskToggleDone, () => this._bulkActions.toggleDone()],
      [keys.taskDelete, () => this._bulkActions.deleteSelected()],
      [keys.taskSchedule, () => this._bulkActions.openScheduleDialog()],
      [keys.taskScheduleDeadline, () => this._bulkActions.openDeadlineDialog()],
      [keys.taskScheduleToday, () => this._bulkActions.addToToday()],
      [keys.taskUnschedule, () => this._bulkActions.unschedule()],
      [keys.moveToBacklog, () => this._bulkActions.moveToBacklog()],
      [keys.taskMoveToProject, () => this._requestBulkMenu(focusedTaskId)],
      [keys.taskEditTags, () => this._requestBulkMenu(focusedTaskId)],
      [keys.taskOpenEstimationDialog, () => this._requestBulkMenu(focusedTaskId)],
      [keys.taskOpenContextMenu, () => this._requestBulkMenu(focusedTaskId)],
    ];
    for (const [combo, handler] of bulkHandlers) {
      if (combo && checkKeyCombo(ev, combo)) {
        handler();
        ev.preventDefault();
        ev.stopPropagation();
        return true;
      }
    }
    if (isNativeContextMenuKey(ev)) {
      this._requestBulkMenu(focusedTaskId);
      ev.preventDefault();
      return true;
    }
    return false;
  }

  private _isBulkShortcut(ev: KeyboardEvent, keys: KeyboardConfig): boolean {
    return (
      [
        keys.taskToggleDone,
        keys.taskDelete,
        keys.taskSchedule,
        keys.taskScheduleDeadline,
        keys.taskScheduleToday,
        keys.taskUnschedule,
        keys.moveToBacklog,
        keys.taskMoveToProject,
        keys.taskEditTags,
        keys.taskOpenEstimationDialog,
        keys.taskOpenContextMenu,
      ].some((combo) => !!combo && checkKeyCombo(ev, combo)) || isNativeContextMenuKey(ev)
    );
  }

  private _lastExtendAt = 0;

  /** Key repeat over a long list would re-check every row per event; ~30/s → 10/s. */
  private _extendSelectionThrottled(direction: 'up' | 'down'): void {
    const now = Date.now();
    if (now - this._lastExtendAt < 100) {
      return;
    }
    this._lastExtendAt = now;
    this._multiSelect.extendFromFocused(direction);
  }

  /** Opens the bulk actions menu next to the focused row (or the bar). */
  private _requestBulkMenu(focusedTaskId: TaskId | null): void {
    const rowEl = focusedTaskId
      ? (document.activeElement?.closest('task') as HTMLElement | null)
      : null;
    const rect = rowEl?.getBoundingClientRect();
    this._multiSelect.requestMenuOpen(
      rect
        ? { x: rect.left + Math.min(rect.width / 2, 200), y: rect.bottom }
        : { x: window.innerWidth / 2, y: window.innerHeight - 80 },
    );
  }

  /**
   * Handles togglePlay shortcut as a fallback when no task is focused.
   *
   * @param ev - The keyboard event
   * @returns True if handled, false otherwise
   */
  handleTogglePlayFallback(ev: KeyboardEvent): boolean {
    const cfg = this._configService.cfg();
    if (!cfg) return false;

    if (checkKeyCombo(ev, cfg.keyboard.togglePlay) && this.isTimeTrackingEnabled()) {
      // Check for selected task (e.g., from Schedule view)
      const selectedId = this._taskService.selectedTaskId();
      if (selectedId) {
        const currentTaskId = this._taskService.currentTaskId();
        if (currentTaskId === selectedId) {
          // Already tracking this task - stop tracking
          this._taskService.setCurrentId(null);
        } else {
          // Start tracking the selected task
          this._taskService.setCurrentId(selectedId);
        }
      } else {
        // Neither focused nor selected - use global toggle
        this._taskService.toggleStartTask();
      }
      ev.preventDefault();
      return true;
    }
    return false;
  }

  /**
   * Resolves a task id from the focused element, matching `<planner-task>` as
   * well as `<task>`, so the id-based shortcut path can act on a task without a
   * live `<task>` component. (#8851)
   */
  private _resolveTaskIdFromDom(): TaskId | null {
    return getDomFocusedTaskId('[data-task-id]');
  }

  /**
   * Calls a method on the currently focused task component.
   *
   * @param taskId - The ID of the task (must match lastFocusedTaskComponent;
   *   guards against the recovery path delegating to a stale component when
   *   the active element belongs to a different task than the one tracked).
   * @param method - The method name to call on the task component
   * @param args - Arguments to pass to the method
   * @returns True if the method was found and called, false otherwise
   */
  private _handleTaskShortcut(
    taskId: TaskId,
    method: TaskComponentMethod,
    ...args: unknown[]
  ): boolean {
    const taskComponent = this._taskFocusService.lastFocusedTaskComponent();
    if (!taskComponent) {
      Log.warn(`No focused task component available for ID: ${taskId}`);
      return false;
    }
    if (taskComponent.task().id !== taskId) {
      Log.warn(
        `Focused task component (${taskComponent.task().id}) does not match shortcut target (${taskId})`,
      );
      return false;
    }

    if (typeof taskComponent[method] === 'function') {
      // Close context menu if open before executing the shortcut
      this._closeContextMenuIfOpen(taskComponent);

      (taskComponent[method] as (...args: unknown[]) => unknown)(...args);
      return true;
    } else {
      Log.warn(`Method ${method} not found on task component`, taskComponent);
      return false;
    }
  }

  /**
   * Checks if the context menu is open for the currently focused task.
   *
   * @param taskId - The task ID to check
   * @returns True if the context menu is open, false otherwise
   */
  private _isTaskContextMenuOpen(taskId: TaskId): boolean {
    try {
      const taskComponent = this._taskFocusService.lastFocusedTaskComponent();
      if (!taskComponent) return false;

      const contextMenu: TaskContextMenuComponent | undefined =
        taskComponent.taskContextMenu();
      return contextMenu?.isOpen() ?? false;
    } catch (error) {
      return false;
    }
  }

  /**
   * Closes the context menu if it's currently open for the given task component.
   *
   * @param taskComponent - The task component instance
   */
  private _closeContextMenuIfOpen(taskComponent: TaskComponent): void {
    try {
      const contextMenu: TaskContextMenuComponent | undefined =
        taskComponent.taskContextMenu();

      if (contextMenu?.isOpen()) {
        const innerComponent: TaskContextMenuInnerComponent | undefined =
          contextMenu.taskContextMenuInner?.();
        if (innerComponent) {
          innerComponent.onClose();
        } else {
          contextMenu.onClose();
        }
      }
    } catch (error) {
      // Silently ignore errors - context menu might not exist or be accessible
      Log.warn('Failed to close context menu:', error);
    }
  }
}
