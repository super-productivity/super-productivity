import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { T } from '../../../../t.const';
import {
  ClipboardImageService,
  ClipboardImageMetadata,
} from '../../../../core/clipboard-image/clipboard-image.service';
import { SnackService } from '../../../../core/snack/snack.service';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { DatePipe } from '@angular/common';
import { MatTooltip } from '@angular/material/tooltip';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatSelect } from '@angular/material/select';
import { MatOption } from '@angular/material/core';

type SortOrder = 'newest' | 'oldest' | 'largest' | 'smallest';

@Component({
  selector: 'dialog-clipboard-images-manager',
  templateUrl: './dialog-clipboard-images-manager.component.html',
  styleUrls: ['./dialog-clipboard-images-manager.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogModule,
    MatButton,
    MatIcon,
    TranslatePipe,
    MatProgressSpinner,
    DatePipe,
    MatTooltip,
    MatFormField,
    MatLabel,
    MatSelect,
    MatOption,
  ],
})
export class DialogClipboardImagesManagerComponent implements OnInit {
  private readonly _matDialogRef = inject(
    MatDialogRef<DialogClipboardImagesManagerComponent>,
  );
  private readonly _clipboardImageService = inject(ClipboardImageService);
  private readonly _snackService = inject(SnackService);
  private readonly _translateService = inject(TranslateService);

  readonly T = T;
  readonly images = signal<ClipboardImageMetadata[]>([]);
  readonly isLoading = signal(true);
  readonly imageUrls = signal<Map<string, string>>(new Map());
  readonly sortOrder = signal<SortOrder>('newest');

  readonly sortedImages = computed(() => {
    const images = this.images();
    const order = this.sortOrder();

    if (images.length === 0) return images;

    return [...images].sort((a, b) => {
      switch (order) {
        case 'newest':
          return b.createdAt - a.createdAt;
        case 'oldest':
          return a.createdAt - b.createdAt;
        case 'largest':
          return b.size - a.size;
        case 'smallest':
          return a.size - b.size;
      }
    });
  });

  async ngOnInit(): Promise<void> {
    await this.loadImages();
  }

  async loadImages(): Promise<void> {
    this.isLoading.set(true);
    try {
      const images = await this._clipboardImageService.listImages();
      this.images.set(images);

      // Load image URLs for preview
      const urlMap = new Map<string, string>();
      for (const image of images) {
        const url = await this._clipboardImageService.resolveIndexedDbUrl(
          this._clipboardImageService.getImageUrl(image.id),
        );
        if (url) {
          urlMap.set(image.id, url);
        }
      }
      this.imageUrls.set(urlMap);
    } catch (error) {
      console.error('Error loading clipboard images:', error);
      this._snackService.open({
        type: 'ERROR',
        msg: this._translateService.instant(T.GCF.CLIPBOARD_IMAGES.ERROR_LOADING),
      });
    } finally {
      this.isLoading.set(false);
    }
  }

  async deleteImage(image: ClipboardImageMetadata): Promise<void> {
    try {
      const success = await this._clipboardImageService.deleteImage(image.id);
      if (success) {
        // Update local state instead of reloading all images
        this.images.update((images) => images.filter((img) => img.id !== image.id));
        this._snackService.open({
          type: 'SUCCESS',
          msg: this._translateService.instant(T.GCF.CLIPBOARD_IMAGES.DELETE_SUCCESS),
        });
      } else {
        throw new Error('Delete operation returned false');
      }
    } catch (error) {
      console.error('Error deleting clipboard image:', error);
      this._snackService.open({
        type: 'ERROR',
        msg: this._translateService.instant(T.GCF.CLIPBOARD_IMAGES.ERROR_DELETING),
      });
    }
  }

  async deleteAll(): Promise<void> {
    const images = this.images();
    if (images.length === 0) return;

    try {
      const results = await Promise.allSettled(
        images.map((image) => this._clipboardImageService.deleteImage(image.id)),
      );

      const failedCount = results.filter((r) => r.status === 'rejected').length;

      if (failedCount === 0) {
        this.images.set([]);
        this.imageUrls.set(new Map());
        this._snackService.open({
          type: 'SUCCESS',
          msg: this._translateService.instant(T.GCF.CLIPBOARD_IMAGES.DELETE_ALL_SUCCESS),
        });
      } else {
        // Reload to see which images remain
        await this.loadImages();
        this._snackService.open({
          type: 'ERROR',
          msg: this._translateService.instant(T.GCF.CLIPBOARD_IMAGES.ERROR_DELETING_ALL),
        });
      }
    } catch (error) {
      console.error('Error deleting all clipboard images:', error);
      await this.loadImages();
      this._snackService.open({
        type: 'ERROR',
        msg: this._translateService.instant(T.GCF.CLIPBOARD_IMAGES.ERROR_DELETING_ALL),
      });
    }
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  getTotalSize(): string {
    const total = this.images().reduce((sum, img) => sum + img.size, 0);
    return this.formatSize(total);
  }

  onSortChange(order: SortOrder): void {
    this.sortOrder.set(order);
  }

  close(): void {
    this._matDialogRef.close();
  }
}
