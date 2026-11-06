import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { DraftTaskImage } from './add-task-bar-images.service';

@Component({
  selector: 'dialog-draft-image',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconButton, MatIcon, TranslatePipe],
  // eslint-disable-next-line @typescript-eslint/naming-convention
  host: { '(document:keydown)': 'onKeydown($event)' },
  template: `
    <div class="controls">
      <span>{{ data.images[index()].title }}</span>
      <button
        mat-icon-button
        (click)="dialog.close()"
        [attr.aria-label]="T.G.CLOSE | translate"
      >
        <mat-icon>close</mat-icon>
      </button>
    </div>
    <img
      [src]="data.images[index()].preview"
      [alt]="data.images[index()].title"
    />
    @if (data.images.length > 1) {
      <div class="controls navigation">
        <button
          mat-icon-button
          (click)="move(-1)"
          [attr.aria-label]="T.G.MOVE_BACKWARD | translate"
        >
          <mat-icon>chevron_left</mat-icon>
        </button>
        <span>{{ index() + 1 }} / {{ data.images.length }}</span>
        <button
          mat-icon-button
          (click)="move(1)"
          [attr.aria-label]="T.G.NEXT | translate"
        >
          <mat-icon>chevron_right</mat-icon>
        </button>
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
      padding: var(--s);
    }
    img {
      display: block;
      width: 100%;
      height: min(65vh, 460px);
      object-fit: contain;
    }
    .controls {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--s);
    }
    .controls span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .navigation {
      justify-content: center;
    }
  `,
})
export class DialogDraftImageComponent {
  readonly data = inject<{ images: DraftTaskImage[]; index: number }>(MAT_DIALOG_DATA);
  readonly dialog = inject(MatDialogRef<DialogDraftImageComponent>);
  readonly index = signal(this.data.index);
  readonly T = T;

  move(direction: number): void {
    this.index.update(
      (index) => (index + direction + this.data.images.length) % this.data.images.length,
    );
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      event.stopPropagation();
      this.move(event.key === 'ArrowLeft' ? -1 : 1);
    }
  }
}
