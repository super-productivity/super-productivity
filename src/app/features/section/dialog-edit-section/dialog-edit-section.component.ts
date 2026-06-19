import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
} from '@angular/material/dialog';
import { FormsModule } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatRadioButton, MatRadioChange, MatRadioGroup } from '@angular/material/radio';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { T } from '../../../t.const';
import { Section } from '../section.model';
import { Tag } from '../../tag/tag.model';
import { selectAllTagsWithoutMyDay } from '../../tag/store/tag.reducer';
import { ChipListInputComponent } from '../../../ui/chip-list-input/chip-list-input.component';

export interface EditSectionDialogData {
  section?: Section;
}

export interface EditSectionDialogResult {
  title: string;
  tagFilterIds: string[];
  tagFilterMode: 'OR' | 'AND';
}

@Component({
  selector: 'dialog-edit-section',
  templateUrl: './dialog-edit-section.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ChipListInputComponent,
    FormsModule,
    MatButton,
    MatDialogActions,
    MatDialogContent,
    MatFormField,
    MatIcon,
    MatInput,
    MatLabel,
    MatRadioButton,
    MatRadioGroup,
    TranslatePipe,
  ],
})
export class DialogEditSectionComponent {
  private _matDialogRef = inject<MatDialogRef<DialogEditSectionComponent>>(MatDialogRef);
  data = inject<EditSectionDialogData>(MAT_DIALOG_DATA);
  private _store = inject(Store);

  T: typeof T = T;

  title: string = this.data.section?.title ?? '';
  tagFilterIds = signal<string[]>([...(this.data.section?.tagFilterIds ?? [])]);
  tagFilterMode = signal<'OR' | 'AND'>(this.data.section?.tagFilterMode ?? 'OR');

  allTags = toSignal(this._store.select(selectAllTagsWithoutMyDay), {
    initialValue: [] as Tag[],
  });

  showFilterMode = computed(() => this.tagFilterIds().length >= 2);

  addTag(tagId: string): void {
    this.tagFilterIds.update((ids) => [...ids, tagId]);
  }

  removeTag(tagId: string): void {
    this.tagFilterIds.update((ids) => ids.filter((id) => id !== tagId));
  }

  onFilterModeChange(event: MatRadioChange): void {
    this.tagFilterMode.set(event.value as 'OR' | 'AND');
  }

  close(isSave: boolean): void {
    if (isSave && this.title.trim()) {
      this._matDialogRef.close({
        title: this.title,
        tagFilterIds: this.tagFilterIds(),
        tagFilterMode: this.tagFilterMode(),
      } satisfies EditSectionDialogResult);
    } else {
      this._matDialogRef.close(undefined);
    }
  }
}
