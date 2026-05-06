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
