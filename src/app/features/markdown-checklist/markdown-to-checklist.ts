import { MarkdownChecklistTask } from './markdown-checklist.model';
import { getChecklistItemLineIndices, isCheckedItemLine } from './checklist-operations';

export const markdownToChecklist = (text: string): MarkdownChecklistTask[] => {
  const lines = text.split('\n');
  return getChecklistItemLineIndices(lines).map((index) => ({
    text: lines[index].trim().replace(/^- \[[ xX]\] ?/, ''),
    isChecked: isCheckedItemLine(lines[index]),
  }));
};
