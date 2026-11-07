import { marked } from 'marked';
import { markedOptionsFactory } from '../../ui/marked-options-factory';
import { markdownLanguage } from '../../ui/inline-markdown/live-markdown/markdown-language';
import { getChecklistProgress } from './get-checklist-progress';
import { markdownToChecklist } from './markdown-to-checklist';
import {
  getChecklistItemLineIndices,
  isChecklistItemLine,
  isCheckedItemLine,
  removeCheckedChecklistItems,
  setAllChecklistItemsChecked,
  toggleChecklistItemAtIndex,
} from './checklist-operations';

describe('checklist-operations', () => {
  describe('isChecklistItemLine', () => {
    it('should match unchecked, checked and indented items', () => {
      expect(isChecklistItemLine('- [ ] foo')).toBe(true);
      expect(isChecklistItemLine('- [x] foo')).toBe(true);
      expect(isChecklistItemLine('- [X] foo')).toBe(true);
      expect(isChecklistItemLine('  - [ ] indented')).toBe(true);
    });

    it('should not match anything marked would not render as a checkbox', () => {
      expect(isChecklistItemLine('just text')).toBe(false);
      expect(isChecklistItemLine('- plain bullet')).toBe(false);
      expect(isChecklistItemLine('')).toBe(false);
      // marked renders a checkbox only for "- [marker] <content>" — none of these:
      expect(isChecklistItemLine('- [] no marker')).toBe(false);
      expect(isChecklistItemLine('- [ ]')).toBe(false); // empty, no content
      expect(isChecklistItemLine('- [ ] ')).toBe(false); // empty, trailing space only
      expect(isChecklistItemLine('- [x]nospace')).toBe(false); // no space after the box
    });
  });

  describe('isCheckedItemLine', () => {
    it('should only match checked items with content', () => {
      expect(isCheckedItemLine('- [x] done')).toBe(true);
      expect(isCheckedItemLine('- [X] done')).toBe(true);
      expect(isCheckedItemLine('- [ ] todo')).toBe(false);
      expect(isCheckedItemLine('- [x] ')).toBe(false); // empty, not a rendered checkbox
    });
  });

  describe('setAllChecklistItemsChecked', () => {
    it('should check every item', () => {
      const notes = '- [ ] a\n- [x] b\n- [ ] c';
      expect(setAllChecklistItemsChecked(notes, true)).toBe('- [x] a\n- [x] b\n- [x] c');
    });

    it('should uncheck every item', () => {
      const notes = '- [x] a\n- [ ] b\n- [X] c';
      expect(setAllChecklistItemsChecked(notes, false)).toBe('- [ ] a\n- [ ] b\n- [ ] c');
    });

    it('should leave non-item lines untouched', () => {
      const notes = 'Intro\n- [ ] a\nmid prose\n- [ ] b';
      expect(setAllChecklistItemsChecked(notes, true)).toBe(
        'Intro\n- [x] a\nmid prose\n- [x] b',
      );
    });
  });

  describe('removeCheckedChecklistItems', () => {
    it('should drop only checked items', () => {
      const notes = '- [ ] a\n- [x] b\n- [ ] c\n- [X] d';
      expect(removeCheckedChecklistItems(notes)).toBe('- [ ] a\n- [ ] c');
    });

    it('should keep prose lines', () => {
      const notes = 'Title\n- [x] done\n- [ ] todo';
      expect(removeCheckedChecklistItems(notes)).toBe('Title\n- [ ] todo');
    });
  });

  describe('toggleChecklistItemAtIndex', () => {
    it('should check an unchecked item', () => {
      expect(toggleChecklistItemAtIndex('- [ ] a\n- [ ] b', 1)).toBe('- [ ] a\n- [x] b');
    });

    it('should uncheck a checked item', () => {
      expect(toggleChecklistItemAtIndex('- [x] a\n- [ ] b', 0)).toBe('- [ ] a\n- [ ] b');
    });

    it('should uncheck an uppercase [X] item', () => {
      // the old in-component toggle only matched lowercase [x] and left [X] stuck
      expect(toggleChecklistItemAtIndex('- [X] a', 0)).toBe('- [ ] a');
    });

    it('should only flip the checkbox marker, not "[ ]" inside the item text', () => {
      expect(toggleChecklistItemAtIndex('- [x] fix the [ ] placeholder', 0)).toBe(
        '- [ ] fix the [ ] placeholder',
      );
    });

    it('should map the Nth item past interleaved prose and blank lines', () => {
      const notes = 'Intro\n- [ ] a\n\nmid\n- [ ] b';
      expect(toggleChecklistItemAtIndex(notes, 1)).toBe('Intro\n- [ ] a\n\nmid\n- [x] b');
    });

    it('should skip an empty "- [ ] " line that marked does not render as a checkbox', () => {
      // The empty placeholder line is not a rendered checkbox, so checkbox
      // index 0 must map to the real item below it, not the placeholder.
      expect(toggleChecklistItemAtIndex('- [ ] \n- [x] real', 0)).toBe(
        '- [ ] \n- [ ] real',
      );
    });

    it('should return the input unchanged for out-of-range or invalid indices', () => {
      const notes = '- [ ] a\n- [ ] b';
      expect(toggleChecklistItemAtIndex(notes, 5)).toBe(notes);
      expect(toggleChecklistItemAtIndex(notes, -1)).toBe(notes);
      expect(toggleChecklistItemAtIndex(notes, NaN)).toBe(notes);
    });
  });
});

