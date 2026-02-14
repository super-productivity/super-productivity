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
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
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
import * as MarkdownToolbar from '../inline-markdown/markdown-toolbar.util';
import { ClipboardImageService } from '../../core/clipboard-image/clipboard-image.service';
import { TaskAttachmentService } from '../../features/tasks/task-attachment/task-attachment.service';
import { ClipboardPasteHandlerService } from '../../core/clipboard-image/clipboard-paste-handler.service';
import { HISTORY_STATE } from 'src/app/app.constants';
import { IS_MOBILE } from 'src/app/util/is-mobile';

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
  _matDialogRef = inject<MatDialogRef<DialogFullscreenMarkdownComponent>>(MatDialogRef);
  data: { content: string; taskId?: string } = inject(MAT_DIALOG_DATA) || { content: '' };

  T: typeof T = T;
  viewMode: ViewMode = isSmallScreen() ? 'TEXT_ONLY' : 'SPLIT';
  readonly previewEl = viewChild<MarkdownComponent>('previewEl');
  readonly textareaEl = viewChild<ElementRef>('textareaEl');
  readonly contentChanged = output<string>();
  private readonly _contentChanges$ = new Subject<string>();
  private _currentPastePlaceholder: string | null = null;

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

  keydownHandler(ev: KeyboardEvent): void {
    if (ev.key === 'Enter' && ev.ctrlKey) {
      this.close();
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
    if (($event.target as HTMLElement).tagName === 'A') {
      // links are already handled by the markdown component
    } else if (
      $event?.target &&
      ($event.target as HTMLElement).classList.contains('checkbox')
    ) {
      this._handleCheckboxClick(
        ($event.target as HTMLElement).parentElement as HTMLElement,
      );
    }
  }

  private _handleCheckboxClick(targetEl: HTMLElement): void {
    const allCheckboxes =
      this.previewEl()?.element.nativeElement.querySelectorAll('.checkbox-wrapper');

    const checkIndex = Array.from(allCheckboxes || []).findIndex((el) => el === targetEl);
    if (checkIndex !== -1 && this.data.content) {
      const allLines = this.data.content.split('\n');
      const todoAllLinesIndexes = allLines
        .map((line, index) => (line.includes('- [') ? index : null))
        .filter((i) => i !== null);

      const itemIndex = todoAllLinesIndexes[checkIndex];
      if (typeof itemIndex === 'number' && itemIndex > -1) {
        const item = allLines[itemIndex];
        allLines[itemIndex] = item.includes('[ ]')
          ? item.replace('[ ]', '[x]').replace('[]', '[x]')
          : item.replace('[x]', '[ ]');
        this.data.content = allLines.join('\n');
        // Emit change for auto-save
        this._contentChanges$.next(this.data.content);
      }
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
    this._applyTransformWithArgs(MarkdownToolbar.applyBold);
  }

  onApplyItalic(): void {
    this._applyTransformWithArgs(MarkdownToolbar.applyItalic);
  }

  onApplyStrikethrough(): void {
    this._applyTransformWithArgs(MarkdownToolbar.applyStrikethrough);
  }

  onApplyHeading(level: 1 | 2 | 3): void {
    this._applyTransformWithArgs((text, start, end) =>
      MarkdownToolbar.applyHeading(text, start, end, level),
    );
  }

  onApplyQuote(): void {
    this._applyTransformWithArgs(MarkdownToolbar.applyQuote);
  }

  onApplyBulletList(): void {
    this._applyTransformWithArgs(MarkdownToolbar.applyBulletList);
  }

  onApplyNumberedList(): void {
    this._applyTransformWithArgs(MarkdownToolbar.applyNumberedList);
  }

  onApplyTaskList(): void {
    this._applyTransformWithArgs(MarkdownToolbar.applyTaskList);
  }

  onApplyInlineCode(): void {
    this._applyTransformWithArgs(MarkdownToolbar.applyInlineCode);
  }

  onApplyCodeBlock(): void {
    this._applyTransformWithArgs(MarkdownToolbar.applyCodeBlock);
  }

  onInsertLink(): void {
    this._applyTransformWithArgs(MarkdownToolbar.insertLink);
  }

  onInsertImage(): void {
    this._applyTransformWithArgs(MarkdownToolbar.insertImage);
  }

  onInsertTable(): void {
    this._applyTransformWithArgs(MarkdownToolbar.insertTable);
  }

  private _applyTransformWithArgs(
    transformFn: (
      text: string,
      start: number,
      end: number,
    ) => MarkdownToolbar.TextTransformResult,
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
