import { ADD_TASK_INLINE_BTN_SELECTOR } from './add-task-inline/add-task-inline.const';

/** Resolve before removing a Planner section, such as overdue, with no add button. */
export const getNextPlannerAddButton = (scope: HTMLElement): HTMLElement | null => {
  const sections = Array.from(
    document.querySelectorAll<HTMLElement>('[data-planner-selection-scope]'),
  );
  const idx = sections.indexOf(scope);
  if (idx === -1) {
    return null;
  }
  for (const section of sections.slice(idx + 1)) {
    const btn = section.querySelector<HTMLElement>(ADD_TASK_INLINE_BTN_SELECTOR);
    if (btn) {
      return btn;
    }
  }
  return null;
};
