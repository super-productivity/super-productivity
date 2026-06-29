import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  effect,
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
import { MarkdownComponent } from 'ngx-markdown';
import { IS_ELECTRON } from '../../app.constants';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { isMarkdownChecklist } from '../../features/markdown-checklist/is-markdown-checklist';
import {
  removeCheckedChecklistItems,
  setAllChecklistItemsChecked,
  toggleChecklistItemAtIndex,
} from '../../features/markdown-checklist/checklist-operations';
import { T } from '../../t.const';
import { fadeInAnimation } from '../animations/fade.ani';
import { openFullscreenMarkdownDialog } from '../dialog-fullscreen-markdown/open-fullscreen-markdown-dialog';
import { ClipboardImageService } from '../../core/clipboard-image/clipboard-image.service';
import { TaskAttachmentService } from '../../features/tasks/task-attachment/task-attachment.service';
import { ResolveClipboardImagesDirective } from '../../core/clipboard-image/resolve-clipboard-images.directive';
import { ClipboardPasteHandlerService } from '../../core/clipboard-image/clipboard-paste-handler.service';
import { Store } from '@ngrx/store';
import { Location } from '@angular/common';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { Log } from '../../core/log';
import { handleListKeydown } from './markdown-toolbar.util';
import { DateService } from '../../core/date/date.service';

const HIDE_OVERFLOW_TIMEOUT_DURATION = 300;

// A pointer that moves more than this between mousedown and click is treated as
// a drag-select rather than a click, so it must not flip the note into edit mode.
const DRAG_THRESHOLD_PX = 5;

