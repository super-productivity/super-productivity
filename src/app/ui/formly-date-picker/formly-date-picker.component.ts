import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FieldType } from '@ngx-formly/material';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { ReactiveFormsModule } from '@angular/forms';
import { DatePickerInputComponent } from '../date-picker-input/date-picker-input.component';

@Component({
  selector: 'formly-date-picker',
  standalone: true,
  imports: [FormlyModule, DatePickerInputComponent, ReactiveFormsModule],
  template: `
    <date-picker-input
      [formControl]="formControl"
      [label]="props.label || ''"
      [required]="props.required || false"
      [min]="props.min"
      [max]="props.max"
      [errorMessage]="props.errorMessages?.required"
      [isInvalid]="showError"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormlyDatePickerComponent extends FieldType<FormlyFieldConfig> {}
