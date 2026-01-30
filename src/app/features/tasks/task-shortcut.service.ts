import { computed, inject, Injectable } from '@angular/core';
import { TaskFocusService } from './task-focus.service';
import { TaskService } from './task.service';
import { GlobalConfigService } from '../config/global-config.service';
import { checkKeyCombo } from '../../util/check-key-combo';
import { Log } from '../../core/log';
import { TaskComponent } from './task/task.component';
import { TaskContextMenuComponent } from './task-context-menu/task-context-menu.component';
import { TaskContextMenuInnerComponent } from './task-context-menu/task-context-menu-inner/task-context-menu-inner.component';

type TaskId = string;

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
    const focusedTaskId: TaskId | null = this._taskFocusService.focusedTaskId();

    // Handle togglePlay specially - it works with focusedTaskId OR selectedTaskId
    // This allows starting time tracking from Schedule view where tasks are selected but not focused
    if (checkKeyCombo(ev, keys.togglePlay) && this.isTimeTrackingEnabled()) {
      if (focusedTaskId) {
        // Focused task exists - delegate to the task component
        this._handleTaskShortcut(focusedTaskId, 'togglePlayPause');
      } else {
        // No focused task - check for selected task (e.g., from Schedule view)
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
      }
      ev.preventDefault();
      return true;
    }

    // All other shortcuts require a focused task
    if (!focusedTaskId) {
      return false;
    }

    const isShiftOrCtrlPressed = ev.shiftKey || ev.ctrlKey;

    // Check if the focused task's context menu is open - if so, skip arrow navigation shortcuts
    const isContextMenuOpen = this._isTaskContextMenuOpen(focusedTaskId);

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
    if (checkKeyCombo(ev, keys.taskOpenContextMenu)) {
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

    if (checkKeyCombo(ev, keys.moveToTodaysTasks)) {
      this._handleTaskShortcut(focusedTaskId, 'moveToTodayWithFocus');
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
      ev.preventDefault();
      this._handleTaskShortcut(focusedTaskId, 'focusPrevious');
      return true;
    }

    if (
      !isContextMenuOpen &&
      ((!isShiftOrCtrlPressed && ev.key === 'ArrowDown') ||
        checkKeyCombo(ev, keys.selectNextTask))
    ) {
      ev.preventDefault();
      this._handleTaskShortcut(focusedTaskId, 'focusNext');
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
   * Calls a method on the currently focused task component.
   *
   * @param taskId - The ID of the task (for validation)
   * @param method - The method name to call on the task component
   * @param args - Arguments to pass to the method
   */
  private _handleTaskShortcut(
    taskId: TaskId,
    method: TaskComponentMethod,
    ...args: unknown[]
  ): void {
    const taskComponent = this._taskFocusService.lastFocusedTaskComponent();
    if (!taskComponent) {
      Log.warn(`No focused task component available for ID: ${taskId}`);
      return;
    }

    if (typeof taskComponent[method] === 'function') {
      // Close context menu if open before executing the shortcut
      this._closeContextMenuIfOpen(taskComponent);

      (taskComponent[method] as (...args: unknown[]) => void)(...args);
    } else {
      Log.warn(`Method ${method} not found on task component`, taskComponent);
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
