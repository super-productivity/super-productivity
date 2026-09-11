import { syntaxTree } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { markdownLanguage } from './markdown-language';
import {
  buildLiveMarkdownRanges,
  revealedLinesFor,
  taskMarkerToggleFor,
} from './live-markdown-ranges';

const HIDE = Decoration.replace({});
const markCache = new Map<string, Decoration>();
const lineCache = new Map<string, Decoration>();

const TASK_CHECKBOX_CLASS = 'cm-md-task-checkbox';

/**
 * Renders a checklist item's `- [ ] ` prefix as a real checkbox. The document
 * keeps the markdown source; only the view shows the control, so notes still
 * round-trip byte-for-byte.
 */
class TaskCheckboxWidget extends WidgetType {
  constructor(readonly isChecked: boolean) {
    super();
  }

  override eq(other: TaskCheckboxWidget): boolean {
    return other.isChecked === this.isChecked;
  }

  override toDOM(): HTMLElement {
    // Same Material Icons ligature the rendered markdown uses
    // (marked-options-factory), so a checklist looks identical whether it is
    // shown in the editor or by ngx-markdown elsewhere in the app.
    const el = document.createElement('span');
    el.className = `${TASK_CHECKBOX_CLASS} material-icons${this.isChecked ? ' isChecked' : ''}`;
    el.textContent = this.isChecked ? 'check_box' : 'check_box_outline_blank';
    return el;
  }

  /** Let our mousedown handler see the click instead of CodeMirror eating it. */
  override ignoreEvent(): boolean {
    return false;
  }
}

const CHECKBOX_CHECKED = Decoration.replace({
  widget: new TaskCheckboxWidget(true),
});
const CHECKBOX_UNCHECKED = Decoration.replace({
  widget: new TaskCheckboxWidget(false),
});

/** Flip `[ ]` <-> `[x]` in the source when its rendered checkbox is clicked. */
const taskCheckboxToggle = EditorView.domEventHandlers({
  mousedown: (event, view) => {
    const target = event.target as HTMLElement;
    if (!target.classList?.contains(TASK_CHECKBOX_CLASS)) {
      return false;
    }
    const line = view.state.doc.lineAt(view.posAtDOM(target));
    const toggle = taskMarkerToggleFor(line.text);
    if (!toggle) {
      return false;
    }
    event.preventDefault();
    const pos = line.from + toggle.offset;
    view.dispatch({ changes: { from: pos, to: pos + 1, insert: toggle.nextChar } });
    return true;
  },
});

const markFor = (cls: string): Decoration => {
  let dec = markCache.get(cls);
  if (!dec) {
    dec = Decoration.mark({ class: cls });
    markCache.set(cls, dec);
  }
  return dec;
};

const lineFor = (cls: string): Decoration => {
  let dec = lineCache.get(cls);
  if (!dec) {
    dec = Decoration.line({ class: cls });
    lineCache.set(cls, dec);
  }
  return dec;
};

const buildDecorations = (view: EditorView): DecorationSet => {
  const { doc } = view.state;
  const revealedLines = revealedLinesFor(doc, view.state.selection.ranges, view.hasFocus);
  const ranges = buildLiveMarkdownRanges({
    tree: syntaxTree(view.state),
    doc,
    revealedLines,
  });
  // `Decoration.set(_, true)` sorts for us; the tree yields parents before
  // children, which a RangeSetBuilder would reject.
  return Decoration.set(
    ranges.map(({ from, to, type, cls, isChecked }) => {
      const dec =
        type === 'hide'
          ? HIDE
          : type === 'checkbox'
            ? isChecked
              ? CHECKBOX_CHECKED
              : CHECKBOX_UNCHECKED
            : type === 'line'
              ? lineFor(cls!)
              : markFor(cls!);
      return dec.range(from, to);
    }),
    true,
  );
};

/**
 * Obsidian-style inline rendering: markdown is styled in place and its syntax
 * markers hide themselves, except on the line the caret is on. The document
 * itself is never rewritten — every decoration is view-only, so the text that
 * round-trips to `task.notes` is byte-for-byte what the user typed.
 */
const liveMarkdownPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate): void {
      // focusChanged matters: an unfocused editor reveals no lines at all.
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        update.focusChanged
      ) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

export const liveMarkdown = (): Extension => [
  markdownLanguage,
  liveMarkdownPlugin,
  taskCheckboxToggle,
];
