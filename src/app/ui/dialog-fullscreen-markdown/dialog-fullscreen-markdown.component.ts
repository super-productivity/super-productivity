import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  OnInit,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatButton } from '@angular/material/button';
import { MatButtonToggle, MatButtonToggleGroup } from '@angular/material/button-toggle';
import { MatIcon } from '@angular/material/icon';
import { MatIconButton } from '@angular/material/button';
import { MatTooltip } from '@angular/material/tooltip';
import { MarkdownComponent } from 'ngx-markdown';
import { TranslatePipe } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { LS } from '../../core/persistence/storage-keys.const';
import { T } from '../../t.const';
import { isSmallScreen } from '../../util/is-small-screen';
import { DateService } from '../../core/date/date.service';
import {
  handleListKeydown,
  TextTransformResult,
  applyBold,
  applyItalic,
  applyStrikethrough,
  applyHeading,
  applyQuote,
  applyBulletList,
  applyNumberedList,
  applyTaskList,
  applyInlineCode,
  applyCodeBlock,
  insertLink,
  insertImage,
  insertTable,
} from '../inline-markdown/markdown-toolbar.util';
import { ClipboardImageService } from '../../core/clipboard-image/clipboard-image.service';
import { TaskAttachmentService } from '../../features/tasks/task-attachment/task-attachment.service';
import { ClipboardPasteHandlerService } from '../../core/clipboard-image/clipboard-paste-handler.service';
import { toggleChecklistItemAtIndex } from '../../features/markdown-checklist/checklist-operations';
import { HISTORY_STATE } from 'src/app/app.constants';
import { IS_MOBILE } from 'src/app/util/is-mobile';
import { IS_IOS } from 'src/app/util/is-ios';
import { Keyboard } from '@capacitor/keyboard';
import { DialogMarkdownShortcutsComponent } from './dialog-markdown-shortcuts.component';
import {
  isShortcutWithKey,
  MARKDOWN_SHORTCUTS,
  MarkdownShortcut,
  shortcutLabels,
  ShortcutNames,
} from './markdown-shortcuts.const';

type ViewMode = 'SPLIT' | 'PARSED' | 'TEXT_ONLY';
const ALL_VIEW_MODES: ['SPLIT', 'PARSED', 'TEXT_ONLY'] = ['SPLIT', 'PARSED', 'TEXT_ONLY'];

@Component({
  selector: 'dialog-fullscreen-markdown',
  templateUrl: './dialog-fullscreen-markdown.component.html',
  styleUrls: ['./dialog-fullscreen-markdown.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    FormsModule,
    MarkdownComponent,
    MatButton,
    MatButtonToggle,
    MatButtonToggleGroup,
    MatIcon,
    MatIconButton,
    MatTooltip,
    TranslatePipe,
  ],
})
export class DialogFullscreenMarkdownComponent implements OnInit, AfterViewInit {
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _clipboardImageService = inject(ClipboardImageService);
  private readonly _taskAttachmentService = inject(TaskAttachmentService);
  private readonly _clipboardPasteHandler = inject(ClipboardPasteHandlerService);
  private readonly _cdr = inject(ChangeDetectorRef);
  private readonly _dateService = inject(DateService);
  _matDialogRef = inject<MatDialogRef<DialogFullscreenMarkdownComponent>>(MatDialogRef);
  data: { content: string; taskId?: string } = inject(MAT_DIALOG_DATA) || { content: '' };

  T: typeof T = T;
  viewMode: ViewMode = isSmallScreen() ? 'TEXT_ONLY' : 'SPLIT';
  readonly previewEl = viewChild<MarkdownComponent>('previewEl');
  readonly textareaEl = viewChild<ElementRef>('textareaEl');
  readonly contentChanged = output<string>();
  private readonly _contentChanges$ = new Subject<string>();
  private _currentPastePlaceholder: string | null = null;
  private readonly _matDialog = inject(MatDialog);
  readonly shortcutLabels = shortcutLabels;
  /**
   * Resolved content with blob URLs for images (for preview rendering).
   * Initialized in ngOnInit with raw content, updated asynchronously when images resolve.
   */
  resolvedContent = signal<string>('');
  // Plain property for markdown component compatibility
  resolvedContentData: string | undefined;

