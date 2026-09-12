import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  ElementRef,
  HostBinding,
  inject,
  Input,
  input,
  OnDestroy,
  OnInit,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconButton } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { isMarkdownChecklist } from '../../features/markdown-checklist/is-markdown-checklist';
import {
  removeCheckedChecklistItems,
  setAllChecklistItemsChecked,
} from '../../features/markdown-checklist/checklist-operations';
import { T } from '../../t.const';
import { fadeInAnimation } from '../animations/fade.ani';
import { openFullscreenMarkdownDialog } from '../dialog-fullscreen-markdown/open-fullscreen-markdown-dialog';
import { ClipboardImageService } from '../../core/clipboard-image/clipboard-image.service';
import { TaskAttachmentService } from '../../features/tasks/task-attachment/task-attachment.service';
import { ResolveClipboardImagesDirective } from '../../core/clipboard-image/resolve-clipboard-images.directive';
import { ClipboardPasteHandlerService } from '../../core/clipboard-image/clipboard-paste-handler.service';
import type { EditorView, KeyBinding } from '@codemirror/view';
import { LiveMarkdownEditorComponent } from './live-markdown/live-markdown-editor.component';
import { Store } from '@ngrx/store';
import { Location } from '@angular/common';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { Log } from '../../core/log';
import { handleListKeydown, applyTaskList } from './markdown-toolbar.util';
import { DateService } from '../../core/date/date.service';

const HIDE_OVERFLOW_TIMEOUT_DURATION = 300;

