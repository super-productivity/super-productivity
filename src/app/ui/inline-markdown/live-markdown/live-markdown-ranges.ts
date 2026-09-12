import type { Text } from '@codemirror/state';
import type { Tree } from '@lezer/common';

/**
 * A decoration to apply to the markdown source, expressed without any
 * CodeMirror view types so it can be unit-tested against a parsed tree alone.
 *
 * - `hide` — replace a syntax marker (`**`, `#`, `>`) with nothing
 * - `mark` — inline class over a span (bold, italic, code, …)
 * - `line` — class on the whole line; `from` is the line start and `to === from`
 * - `checkbox` — replace a `- [ ] ` prefix with a real, clickable checkbox
 * - `image` — replace `![alt](src)` with the rendered image
 */
export interface LiveMarkdownRange {
  readonly from: number;
  readonly to: number;
  readonly type: 'hide' | 'mark' | 'line' | 'checkbox' | 'image';
  readonly cls?: string;
  /** Only set for `checkbox` ranges. */
  readonly isChecked?: boolean;
  /** Only set for `image` ranges. */
  readonly image?: {
    readonly src: string;
    readonly alt: string;
    /** From the app's `=WxH` sizing syntax; absent when unsized. */
    readonly width?: string;
    readonly height?: string;
  };
}

/** `![alt](src)` — src stops at the first space so a `"title"` is not swallowed. */
const IMAGE_RE = /^!\[([^\]]*)\]\(\s*([^\s)]+)/;

/**
 * The app's image-sizing syntax as the user writes it. CommonMark has no such
 * thing — an unquoted `=200x100` where a title belongs makes the whole inline
 * image unparseable, so lezer ends the `Image` node after `![alt]` and leaves
 * the rest as plain text. Without this the sized images already in people's
 * notes would render as raw source (`marked` handles them via
 * `preprocessMarkdown`, which the live editor never runs).
 */
const SIZED_IMAGE_RE = /^!\[([^\]]*)\]\(\s*([^\s)]+)\s+=(\d*)x(\d*)\)/;

/** The same dimensions after `preprocessMarkdown` has rewritten them into a title. */
const TITLE_SIZE_RE = /"(\d*)\|(\d*)"\s*\)$/;

type ImagePayload = NonNullable<LiveMarkdownRange['image']>;

/** Omit absent dimensions entirely rather than carrying `undefined` around. */
const imagePayload = (
  alt: string,
  src: string,
  width: string,
  height: string,
): ImagePayload => ({
  alt,
  src,
  ...(width ? { width } : {}),
  ...(height ? { height } : {}),
});

/**
 * Read the image starting at `from`, in either spelling, bounded by the end of
 * its line — a replacing decoration may not span a line break (see the caller).
 *
 * `treeSrc` is the destination as the markdown parser resolved it. Preferred
 * over the regex, which stops the src at the first space or `)` and so
 * truncates a perfectly legal `](https://x.org/Foo_(bar).png)` into a broken
 * image — with the source hidden behind the widget, leaving no clue why.
 */
const imageAt = (
  doc: Text,
  from: number,
  nodeTo: number,
  lineTo: number,
  treeSrc: string | null,
): {
  readonly to: number;
  readonly image: ImagePayload;
} | null => {
  if (nodeTo <= lineTo) {
    const text = doc.sliceString(from, nodeTo);
    const match = IMAGE_RE.exec(text);
    if (match) {
      const size = TITLE_SIZE_RE.exec(text);
      return {
        to: nodeTo,
        image: imagePayload(
          match[1],
          treeSrc === null ? match[2] : stripAngleBrackets(treeSrc),
          size?.[1] ?? '',
          size?.[2] ?? '',
        ),
      };
    }
  }
  const sized = SIZED_IMAGE_RE.exec(doc.sliceString(from, lineTo));
  return sized
    ? {
        to: from + sized[0].length,
        image: imagePayload(sized[1], sized[2], sized[3], sized[4]),
      }
    : null;
};

