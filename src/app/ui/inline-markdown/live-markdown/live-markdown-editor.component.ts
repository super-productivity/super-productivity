import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { EditorState } from '@codemirror/state';
import {
  EditorView,
  KeyBinding,
  keymap,
  placeholder as cmPlaceholder,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { liveMarkdown, type ResolveImageSrc } from './live-markdown-extension';
import { liveMarkdownTheme } from './live-markdown-theme';
import {
  markdownEditKeymap,
  runTextTransform,
  TextTransform,
} from './live-markdown-commands';
import { DateService } from '../../../core/date/date.service';

/**
 * Obsidian-style markdown editor: the document stays raw markdown while the
 * syntax markers are hidden everywhere except on the line holding the caret.
 * Replaces the edit/preview split in task notes and in the fullscreen dialog
 * (#9910).
 *
 * Deliberately exposes a textarea-shaped surface (`value`, `selectionStart`,
 * `setSelectionRange`, ...) so the existing pure toolbar/paste helpers work
 * against it unchanged.
 */
@Component({
  selector: 'live-markdown-editor',
  template: '<div #hostEl class="cm-host"></div>',
  styleUrls: ['./live-markdown-editor.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiveMarkdownEditorComponent {
  private readonly _dateService = inject(DateService);

  readonly model = input<string>('');
  readonly placeholderTxt = input<string>('');
  readonly ariaLabel = input<string>('');
  readonly autoFocus = input<boolean>(false);
  /** Extra key bindings, e.g. the fullscreen dialog's Ctrl+Enter save. */
  readonly extraKeymap = input<readonly KeyBinding[]>([]);
  /**
   * Turns a markdown image src into something loadable. Pasted images live
   * behind `indexeddb://` URLs that only resolve after a lookup; without a
   * resolver the src is used as-is.
   */
  readonly resolveImageSrc = input<ResolveImageSrc | undefined>(undefined);

  /** Every document change, for consumers that auto-save while typing. */
  readonly docChanged = output<string>();
  /** Committed value, emitted on blur — mirrors the textarea path. */
  readonly changed = output<string>();
  readonly blurred = output<void>();
  readonly focused = output<void>();
  readonly pasted = output<ClipboardEvent>();

  private readonly _hostEl = viewChild.required<ElementRef<HTMLElement>>('hostEl');
  private _view: EditorView | undefined;
  /** Last value emitted to the consumer; guards against echoing our own writes. */
  private _lastEmitted = '';

  constructor() {
    const destroyRef = inject(DestroyRef);

    effect(() => {
      const host = this._hostEl().nativeElement;
      const model = this.model();
      if (!this._view) {
        this._view = this._createView(host, model);
        this._lastEmitted = model;
        if (this.autoFocus()) {
          this._view.focus();
          this._view.dispatch({
            selection: { anchor: this._view.state.doc.length },
            scrollIntoView: true,
          });
        }
        return;
      }
      // External model change (e.g. a remote sync update) — replace the doc, but
      // never when it already matches, or we would reset the caret on every
      // keystroke.
      const current = this._view.state.doc.toString();
      if (model !== current) {
        this._view.dispatch({
          changes: { from: 0, to: current.length, insert: model },
        });
        this._lastEmitted = model;
      }
    });

    // Deliberately no commit here. Angular destroys child views before the
    // parent's ngOnDestroy, and by then the parent's own outputs are dead too
    // ("NG0953: Unexpected emit for destroyed OutputRef"), so anything emitted
    // from here is silently dropped. Consumers keep the last document from
    // `docChanged` instead and commit it themselves.
    destroyRef.onDestroy(() => {
      this._view?.destroy();
      this._view = undefined;
    });
  }

  // ---------------------------------------------------------------------------
  // Textarea-shaped surface (see class docs)
  // ---------------------------------------------------------------------------

  get value(): string {
    return this._view?.state.doc.toString() ?? this.model();
  }

  get selectionStart(): number {
    return this._view?.state.selection.main.from ?? 0;
  }

  get selectionEnd(): number {
    return this._view?.state.selection.main.to ?? 0;
  }

  setSelectionRange(start: number, end: number): void {
    const view = this._view;
    if (!view) {
      return;
    }
    const max = view.state.doc.length;
    view.dispatch({
      selection: { anchor: Math.min(start, max), head: Math.min(end, max) },
      scrollIntoView: true,
    });
  }

  focus(): void {
    this._view?.focus();
  }

  /** Apply one of the shared pure markdown transforms at the current selection. */
  applyTransform(transform: TextTransform): void {
    const view = this._view;
    if (!view) {
      return;
    }
    view.focus();
    runTextTransform(view, transform);
  }

  private _createView(parent: HTMLElement, doc: string): EditorView {
    return new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [
          history(),
          EditorView.lineWrapping,
          cmPlaceholder(this.placeholderTxt()),
          liveMarkdown(this.resolveImageSrc()),
          liveMarkdownTheme,
          EditorView.contentAttributes.of(this._contentAttributes()),
          // Ours first: the markdown bindings must win over the defaults for
          // Enter (list continuation) and Tab (indent).
          keymap.of([
            ...this.extraKeymap(),
            ...markdownEditKeymap(() => this._dateService.getLogicalTodayDate()),
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.domEventHandlers({
            // Returning false keeps CodeMirror's own text paste; the image paste
            // handler calls preventDefault synchronously when it takes over.
            paste: (ev) => {
              this.pasted.emit(ev);
              return false;
            },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              this.docChanged.emit(update.state.doc.toString());
            }
            if (update.focusChanged) {
              if (update.view.hasFocus) {
                this.focused.emit();
              } else {
                this._emitIfChanged();
                this.blurred.emit();
              }
            }
          }),
        ],
      }),
    });
  }

  /**
   * Notes are prose: CodeMirror disables spellcheck by default (it is built for
   * code) and the textarea this replaces had it on.
   */
  private _contentAttributes(): Record<string, string> {
    const label = this.ariaLabel() || this.placeholderTxt();
    return {
      spellcheck: 'true',
      autocapitalize: 'sentences',
      // An empty aria-label is worse than none: it silences the role's own
      // accessible name.
      /* eslint-disable-next-line @typescript-eslint/naming-convention --
         DOM attribute name, not an identifier. */
      ...(label ? { 'aria-label': label } : {}),
    };
  }

  private _emitIfChanged(): void {
    const value = this._view?.state.doc.toString() ?? '';
    if (value !== this._lastEmitted) {
      this._lastEmitted = value;
      this.changed.emit(value);
    }
  }
}
