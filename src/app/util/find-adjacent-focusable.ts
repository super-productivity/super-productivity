export type FocusDirection = 'prev' | 'next';

/**
 * Returns the previous or next element matching `selector` in document order,
 * relative to `from`. Used for keyboard arrow-navigation across a mixed list
 * of focusable elements (e.g. group headers and task rows in the work view).
 *
 * `from` must itself match `selector`. Visibility is determined by DOM
 * presence — Angular structural directives (`@if`, `@for` filters) keep
 * hidden elements out of the document, so this only returns rendered targets.
 */
export const findAdjacentFocusable = (
  from: HTMLElement,
  direction: FocusDirection,
  selector: string,
): HTMLElement | null => {
  const all = Array.from(document.querySelectorAll<HTMLElement>(selector));
  const idx = all.indexOf(from);
  if (idx < 0) {
    return null;
  }
  const step = direction === 'next' ? 1 : -1;
  return all[idx + step] ?? null;
};

/**
 * Returns the final rendered row in a parent task's subtree. The parent itself
 * is returned when it has no rendered subtasks.
 */
export const findLastTaskInSubtree = (parentTaskEl: HTMLElement): HTMLElement => {
  const subtaskEls = Array.from(parentTaskEl.querySelectorAll<HTMLElement>('task'));
  return subtaskEls[subtaskEls.length - 1] ?? parentTaskEl;
};

/**
 * Finds the next main-list task after a parent and all of its rendered
 * subtasks. Task copies inside the detail panel are excluded so navigation
 * cannot jump into a second rendering of the same subtree.
 */
export const findNextTaskAfterSubtree = (
  parentTaskEl: HTMLElement,
): HTMLElement | null => {
  const lastRow = findLastTaskInSubtree(parentTaskEl);
  const mainTaskEls = Array.from(document.querySelectorAll<HTMLElement>('task')).filter(
    (taskEl) => !taskEl.closest('task-detail-panel'),
  );
  const currentIndex = mainTaskEls.indexOf(lastRow);
  return currentIndex < 0 ? null : (mainTaskEls[currentIndex + 1] ?? null);
};
