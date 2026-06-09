import { MarkdownChecklistTask } from './markdown-checklist.model';
import { isCheckedItemLine, isChecklistItemLine } from './checklist-operations';

export const markdownToChecklist = (text: string): MarkdownChecklistTask[] =>
  text
    .split('\n')
    .filter((line) => isChecklistItemLine(line))
    .map((line) => ({
      text: line.trim().replace(/^- \[[ xX]\] ?/, ''),
      isChecked: isCheckedItemLine(line),
    }));
