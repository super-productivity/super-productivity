import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
} from '@angular/material/dialog';
import { T } from '../../t.const';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput, MatSuffix } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { DEFAULT_TAG_COLOR } from '../../features/work-context/work-context.const';
import { MatAutocomplete, MatAutocompleteTrigger } from '@angular/material/autocomplete';
import { MatOption } from '@angular/material/core';
import { MATERIAL_ICONS } from '../material-icons.const';
import { MatTooltip } from '@angular/material/tooltip';
import { containsEmoji, extractFirstEmoji } from '../../util/extract-first-emoji';
import { isSingleEmoji } from '../../util/extract-first-emoji';
import { MatDialog } from '@angular/material/dialog';
import { EmojiPickerDialogComponent } from '../../features/config/icon-input/emoji-picker-dialog/emoji-picker-dialog.component';
import '@ctrl/ngx-emoji-mart/picker';

export interface CreateTagData {
  title?: string;
  icon?: string | null;
  color?: string;
}

@Component({
  selector: 'dialog-create-tag',
  templateUrl: './dialog-create-tag.component.html',
  styleUrls: ['./dialog-create-tag.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogContent,
    MatFormField,
    MatLabel,
    MatInput,
    FormsModule,
    MatDialogActions,
    MatButton,
    MatIcon,
    TranslatePipe,
    MatAutocomplete,
    MatAutocompleteTrigger,
    MatOption,
    MatSuffix,
    MatTooltip,
    EmojiPickerDialogComponent,
  ],
})
export class DialogCreateTagComponent {
  private _matDialogRef = inject<MatDialogRef<DialogCreateTagComponent>>(MatDialogRef);
  data = inject(MAT_DIALOG_DATA);
  private _dialog = inject(MatDialog);

  T: typeof T = T;
  title: string = '';
  icon: string | null = null;
  color: string = DEFAULT_TAG_COLOR;
  filteredIcons = signal<string[]>([]);
  isEmoji = signal(false);

  onIconFocus(): void {
    if (this.filteredIcons().length === 0) {
      this.filteredIcons.set(MATERIAL_ICONS.slice(0, 50));
    }
  }

  onIconInput(val: string): void {
    const filtered = MATERIAL_ICONS.filter((ico) =>
      ico.toLowerCase().includes(val.toLowerCase()),
    );
    filtered.length = Math.min(50, filtered.length);
    this.filteredIcons.set(filtered);

    const hasEmoji = containsEmoji(val);

    if (hasEmoji) {
      const firstEmoji = extractFirstEmoji(val);

      if (firstEmoji) {
        this.icon = firstEmoji;
        this.isEmoji.set(true);
      } else {
        this.icon = '';
        this.isEmoji.set(false);
      }
    } else if (!val) {
      this.icon = '';
      this.isEmoji.set(false);
    } else {
      this.isEmoji.set(false);
    }
  }

  onIconSelect(icon: string): void {
    this.icon = icon;
    const emojiCheck = isSingleEmoji(icon);
    this.isEmoji.set(emojiCheck && !this.filteredIcons().includes(icon));
  }

  openEmojiPicker(): void {
    const dialogRef = this._dialog.open(EmojiPickerDialogComponent, {
      width: '350px',
      data: { selectedEmoji: this.icon },
    });

    dialogRef.afterClosed().subscribe((selectedEmoji: string | undefined) => {
      if (selectedEmoji) {
        this.icon = selectedEmoji;
        this.isEmoji.set(true);
      }
    });
  }

  onPaste(event: ClipboardEvent): void {
    event.preventDefault();

    const pastedText = event.clipboardData?.getData('text') || '';

    if (pastedText) {
      const firstEmoji = extractFirstEmoji(pastedText);

      if (firstEmoji && isSingleEmoji(firstEmoji)) {
        this.icon = firstEmoji;
        this.isEmoji.set(true);
      }
    }
  }

  close(isSave: boolean): void {
    if (isSave && this.title.trim()) {
      this._matDialogRef.close({
        title: this.title.trim(),
        icon: this.icon || null,
        color: this.color,
      } as CreateTagData);
    } else {
      this._matDialogRef.close(undefined);
    }
  }
}
