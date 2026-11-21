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
// The HTML lines that end a list item in marked (its `htmlBeginRegex`).
const MARKED_ITEM_ENDING_HTML_RE = /^<(?:[a-z].*>|!--)/i;

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
  // Let Lezer resolve that grammar and skip code and HTML blocks, which can hold
  // fence-like text, but retain the existing item syntax outside those blocks.
  // Lezer receives normalized lines, as it does in CodeMirror. Keep the original
  // strings for editing, and use the normalized lengths for parser offsets.
  const parserLines = lines.map((line) => line.replace(/\r$/, ''));
  let source = parserLines.join('\n');
  let fences: { from: number; to: number }[];
  let lazyHtmlStarts: number[];
  do {
    fences = [];
    lazyHtmlStarts = [];
    // Line breaks that end a list item's text, the item's last block.
    const listTextBreaks = new Set<number>();
    FENCE_PARSER.parse(source).iterate({
      enter: ({ name, from, to, node }) => {
        if (name === 'ListItem') {
          const last = node.lastChild;
          const lineBreak = last ? source.indexOf('\n', last.to) : -1;
          if ((last?.name === 'Task' || last?.name === 'Paragraph') && lineBreak !== -1) {
            listTextBreaks.add(lineBreak);
          }
          return true;
        }
        if (name !== 'FencedCode' && name !== 'CodeBlock' && name !== 'HTMLBlock') {
          return true;
        }
        // marked ends a list item only at an HTML line that opens a tag or a
        // comment. Any other HTML line right after the item's text, such as a
        // closing tag, stays in the item as lazy continuation, and marked
        // renders the lines below it as markdown again. Lezer follows CommonMark
        // and starts an HTML block there that runs to the next blank line.
        if (
          name === 'HTMLBlock' &&
          listTextBreaks.has(source.lastIndexOf('\n', from - 1)) &&
          !MARKED_ITEM_ENDING_HTML_RE.test(source.slice(from, to))
        ) {
          lazyHtmlStarts.push(from);
        } else {
          fences.push({ from, to });
        }
        return false;
      },
    });
    // Mask the "<" so Lezer continues the item's text there, as marked does,
    // and parse again: the lines below may hold more such tags. Each pass
    // masks at least one "<", and offsets stay the same.
    for (const at of lazyHtmlStarts) {
      source = `${source.slice(0, at)}x${source.slice(at + 1)}`;
    }
  } while (lazyHtmlStarts.length > 0);
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