  constructor() {
    // Set initial content synchronously for immediate rendering
    this.resolvedContentData = this.data.content || '';

    const lastViewMode = localStorage.getItem(LS.LAST_FULLSCREEN_EDIT_VIEW_MODE);
    if (
      ALL_VIEW_MODES.includes(lastViewMode as ViewMode) &&
      // empty notes should never be in preview mode
      this.data &&
      this.data.content.trim().length > 0
    ) {
      this.viewMode = lastViewMode as ViewMode;

      if (this.viewMode === 'SPLIT' && isSmallScreen()) {
        this.viewMode = 'TEXT_ONLY';
      }
    }

    // Sync signal to plain property for markdown component
    effect(() => {
      this.resolvedContentData = this.resolvedContent();
      this._cdr.markForCheck();
    });

    // Auto-save with debounce
    this._contentChanges$
      .pipe(debounceTime(500), takeUntilDestroyed(this._destroyRef))
      .subscribe((value) => {
        this.contentChanged.emit(value);
      });

    // Update resolved content when content changes (for preview with images)
    this._contentChanges$
      .pipe(debounceTime(100), takeUntilDestroyed(this._destroyRef))
      .subscribe((value) => {
        this._updateResolvedContent(value);
      });

    // Show the iOS keyboard accessory bar while this dialog is open so the
    // Done button is available; the bar is globally hidden elsewhere.
    if (IS_IOS) {
      Keyboard.setAccessoryBarVisible({ isVisible: true });
      this._destroyRef.onDestroy(() => {
        Keyboard.setAccessoryBarVisible({ isVisible: false });
      });
    }

    // Handle Escape key - save and close
    this._matDialogRef.disableClose = true;
    this._matDialogRef
      .keydownEvents()
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          this.close();
        }
      });
  }

  async ngOnInit(): Promise<void> {
    // Push a fake state for our dialog in the history when it's displayed in fullscreen
    if (IS_MOBILE) {
      if (!window.history.state?.[HISTORY_STATE.DIALOG_FULLSCREEN_MARKDOWN]) {
        window.history.pushState(
          { [HISTORY_STATE.DIALOG_FULLSCREEN_MARKDOWN]: true },
          '',
        );
      }
    }

    // Update resolved content asynchronously for image processing
    if (this.data.content) {
      await this._updateResolvedContent(this.data.content);
    }
  }

  ngAfterViewInit(): void {
    // Focus textarea if present (not in PARSED view mode)
    this.textareaEl()?.nativeElement?.focus();
  }

  openShortcutsHelp(): void {
    this._matDialog.open(DialogMarkdownShortcutsComponent, {
      maxWidth: '100vw',
      width: '402px',
    });
  }

  private _executeShortcutByName(name: ShortcutNames): void {
    switch (name) {
      case 'bold':
        this.onApplyBold();
        break;
      case 'italic':
        this.onApplyItalic();
        break;
      case 'link':
        this.onInsertLink();
        break;
      case 'strikethrough':
        this.onApplyStrikethrough();
        break;
      case 'bullet':
        this.onApplyBulletList();
        break;
      case 'numbered':
        this.onApplyNumberedList();
        break;
      case 'code':
        this.onApplyInlineCode();
        break;
      case 'quote':
        this.onApplyQuote();
        break;
      default: {
        const _exhaustive: never = name;
        return _exhaustive;
      }
    }
  }

  keydownHandler(ev: KeyboardEvent): void {
    if (ev.key === 'Enter' && ev.ctrlKey) {
      this.close();
      return;
    }

    // Accept both Ctrl and Meta intentionally; the displayed shortcut label shows only one.
    const hasModifier = (ev.ctrlKey || ev.metaKey) && !ev.altKey;

    const textarea = this.textareaEl()?.nativeElement;
    if (!textarea) {
      return;
    }

    if (hasModifier) {
      const shortcutIndex = (MARKDOWN_SHORTCUTS as readonly MarkdownShortcut[]).findIndex(
        (s) => {
          const keyMatch = isShortcutWithKey(s)
            ? ev.key.toLowerCase() === s.key
            : ev.code === s.code;
          return keyMatch && ev.shiftKey === s.shiftKey;
        },
      );

      const shortcut =
        shortcutIndex !== -1 ? MARKDOWN_SHORTCUTS[shortcutIndex] : undefined;

      if (shortcut) {
        ev.preventDefault();
        this._executeShortcutByName(shortcut.name);
        return;
      }
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
      this.data.content = result.text;
      this._contentChanges$.next(result.text);
    }
  }

  async pasteHandler(ev: ClipboardEvent): Promise<void> {
    await this._clipboardPasteHandler.handlePaste(ev, {
      currentPlaceholder: {
        get: () => this._currentPastePlaceholder,
        set: (val) => (this._currentPastePlaceholder = val),
      },
      getContent: () => this.data.content,
      setContent: (content) => {
        this.data.content = content;
        this._contentChanges$.next(content);
      },
      getTextarea: () => this.textareaEl()?.nativeElement || null,
      getTaskId: () => this.data.taskId || null,
    });
  }

  ngModelChange(content: string): void {
    this._contentChanges$.next(content);
  }

  close(isSkipSave: boolean = false): void {
    // When the "Close" button is hit by the user, the note is closed without saving.
    if (isSkipSave) {
      this._matDialogRef.close();
      // When the note is made empty manually by the user and the "Save" button is hit, the note is automatically deleted instead of being left blank.
    } else if (!this.data?.content && this.data.content.trim().length < 1) {
      this._matDialogRef.close({ action: 'DELETE' });
      // When the "Save" button is clicked by the user and the note has content, it will save.
    } else {
      this._matDialogRef.close(this.data?.content);
    }
  }

  onViewModeChange(): void {
    localStorage.setItem(LS.LAST_FULLSCREEN_EDIT_VIEW_MODE, this.viewMode);
  }

  clickPreview($event: MouseEvent): void {
    const target = $event.target as HTMLElement;
    if (target.closest('a')) {
      // links are already handled by the markdown component
      return;
    }

    const wrapper = target.closest('.checkbox-wrapper') as HTMLElement | null;
    if (wrapper) {
      this._handleCheckboxClick(wrapper);
    }
  }

  private _handleCheckboxClick(targetEl: HTMLElement): void {
    const allCheckboxes =
      this.previewEl()?.element.nativeElement.querySelectorAll('.checkbox-wrapper');
    const checkIndex = Array.from(allCheckboxes || []).findIndex((el) => el === targetEl);
    if (checkIndex === -1 || !this.data.content) {
      return;
    }
    const next = toggleChecklistItemAtIndex(this.data.content, checkIndex);
    if (next !== this.data.content) {
      this.data.content = next;
      // Emit change for auto-save
      this._contentChanges$.next(this.data.content);
    }
  }

  private async _updateResolvedContent(content: string): Promise<void> {
    const resolved = await this._clipboardImageService.resolveMarkdownImages(content);
    this.resolvedContent.set(resolved);
  }

  // =========================================================================
  // Toolbar actions
  // =========================================================================

  onApplyBold(): void {
    this._applyTransformWithArgs(applyBold);
  }

  onApplyItalic(): void {
    this._applyTransformWithArgs(applyItalic);
  }

  onApplyStrikethrough(): void {
    this._applyTransformWithArgs(applyStrikethrough);
  }

  onApplyHeading(level: 1 | 2 | 3): void {
    this._applyTransformWithArgs((text, start, end) =>
      applyHeading(text, start, end, level),
    );
  }

  onApplyQuote(): void {
    this._applyTransformWithArgs(applyQuote);
  }

  onApplyBulletList(): void {
    this._applyTransformWithArgs(applyBulletList);
  }

  onApplyNumberedList(): void {
    this._applyTransformWithArgs(applyNumberedList);
  }

  onApplyTaskList(): void {
    this._applyTransformWithArgs(applyTaskList);
  }

  onApplyInlineCode(): void {
    this._applyTransformWithArgs(applyInlineCode);
  }

  onApplyCodeBlock(): void {
    this._applyTransformWithArgs(applyCodeBlock);
  }

  onInsertLink(): void {
    this._applyTransformWithArgs(insertLink);
  }

  onInsertImage(): void {
    this._applyTransformWithArgs(insertImage);
  }

  onInsertTable(): void {
    this._applyTransformWithArgs(insertTable);
  }

  private _applyTransformWithArgs(
    transformFn: (text: string, start: number, end: number) => TextTransformResult,
  ): void {
    const textarea = this.textareaEl()?.nativeElement;
    if (!textarea) {
      return;
    }

    const { value, selectionStart, selectionEnd } = textarea;
    const result = transformFn(value || '', selectionStart, selectionEnd);

    this.data.content = result.text;
    this._contentChanges$.next(result.text);

    // Wait for Angular to update the DOM after ngModel change before restoring selection
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(result.selectionStart, result.selectionEnd);
    });
  }
}
