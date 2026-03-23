import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FieldType } from '@ngx-formly/material';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { ReactiveFormsModule } from '@angular/forms';
import {
  DATE_PICKER_MAX_DEFAULT,
  DATE_PICKER_MIN_DEFAULT,
  DatePickerInputComponent,
} from '../date-picker-input/date-picker-input.component';

@Component({
  selector: 'formly-date-picker',
  standalone: true,
  imports: [FormlyModule, DatePickerInputComponent, ReactiveFormsModule],
  template: `
    <date-picker-input
      [formControl]="formControl"
      [label]="props.label || ''"
      [required]="props.required || false"
      [min]="props.min ?? DATE_PICKER_MIN_DEFAULT"
      [max]="props.max ?? DATE_PICKER_MAX_DEFAULT"
      [errorMessage]="props.errorMessages?.required"
      [isInvalid]="showError"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormlyDatePickerComponent extends FieldType<FormlyFieldConfig> {
  readonly DATE_PICKER_MIN_DEFAULT = DATE_PICKER_MIN_DEFAULT;
  readonly DATE_PICKER_MAX_DEFAULT = DATE_PICKER_MAX_DEFAULT;
}