/** `<my img.png>` — a destination may be angle-wrapped so it can hold spaces. */
const stripAngleBrackets = (url: string): string =>
  url.startsWith('<') && url.endsWith('>') ? url.slice(1, -1) : url;

/**
 * A line's leading blockquote markers, which sit before any list marker.
 * `\s*` after each `>`, not `\s?`: `>  > - [ ] x` is one quote too.
 */
const QUOTE_PREFIX_RE = /^\s*(?:>\s*)+/;

/**
 * A checklist line's `- [ ] ` / `1. [x] ` prefix. Captures the indent, the list
 * marker and the state character, so the same expression serves both the
 * decoration and the click-to-toggle handler.
 */
export const TASK_LINE_RE = /^(\s*)([-*+]|\d+[.)])\s+\[([ xX])\]\s?/;

/**
 * Offset (relative to the line start) of the character inside a checklist
 * line's brackets, plus the character that toggles it. Null when the line is
 * not a checklist item.
 */
export const taskMarkerToggleFor = (
  lineText: string,
): { readonly offset: number; readonly nextChar: string } | null => {
  const quoted = taskLineMatch(lineText);
  if (!quoted) {
    return null;
  }
  const { offset, match } = quoted;
  return {
    offset: offset + match[0].indexOf('[') + 1,
    nextChar: match[3] === ' ' ? 'x' : ' ',
  };
};

/**
 * Match a checklist prefix, skipping any blockquote markers first: inside a
 * quote the line still reads `> - [ ] x`, and matching the raw line would miss
 * it — leaving the one place in a note where a literal `[ ]` stays on screen.
 */
const taskLineMatch = (
  lineText: string,
): { readonly offset: number; readonly match: RegExpExecArray } | null => {
  const offset = QUOTE_PREFIX_RE.exec(lineText)?.[0].length ?? 0;
  const match = TASK_LINE_RE.exec(lineText.slice(offset));
  return match ? { offset, match } : null;
};

export interface BuildLiveMarkdownRangesArgs {
  readonly tree: Tree;
  readonly doc: Text;
  /**
   * Line numbers (1-based) whose raw markdown must stay visible — the lines the
   * caret or selection touches. Obsidian's rule: you see the source of the line
   * you are on, and rendered output everywhere else.
   */
  readonly revealedLines: ReadonlySet<number>;
}

const HEADING_NODE_RE = /^ATXHeading([1-6])$/;

/** Inline nodes that only get a class, never hide anything themselves. */
const INLINE_CLASS_BY_NODE: Readonly<Record<string, string>> = {
  StrongEmphasis: 'cm-md-strong',
  Emphasis: 'cm-md-em',
  Strikethrough: 'cm-md-strike',
  InlineCode: 'cm-md-code',
  Link: 'cm-md-link',
  ListMark: 'cm-md-list-mark',
};

/** Syntax markers hidden on unrevealed lines. */
const HIDDEN_MARK_NODES: ReadonlySet<string> = new Set([
  'HeaderMark',
  'EmphasisMark',
  'StrikethroughMark',
  'QuoteMark',
  'LinkMark',
  'URL',
]);

/**
 * Inline `CodeMark` (the backticks of `` `code` ``) is hidden, but the same node
 * name is used for fenced-code ``` fences, where hiding them would make the
 * block's boundaries invisible. Distinguish by parent.
 */
const isHideableCodeMark = (nodeName: string, parentName: string | undefined): boolean =>
  nodeName === 'CodeMark' && parentName === 'InlineCode';

/**
 * Extend a hidden marker over the single space that follows it, so that hiding
 * `#` in `# Title` does not leave the title indented by one space. Only applies
 * to block markers at the start of their line — an ATX *closing* sequence
 * (`# Title #`) must not swallow anything.
 */
