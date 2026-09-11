import { defineLanguageFacet, Language, languageDataProp } from '@codemirror/language';
import { GFM, parser as baseMarkdownParser } from '@lezer/markdown';

/**
 * A CodeMirror `Language` over the raw @lezer/markdown parser.
 *
 * Deliberately NOT `@codemirror/lang-markdown`: that package has a static
 * top-level `import { html } from '@codemirror/lang-html'`, which no bundler can
 * tree-shake, dragging in lang-html + lang-javascript + lang-css + their Lezer
 * parsers for +73kB gzip (measured 2026-09). We only need the syntax tree to
 * place decorations, never embedded-HTML parsing, so we wire the parser up
 * ourselves.
 *
 * The cost of doing so is that markdown-specific editing commands from
 * lang-markdown (`insertNewlineContinueMarkup`) are unavailable — we already
 * have equivalents in `markdown-toolbar.util.ts`.
 */
const markdownFacet = defineLanguageFacet({});

export const markdownLanguage = new Language(
  markdownFacet,
  baseMarkdownParser.configure([
    GFM,
    { props: [languageDataProp.add(() => markdownFacet)] },
  ]),
  [],
  'markdown',
);
