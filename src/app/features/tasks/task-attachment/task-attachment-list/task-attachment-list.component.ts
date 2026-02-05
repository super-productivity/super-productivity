import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  computed,
  effect,
  signal,
} from '@angular/core';
import { TaskAttachment } from '../task-attachment.model';
import { TaskAttachmentService } from '../task-attachment.service';
import { MatDialog } from '@angular/material/dialog';
import { DialogEditTaskAttachmentComponent } from '../dialog-edit-attachment/dialog-edit-task-attachment.component';
import { standardListAnimation } from '../../../../ui/animations/standard-list.ani';
import { T } from '../../../../t.const';
import { SnackService } from 'src/app/core/snack/snack.service';
import { TaskAttachmentLinkDirective } from '../task-attachment-link/task-attachment-link.directive';
import { MatIcon } from '@angular/material/icon';
import { EnlargeImgDirective } from '../../../../ui/enlarge-img/enlarge-img.directive';
import { MatAnchor, MatButton } from '@angular/material/button';
import { ClipboardImageService } from '../../../../core/clipboard-image/clipboard-image.service';

interface ResolvedAttachment extends TaskAttachment {
  resolvedPath?: string;
  resolvedOriginalPath?: string;
  isLoading?: boolean;
}

@Component({
  selector: 'task-attachment-list',
  templateUrl: './task-attachment-list.component.html',
  styleUrls: ['./task-attachment-list.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [standardListAnimation],
  imports: [
    TaskAttachmentLinkDirective,
    MatIcon,
    EnlargeImgDirective,
    MatAnchor,
    MatButton,
  ],
})
export class TaskAttachmentListComponent {
  readonly attachmentService = inject(TaskAttachmentService);
  private readonly _matDialog = inject(MatDialog);
  private readonly _snackService = inject(SnackService);
  private readonly _clipboardImageService = inject(ClipboardImageService);

  readonly taskId = input<string>();
  readonly attachments = input<TaskAttachment[]>();
  readonly isDisableControls = input<boolean>(false);

  private readonly _resolvedUrlsMap = signal<Map<string, string>>(new Map());
  private readonly _loadingUrls = signal<Set<string>>(new Set());

  readonly resolvedAttachments = computed(() => {
    const attachments = this.attachments();
    const urlMap = this._resolvedUrlsMap();
    const loadingUrls = this._loadingUrls();

    if (!attachments) return [];

    return attachments.map((att) => {
      const resolvedPath = att.path?.startsWith('indexeddb://clipboard-images/')
        ? urlMap.get(att.path) || att.path
        : att.path;

      const imgPath = att.originalImgPath || att.path;
      const resolvedOriginalPath = imgPath?.startsWith('indexeddb://clipboard-images/')
        ? urlMap.get(imgPath) || imgPath
        : imgPath;

      const isLoading =
        att.path?.startsWith('indexeddb://clipboard-images/') &&
        !urlMap.has(att.path) &&
        loadingUrls.has(att.path);

      return {
        ...att,
        resolvedPath,
        resolvedOriginalPath,
        isLoading,
      } as ResolvedAttachment;
    });
  });

  T: typeof T = T;
  isError: boolean[] = [];

  constructor() {
    // Effect to resolve URLs asynchronously when attachments change
    effect(() => {
      const attachments = this.attachments();
      if (!attachments) return;

      attachments.forEach(async (att) => {
        try {
          const urlsToResolve: string[] = [];

          if (att.path?.startsWith('indexeddb://clipboard-images/')) {
            urlsToResolve.push(att.path);
          }

          const imgPath = att.originalImgPath || att.path;
          if (
            imgPath?.startsWith('indexeddb://clipboard-images/') &&
            imgPath !== att.path
          ) {
            urlsToResolve.push(imgPath);
          }

          for (const url of urlsToResolve) {
            // Mark as loading
            this._loadingUrls.update((set) => {
              const newSet = new Set(set);
              newSet.add(url);
              return newSet;
            });

            const resolved = await this._clipboardImageService.resolveIndexedDbUrl(url);
            if (resolved) {
              this._resolvedUrlsMap.update((map) => {
                const newMap = new Map(map);
                newMap.set(url, resolved);
                return newMap;
              });
            }

            // Remove from loading
            this._loadingUrls.update((set) => {
              const newSet = new Set(set);
              newSet.delete(url);
              return newSet;
            });
          }
        } catch (error) {
          console.error('Error resolving clipboard image:', error);
        }
      });
    });
  }

  openEditDialog(attachment?: TaskAttachment): void {
    if (!this.taskId()) {
      throw new Error('No task id given');
    }

    this._matDialog
      .open(DialogEditTaskAttachmentComponent, {
        restoreFocus: true,
        data: {
          attachment,
        },
      })
      .afterClosed()
      .subscribe((attachmentIN) => {
        const taskId = this.taskId();
        if (!taskId) {
          throw new Error('No taskId');
        }
        if (attachmentIN) {
          if (attachmentIN.id) {
            this.attachmentService.updateAttachment(
              taskId,
              attachmentIN.id,
              attachmentIN,
            );
          } else {
            this.attachmentService.addAttachment(taskId, attachmentIN);
          }
        }
      });
  }

  async copy(attachment?: TaskAttachment): Promise<void> {
    if (!attachment || !attachment.path) return;

    try {
      // Try modern clipboard API first (works in most browsers with user gesture)
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(attachment.path);
        this._snackService.open(T.GLOBAL_SNACK.COPY_TO_CLIPPBOARD);
      } else {
        // Fallback for older browsers or when clipboard API is not available
        this._copyWithFallback(attachment.path);
      }
    } catch (error) {
      console.warn('Clipboard write failed, trying fallback method:', error);
      // Try fallback method if modern API fails
      this._copyWithFallback(attachment.path);
    }
  }

  private _copyWithFallback(text: string): void {
    // Create a temporary textarea element
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';

    document.body.appendChild(textarea);
    textarea.select();

    try {
      const successful = document.execCommand('copy');
      if (successful) {
        this._snackService.open(T.GLOBAL_SNACK.COPY_TO_CLIPPBOARD);
      } else {
        this._snackService.open({
          msg: 'Failed to copy to clipboard. Please copy manually.',
          type: 'ERROR',
        });
      }
    } catch (error) {
      console.error('Fallback copy failed:', error);
      this._snackService.open({
        msg: 'Failed to copy to clipboard. Please copy manually.',
        type: 'ERROR',
      });
    } finally {
      document.body.removeChild(textarea);
    }
  }

  remove(id: string): void {
    const taskId = this.taskId();
    if (!taskId) {
      throw new Error('No taskId');
    }
    this.attachmentService.deleteAttachment(taskId, id);
  }

  trackByFn(i: number, attachment: TaskAttachment): string | number | null {
    return attachment ? attachment.id : i;
  }
}