@Component({
  selector: 'inline-markdown',
  templateUrl: './inline-markdown.component.html',
  styleUrls: ['./inline-markdown.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [fadeInAnimation],
  imports: [
    FormsModule,
    MatIconButton,
    MatTooltip,
    MatIcon,
    MatMenu,
    MatMenuItem,
    MatMenuTrigger,
    TranslatePipe,
    ResolveClipboardImagesDirective,
    LiveMarkdownEditorComponent,
  ],
})
export class InlineMarkdownComponent implements OnInit, OnDestroy {
  private _cd = inject(ChangeDetectorRef);
  private _globalConfigService = inject(GlobalConfigService);
  private _matDialog = inject(MatDialog);
  private _clipboardImageService = inject(ClipboardImageService);
  private _taskAttachmentService = inject(TaskAttachmentService);
  private _clipboardPasteHandler = inject(ClipboardPasteHandlerService);
  private _store = inject(Store);
  private _location = inject(Location);
  private _dateService = inject(DateService);
  private _currentPastePlaceholder: string | null = null;

  /**
   * Pasted images are stored behind `indexeddb://` (or, in Electron, a
   * `file:///…/clipboard-images/` path) and have to be read back before they can
   * load. Anything else — a plain http(s) image — is used unchanged.
   */
  readonly resolveImageSrc = async (src: string): Promise<string> =>
    (await this._clipboardImageService.resolveClipboardImageUrl(src)) ?? src;

  /**
   * Last document the live editor reported; null until it reports one. A signal
   * because the checklist toolbar has to notice a list being typed, before the
   * blur that writes it back to `modelCopy`.
   */
  private readonly _liveDoc = signal<string | null>(null);
  private _isFullscreenDialogOpen = false;
  private _isDestroyed = false;

  readonly isLock = input<boolean>(false);
  readonly isShowControls = input<boolean>(false);
  readonly isShowChecklistToggle = input<boolean>(false);
  readonly isDefaultText = input<boolean>(false);
  // The default/placeholder text currently shown when there are no real notes.
  // When set and still unmodified, the checklist button REPLACES it with a fresh
  // checklist instead of appending below it (see toggleChecklistMode). Callers
  // only pass this for throwaway default text, never for user content (#7786).
  readonly defaultText = input<string>('');
  readonly placeholderTxt = input<string | undefined>(undefined);
  readonly taskId = input<string | undefined>(undefined);

  readonly changed = output<string>();
  readonly focused = output<Event>();
  readonly blurred = output<Event>();
  readonly keyboardUnToggle = output<Event>();
  readonly wrapperEl = viewChild<ElementRef>('wrapperEl');
  readonly textareaEl = viewChild<ElementRef>('textareaEl');
  readonly liveEditorEl = viewChild<LiveMarkdownEditorComponent>('liveEditorEl');

  /**
   * Escape and Ctrl+Enter leave the notes field, as they did on the textarea
   * path (keypressHandler): blurring commits the note, and `keyboardUnToggle`
   * is what hands focus back to the task detail panel. Without these the only
   * way out of the editor by keyboard is Tab.
   */
  readonly liveEditorKeymap: readonly KeyBinding[] = [
    { key: 'Escape', run: (view) => this._leaveLiveEditor(view) },
    { key: 'Mod-Enter', run: (view) => this._leaveLiveEditor(view) },
  ];

  isHideOverflow = signal(false);
  isChecklistMode = signal(false);
  isShowEdit = signal(false);
  // Set when a parent asks for focus before the deferred editor chunk has
  // loaded; the editor picks it up via [autoFocus] once it mounts.
  isPendingLiveFocus = signal(false);
  modelCopy = signal<string | undefined>(undefined);

  isMarkdownFormattingEnabled = computed(() => {
    const tasks = this._globalConfigService.tasks();
    return tasks?.isMarkdownFormattingInNotesEnabled ?? true;
  });

  // Obsidian-style editor (#9910): renders and edits in one view, so it fully
  // replaces the read preview here. Whenever markdown is parsed at all, this is
  // how notes are edited — with formatting off the user asked for plain text
  // and gets a plain textarea.
  isLiveMarkdownEditor = computed(() => this.isMarkdownFormattingEnabled());

  // True when the current notes are a markdown checklist — gates the checklist
  // bulk actions (check all / uncheck all / clear completed) in the UI.
  // Reads the live document first: notes only write back to `modelCopy` on
  // blur, so keying off it alone hid the checklist actions for the whole time
  // you were actually typing the checklist.
  isCurrentlyChecklist = computed(
    () =>
      this.isShowChecklistToggle() &&
      this.isMarkdownFormattingEnabled() &&
      isMarkdownChecklist(this._liveDoc() ?? this.modelCopy() ?? ''),
  );

  readonly T = T;
  private _hideOverFlowTimeout: number | undefined;

  constructor() {
    this.resizeToFit();
  }

  @HostBinding('class.isFocused') get isFocused(): boolean {
    return this.isShowEdit();
  }

  private _model: string | undefined;

  get model(): string | undefined {
    return this._model;
  }

  // TODO: Skipped for migration because:
  //  Accessor inputs cannot be migrated as they are too complex.
  @Input() set model(v: string) {
    this._model = v || '';
    this.modelCopy.set(v || '');
    // Drop what the live editor last reported: on a task switch this setter
    // runs before the editor has been handed the new document, and a destroy
    // landing in that window would otherwise commit the PREVIOUS task's notes
    // onto this one.
    this._liveDoc.set(null);

    if (!this.isShowEdit()) {
      window.setTimeout(() => {
        this.resizeToFit();
      });
    }

    this.isChecklistMode.set(
      this.isChecklistMode() &&
        this.isShowChecklistToggle() &&
        !!v &&
        isMarkdownChecklist(v),
    );
  }

  // TODO: Skipped for migration because:
  //  Accessor inputs cannot be migrated as they are too complex.
  @Input() set isFocus(val: boolean) {
    if (this.isLiveMarkdownEditor()) {
      if (val) {
        this.isPendingLiveFocus.set(true);
        this.liveEditorEl()?.focus();
      }
      return;
    }
    if (!this.isShowEdit() && val) {
      this._toggleShowEdit();
    }
  }

  ngOnInit(): void {
    if (this.isLock()) {
      this._toggleShowEdit();
    } else {
      this.resizeToFit();
    }
  }

  ngOnDestroy(): void {
    this._isDestroyed = true;
    if (this._hideOverFlowTimeout) {
      window.clearTimeout(this._hideOverFlowTimeout);
    }

    if (this._isFullscreenDialogOpen) {
      return;
    }
    if (this.isLiveMarkdownEditor()) {
      // The blur that would normally commit can arrive AFTER Angular has torn
      // this component down — closing the detail panel destroys it on
      // mousedown, and the browser fires blur at the removed element
      // afterwards, where the emit is dropped. So commit from here, where the
      // output is still alive, using the doc `docChanged` last recorded (the
      // editor's own view is already destroyed by this point).
      const liveDoc = this._liveDoc();
      if (liveDoc !== null && liveDoc !== this.model) {
        this.changed.emit(liveDoc);
      }
      return;
    }
    if (this.isShowEdit()) {
      const textareaEl = this.textareaEl();
      if (textareaEl) {
        const currentValue = textareaEl.nativeElement.value;
        if (currentValue !== this.model) {
          this.changed.emit(currentValue);
        }
      }
    }
  }

  checklistToggle(): void {
    this.isChecklistMode.set(!this.isChecklistMode());
  }

  checkAllChecklistItems(): void {
    this._applyChecklistTransform((notes) => setAllChecklistItemsChecked(notes, true));
  }

  uncheckAllChecklistItems(): void {
    this._applyChecklistTransform((notes) => setAllChecklistItemsChecked(notes, false));
  }

  clearCompletedChecklistItems(): void {
    this._applyChecklistTransform(removeCheckedChecklistItems);
  }

  private _applyChecklistTransform(transform: (notes: string) => string): void {
    // Read the freshest content: whichever editor is mounted, else the model.
    const textareaEl = this.textareaEl();
    const current = this._currentText();
    const next = transform(current);
    if (next === current) {
      return;
    }
    // The `model` setter syncs `modelCopy`, which is what the editors read.
    this.model = next;
    if (textareaEl) {
      textareaEl.nativeElement.value = next;
    }
    this.changed.emit(next);
    window.setTimeout(() => this.resizeToFit());
  }

  keypressHandler(ev: KeyboardEvent): void {
    this.resizeTextareaToFit();

    if ((ev.key === 'Enter' && ev.ctrlKey) || ev.code === 'Escape') {
      this.untoggleShowEdit();
      this.keyboardUnToggle.emit(ev);
      return;
    }

    const textarea = this.textareaEl()?.nativeElement;
    if (!textarea) {
      return;
    }
    if (ev.type !== 'keydown') {
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'b' || ev.key === 'i')) {
      ev.preventDefault();
      const marker = ev.key === 'b' ? '**' : '_';
      this._wrapSelectionWithMarker(marker);
      return;
    }
    const result = handleListKeydown(
      textarea.value,
      textarea.selectionStart,
      textarea.selectionEnd,
      ev.key,
      ev.shiftKey,
      ev.ctrlKey,
      ev.metaKey,
      this._dateService.getLogicalTodayDate(),
    );
    if (result) {
      ev.preventDefault();
      textarea.value = result.text;
      textarea.setSelectionRange(result.selectionStart, result.selectionEnd);
      this.modelCopy.set(result.text);
      this.resizeTextareaToFit();
      this.changed.emit(result.text);
    }
  }

  async pasteHandler(ev: ClipboardEvent): Promise<void> {
    await this._clipboardPasteHandler.handlePaste(ev, {
      currentPlaceholder: {
        get: () => this._currentPastePlaceholder,
        set: (val) => (this._currentPastePlaceholder = val),
      },
      getContent: () => this._currentText(),
      setContent: (content) => {
        this.modelCopy.set(content);
        this._model = content;
        this.changed.emit(content);
      },
      getTextarea: () => this.liveEditorEl() ?? this.textareaEl()?.nativeElement ?? null,
      getTaskId: () => this.taskId() || null,
      onPasteComplete: async () => {
        if (!this.liveEditorEl()) {
          this.resizeTextareaToFit();
        }
      },
    });
  }

  /**
   * Blur commits the note through the normal path; the emitted Event is only a
   * signal — the one consumer (`task-detail-panel`) ignores its payload.
   */
  private _leaveLiveEditor(view: EditorView): boolean {
    view.contentDOM.blur();
    this.keyboardUnToggle.emit(new Event('keyboardUnToggle'));
    return true;
  }

  untoggleShowEdit(): void {
    if (this._isFullscreenDialogOpen) {
      return;
    }
    if (!this.isLock()) {
      this.resizeToFit();
      this.isShowEdit.set(false);
    }
    const textareaEl = this.textareaEl();
    if (!textareaEl) {
      throw new Error('Textarea not visible');
    }
    this.modelCopy.set(textareaEl.nativeElement.value);

    if (this.modelCopy() !== this.model) {
      this.model = this.modelCopy() || '';
      this.changed.emit(this.modelCopy() as string);
    }
  }

  /** Commit a change made in the live editor (emitted on blur, like the textarea). */
  onLiveEditorChanged(value: string): void {
    this._liveDoc.set(value);
    this.modelCopy.set(value);
    this.model = value;
    this.changed.emit(value);
  }

  /**
   * Every keystroke, but deliberately NOT a save: it only records what the
   * editor currently holds so `ngOnDestroy` has something to commit. The real
   * save still happens on blur, so a note is still one op per edit session
   * rather than one per keystroke.
   */
  onLiveEditorDocChanged(value: string): void {
    this._liveDoc.set(value);
  }

  onLiveEditorFocused(): void {
    this.isPendingLiveFocus.set(false);
    this.isShowEdit.set(true);
    this.focused.emit(new FocusEvent('focus'));
  }

  onLiveEditorBlurred(): void {
    if (!this.isLock()) {
      this.isShowEdit.set(false);
    }
    this.setBlur(new FocusEvent('blur'));
  }

  /** Freshest text, from whichever editor is mounted. */
  private _currentText(): string {
    const liveEditorEl = this.liveEditorEl();
    if (liveEditorEl) {
      return liveEditorEl.value;
    }
    const textareaEl = this.textareaEl();
    return textareaEl ? textareaEl.nativeElement.value : this._model || '';
  }

  resizeTextareaToFit(): void {
    this._hideOverflow();
    const textareaEl = this.textareaEl();
    if (!textareaEl) {
      throw new Error('Textarea not visible');
    }
    const wrapperEl = this.wrapperEl();
    if (!wrapperEl) {
      throw new Error('Wrapper el not visible');
    }
    textareaEl.nativeElement.style.height = 'auto';
    textareaEl.nativeElement.style.height = textareaEl.nativeElement.scrollHeight + 'px';
    wrapperEl.nativeElement.style.height = textareaEl.nativeElement.offsetHeight + 'px';
  }

  openFullScreen(): void {
    this._isFullscreenDialogOpen = true;
    const taskId = this.taskId();
    // Read straight from the live editor / textarea: modelCopy lags behind
    // (one-way ngModel binding, and the live editor only commits on blur — which
    // the toolbar button suppresses via mousedown.preventDefault).
    const currentContent = this._currentText();
    // Saves-and-closes on a navigation (resize crossing the mobile breakpoint,
    // Android back) instead of dropping the edit — see openFullscreenMarkdownDialog
    // (#8434).
    const dialogRef = openFullscreenMarkdownDialog(this._matDialog, this._location, {
      content: currentContent,
      taskId,
    });

    // Intentionally NOT torn down with takeUntilDestroyed: this MUST still fire
    // after the component is destroyed — see the `_isDestroyed` branch below.
    // afterClosed emits once then completes, so there is no leak.
    dialogRef.afterClosed().subscribe((res) => {
      this._isFullscreenDialogOpen = false;
      // DELETE resets the note to its default text; a string is the saved note.
      // A missing result (Close without saving) leaves the note untouched.
      let newVal: string | null = null;
      if (res?.action === 'DELETE') {
        newVal = '';
      } else if (typeof res === 'string') {
        newVal = res;
      }
      if (newVal === null) {
        return;
      }
      this.modelCopy.set(newVal);

      // The fullscreen editor is a detached overlay that outlives this
      // component: a focus session can end mid-edit and swap the focus-mode
      // screen, destroying us while the dialog stays open. Our `changed` output
      // then has no listener, so emitting it would silently drop the user's
      // note. When we've been destroyed, persist the note directly so the save
      // survives the teardown.
      if (this._isDestroyed) {
        // Skip when the content is effectively unchanged from what we loaded:
        // avoids a redundant op and stops the unmodified default-text
        // placeholder being written back as a real note. Trimmed compare to
        // ignore whitespace-only diffs the editor may introduce. This
        // approximates (not duplicates) the parent's default-text guard —
        // comparing against the loaded model is the closest signal we have here.
        if (newVal.trim() !== (this._model ?? '').trim()) {
          if (taskId) {
            // shortcut: a shared ui/ component dispatching a task action is a
            // layering compromise (TaskService can't be injected here — its
            // eager effects need a full GlobalConfigService under test). Clean
            // upgrade: give the surviving focus-mode container ownership of the
            // fullscreen dialog so the save never depends on this lifetime.
            this._store.dispatch(
              TaskSharedActions.updateTask({
                task: { id: taskId, changes: { notes: newVal } },
              }),
            );
          } else {
            // No task to persist to and our `changed` listener is gone — the
            // edit cannot be saved. Surface it rather than dropping it silently.
            Log.warn(
              'inline-markdown: fullscreen note edit dropped on destroy (no taskId)',
            );
          }
        }
        return;
      }
      this.changed.emit(newVal);
    });
  }

  /**
   * The live editor sizes itself; only the plain textarea (markdown formatting
   * off) needs measuring, and only once it is in the DOM.
   */
  resizeToFit(): void {
    this._hideOverflow();

    setTimeout(() => {
      if (this.textareaEl()) {
        this.resizeTextareaToFit();
      }
    });
  }

  setFocus(ev: Event): void {
    this.focused.emit(ev);
  }

  setBlur(ev: Event): void {
    if (this._isFullscreenDialogOpen) {
      return;
    }
    this.blurred.emit(ev);
  }

  toggleChecklistMode(ev: Event): void {
    ev.preventDefault();
    ev.stopPropagation();

    const textareaEl = this.textareaEl();
    const liveEditorEl = this.liveEditorEl();
    let cursorPos: number | undefined;
    let selectionEnd: number | undefined;
    let currentText: string;

    // Read the live content, not modelCopy: the toolbar button suppresses its
    // own mousedown to keep focus, so the editor has NOT committed on blur and
    // modelCopy still holds the pre-edit note. Reading it would throw away
    // everything typed since the last blur.
    // Check textareaEl directly (not isShowEdit) because blur may have
    // set isShowEdit=false while the textarea is still in the DOM.
    if (liveEditorEl) {
      currentText = liveEditorEl.value;
      cursorPos = liveEditorEl.selectionStart;
    } else if (textareaEl) {
      currentText = textareaEl.nativeElement.value;
      cursorPos = textareaEl.nativeElement.selectionStart;
      selectionEnd = textareaEl.nativeElement.selectionEnd ?? cursorPos;
    } else {
      currentText = this.modelCopy() || '';
    }

    const INSERT_TEXT = '\n- [ ] ';

    // Replace the field with a fresh checklist when it shows only default text:
    // either nothing at all, or the unmodified default template. We never reach
    // here with user-typed content because `currentText` reflects the live
    // textarea value, so any edit breaks the equality check below.
    const defaultText = this.defaultText();
    const isUnmodifiedDefault =
      !!defaultText && currentText.trim() === defaultText.trim();

    if (this.isDefaultText() && (!currentText || isUnmodifiedDefault)) {
      const newValue = '- [ ] ';
      this.model = newValue;
      this.isChecklistMode.set(true);
      this.changed.emit(newValue);
      if (textareaEl) {
        this.isShowEdit.set(true);
        this._setTextareaState(newValue.length);
      } else {
        this._toggleShowEdit(newValue.length);
        this.modelCopy.set(newValue);
      }
      return;
    }

    let cleaned: string;
    let adjustedSelectionStart: number | undefined;
    let adjustedSelectionEnd: number | undefined;

    let isChecklist = true;

    if (cursorPos !== undefined && cursorPos !== selectionEnd) {
      // Convert selected text to checklist items
      const result = applyTaskList(currentText, cursorPos, selectionEnd!);
      cleaned = result.text;
      adjustedSelectionStart = result.selectionStart;
      adjustedSelectionEnd = result.selectionEnd;
      isChecklist = cleaned.includes('- [ ]') || cleaned.includes('- [x]');
    } else if (cursorPos !== undefined) {
      // Path A: Textarea visible — insert after cursor's current line
      let lineEnd = cursorPos;
      while (lineEnd < currentText.length && currentText[lineEnd] !== '\n') {
        lineEnd++;
      }
      const newText =
        currentText.substring(0, lineEnd) + INSERT_TEXT + currentText.substring(lineEnd);
      cleaned = newText.replace(/\n\n- \[/g, '\n- [').replace(/^\n/g, '');

      // Calculate cursor AFTER cleanup to avoid drift
      const beforeCursor = newText.substring(0, lineEnd + INSERT_TEXT.length);
      const cleanedBeforeCursor = beforeCursor
        .replace(/\n\n- \[/g, '\n- [')
        .replace(/^\n/g, '');
      adjustedSelectionStart = Math.min(cleanedBeforeCursor.length, cleaned.length);
      adjustedSelectionEnd = adjustedSelectionStart;
    } else {
      // Path B: Preview mode — append to end
      const appended = currentText + INSERT_TEXT;
      cleaned = appended.replace(/\n\n- \[/g, '\n- [').replace(/^\n/g, '');
    }

    // Update model with FINAL value and emit to parent.
    // This ensures Angular CD won't reset modelCopy to a stale pre-insertion value.
    this.model = cleaned;
    this.isChecklistMode.set(isChecklist);
    this.changed.emit(cleaned);

    if (cursorPos !== undefined) {
      // Ensure editor stays open (blur may have set isShowEdit=false)
      this.isShowEdit.set(true);
      this._setTextareaState(adjustedSelectionStart!, adjustedSelectionEnd);
    } else {
      this._toggleShowEdit(cleaned.length);
      this.modelCopy.set(cleaned);
    }
  }

  private _toggleShowEdit(cursorPos?: number): void {
    this.isShowEdit.set(true);
    this.modelCopy.set(this.model || '');
    if (this.isLiveMarkdownEditor()) {
      this.isPendingLiveFocus.set(true);
      this.liveEditorEl()?.focus();
      if (cursorPos !== undefined) {
        this._setTextareaState(cursorPos);
      }
      return;
    }
    setTimeout(() => {
      const textareaEl = this.textareaEl();
      if (!textareaEl) {
        throw new Error('Textarea not visible');
      }
      textareaEl.nativeElement.value = this.modelCopy();
      textareaEl.nativeElement.focus();
      if (cursorPos !== undefined) {
        textareaEl.nativeElement.setSelectionRange(cursorPos, cursorPos);
      }
      this.resizeTextareaToFit();
    });
  }

  private _setTextareaState(selectionStart: number, selectionEnd?: number): void {
    setTimeout(() => {
      const liveEditorEl = this.liveEditorEl();
      if (liveEditorEl) {
        // Deferred like the textarea path: the model write above only reaches
        // the editor's document once the effect has run.
        liveEditorEl.focus();
        liveEditorEl.setSelectionRange(selectionStart, selectionEnd ?? selectionStart);
        return;
      }
      const textareaEl = this.textareaEl();
      if (textareaEl) {
        textareaEl.nativeElement.value = this.modelCopy();
        textareaEl.nativeElement.focus();
        textareaEl.nativeElement.setSelectionRange(
          selectionStart,
          selectionEnd ?? selectionStart,
        );
        this.resizeTextareaToFit();
      }
    });
  }

  private _wrapSelectionWithMarker(marker: string): void {
    const textareaEl = this.textareaEl();
    if (!textareaEl) return;
    const textarea = textareaEl.nativeElement as HTMLTextAreaElement;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const value = textarea.value;
    const selectedText = value.substring(start, end);
    let newValue: string;
    let newCursorPos: number;

    // Case 1: No selection -> Insert markers and place cursor between them
    // For example: **<cursor>**
    if (selectedText.length === 0) {
      newValue = value.substring(0, start) + marker + marker + value.substring(end);
      newCursorPos = start + marker.length;
    } else {
      newValue =
        value.substring(0, start) + marker + selectedText + marker + value.substring(end);
      newCursorPos = start + marker.length + selectedText.length + marker.length;
    }
    textarea.value = newValue;
    textarea.setSelectionRange(newCursorPos, newCursorPos);

    // Persist changes
    this.modelCopy.set(newValue);
    this.changed.emit(newValue);
    this.resizeTextareaToFit();
  }

  private _hideOverflow(): void {
    this.isHideOverflow.set(true);
    if (this._hideOverFlowTimeout) {
      window.clearTimeout(this._hideOverFlowTimeout);
    }

    this._hideOverFlowTimeout = window.setTimeout(() => {
      this.isHideOverflow.set(false);
      this._cd.detectChanges();
    }, HIDE_OVERFLOW_TIMEOUT_DURATION);
  }
}
