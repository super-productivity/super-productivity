import { InjectionToken, Signal } from '@angular/core';
import type { TaskCopy } from './task.model';
import type { TaskAddEvent } from './add-task-bar/add-task-bar.component';

/** What the regular add-task bar needs to add a task into a view's column. */
export interface ViewNewTaskTarget {
  /** Always carries a `projectId`: the bar must not fall back to the stale context. */
  additionalFields: Partial<TaskCopy>;
  tagsToRemove: string[];
  taskIdsToExclude: string[];
}

/**
 * Provided by a view's column (board panel) when it renders its tasks as a
 * task list. Task rows and the task list use it instead of the active work
 * context, which on a view page is still whatever project or tag was open
 * before: reordering goes to the view, Today/backlog actions that depend on
 * the open list are off. Lives in `tasks/` so tasks don't import boards.
 */
export interface ViewTaskListHost {
  /** Whether the task is a top-level row of this view (not a nested subtask). */
  isRow(taskId: string): boolean;
  /** False while the column is sorted: rows can't be reordered by hand. */
  readonly isManualOrder: Signal<boolean>;
  /** Tags the column requires; rows don't need to show them. */
  readonly tagsToHide: Signal<string[]>;
  /** Whether the column's rules can make the task match (drops from other sections). */
  canEnter(task: TaskCopy): boolean;
  /**
   * Puts a row after `afterTaskId` (null: first). A task from another column
   * of the same view is moved in through the column's rules.
   */
  placeRow(taskId: string, afterTaskId: string | null): void;
  /**
   * Moves a row within its section, or at the section's edge into the
   * previous/next section. Returns true when the row left this section: the
   * row element is then leaving and must not refocus itself.
   */
  moveRow(taskId: string, to: 'up' | 'down' | 'top' | 'bottom'): boolean;
  /** Null when no new task can match the column (e.g. "overdue" rules). */
  readonly newTaskTarget: Signal<ViewNewTaskTarget | null>;
  /** Places and completes a task the add-task bar created for this column. */
  afterTaskAdd(ev: TaskAddEvent): Promise<void>;
}

export const VIEW_TASK_LIST = new InjectionToken<ViewTaskListHost>('VIEW_TASK_LIST');
