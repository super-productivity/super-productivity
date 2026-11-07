import { GFM, parser } from '@lezer/markdown';

/**
 * Pure helpers for manipulating markdown checklists stored as plain note strings.
 *
 * All functions operate on the raw notes string (the same representation used by
 * `task.notes`) and return a new string, so callers can emit the result through
 * the normal `changed` flow without any extra data model. Non-checklist lines
 * (prose, headings, blank lines) are always preserved in place.
 */

// Matches a GFM task-list item line exactly as marked renders one: "- " + a
// marker box ([ ], [x] or [X]) + whitespace + at least one non-space content
// char. marked does NOT produce a checkbox for "- []", "- [x]a" (no space after
// the box) or an empty "- [ ] " (no content), so neither do these — verified
// against marked, see marked-options-factory.ts `renderer.listitem`. This is the
// single source of truth for "is this line a checklist item" across the feature
// (toggle, bulk actions, progress badge, is-markdown-checklist).
const CHECKLIST_ITEM_RE = /^\s*- \[[ xX]\]\s+\S/;
const CHECKED_ITEM_RE = /^\s*- \[[xX]\]\s+\S/;
const FENCE_PARSER = parser.configure(GFM);

export const isChecklistItemLine = (line: string): boolean =>
  CHECKLIST_ITEM_RE.test(line);

export const isCheckedItemLine = (line: string): boolean => CHECKED_ITEM_RE.test(line);

/**
 * Locate editable items without treating fenced code examples as checklists.
 * Keep line indices so edits retain all other source text and line endings.
 */
export const getChecklistItemLineIndices = (lines: string[]): number[] => {
  const indices: number[] = [];
  let hasPossibleFence = false;
  for (let i = 0; i < lines.length; i++) {
    hasPossibleFence ||= lines[i].includes('```') || lines[i].includes('~~~');
    if (isChecklistItemLine(lines[i])) {
      indices.push(i);
    }
  }
  // Progress is computed for every task row. Ordinary checklists need only the
  // line scan; reuse the editor's existing parser only for possible fences.
  if (!hasPossibleFence || indices.length === 0) {
    return indices;
  }

  // Container indentation and the end of a list item determine fence lifetime.
  // Let Lezer resolve that grammar, including code and HTML blocks containing
  // fence-like text, but retain the existing item syntax outside those blocks.
  // Lezer receives normalized lines, as it does in CodeMirror. Keep the original
  // strings for editing, and use the normalized lengths for parser offsets.
  const parserLines = lines.map((line) => line.replace(/\r$/, ''));
  const fences: { from: number; to: number }[] = [];
  FENCE_PARSER.parse(parserLines.join('\n')).iterate({
    enter: ({ name, from, to }) => {
      if (name === 'FencedCode' || name === 'CodeBlock' || name === 'HTMLBlock') {
        fences.push({ from, to });
        return false;
      }
      return true;
    },
  });
  let lineIndex = 0;
  let lineStart = 0;
  let fenceIndex = 0;
  return indices.filter((index) => {
    while (lineIndex < index) {
      lineStart += parserLines[lineIndex].length + 1;
      lineIndex++;
    }
    while (fenceIndex < fences.length && fences[fenceIndex].to <= lineStart) {
      fenceIndex++;
    }
    const fence = fences[fenceIndex];
    return !fence || lineStart + parserLines[index].length <= fence.from;
  });
};

/**
 * Sets every checklist item to checked or unchecked, leaving non-item lines untouched.
 */
export const setAllChecklistItemsChecked = (notes: string, checked: boolean): string => {
  const lines = notes.split('\n');
  for (const index of getChecklistItemLineIndices(lines)) {
    lines[index] = checked
      ? lines[index].replace(/- \[[ ]?\]/, '- [x]')
      : lines[index].replace(/- \[[xX]\]/, '- [ ]');
  }
  return lines.join('\n');
};

/**
 * Removes all checked checklist items, keeping unchecked items and any other lines.
 */
export const removeCheckedChecklistItems = (notes: string): string => {
  const lines = notes.split('\n');
  const checkedIndices = new Set(
    getChecklistItemLineIndices(lines).filter((index) => isCheckedItemLine(lines[index])),
  );
  return lines.filter((_, index) => !checkedIndices.has(index)).join('\n');
};

/**
 * Toggles the checked state of the Nth checklist item (0-based, in document
 * order — matching the rendered checkbox order). Non-item lines are skipped and
 * preserved. Out-of-range/invalid indices return the input unchanged. Only the
 * checkbox marker is rewritten, so item text (which may itself contain "[ ]") is
 * never touched, and uppercase "[X]" is handled.
 */
export const toggleChecklistItemAtIndex = (notes: string, nthItem: number): string => {
  if (!Number.isInteger(nthItem) || nthItem < 0) {
    return notes;
  }
  const lines = notes.split('\n');
  const index = getChecklistItemLineIndices(lines)[nthItem];
  if (index === undefined) {
    return notes;
  }
  lines[index] = isCheckedItemLine(lines[index])
    ? lines[index].replace(/- \[[xX]\]/, '- [ ]')
    : lines[index].replace('- [ ]', '- [x]');
  return lines.join('\n');
};
