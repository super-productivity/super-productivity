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

export const isChecklistItemLine = (line: string): boolean =>
  CHECKLIST_ITEM_RE.test(line);

export const isCheckedItemLine = (line: string): boolean => CHECKED_ITEM_RE.test(line);

/**
 * Sets every checklist item to checked or unchecked, leaving non-item lines untouched.
 */
export const setAllChecklistItemsChecked = (notes: string, checked: boolean): string =>
  notes
    .split('\n')
    .map((line) => {
      if (!isChecklistItemLine(line)) {
        return line;
      }
      return checked
        ? line.replace(/- \[[ ]?\]/, '- [x]')
        : line.replace(/- \[[xX]\]/, '- [ ]');
    })
    .join('\n');

/**
 * Removes all checked checklist items, keeping unchecked items and any other lines.
 */
export const removeCheckedChecklistItems = (notes: string): string =>
  notes
    .split('\n')
    .filter((line) => !isCheckedItemLine(line))
    .join('\n');

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
  let seen = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!isChecklistItemLine(lines[i])) {
      continue;
    }
    seen++;
    if (seen === nthItem) {
      lines[i] = isCheckedItemLine(lines[i])
        ? lines[i].replace(/- \[[xX]\]/, '- [ ]')
        : lines[i].replace('- [ ]', '- [x]');
      return lines.join('\n');
    }
  }
  return notes;
};
