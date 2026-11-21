import { isMarkdownChecklist } from './is-markdown-checklist';
import { getChecklistItemLineIndices, isCheckedItemLine } from './checklist-operations';

export interface ChecklistProgress {
  done: number;
  total: number;
}

/**
 * Derives checklist progress ({done, total}) from a task's markdown notes.
 * Returns null when the notes are not a markdown checklist or contain no items,
 * so callers can simply hide the indicator on a falsy value. Uses the same
 * fence-aware item indices as checklist edits so code examples are not counted.
 */
export const getChecklistProgress = (notes?: string | null): ChecklistProgress | null => {
  if (!notes || !isMarkdownChecklist(notes)) {
    return null;
  }
  let total = 0;
  let done = 0;
  const lines = notes.split('\n');
  for (const index of getChecklistItemLineIndices(lines)) {
    total++;
    if (isCheckedItemLine(lines[index])) {
      done++;
    }
  }
  return total === 0 ? null : { done, total };
};