@Component({
  selector: 'inline-markdown',
  templateUrl: './inline-markdown.component.html',
  styleUrls: ['./inline-markdown.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [fadeInAnimation],
  imports: [
    FormsModule,
    MarkdownComponent,
    MatIconButton,
    MatTooltip,
    MatIcon,
    MatMenu,
    MatMenuItem,
    MatMenuTrigger,
    TranslatePipe,
    ResolveClipboardImagesDirective,
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
  private _isFullscreenDialogOpen = false;
  private _isDestroyed = false;
  private _resolveGeneration = 0;
  private _mousedownX = 0;
  private _mousedownY = 0;
  private _hasSelectionOnMousedown = false;

  readonly isLock = input<boolean>(false);
  readonly isShowControls = input<boolean>(false);
  // When true, the rendered preview is shown in read mode but hidden while
  // editing, so the editor is a plain textarea (no dimmed live preview below).
  // Used by the compact focus-mode notes panel; the detail panel keeps the
  // live preview.
  readonly isHidePreviewWhileEditing = input<boolean>(false);
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
  readonly previewEl = viewChild<MarkdownComponent>('previewEl');

  isHideOverflow = signal(false);
  isChecklistMode = signal(false);
  isShowEdit = signal(false);
  modelCopy = signal<string | undefined>(undefined);
  resolvedModel = signal<string | undefined>(undefined);
  // Plain property for markdown component compatibility
  resolvedMarkdownData: string | undefined;

  isMarkdownFormattingEnabled = computed(() => {
    const tasks = this._globalConfigService.tasks();
    return tasks?.isMarkdownFormattingInNotesEnabled ?? true;
  });

  isTurnOffMarkdownParsing = computed(() => !this.isMarkdownFormattingEnabled());

  // The rendered preview shows in read mode, and also below the textarea while
  // editing (live preview) — unless the consumer opts out via
  // isHidePreviewWhileEditing (the compact focus-mode panel does, to stay a
  // single view). Hidden entirely when markdown parsing is off.
  isShowPreview = computed(
    () =>
      !this.isTurnOffMarkdownParsing() &&
      !(this.isHidePreviewWhileEditing() && this.isShowEdit()),
  );

  // True when the current notes are a markdown checklist — gates the checklist
  // bulk actions (check all / uncheck all / clear completed) in the UI.
  isCurrentlyChecklist = computed(
    () =>
      this.isShowChecklistToggle() &&
      this.isMarkdownFormattingEnabled() &&
      isMarkdownChecklist(this.modelCopy() || ''),
  );

  readonly T = T;
  private _hideOverFlowTimeout: number | undefined;

  constructor() {
    this.resizeParsedToFit();

    // Sync signal to plain property for markdown component
    effect(() => {
      this.resolvedMarkdownData = this.resolvedModel();
      this._cd.markForCheck();
    });
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

    this._resolveGeneration++;
    if (v) {
      if (this._clipboardImageService.hasResolvableImages(v)) {
        // Has clipboard images whose URLs must be resolved to blob: URLs first;
        // defer the render until then so we don't flash a broken image.
        this._updateResolvedModel(v);
      } else {
        // Nothing to resolve: render the parsed markdown on the first paint
        // instead of a tick later, which briefly showed the raw notes as plain
        // text before the async (no-op) resolution settled.
        this.resolvedModel.set(v);
        this.resolvedMarkdownData = v;
      }
    } else {
      this.resolvedModel.set('');
      this.resolvedMarkdownData = '';
    }

    if (!this.isShowEdit()) {
      window.setTimeout(() => {
        this.resizeParsedToFit();
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
    if (!this.isShowEdit() && val) {
      this._toggleShowEdit();
    }
  }

  ngOnInit(): void {
    if (this.isLock()) {
      this._toggleShowEdit();
    } else {
      this.resizeParsedToFit();
    }
    if (IS_ELECTRON) {
      this._makeLinksWorkForElectron();
    }
  }

  ngOnDestroy(): void {
    this._isDestroyed = true;
    if (this._hideOverFlowTimeout) {
      window.clearTimeout(this._hideOverFlowTimeout);
    }

    if (this.isShowEdit() && !this._isFullscreenDialogOpen) {
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
    // Read the freshest content: the textarea when editing, else the model.
    const textareaEl = this.textareaEl();
    const current = textareaEl ? textareaEl.nativeElement.value : this._model || '';
    const next = transform(current);
    if (next === current) {
      return;
    }
    // The `model` setter syncs `modelCopy` and re-resolves the rendered markdown.
    this.model = next;
    if (textareaEl) {
      textareaEl.nativeElement.value = next;
    }
    this.changed.emit(next);
    window.setTimeout(() => this.resizeParsedToFit());
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
      getContent: () => this._model || '',
      setContent: (content) => {
        this.modelCopy.set(content);
        this._model = content;
        this.changed.emit(content);
      },
      getTextarea: () => this.textareaEl()?.nativeElement || null,
      getTaskId: () => this.taskId() || null,
      onPasteComplete: async (content) => {
        this.resizeTextareaToFit();
        await this._updateResolvedModel(content);
      },
    });
  }

  previewMousedown($event: MouseEvent): void {
    if ($event.button !== 0) {
      return;
    }
    this._mousedownX = $event.clientX ?? 0;
    this._mousedownY = $event.clientY ?? 0;
    this._hasSelectionOnMousedown = !!window.getSelection()?.toString();
  }

  clickPreview($event: MouseEvent): void {
    const target = $event.target as HTMLElement;
    if (target.tagName === 'A') {
      // Let links work normally
      return;
    }

    // Only the checkbox icon and the item's text label toggle the item. Clicks
    // on the empty rest of the row fall through to opening the editor.
    const hit = target.closest('.checkbox, .checkbox-label') as HTMLElement | null;
    const wrapper = hit?.closest('.checkbox-wrapper') as HTMLElement | null;
    if (wrapper) {
      this._handleCheckboxClick(wrapper);
      return;
    }

    const dx = ($event.clientX ?? 0) - this._mousedownX;
    const dy = ($event.clientY ?? 0) - this._mousedownY;
    const isDrag = Math.hypot(dx, dy) > DRAG_THRESHOLD_PX;
    const hasCurrentSelection = !!window.getSelection()?.toString();

    if (this._hasSelectionOnMousedown || hasCurrentSelection || isDrag) {
      return;
    }

    this._toggleShowEdit();
  }

  untoggleShowEdit(): void {
    if (this._isFullscreenDialogOpen) {
      return;
    }
    if (!this.isLock()) {
      this.resizeParsedToFit();
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
    // Read directly from textarea since modelCopy may be stale (one-way ngModel binding)
    const textareaEl = this.textareaEl();
    const currentContent = textareaEl ? textareaEl.nativeElement.value : this.modelCopy();
    // Saves-and-closes on a navigation (resize crossing the mobile breakpoint,
    // Android back) instead of dropping the edit — see openFullscreenMarkdownDialog
    // (#8434).
    const dialogRef = openFullscreenMarkdownDialog(this._matDialog, this._location, {
      content: currentContent ?? '',
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

  resizeParsedToFit(): void {
    this._hideOverflow();

    setTimeout(() => {
      const previewEl = this.previewEl();
      if (!previewEl) {
        if (this.textareaEl()) {
          this.resizeTextareaToFit();
        }
        return;
      }
      const wrapperEl = this.wrapperEl();
      if (!wrapperEl) {
        throw new Error('Wrapper el not visible');
      }
      previewEl.element.nativeElement.style.height = 'auto';
      // NOTE: somehow this pixel seem to help
      wrapperEl.nativeElement.style.height =
        previewEl.element.nativeElement.offsetHeight + 'px';
      previewEl.element.nativeElement.style.height = '';
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
    let cursorPos: number | undefined;
    let currentText: string;

    // Read current content from textarea if available, otherwise from modelCopy.
    // Check textareaEl directly (not isShowEdit) because blur may have
    // set isShowEdit=false while the textarea is still in the DOM.
    if (textareaEl) {
      currentText = textareaEl.nativeElement.value;
      cursorPos = textareaEl.nativeElement.selectionStart;
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
    let adjustedCursorPos: number | undefined;

    if (cursorPos !== undefined) {
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
      adjustedCursorPos = Math.min(cleanedBeforeCursor.length, cleaned.length);
    } else {
      // Path B: Preview mode — append to end
      const appended = currentText + INSERT_TEXT;
      cleaned = appended.replace(/\n\n- \[/g, '\n- [').replace(/^\n/g, '');
    }

    // Update model with FINAL value and emit to parent.
    // This ensures Angular CD won't reset modelCopy to a stale pre-insertion value.
    this.model = cleaned;
    this.isChecklistMode.set(true);
    this.changed.emit(cleaned);

    if (cursorPos !== undefined) {
      // Ensure editor stays open (blur may have set isShowEdit=false)
      this.isShowEdit.set(true);
      this._setTextareaState(adjustedCursorPos!);
    } else {
      this._toggleShowEdit(cleaned.length);
      this.modelCopy.set(cleaned);
    }
  }

  private _toggleShowEdit(cursorPos?: number): void {
    this.isShowEdit.set(true);
    this.modelCopy.set(this.model || '');
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

  private _setTextareaState(cursorPos: number): void {
    setTimeout(() => {
      const textareaEl = this.textareaEl();
      if (textareaEl) {
        textareaEl.nativeElement.value = this.modelCopy();
        textareaEl.nativeElement.focus();
        textareaEl.nativeElement.setSelectionRange(cursorPos, cursorPos);
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

  private _makeLinksWorkForElectron(): void {
    const wrapperEl = this.wrapperEl();
    if (!wrapperEl) {
      throw new Error('Wrapper el not visible');
    }
    wrapperEl.nativeElement.addEventListener('click', (ev: MouseEvent) => {
      const target = ev.target as HTMLElement;
      if (target.tagName && target.tagName.toLowerCase() === 'a') {
        const href = target.getAttribute('href');
        if (href !== null) {
          ev.preventDefault();
          window.ea.openExternalUrl(href);
        }
      }
    });
  }

  private _handleCheckboxClick(targetEl: HTMLElement): void {
    const allCheckboxes =
      this.previewEl()?.element.nativeElement.querySelectorAll('.checkbox-wrapper');
    const checkIndex = Array.from(allCheckboxes || []).findIndex((el) => el === targetEl);
    if (checkIndex === -1 || !this._model) {
      return;
    }
    const next = toggleChecklistItemAtIndex(this._model, checkIndex);
    if (next !== this._model) {
      this.modelCopy.set(next);
      this.model = next;
      this.changed.emit(next);
    }
  }

  private async _updateResolvedModel(content: string | undefined): Promise<void> {
    if (!content) {
      this.resolvedModel.set('');
      this._cd.markForCheck();
      return;
    }

    // Capture generation to detect if model changed during async resolution
    const gen = this._resolveGeneration;
    // First resolve all URLs in the markdown
    const resolved = await this._clipboardImageService.resolveMarkdownImages(content);
    if (gen !== this._resolveGeneration) return;
    this.resolvedModel.set(resolved);
  }
}
