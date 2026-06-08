import { isMarkdownChecklist } from './is-markdown-checklist';
import { isCheckedItemLine, isChecklistItemLine } from './checklist-operations';

export interface ChecklistProgress {
  done: number;
  total: number;
}

/**
 * Derives checklist progress ({done, total}) from a task's markdown notes.
 * Returns null when the notes are not a markdown checklist or contain no items,
 * so callers can simply hide the indicator on a falsy value. Runs on the task
 * hot path, so it counts in a single pass over the lines (no intermediate
 * checklist-item array) using the shared checklist predicates.
 */
export const getChecklistProgress = (notes?: string | null): ChecklistProgress | null => {
  if (!notes || !isMarkdownChecklist(notes)) {
    return null;
  }
  let total = 0;
  let done = 0;
  for (const line of notes.split('\n')) {
    if (isChecklistItemLine(line)) {
      total++;
      if (isCheckedItemLine(line)) {
        done++;
      }
    }
  }
  return total === 0 ? null : { done, total };
};
