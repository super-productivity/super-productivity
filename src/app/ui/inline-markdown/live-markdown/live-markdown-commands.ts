import { EditorView, KeyBinding } from '@codemirror/view';
import {
  applyBold,
  applyBulletList,
  applyInlineCode,
  applyItalic,
  applyNumberedList,
  applyQuote,
  applyStrikethrough,
  handleListKeydown,
  insertLink,
  TextTransformResult,
} from '../markdown-toolbar.util';
import {
  isShortcutWithKey,
  MARKDOWN_SHORTCUTS,
  MarkdownShortcut,
  ShortcutNames,
} from '../../dialog-fullscreen-markdown/markdown-shortcuts.const';

/** The shape every markdown toolbar/shortcut action in this app already has. */
export type TextTransform = (
  text: string,
  selectionStart: number,
  selectionEnd: number,
) => TextTransformResult;

/**
 * Run one of the shared pure text transforms against a CodeMirror view.
 *
 * The transforms operate on the whole document, so the dispatch replaces it
 * wholesale rather than computing a minimal diff. That keeps a single source of
 * truth with the textarea path at the cost of one coarse undo step per action —
 * the same granularity the textarea has.
 */
export const runTextTransform = (view: EditorView, transform: TextTransform): boolean => {
  const text = view.state.doc.toString();
  const { from, to } = view.state.selection.main;
  const result = transform(text, from, to);
  view.dispatch({
    changes: { from: 0, to: text.length, insert: result.text },
    selection: { anchor: result.selectionStart, head: result.selectionEnd },
    scrollIntoView: true,
  });
  return true;
};

const TRANSFORM_BY_SHORTCUT: Record<ShortcutNames, TextTransform> = {
  bold: applyBold,
  italic: applyItalic,
  link: insertLink,
  strikethrough: applyStrikethrough,
  bullet: applyBulletList,
  numbered: applyNumberedList,
  quote: applyQuote,
  code: applyInlineCode,
};

// `Mod-` is CodeMirror's Cmd-on-mac/Ctrl-elsewhere alias, matching the labels in
// markdown-shortcuts.const. The code-based entries (Digit7/8/9) bind to the
// unshifted digit; CodeMirror falls back to the layout's base key for those.
const cmKeyFor = (shortcut: MarkdownShortcut): string => {
  const base = isShortcutWithKey(shortcut)
    ? shortcut.key
    : shortcut.code.replace('Digit', '');
  return `Mod-${shortcut.shiftKey ? 'Shift-' : ''}${base}`;
};

const listKeyBinding = (
  key: 'Enter' | 'Tab',
  isShift: boolean,
  getTodayDate: () => Date,
): KeyBinding => ({
  key: `${isShift ? 'Shift-' : ''}${key}`,
  run: (view) => {
    const text = view.state.doc.toString();
    const { from, to } = view.state.selection.main;
    const result = handleListKeydown(
      text,
      from,
      to,
      key,
      isShift,
      false,
      false,
      getTodayDate(),
    );
    // No list context: let CodeMirror's default binding handle the key.
    return result ? runTextTransform(view, () => result) : false;
  },
});

/**
 * Formatting shortcuts and list continuation for the live editor, reusing the
 * same pure transforms the textarea path and the fullscreen toolbar use.
 */
export const markdownEditKeymap = (getTodayDate: () => Date): KeyBinding[] => [
  ...MARKDOWN_SHORTCUTS.map((shortcut) => ({
    key: cmKeyFor(shortcut),
    preventDefault: true,
    run: (view: EditorView) =>
      runTextTransform(view, TRANSFORM_BY_SHORTCUT[shortcut.name]),
  })),
  listKeyBinding('Enter', false, getTodayDate),
  listKeyBinding('Tab', false, getTodayDate),
  listKeyBinding('Tab', true, getTodayDate),
];
