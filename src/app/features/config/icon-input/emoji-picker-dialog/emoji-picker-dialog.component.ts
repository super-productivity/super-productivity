import { Component, inject, Inject } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { PickerComponent } from '@ctrl/ngx-emoji-mart';
import { EmojiData } from '@ctrl/ngx-emoji-mart/ngx-emoji';
import '@ctrl/ngx-emoji-mart/picker';

@Component({
  selector: 'app-emoji-picker-dialog',
  standalone: true,
  imports: [PickerComponent],
  template: `
    <emoji-mart
      [showSkinTones]="true"
      [showPreview]="true"
      [emojiSize]="24"
      [emojiTooltip]="true"
      [perLine]="9"
      [i18n]="{
        search: 'Search emojis...',
        notfound: 'No emojis found',
        categories: {
          recent: 'Recent',
          smileys: 'Smileys & Emotion',
          people: 'People & Body',
          animals: 'Animals & Nature',
          food: 'Food & Drink',
          activities: 'Activities',
          travel: 'Travel & Places',
          objects: 'Objects & Symbols',
          flags: 'Flags',
        },
      }"
      [title]="title"
      (emojiSelect)="onEmojiSelect($event)"
    />
  `,
  styles: [
    `
      :host {
        display: block;
      }
      emoji-mart {
        width: 100%;
        height: 400px;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
      }
    `,
  ],
})
export class EmojiPickerDialogComponent {
  private dialogRef = inject(MatDialogRef<EmojiPickerDialogComponent>);

  constructor(@Inject(MAT_DIALOG_DATA) public data: { selectedEmoji?: string }) {}

  onEmojiSelect(event: { emoji: EmojiData }): void {
    this.dialogRef.close(event.emoji.native);
  }
}
