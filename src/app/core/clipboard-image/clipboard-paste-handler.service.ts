import { Injectable, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { ClipboardImageService } from './clipboard-image.service';
import { TaskAttachmentService } from '../../features/tasks/task-attachment/task-attachment.service';
import { clipboardHasText } from '../../util/clipboard-has-text';
import { T } from '../../t.const';

// Paste context interface
export interface PasteContext {
  currentPlaceholder: {
    get(): string | null;
    set(val: string | null): void;
  };
  getContent(): string;
  setContent(content: string): void;
  getTextarea(): HTMLTextAreaElement | null;
  getTaskId(): string | null;
  onPasteComplete?(content: string): void;
}

@Injectable({
  providedIn: 'root',
})
export class ClipboardPasteHandlerService {
  private _clipboardImageService = inject(ClipboardImageService);
  private _taskAttachmentService = inject(TaskAttachmentService);
  private _translateService = inject(TranslateService);

  async handlePaste(ev: ClipboardEvent, context: PasteContext): Promise<boolean> {
    if (!ev.clipboardData) return false;

    // Prioritize text over images (e.g. OneNote copies both); let the default
    // text paste behavior handle it instead of saving an image.
    if (clipboardHasText(ev.clipboardData)) {
      return false;
    }

    const progress = this._clipboardImageService.handlePasteWithProgress(ev);
    if (!progress) return false;

    ev.preventDefault();

    // Clean up old placeholder if exists
    if (context.currentPlaceholder.get()) {
      const cleaned = context.getContent().replace(context.currentPlaceholder.get()!, '');
      context.setContent(cleaned);
    }

    const textarea = context.getTextarea();
    if (!textarea) return false;

    const { value, selectionStart, selectionEnd } = textarea;

    // Track and insert placeholder
    context.currentPlaceholder.set(progress.placeholderText);
    const newContent =
      value.substring(0, selectionStart) +
      progress.placeholderText +
      value.substring(selectionEnd);
    context.setContent(newContent);

    // Wait for result
    const result = await progress.resultPromise;

    // Only update if still current operation
    if (context.currentPlaceholder.get() === progress.placeholderText) {
      if (result.success && result.markdownText) {
        // Replace placeholder
        const finalContent = context
          .getContent()
          .replace(progress.placeholderText, result.markdownText);
        context.setContent(finalContent);

        // Add attachment if taskId provided
        const taskId = context.getTaskId();
        if (taskId && result.imageUrl) {
          this._taskAttachmentService.addAttachment(taskId, {
            id: null,
            type: 'IMG',
            path: result.imageUrl,
            title: this._translateService.instant(
              T.F.TASK.ADDITIONAL_INFO.PASTED_IMAGE_TITLE,
            ),
          });
        }

        // Move cursor
        const newCursorPos = selectionStart + result.markdownText.length;
        setTimeout(() => {
          textarea.focus();
          textarea.setSelectionRange(newCursorPos, newCursorPos);
          context.onPasteComplete?.(finalContent);
        });
      } else {
        // Remove placeholder on failure
        const cleaned = context.getContent().replace(progress.placeholderText, '');
        context.setContent(cleaned);
      }

      context.currentPlaceholder.set(null);
    }

    return true;
  }
}
