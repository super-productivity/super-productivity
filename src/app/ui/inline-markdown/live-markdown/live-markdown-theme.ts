import { EditorView } from '@codemirror/view';

/**
 * Inline rendering styles, kept as a CodeMirror theme rather than component SCSS
 * so the editor stays self-contained: CodeMirror renders into its own DOM inside
 * the host, which Angular's style encapsulation would otherwise not reach
 * without `::ng-deep`.
 *
 * Sizes mirror `src/styles/components/markdown.scss` so that switching between
 * the rendered read view and this editor does not reflow the note.
 */
/* eslint-disable @typescript-eslint/naming-convention --
   The keys of a CodeMirror theme are CSS selectors, which cannot be camelCase.
   Scoped to this object rather than added to the lint allowlist. */
export const liveMarkdownTheme = EditorView.theme({
  '&': {
    color: 'inherit',
    backgroundColor: 'transparent',
    fontSize: 'inherit',
  },
  '&.cm-focused': { outline: 'none' },
  // CodeMirror's base theme hard-codes `font-family: monospace` on .cm-scroller;
  // notes are prose, so take the app font back. Must be set here — `inherit` on
  // .cm-content would just inherit the monospace from this element.
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: 'inherit' },
  // Matches .markdown-unparsed/.markdown-parsed so the text does not shift when
  // the note flips between the rendered view and the editor.
  '.cm-content': {
    padding: 'var(--s) var(--s2)',
    fontFamily: 'inherit',
    caretColor: 'currentColor',
  },
  '.cm-line': { padding: '0' },
  '.cm-gutters': { display: 'none' },

  '.cm-md-h1': { fontSize: '22px', lineHeight: '24px', fontWeight: 'bold' },
  '.cm-md-h2': { fontSize: '18px', lineHeight: '22px', fontWeight: 'bold' },
  '.cm-md-h3': { fontSize: '16px', fontWeight: 'bold' },
  '.cm-md-h4': { fontWeight: 'bold' },
  '.cm-md-h5': { fontWeight: 'bold' },
  '.cm-md-h6': { fontWeight: 'bold' },

  '.cm-md-strong': { fontWeight: 'bold' },
  '.cm-md-em': { fontStyle: 'italic' },
  '.cm-md-strike': { textDecoration: 'line-through' },
  '.cm-md-code': {
    fontFamily: 'monospace',
    fontSize: '12px',
    padding: '0 3px',
    borderRadius: '3px',
    backgroundColor: 'var(--separator-color, rgba(127,127,127,0.15))',
  },
  // A fenced or indented block keeps its fences as source, so it gets the
  // monospace + background the rendered `pre` had, applied per line.
  '.cm-md-code-block': {
    fontFamily: 'monospace',
    fontSize: '12px',
    backgroundColor: 'var(--separator-color, rgba(127,127,127,0.15))',
  },
  '.cm-md-link': { color: 'var(--c-accent, inherit)', textDecoration: 'underline' },
  '.cm-md-list-mark': { color: 'var(--text-color-muted, inherit)' },
  // Mirrors `.checkbox` / `.checkbox-wrapper` in styles/components/markdown.scss
  // so checklists read the same in the editor as in the rendered view.
  '.cm-md-task-checkbox': {
    fontSize: '20px',
    lineHeight: '1',
    verticalAlign: '-5px',
    marginRight: 'var(--s-half, 4px)',
    color: 'var(--text-color-muted, inherit)',
    cursor: 'pointer',
    // The glyph's textContent is the ligature name (`check_box_outline_blank`);
    // selecting a checklist would otherwise copy that into the clipboard.
    userSelect: 'none',
  },
  '.cm-md-task-checkbox.isChecked': { color: 'var(--c-accent, inherit)' },
  '.cm-md-task': { paddingBottom: 'var(--s-half, 4px)' },
  '.cm-md-task-done': { opacity: '0.6', textDecoration: 'line-through' },
  // The strike belongs on the label, not across the checkbox glyph.
  '.cm-md-task-done .cm-md-task-checkbox': { textDecoration: 'none' },
  // Pipe tables only align if the glyphs are fixed-width and the row is not
  // wrapped; `lineWrapping` is on for prose, so opt these lines out of it and
  // let the scroller handle a table that is wider than the panel.
  '.cm-md-table': {
    fontFamily: 'monospace',
    fontSize: '12px',
    whiteSpace: 'pre',
    overflowX: 'auto',
  },
  '.cm-md-table-header': { fontWeight: 'bold' },
  '.cm-md-table-sep': { color: 'var(--text-color-muted, inherit)', opacity: '0.5' },
  '.cm-md-table-delim': { color: 'var(--text-color-muted, inherit)', opacity: '0.6' },
  // Mirrors `img` in styles/components/markdown.scss: a pasted screenshot must
  // not blow the note's width open.
  '.cm-md-image': {
    maxWidth: '100%',
    maxHeight: '400px',
    borderRadius: 'var(--card-border-radius, 4px)',
    verticalAlign: 'top',
  },
  '.cm-md-quote': {
    borderLeft: '3px solid var(--extra-border-color, currentColor)',
    paddingLeft: 'var(--s, 8px)',
    color: 'var(--text-color-muted, inherit)',
  },
  '.cm-md-hr': {
    borderBottom: '1px solid var(--extra-border-color, currentColor)',
    opacity: '0.6',
  },
});
