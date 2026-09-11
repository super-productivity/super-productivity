import { Text } from '@codemirror/state';
import { GFM, parser as baseMarkdownParser } from '@lezer/markdown';
import {
  buildLiveMarkdownRanges,
  revealedLinesFor,
  taskMarkerToggleFor,
  type LiveMarkdownRange,
} from './live-markdown-ranges';

const mdParser = baseMarkdownParser.configure(GFM);

const build = (src: string, revealed: number[] = []): LiveMarkdownRange[] =>
  buildLiveMarkdownRanges({
    tree: mdParser.parse(src),
    doc: Text.of(src.split('\n')),
    revealedLines: new Set(revealed),
  });

/** The exact source text each `hide` range would remove from view. */
const hiddenText = (src: string, revealed: number[] = []): string[] =>
  build(src, revealed)
    .filter((r) => r.type === 'hide')
    .map((r) => src.slice(r.from, r.to));

const classesAt = (src: string, revealed: number[] = []): string[] =>
  build(src, revealed)
    .filter((r) => r.type !== 'hide')
    .map((r) => r.cls as string);

describe('buildLiveMarkdownRanges', () => {
  describe('hiding syntax markers', () => {
    it('hides the ** around bold text', () => {
      expect(hiddenText('a **bold** b')).toEqual(['**', '**']);
    });

    it('hides the backticks around inline code', () => {
      expect(hiddenText('a `code` b')).toEqual(['`', '`']);
    });

    it('hides ~~ around strikethrough', () => {
      expect(hiddenText('a ~~gone~~ b')).toEqual(['~~', '~~']);
    });

    it('hides a heading marker together with its trailing space', () => {
      expect(hiddenText('## Title')).toEqual(['## ']);
    });

    it('hides a quote marker together with its trailing space', () => {
      expect(hiddenText('> quoted')).toEqual(['> ']);
    });

    it('hides the bracket/URL tail of a link but not its text', () => {
      const hidden = hiddenText('see [docs](http://x.com) now');
      expect(hidden).toEqual(['[', ']', '(', 'http://x.com', ')']);
    });

    it('keeps the list bullet visible', () => {
      expect(hiddenText('- item')).toEqual([]);
    });

    it('keeps fenced-code fences visible', () => {
      expect(hiddenText('```js\nlet a = 1\n```')).toEqual([]);
    });
  });

  describe('revealing the caret line', () => {
    it('leaves every marker on a revealed line as raw source', () => {
      expect(hiddenText('a **bold** b', [1])).toEqual([]);
    });

    it('reveals only the given line, not its neighbours', () => {
      const src = '**one**\n**two**';
      expect(hiddenText(src, [2])).toEqual(['**', '**']);
      expect(hiddenText(src, [1, 2])).toEqual([]);
    });

    it('still applies styling classes on a revealed line', () => {
      expect(classesAt('**bold**', [1])).toContain('cm-md-strong');
    });
  });

  describe('styling classes', () => {
    it('marks each heading level on its own line', () => {
      expect(classesAt('# a')).toContain('cm-md-h1');
      expect(classesAt('###### f')).toContain('cm-md-h6');
    });

    it('emits a line class per line of a multi-line blockquote', () => {
      const quoteLines = build('> one\n> two').filter((r) => r.cls === 'cm-md-quote');
      expect(quoteLines.length).toBe(2);
    });

    it('anchors line decorations at the line start with zero width', () => {
      const [heading] = build('# a').filter((r) => r.type === 'line');
      expect(heading.from).toBe(0);
      expect(heading.to).toBe(0);
    });

    it('never emits an empty mark range', () => {
      const marks = build('# a\n**b** `c` ~~d~~\n- [ ] e\n> f\n---');
      expect(marks.every((r) => r.type === 'line' || r.to > r.from)).toBe(true);
    });

    it('anchors every line range at a real line start', () => {
      const src = '# a\n- [ ] e\n> f\n---';
      const lineStarts = new Set(
        src
          .split('\n')
          .reduce<
            number[]
          >((acc, line, i) => [...acc, i === 0 ? 0 : acc[i - 1] + src.split('\n')[i - 1].length + 1], []),
      );
      for (const range of build(src).filter((r) => r.type === 'line')) {
        expect(lineStarts.has(range.from)).toBe(true);
      }
    });
  });

  // CodeMirror throws "Decorations that replace line breaks may not be
  // specified via plugins" — the view never constructs, so the note renders
  // blank and uneditable. Every replacing range has to stay inside its line.
  it('never emits a replacing range that crosses a line break', () => {
    const sources = [
      '![foo\nbar](img.png)',
      '![a](\nimg.png)',
      '# Title\n\n**bold** and [a](http://x)\n- [ ] item\n---\n| a | b |\n|---|---|',
    ];
    for (const src of sources) {
      const doc = Text.of(src.split('\n'));
      const replacing = build(src).filter(
        (r) => r.type === 'hide' || r.type === 'image' || r.type === 'checkbox',
      );
      for (const range of replacing) {
        expect(doc.lineAt(range.from).number)
          .withContext(`${JSON.stringify(src)} range ${range.from}-${range.to}`)
          .toBe(doc.lineAt(range.to).number);
      }
    }
  });
});

