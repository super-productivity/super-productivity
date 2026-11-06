import { computed, inject, Injectable, signal } from '@angular/core';
import { nanoid } from 'nanoid';
import { ClipboardImageService } from '../../../core/clipboard-image/clipboard-image.service';
import { SnackService } from '../../../core/snack/snack.service';
import { T } from '../../../t.const';
import { TaskAttachment } from '../task-attachment/task-attachment.model';
import { clipboardHasText } from '../../../util/clipboard-has-text';

export interface DraftTaskImage {
  id: string;
  title: string;
  path?: string;
  preview?: string;
  isLoading: boolean;
}

/** Shared in memory so closing the desktop popup preserves its image draft. */
@Injectable({ providedIn: 'root' })
export class AddTaskBarImagesService {
  private readonly _clipboard = inject(ClipboardImageService);
  private readonly _snack = inject(SnackService);
  private readonly _images = signal<DraftTaskImage[]>([]);
  readonly images = this._images.asReadonly();
  readonly isLoading = computed(() => this.images().some((image) => image.isLoading));

  paste(event: ClipboardEvent): boolean {
    const data = event.clipboardData;
    // Preserve text paste from apps that put both text and a screenshot on the clipboard.
    if (!data || clipboardHasText(data)) return false;
    const files = Array.from(data.files).filter((file) => file.type.startsWith('image/'));
    if (!files.length) {
      for (const item of Array.from(data.items)) {
        if (!item.type.startsWith('image/')) continue;
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (!files.length) return false;
    event.preventDefault();
    for (const file of files) {
      const image: DraftTaskImage = {
        id: nanoid(),
        title: file.name,
        isLoading: true,
      };
      this._images.update((images) => [...images, image]);
      void this._save(file, image.id);
    }
    return true;
  }

  remove(id: string): void {
    this._images.update((images) => images.filter((image) => image.id !== id));
  }

  clear(): void {
    this._images.set([]);
  }

  attachments(): TaskAttachment[] {
    return this.images().flatMap((image) =>
      image.path
        ? [{ id: image.id, type: 'IMG' as const, path: image.path, title: image.title }]
        : [],
    );
  }

  private async _save(file: File, id: string): Promise<void> {
    try {
      const path = await this._clipboard.saveImage(file);
      if (!path) {
        this.remove(id);
        return;
      }
      const preview = await this._clipboard.resolveClipboardImageUrl(path);
      if (!preview) throw new Error('Image preview unavailable');
      this._images.update((images) =>
        images.map((image) =>
          image.id === id ? { ...image, path, preview, isLoading: false } : image,
        ),
      );
    } catch {
      this.remove(id);
      this._snack.open({ type: 'ERROR', msg: T.F.CLIPBOARD_IMAGE.PASTE_ERROR });
    }
  }
}
