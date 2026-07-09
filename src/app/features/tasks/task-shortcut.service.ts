import { computed, inject, Injectable } from '@angular/core';
import { TaskFocusService } from './task-focus.service';
import { TaskService } from './task.service';
import { GlobalConfigService } from '../config/global-config.service';
import { checkKeyCombo } from '../../util/check-key-combo';
import { Log } from '../../core/log';
import { TaskComponent } from './task/task.component';
import { TaskContextMenuComponent } from './task-context-menu/task-context-menu.component';
import { TaskContextMenuInnerComponent } from './task-context-menu/task-context-menu-inner/task-context-menu-inner.component';
import { isInputElement } from '../../util/dom-element';

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
    let focusedTaskId: TaskId | null = this._taskFocusService.focusedTaskId();

    // Make the DOM authoritative for task focus (#8851). Two problems this
    // solves:
    //  1. Focus-tracking recovery: a `focusout` can clear focusedTaskId without
    //     a following `focusin` rebinding it (e.g. focus staying on the task
    //     host after an inline-edit blur, where `.focus()` is a no-op and no new
    //     focusin fires). If the active element is still inside a <task>, we
    //     recover the id so shortcuts don't silently drop.
    //  2. Stale-focus guard: navigating to a view with no live <task> (e.g. the
    //     Planner overdue list) leaves focusedTaskId pointing at a <task> that
    //     no longer holds focus. Acting on it would mutate the wrong task. If
    //     the active element is not inside the <task> matching focusedTaskId,
    //     drop it.
    // Only the DOM actively contradicting invalidates focus, so the inline-edit
    // recovery path above stays intact.
    const active = document.activeElement as HTMLElement | null;
    const domFocusedTaskId =
      (active?.closest('task') as HTMLElement | null)?.getAttribute('data-task-id') ??
      null;
    if (domFocusedTaskId) {
      focusedTaskId = domFocusedTaskId;
    } else if (focusedTaskId) {
      focusedTaskId = null;
    }

    // Schedule for today (Shift+T). This is the one task shortcut wired to work
    // without a live <task> component, so it also fires from views that render
    // <planner-task> (the Planner overdue list). When a real <task> is focused
    // we still delegate, so the backlog→regular position-only move (#8592/#8603)
    // and the overdue branch in moveToToday() are preserved. (#8851)
    if (checkKeyCombo(ev, keys.taskScheduleToday)) {
      if (focusedTaskId) {
        this._handleTaskShortcut(focusedTaskId, 'moveToTodayWithFocus');
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
        // Recovery path (above) can derive focusedTaskId from the DOM before
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
   * Resolves a task id straight from the focused element by walking up to the
   * nearest host carrying `data-task-id`. Generic over the host selector (works
   * for both `<task>` and `<planner-task>`) so the id-based shortcut path can
   * act on a task without a live `<task>` component. (#8851)
   */
  private _resolveTaskIdFromDom(): TaskId | null {
    const active = document.activeElement as HTMLElement | null;
    const host = active?.closest('[data-task-id]') as HTMLElement | null;
    return host?.getAttribute('data-task-id') ?? null;
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
      return contextMenu?.isShowInner ?? false;
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

      // Close the context menu if it's open
      if (contextMenu && contextMenu.isShowInner) {
        // Set isShowInner to false to hide the context menu
        contextMenu.isShowInner = false;

        // Also trigger onClose on the inner component if available
        const innerComponent: TaskContextMenuInnerComponent | undefined =
          contextMenu.taskContextMenuInner?.();
        if (innerComponent && typeof innerComponent.onClose === 'function') {
          innerComponent.onClose();
        }
      }
    } catch (error) {
      // Silently ignore errors - context menu might not exist or be accessible
      Log.warn('Failed to close context menu:', error);
    }
  }
}