describe('checklist items', () => {
  const checkboxes = (src: string, revealed: number[] = []): LiveMarkdownRange[] =>
    build(src, revealed).filter((r) => r.type === 'checkbox');

  it('replaces the whole "- [ ] " prefix with an unchecked box', () => {
    const [range] = checkboxes('- [ ] buy milk');
    expect(range).toBeTruthy();
    expect('- [ ] buy milk'.slice(range.from, range.to)).toBe('- [ ] ');
    expect(range.isChecked).toBe(false);
  });

  it('marks "[x]" as checked', () => {
    expect(checkboxes('- [x] done')[0].isChecked).toBe(true);
  });

  it('keeps the indent of a nested item outside the replaced range', () => {
    const src = '- [ ] a\n  - [ ] b';
    const nested = checkboxes(src)[1];
    expect(src.slice(nested.from, nested.to)).toBe('- [ ] ');
  });

  it('stays rendered on the caret line, unlike the other markers', () => {
    expect(checkboxes('- [ ] buy milk', [1]).length).toBe(1);
  });

  it('leaves a plain list item alone', () => {
    expect(checkboxes('- just a bullet').length).toBe(0);
  });
});

describe('tables', () => {
  const TABLE = '| a | b |\n|---|---|\n| 1 | 2 |';
  const lineClasses = (src: string): string[] =>
    build(src)
      .filter((r) => r.type === 'line')
      .map((r) => r.cls as string);

  it('marks every line of the table so the columns can be monospaced', () => {
    expect(lineClasses(TABLE).filter((c) => c === 'cm-md-table').length).toBe(3);
  });

  it('marks the header row', () => {
    expect(lineClasses(TABLE)).toContain('cm-md-table-header');
  });

  it('marks the |---|---| separator as a whole line, not as column pipes', () => {
    expect(lineClasses(TABLE)).toContain('cm-md-table-sep');
  });

  it('mutes the column pipes without hiding them', () => {
    const delims = build(TABLE).filter((r) => r.cls === 'cm-md-table-delim');
    expect(delims.length).toBeGreaterThan(0);
    for (const delim of delims) {
      expect(TABLE.slice(delim.from, delim.to)).toBe('|');
      expect(delim.type).toBe('mark');
    }
  });

  it('leaves a lone pipe in prose alone', () => {
    expect(lineClasses('a | b')).not.toContain('cm-md-table');
  });
});

describe('links', () => {
  it('styles a bare autolink so it can be clicked', () => {
    const ranges = build('see https://example.com for info');
    expect(ranges).toEqual([{ from: 4, to: 23, type: 'mark', cls: 'cm-md-link' }]);
  });

  it('styles an angle-bracket autolink and hides its brackets', () => {
    const ranges = build('<https://example.com>');
    expect(ranges.filter((r) => r.cls === 'cm-md-link').length).toBe(1);
    expect(hiddenText('<https://example.com>')).toEqual(['<', '>']);
  });

  it('still hides the ](url) tail of an explicit link', () => {
    expect(hiddenText('see [docs](http://x.com) now')).toEqual([
      '[',
      ']',
      '(',
      'http://x.com',
      ')',
    ]);
  });
});

