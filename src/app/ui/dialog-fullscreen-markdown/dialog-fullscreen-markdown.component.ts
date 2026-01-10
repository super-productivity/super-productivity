import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  output,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatButtonToggle, MatButtonToggleGroup } from '@angular/material/button-toggle';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { MarkdownComponent } from 'ngx-markdown';
import { Subject } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { LS } from '../../core/persistence/storage-keys.const';
import { T } from '../../t.const';
import { isSmallScreen } from '../../util/is-small-screen';
import * as MarkdownToolbar from '../inline-markdown/markdown-toolbar.util';

type ViewMode = 'SPLIT' | 'PARSED' | 'TEXT_ONLY';
const ALL_VIEW_MODES: ['SPLIT', 'PARSED', 'TEXT_ONLY'] = ['SPLIT', 'PARSED', 'TEXT_ONLY'];

@Component({
  selector: 'dialog-fullscreen-markdown',
  templateUrl: './dialog-fullscreen-markdown.component.html',
  styleUrls: ['./dialog-fullscreen-markdown.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MarkdownComponent,
    MatButtonToggleGroup,
    MatButtonToggle,
    MatTooltip,
    MatIcon,
    MatButton,
    MatIconButton,
    TranslatePipe,
  ],
})
export class DialogFullscreenMarkdownComponent {
  private readonly _destroyRef = inject(DestroyRef);
  _matDialogRef = inject<MatDialogRef<DialogFullscreenMarkdownComponent>>(MatDialogRef);
  data: { content: string } = inject(MAT_DIALOG_DATA) || { content: '' };

  T: typeof T = T;
  viewMode: ViewMode = isSmallScreen() ? 'TEXT_ONLY' : 'SPLIT';
  readonly previewEl = viewChild<MarkdownComponent>('previewEl');
  readonly textareaEl = viewChild<ElementRef>('textareaEl');
  readonly contentChanged = output<string>();
  private readonly _contentChanges$ = new Subject<string>();

  constructor() {
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

    // Auto-save with debounce
    this._contentChanges$
      .pipe(debounceTime(500), takeUntilDestroyed(this._destroyRef))
      .subscribe((value) => {
        this.contentChanged.emit(value);
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

  keydownHandler(ev: KeyboardEvent): void {
    if (ev.key === 'Enter' && ev.ctrlKey) {
      this.close();
    }
  }

  ngModelChange(content: string): void {
    this._contentChanges$.next(content);
  }

  close(): void {
    this._matDialogRef.close(this.data?.content);
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