describe('checklist edits around fenced code examples', () => {
  for (const { name, prefixes } of [
    {
      name: 'fence indentation relative to its container',
      prefixes: [
        ['```', '    ```', '- [x] source', '- [ ] code', '```'],
        ['```', '\t```', '- [x] source', '- [ ] code', '```'],
        ['    ```'],
        ['\t```'],
        ['   ```', '- [x] source', '- [ ] code', '   ```'],
        ['- parent', '    ```', '    - [x] source', '    - [ ] code', '    ```', ''],
        ['1. parent', '     ~~~', '     - [x] source', '     ~~~', ''],
      ],
    },
    {
      name: 'fences inside indented code and HTML blocks',
      prefixes: [
        ['    ```', '    - [x] source', '    ```'],
        ['\t```', '\t- [x] source', '\t```'],
        ['<pre>', '```', '- [x] source', '```', '</pre>', ''],
        ['<div>', '```', '- [x] source', '```', '</div>', ''],
      ],
    },
    {
      name: 'fence openers and lifetime inside list items',
      prefixes: [
        ['- ```', '  - [x] source', '  - [ ] code', '  ```', ''],
        ['1. ~~~', '   - [x] source', '   - [ ] code', '   ~~~', ''],
        ['- parent', '  ```', '  - [x] source', ''],
        ['- parent', '  ```', '  - [x] source'],
        ['- parent', '  - ```', '    - [x] source', ''],
      ],
    },
  ]) {
    it(`matches both renderers for ${name} and preserves source`, () => {
      marked.setOptions(marked.getDefaults());
      marked.setOptions(markedOptionsFactory());
      const results = prefixes.flatMap((prefix) =>
        ['\n', '\r\n'].map((ending) => {
          const lines = [...prefix, '- [x] done', '- [ ] todo'];
          const notes = lines.join(ending);
          const html = marked.parse(notes) as string;
          const editorIndices: number[] = [];
          // CodeMirror's document normalizes CRLF before invoking its parser.
          const editorSource = notes.replace(/\r\n/g, '\n');
          markdownLanguage.parser.parse(editorSource).iterate({
            enter: ({ name: nodeName, from }) => {
              if (nodeName === 'TaskMarker') {
                editorIndices.push(editorSource.slice(0, from).split('\n').length - 1);
              }
            },
          });
          const actual = {
            notes,
            renderedLabels: Array.from(
              html.matchAll(/class="checkbox-label">(.*?)<\/span>/g),
              (match) => match[1].trim(),
            ),
            editorIndices,
            indices: getChecklistItemLineIndices(notes.split('\n')),
            cleared: removeCheckedChecklistItems(notes),
            checked: setAllChecklistItemsChecked(notes, true),
            unchecked: setAllChecklistItemsChecked(notes, false),
            toggled: toggleChecklistItemAtIndex(notes, 1),
            progress: getChecklistProgress(notes),
            converted: markdownToChecklist(notes),
          };
          const expected = {
            notes,
            renderedLabels: ['done', 'todo'],
            editorIndices: [prefix.length, prefix.length + 1],
            indices: [prefix.length, prefix.length + 1],
            cleared: notes.replace(`- [x] done${ending}`, ''),
            checked: notes.replace('- [ ] todo', '- [x] todo'),
            unchecked: notes.replace('- [x] done', '- [ ] done'),
            toggled: notes.replace('- [ ] todo', '- [x] todo'),
            progress: { done: 1, total: 2 },
            converted: [
              { text: 'done', isChecked: true },
              { text: 'todo', isChecked: false },
            ],
          };
          return { actual, expected };
        }),
      );
      expect(results.map((result) => result.actual)).toEqual(
        results.map((result) => result.expected),
      );
    });
  }

  for (const fence of ['```', '~~~', '````']) {
    const notes = `Intro\r\n${fence}markdown\r\n- [x] source\r\n- [ ] code\r\n${fence}\r\n- [x] done\r\n- [ ] todo\r\nEnd`;
    it(`preserves ${fence} fenced content when clearing completed items`, () => {
      expect(removeCheckedChecklistItems(notes)).toBe(
        notes.replace('- [x] done\r\n', ''),
      );
    });
    it(`preserves ${fence} fenced content when checking or unchecking`, () => {
      expect(setAllChecklistItemsChecked(notes, true)).toBe(
        notes.replace('- [ ] todo', '- [x] todo'),
      );
      expect(setAllChecklistItemsChecked(notes, false)).toBe(
        notes.replace('- [x] done', '- [ ] done'),
      );
    });
    it(`indexes ${fence} rendered items without counting code examples`, () => {
      expect(toggleChecklistItemAtIndex(notes, 1)).toBe(
        notes.replace('- [ ] todo', '- [x] todo'),
      );
    });
  }
  it('keeps shorter fence-like lines inside a longer code fence', () => {
    const notes = '````markdown\n```\n- [x] source\n```\n````\n- [x] done';
    expect(removeCheckedChecklistItems(notes)).toBe(
      '````markdown\n```\n- [x] source\n```\n````',
    );
  });
  it('keeps items inside an unclosed fence', () => {
    const notes = '- [ ] real\n```\n- [x] source';
    expect(removeCheckedChecklistItems(notes)).toBe(notes);
  });
});