describe('horizontal rules', () => {
  it('hides the literal --- so only the drawn rule shows', () => {
    expect(hiddenText('---')).toEqual(['---']);
  });

  it('keeps it visible on the caret line', () => {
    expect(hiddenText('---', [1])).toEqual([]);
  });
});

describe('images', () => {
  const imageRanges = (src: string, revealed: number[] = []): LiveMarkdownRange[] =>
    build(src, revealed).filter((r) => r.type === 'image');

  it('replaces the whole ![alt](src) with an image range', () => {
    const src = '![a pic](http://x.com/a.png)';
    expect(imageRanges(src)).toEqual([
      {
        from: 0,
        to: src.length,
        type: 'image',
        image: { alt: 'a pic', src: 'http://x.com/a.png' },
      },
    ]);
  });

  it('handles an empty alt text', () => {
    expect(imageRanges('![](x.png)')[0].image).toEqual({ alt: '', src: 'x.png' });
  });

  it('keeps an indexeddb:// src intact for the resolver', () => {
    const url = 'indexeddb://clipboard-images/abc123.png';
    expect(imageRanges(`![](${url})`)[0].image?.src).toBe(url);
  });

  it('does not swallow a title into the src', () => {
    expect(imageRanges('![a](x.png "the title")')[0].image?.src).toBe('x.png');
  });

  it('falls back to raw source on the caret line so the src stays editable', () => {
    expect(imageRanges('![a](x.png)', [1])).toEqual([]);
  });

  it('leaves a plain link alone', () => {
    expect(imageRanges('[a](x.png)')).toEqual([]);
  });

  it('leaves an image that spans a line break as raw source', () => {
    // A replacing decoration across a line break makes CodeMirror throw.
    expect(imageRanges('![foo\nbar](img.png)')).toEqual([]);
  });

  it('emits no inner hide ranges, so a rejected src stays readable as source', () => {
    // The extension drops the image range when isPathSafeToOpen fails. If the
    // `![`, `]`, `(` and URL markers were hidden too, the blocked image would
    // collapse to bare alt text with nothing to fix.
    expect(hiddenText('![a](file://host/share/x.png)')).toEqual([]);
  });
});

describe('taskMarkerToggleFor', () => {
  it('points at the state character and flips it on', () => {
    const line = '- [ ] buy milk';
    const toggle = taskMarkerToggleFor(line)!;
    expect(line[toggle.offset]).toBe(' ');
    expect(toggle.nextChar).toBe('x');
  });

  it('flips a checked item back off', () => {
    const line = '  - [x] done';
    const toggle = taskMarkerToggleFor(line)!;
    expect(line[toggle.offset]).toBe('x');
    expect(toggle.nextChar).toBe(' ');
  });

  it('handles a numbered checklist item', () => {
    const line = '1. [ ] first';
    const toggle = taskMarkerToggleFor(line)!;
    expect(line[toggle.offset]).toBe(' ');
  });

  it('returns null for a non-checklist line', () => {
    expect(taskMarkerToggleFor('- just a bullet')).toBeNull();
  });
});

describe('revealedLinesFor', () => {
  const doc = Text.of(['one', 'two', 'three']);

  it('reveals nothing when the editor is not focused', () => {
    expect(revealedLinesFor(doc, [{ from: 0, to: 0 }], false).size).toBe(0);
  });

  it('reveals the line the caret sits on', () => {
    expect([...revealedLinesFor(doc, [{ from: 5, to: 5 }], true)]).toEqual([2]);
  });

  it('reveals every line a selection spans', () => {
    expect([...revealedLinesFor(doc, [{ from: 1, to: 9 }], true)]).toEqual([1, 2, 3]);
  });

  it('merges multiple cursors', () => {
    const lines = revealedLinesFor(
      doc,
      [
        { from: 0, to: 0 },
        { from: 9, to: 9 },
      ],
      true,
    );
    expect([...lines].sort()).toEqual([1, 3]);
  });
});
