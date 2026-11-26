import { InjectionToken } from '@angular/core';

export type TaskCardArrow = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';
export type TaskCardMove = 'up' | 'down' | 'top' | 'bottom';

/** Container-specific behavior for shared task cards. Selection stays task-based. */
export interface TaskCardList {
  navigate(taskId: string, key: TaskCardArrow): void;
  reorder(taskId: string, direction: TaskCardMove): void;
  moveToAdjacent(taskId: string, direction: -1 | 1): void;
  rows(): HTMLElement[];
  addButton(): HTMLElement | null;
}

/**
 * A card list's add button (`TaskCardList.addButton()`), e.g. a board column's
 * header "+". The marker sits on the button itself, so no button of an open
 * add-task bar matches.
 */
export const TASK_CARD_LIST_ADD_BTN_SELECTOR = 'button[data-add-task-btn]';

export const TASK_CARD_LIST = new InjectionToken<TaskCardList>('TASK_CARD_LIST');
