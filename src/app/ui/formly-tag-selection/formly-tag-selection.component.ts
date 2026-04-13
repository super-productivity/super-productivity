import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { FieldType } from '@ngx-formly/material';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { T } from 'src/app/t.const';
import { TagEditComponent } from '../../features/tag/tag-edit/tag-edit.component';

@Component({
  selector: 'formly-tag-selection',
  standalone: true,
  imports: [FormsModule, FormlyModule, ReactiveFormsModule, TagEditComponent],
  templateUrl: './formly-tag-selection.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormlyTagSelectionComponent extends FieldType<FormlyFieldConfig> {
  T: typeof T = T;
}
