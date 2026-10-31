import { InjectionToken, Signal } from '@angular/core';

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
  /**
   * Puts a row after `afterTaskId` (null: first). A task from another column
   * of the same view is moved in through the column's rules.
   */
  placeRow(taskId: string, afterTaskId: string | null): void;
  moveRow(taskId: string, to: 'up' | 'down' | 'top' | 'bottom'): void;
}

export const VIEW_TASK_LIST = new InjectionToken<ViewTaskListHost>('VIEW_TASK_LIST');
