import { taskMarkerToggleFor } from '../ui/inline-markdown/live-markdown/live-markdown-ranges';

/**
 * Unchecks every checklist item of a markdown note, e.g. to start the daily
 * summary's end-of-day ritual list fresh each day.
 *
 * Uses the notes editor's own checklist matcher, so every line it shows as a
 * checkbox is reset: `*`, `+` and numbered items, `[X]` and quoted items too,
 * not only `- [x] `. Other lines are left untouched.
 */
export const unToggleCheckboxesInMarkdownTxt = (txt: string): string =>
  txt
    .split('\n')
    .map((line) => {
      const toggle = taskMarkerToggleFor(line);
      // nextChar ' ' means the item is checked now
      return toggle && toggle.nextChar === ' '
        ? line.slice(0, toggle.offset) + ' ' + line.slice(toggle.offset + 1)
        : line;
    })
    .join('\n');
