import { syntaxTree } from '@codemirror/language';
import type { EditorState, Extension } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { isPathSafeToOpen } from '../../../../../electron/shared-with-frontend/is-external-url-allowed';
import { IS_ELECTRON } from '../../../app.constants';
import { toRenderableHref } from '../../link-href.util';
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
const LINK_CLASS = 'cm-md-link';

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
    // preventDefault suppresses the focus this click would have given the
    // editor, and consumers commit the note on BLUR — without focus there is
    // never a blur, so the toggle would change the document and never be
    // saved. Focus explicitly so the normal commit path still runs.
    view.focus();
    const pos = line.from + toggle.offset;
    view.dispatch({ changes: { from: pos, to: pos + 1, insert: toggle.nextChar } });
    return true;
  },
});

/** The raw destination of the link/autolink covering `pos`, if there is one. */
const linkTargetAt = (state: EditorState, pos: number): string | null => {
  let node: ReturnType<typeof syntaxTree>['topNode'] | null = syntaxTree(
    state,
  ).resolveInner(pos, 1);
  while (
    node &&
    node.name !== 'Link' &&
    node.name !== 'Autolink' &&
    node.name !== 'URL'
  ) {
    node = node.parent;
  }
  if (!node) {
    return null;
  }
  const urlNode = node.name === 'URL' ? node : node.getChild('URL');
  return urlNode ? state.doc.sliceString(urlNode.from, urlNode.to) : null;
};

/**
 * Makes links in a note followable again. The rendered preview this replaced
 * produced real anchors; here the link is only a styled span, so the click has
 * to be handled.
 *
 * Gesture: a click opens the link while the editor is NOT focused — i.e. while
 * you are reading the note, which is what the preview used to do — and Mod+click
 * opens it any time. Inside a focused editor a plain click belongs to the caret,
 * or a link would be impossible to edit.
 *
 * The href goes through `toRenderableHref` exactly like the marked renderer:
 * the destination is handed to `shell.openExternal` in Electron, so a note (which
 * may have arrived by sync or import) must not be able to invoke an arbitrary OS
 * protocol handler. A rejected href just places the caret.
 */
const linkOpen = EditorView.domEventHandlers({
  mousedown: (event, view) => {
    const target = event.target as HTMLElement;
    if (event.button !== 0 || !target.classList?.contains(LINK_CLASS)) {
      return false;
    }
    const isModClick = event.metaKey || event.ctrlKey;
    if (view.hasFocus && !isModClick) {
      return false;
    }
    const raw = linkTargetAt(view.state, view.posAtDOM(target));
    const href = raw && toRenderableHref(raw);
    if (!href) {
      return false;
    }
    event.preventDefault();
    if (IS_ELECTRON) {
      window.ea.openExternalUrl(href);
    } else {
      window.open(href, '_blank', 'noopener,noreferrer');
    }
    return true;
  },
});

/**
 * Resolves a markdown image src to something loadable — the app stores pasted
 * images behind `indexeddb://` URLs that only mean something after a lookup.
 * Returning null leaves the image unrendered.
 */
export type ResolveImageSrc = (src: string) => Promise<string | null>;

/**
 * Renders `![alt](src)` inline. Only reached for a src that passed
 * isPathSafeToOpen: an image src auto-loads on render, so a remote
 * `file://host/share` or UNC src would make the OS open an SMB connection and
 * leak the user's NTLM hash just by opening a note (GHSA-hr87-735w-hfq3). The
 * rendered-markdown path blocks the same shape in marked-options-factory.
 */
class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    private readonly _resolve: ResolveImageSrc | undefined,
  ) {
    super();
  }

  override eq(other: ImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt;
  }

  override toDOM(): HTMLElement {
    const img = document.createElement('img');
    img.className = 'cm-md-image';
    img.alt = this.alt;
    img.loading = 'lazy';
    if (this._resolve) {
      // Async: an indexeddb:// src has to be read back before it can load.
      void this._resolve(this.src).then((resolved) => {
        // Re-checked: the guard below ran on the RAW src, and a resolver is a
        // public input — whatever it hands back is what actually loads.
        if (resolved && isPathSafeToOpen(resolved)) {
          img.src = resolved;
        }
      });
    } else {
      img.src = this.src;
    }
    return img;
  }

  /** Purely decorative — clicks belong to the editor, not the image. */
  override ignoreEvent(): boolean {
    return true;
  }
}

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

const buildDecorations = (
  view: EditorView,
  resolveImageSrc: ResolveImageSrc | undefined,
): DecorationSet => {
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
    ranges.flatMap(({ from, to, type, cls, isChecked, image }) => {
      if (type === 'image') {
        // An unsafe src is left as plain `![alt](src)` source rather than
        // rendered or silently dropped, so the user can still see and fix it.
        if (!image || !isPathSafeToOpen(image.src)) {
          return [];
        }
        return [
          Decoration.replace({
            widget: new ImageWidget(image.src, image.alt, resolveImageSrc),
          }).range(from, to),
        ];
      }
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
      return [dec.range(from, to)];
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
const liveMarkdownPlugin = (resolveImageSrc: ResolveImageSrc | undefined): Extension =>
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, resolveImageSrc);
      }

      update(update: ViewUpdate): void {
        // focusChanged matters: an unfocused editor reveals no lines at all.
        // The syntaxTree comparison matters for long notes: the initial parse
        // is time-budgeted (~3kB), and the transaction that lands the rest
        // carries none of the other flags, so without this the tail of a long
        // note stays undecorated until the next caret move.
        if (
          update.docChanged ||
          update.selectionSet ||
          update.viewportChanged ||
          update.focusChanged ||
          syntaxTree(update.startState) !== syntaxTree(update.state)
        ) {
          this.decorations = buildDecorations(update.view, resolveImageSrc);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );

export const liveMarkdown = (resolveImageSrc?: ResolveImageSrc): Extension => [
  markdownLanguage,
  liveMarkdownPlugin(resolveImageSrc),
  taskCheckboxToggle,
  linkOpen,
];
