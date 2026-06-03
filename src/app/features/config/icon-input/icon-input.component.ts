import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { FieldType } from '@ngx-formly/material';
import { MaterialIconsLoaderService } from '../../../ui/material-icons-loader.service';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { MatIcon } from '@angular/material/icon';
import { MatInput, MatSuffix } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import { MatAutocomplete, MatAutocompleteTrigger } from '@angular/material/autocomplete';
import { MatOption } from '@angular/material/core';
import { IS_ELECTRON } from '../../../app.constants';
import { MatTooltip } from '@angular/material/tooltip';
import { containsEmoji, extractFirstEmoji } from '../../../util/extract-first-emoji';
import { isSingleEmoji } from '../../../util/extract-first-emoji';
import { startWith } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'icon-input',
  templateUrl: './icon-input.component.html',
  styleUrls: ['./icon-input.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatIcon,
    MatInput,
    FormsModule,
    MatAutocompleteTrigger,
    FormlyModule,
    MatAutocomplete,
    MatOption,
    MatSuffix,
    MatTooltip,
  ],
})
export class IconInputComponent extends FieldType<FormlyFieldConfig> implements OnInit {
  filteredIcons = signal<string[]>([]);
  isEmoji = signal(false);
  private readonly _destroyRef = inject(DestroyRef);
  private _iconLoader = inject(MaterialIconsLoaderService);
  // Guards against duplicate processing when Windows emoji picker triggers multiple events
  private _lastSetValue: string | null = null;

  protected readonly IS_ELECTRON = IS_ELECTRON;
  isLinux = IS_ELECTRON && window.ea.isLinux();

  get type(): string {
    return this.to.type || 'text';
  }

  ngOnInit(): void {
    this.formControl.valueChanges
      .pipe(startWith(this.formControl.value), takeUntilDestroyed(this._destroyRef))
      .subscribe((val: string | null) => {
        this.isEmoji.set(containsEmoji(val || ''));
      });
  }

  trackByIndex(i: number, p: any): number {
    return i;
  }

  async onFocus(): Promise<void> {
    // Show initial icons when field is focused and no filter applied yet
    if (this.filteredIcons().length === 0) {
      const currentValue = this.formControl.value || '';

      try {
        if (currentValue) {
          // If there's a current value, filter by it
          await this.onInputValueChange(currentValue);
        } else {
          // Show first 50 icons when empty
          const icons = await this._iconLoader.loadIcons();
          this.filteredIcons.set(icons.slice(0, 50));
        }
      } catch (error) {
        console.error('Failed to load material icons:', error);
        this.filteredIcons.set([]);
      }
    }
  }

  async onInputValueChange(val: string): Promise<void> {
    // Skip if this is the value we just set programmatically (prevents double processing)
    if (val === this._lastSetValue) {
      this._lastSetValue = null;
      return;
    }

    try {
      const icons = await this._iconLoader.loadIcons();
      const arr = icons.filter(
        (icoStr) => icoStr && icoStr.toLowerCase().includes(val.toLowerCase()),
      );
      arr.length = Math.min(150, arr.length);
      this.filteredIcons.set(arr);

      const hasEmoji = containsEmoji(val);

      if (hasEmoji) {
        const firstEmoji = extractFirstEmoji(val);

        if (firstEmoji) {
          this._lastSetValue = firstEmoji;
          this.formControl.setValue(firstEmoji);
          this.isEmoji.set(true);
        } else {
          this._lastSetValue = '';
          this.formControl.setValue('');
          this.isEmoji.set(false);
        }
      } else if (!val) {
        this._lastSetValue = '';
        this.formControl.setValue('');
        this.isEmoji.set(false);
      } else {
        this.isEmoji.set(false);
      }
    } catch (error) {
      console.error('Failed to filter icons:', error);
      this.filteredIcons.set([]);
    }
  }

  onIconSelect(icon: string): void {
    this._lastSetValue = icon;
    this.formControl.setValue(icon);
    const emojiCheck = isSingleEmoji(icon);
    this.isEmoji.set(emojiCheck && !this.filteredIcons().includes(icon));
  }

  openEmojiPicker(): void {
    if (IS_ELECTRON) {
      window.ea.showEmojiPanel();
    }
  }

  onPaste(event: ClipboardEvent): void {
    event.preventDefault();

    const pastedText = event.clipboardData?.getData('text') || '';

    if (pastedText) {
      const firstEmoji = extractFirstEmoji(pastedText);

      if (firstEmoji && isSingleEmoji(firstEmoji)) {
        this._lastSetValue = firstEmoji;
        this.formControl.setValue(firstEmoji);
        this.isEmoji.set(true);
      }
    }
  }

  // onKeyDown(ev: KeyboardEvent): void {
  //   if (ev.key === 'Enter') {
  //     const ico = (ev as any)?.target?.value;
  //     if (this.filteredIcons.includes(ico)) {
  //       this.onIconSelect(ico);
  //     }
  //   }
  // }
}
