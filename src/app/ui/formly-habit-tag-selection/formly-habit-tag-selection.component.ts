import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { FieldType } from '@ngx-formly/material';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { TagService } from '../../features/tag/tag.service';

@Component({
  selector: 'formly-habit-tag-selection',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    FormlyModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatSelectModule,
  ],
  template: `
    <mat-form-field class="full-width">
      <mat-label>{{ field.props?.label }}</mat-label>
      <mat-select
        [formControl]="formControl"
        [formlyAttributes]="field"
        multiple
      >
        @for (tag of tags(); track tag.id) {
          <mat-option [value]="tag.id">
            {{ tag.title }}
          </mat-option>
        }
      </mat-select>
      @if (field.props?.description) {
        <mat-hint>{{ field.props.description }}</mat-hint>
      }
    </mat-form-field>
  `,
  styles: [
    `
      .full-width {
        width: 100%;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormlyHabitTagSelectionComponent extends FieldType<FormlyFieldConfig> {
  private _tagService = inject(TagService);

  tags = this._tagService.tags;
}
