import { isMarkdownChecklist } from './is-markdown-checklist';
import { markdownToChecklist } from './markdown-to-checklist';

export interface ChecklistProgress {
  done: number;
  total: number;
}

/**
 * Derives checklist progress ({done, total}) from a task's markdown notes.
 * Returns null when the notes are not a markdown checklist or contain no items,
 * so callers can simply hide the indicator on a falsy value.
 */
export const getChecklistProgress = (notes?: string | null): ChecklistProgress | null => {
  if (!notes || !isMarkdownChecklist(notes)) {
    return null;
  }
  const items = markdownToChecklist(notes);
  if (items.length === 0) {
    return null;
  }
  return {
    done: items.filter((it) => it.isChecked).length,
    total: items.length,
  };
};
