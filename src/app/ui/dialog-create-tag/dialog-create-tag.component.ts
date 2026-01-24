import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
} from '@angular/material/dialog';
import { T } from '../../t.const';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { DEFAULT_TAG_COLOR } from '../../features/work-context/work-context.const';
import { MatAutocomplete, MatAutocompleteTrigger } from '@angular/material/autocomplete';
import { MatOption } from '@angular/material/core';
import { MaterialIconsLoaderService } from '../material-icons-loader.service';

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
  ],
})
export class DialogCreateTagComponent {
  private _matDialogRef = inject<MatDialogRef<DialogCreateTagComponent>>(MatDialogRef);
  private _iconLoader = inject(MaterialIconsLoaderService);
  data = inject(MAT_DIALOG_DATA);

  T: typeof T = T;
  title: string = '';
  icon: string | null = null;
  color: string = DEFAULT_TAG_COLOR;
  filteredIcons = signal<string[]>([]);

  // Get reference to autocomplete trigger for explicit cleanup
  private _iconAutoTrigger = viewChild(MatAutocompleteTrigger);

  async onIconFocus(): Promise<void> {
    if (this.filteredIcons().length === 0) {
      try {
        const icons = await this._iconLoader.loadIcons();
        this.filteredIcons.set(icons.slice(0, 50));
      } catch (error) {
        console.error('Failed to load material icons:', error);
        this.filteredIcons.set([]);
      }
    }
  }

  async onIconInput(val: string): Promise<void> {
    try {
      const icons = await this._iconLoader.loadIcons();
      const filtered = icons.filter((ico) =>
        ico.toLowerCase().includes(val.toLowerCase()),
      );
      filtered.length = Math.min(50, filtered.length);
      this.filteredIcons.set(filtered);
    } catch (error) {
      console.error('Failed to filter icons:', error);
      this.filteredIcons.set([]);
    }
  }

  close(isSave: boolean): void {
    // Explicitly close autocomplete overlay before closing dialog
    // to prevent CDK backdrop from being left behind
    this._iconAutoTrigger()?.closePanel();

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
