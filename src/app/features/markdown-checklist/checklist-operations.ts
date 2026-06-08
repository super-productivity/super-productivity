/**
 * Pure helpers for manipulating markdown checklists stored as plain note strings.
 *
 * All functions operate on the raw notes string (the same representation used by
 * `task.notes`) and return a new string, so callers can emit the result through
 * the normal `changed` flow without any extra data model. Non-checklist lines
 * (prose, headings, blank lines) are always preserved in place.
 */

// Matches a GFM task-list item line, e.g. "- [ ] foo", "- [x] bar", "  - [] baz".
// Kept in sync with the checkbox the marked renderer produces (see
// marked-options-factory.ts `renderer.listitem`).
const CHECKLIST_ITEM_RE = /^\s*- \[[ xX]?\]/;
const CHECKED_ITEM_RE = /^\s*- \[[xX]\]/;

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