const withTrailingSpace = (
  from: number,
  to: number,
  doc: Text,
  isBlockMarkerAtLineStart: boolean,
): number => {
  if (!isBlockMarkerAtLineStart) {
    return to;
  }
  const next = doc.sliceString(to, to + 1);
  return next === ' ' ? to + 1 : to;
};

/**
 * Translate a parsed markdown tree into the decorations that render it inline.
 *
 * Pure: no view, no DOM, no selection object — just the tree, the document and
 * the set of lines to leave as raw source.
 */
export const buildLiveMarkdownRanges = ({
  tree,
  doc,
  revealedLines,
}: BuildLiveMarkdownRangesArgs): LiveMarkdownRange[] => {
  const ranges: LiveMarkdownRange[] = [];
  /**
   * End of the image currently being replaced. The `=WxH` form is not
   * CommonMark, so the nodes lezer finds in its tail (the `URL`, say) sit
   * OUTSIDE the short `Image` node but INSIDE the replacement — and a marker
   * hiding itself inside a replaced range is the overlap CodeMirror rejects.
   */
  let imageEnd = -1;
  const pushLineClass = (pos: number, cls: string): void => {
    const lineStart = doc.lineAt(pos).from;
    ranges.push({ from: lineStart, to: lineStart, type: 'line', cls });
  };

  // `enter` returns whether to descend into the node's children: true for
  // almost everything (a heading's `#` marker is a CHILD of the heading), false
  // only where the node is replaced wholesale and its markers must not add
  // their own ranges inside it.
  tree.iterate({
    enter: (node) => {
      const { name, from, to } = node;
      if (from < imageEnd) {
        return false;
      }
      const line = doc.lineAt(from);
      const isRevealed = revealedLines.has(line.number);

      const headingMatch = HEADING_NODE_RE.exec(name);
      if (headingMatch) {
        pushLineClass(from, `cm-md-h${headingMatch[1]}`);
        return true;
      }
      if (name === 'Blockquote') {
        for (let n = line.number; n <= doc.lineAt(to).number; n++) {
          pushLineClass(doc.line(n).from, 'cm-md-quote');
        }
        return true;
      }
      if (name === 'HorizontalRule') {
        pushLineClass(from, 'cm-md-hr');
        // The rule is drawn as the line's border, so the literal `---` would
        // otherwise sit on top of it. It has no marker child to hide.
        if (!isRevealed && to > from) {
          ranges.push({ from, to, type: 'hide' });
        }
        return true;
      }

      // An image renders as the image itself, but reverts to `![alt](src)` on
      // the caret's line so the source stays editable.
      //
      // The line bound `imageAt` takes is not cosmetic: markdown allows a
      // newline inside the alt text and around the destination, and CodeMirror
      // refuses a replacing decoration that spans a line break when it comes
      // from a view plugin ("Decorations that replace line breaks may not be
      // specified via plugins") — it throws while constructing the view, which
      // would leave the note blank and uneditable. A multi-line image stays
      // raw source.
      if (name === 'Image') {
        if (!isRevealed) {
          const urlNode = node.node.getChild('URL');
          const image = imageAt(
            doc,
            from,
            to,
            line.to,
            urlNode ? doc.sliceString(urlNode.from, urlNode.to) : null,
          );
          if (image) {
            ranges.push({ from, to: image.to, type: 'image', image: image.image });
            imageEnd = image.to;
          }
        }
        // Never descend, decorated or not. The `![`, `]`, `(`, URL and `)`
        // children would otherwise hide themselves — inside the replacement
        // when it was made (pointless), and, when it was NOT made, collapsing
        // an image we deliberately left as source (multi-line, unparseable, or
        // rejected by isPathSafeToOpen) down to bare alt text with nothing for
        // the user to see or fix.
        return false;
      }

      // A code block keeps its fences (see isHideableCodeMark) but has no inline
      // markers to render, so without a line class it would read as ordinary
      // wrapped prose — the rendered preview gave it monospace and a background.
      if (name === 'FencedCode' || name === 'CodeBlock') {
        for (let n = line.number; n <= doc.lineAt(to).number; n++) {
          pushLineClass(doc.line(n).from, 'cm-md-code-block');
        }
        return true;
      }

      // Tables stay literal pipe source — a real <table> widget would have to
      // re-implement cell editing — but monospace + muted pipes makes the
      // columns line up and read as a table (#9910).
      if (name === 'Table') {
        for (let n = line.number; n <= doc.lineAt(to).number; n++) {
          pushLineClass(doc.line(n).from, 'cm-md-table');
        }
        return true;
      }
      if (name === 'TableHeader') {
        pushLineClass(from, 'cm-md-table-header');
        return true;
      }
      if (name === 'TableDelimiter') {
        // The `|---|---|` separator occupies a whole line; the other delimiters
        // are the single `|` column separators.
        const isSeparatorRow = from === line.from && to === line.to;
        if (isSeparatorRow) {
          pushLineClass(from, 'cm-md-table-sep');
        } else {
          ranges.push({ from, to, type: 'mark', cls: 'cm-md-table-delim' });
        }
        return true;
      }

      // A checklist item renders as a real checkbox, replacing the whole
      // `- [ ] ` prefix. Unlike the other markers this stays rendered on the
      // caret's line too: the checkbox IS the affordance, and letting it flip
      // back to raw text under the caret would make the list jump while typing.
      if (name === 'TaskMarker') {
        const quoted = taskLineMatch(line.text);
        if (quoted) {
          const { offset, match } = quoted;
          const isChecked = match[3] !== ' ';
          pushLineClass(from, 'cm-md-task');
          if (isChecked) {
            pushLineClass(from, 'cm-md-task-done');
          }
          ranges.push({
            from: line.from + offset + match[1].length,
            to: line.from + offset + match[0].length,
            type: 'checkbox',
            isChecked,
          });
          return true;
        }
      }

      // A bare or angle-bracket autolink is a `URL` node with no Link parent.
      // It carries no syntax to hide, but it still has to be styled and made
      // clickable like an explicit link.
      if (name === 'URL') {
        const urlParent = node.node.parent?.name;
        if (urlParent !== 'Link' && urlParent !== 'Image') {
          ranges.push({ from, to, type: 'mark', cls: 'cm-md-link' });
          return true;
        }
      }

      const inlineCls = INLINE_CLASS_BY_NODE[name];
      if (inlineCls && to > from) {
        ranges.push({ from, to, type: 'mark', cls: inlineCls });
        return true;
      }

      const parentName = node.node.parent?.name;
      const isHideable =
        HIDDEN_MARK_NODES.has(name) || isHideableCodeMark(name, parentName);
      if (!isHideable || isRevealed) {
        return true;
      }
      // A bare autolink's `URL` was already handled above; only a link's
      // `](…)` tail reaches here.
      const isBlockMarker =
        (name === 'HeaderMark' || name === 'QuoteMark') && from === line.from;
      const end = withTrailingSpace(from, to, doc, isBlockMarker);
      if (end > from) {
        ranges.push({ from, to: end, type: 'hide' });
      }
      return true;
    },
  });

  return ranges;
};

/**
 * The 1-based line numbers a set of selection ranges touches — the lines whose
 * markdown source stays visible. Returns an empty set when the editor is not
 * focused, so an unfocused editor renders as a clean document.
 */
export const revealedLinesFor = (
  doc: Text,
  selectionRanges: readonly { from: number; to: number }[],
  hasFocus: boolean,
): ReadonlySet<number> => {
  if (!hasFocus) {
    return new Set<number>();
  }
  const lines = new Set<number>();
  for (const range of selectionRanges) {
    const first = doc.lineAt(range.from).number;
    const last = doc.lineAt(range.to).number;
    for (let n = first; n <= last; n++) {
      lines.add(n);
    }
  }
  return lines;
};
