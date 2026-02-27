import { Component, forwardRef, inject, input } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR, FormsModule } from '@angular/forms';
import {
  MatFormField,
  MatLabel,
  MatError,
  MatSuffix,
} from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import {
  MatDatepicker,
  MatDatepickerInput,
  MatDatepickerToggle,
} from '@angular/material/datepicker';
import { CommonModule } from '@angular/common';
import { DateTimeFormatService } from 'src/app/core/date-time-format/date-time-format.service';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from 'src/app/t.const';
import { getDbDateStr } from 'src/app/util/get-db-date-str';

type DateValue = Date | null;

@Component({
  selector: 'date-picker-input',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatFormField,
    MatLabel,
    MatInput,
    MatDatepickerInput,
    MatDatepickerToggle,
    MatSuffix,
    MatDatepicker,
    MatError,
    TranslatePipe,
  ],
  templateUrl: './date-picker-input.component.html',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => DatePickerInputComponent),
      multi: true,
    },
  ],
})
export class DatePickerInputComponent implements ControlValueAccessor {
  readonly T: typeof T = T;
  dateTimeFormatService = inject(DateTimeFormatService);

  label = input<string>('');
  min = input<Date | string>('1900-01-01');
  max = input<Date | string>('2999-12-31');

  required = input<boolean>(false);
  isInvalid = input<boolean | undefined>(undefined); // boolean - validation control by parent, undefined - internal validation
  errorMessage = input<string | undefined>(undefined); // instead of default error message

  innerValue: DateValue = null;

  toDate(value: Date | string): Date {
    return value instanceof Date ? value : new Date(value);
  }

  formatDate(value: Date | string): string {
    if (!value) return '';
    return getDbDateStr(this.toDate(value));
  }

  validateDate(value: Date): boolean {
    const minDate = this.toDate(this.min());
    const maxDate = this.toDate(this.max());
    return value >= minDate && value <= maxDate;
  }

  writeValue(value: unknown): void {
    if (!value || !(value instanceof Date)) this.innerValue = null;
    else this.innerValue = this.toDate(value);
  }

  onValueChange(value: DateValue): void {
    if (!value) {
      this.innerValue = null;
      this.onChange(null);
      this.onTouched();
      return;
    }

    if (!this.validateDate(value)) {
      this.innerValue = null;
      this.onChange(null);
    } else {
      this.innerValue = value;
      this.onChange(value);
    }
    this.onTouched();
  }

  private onChange: (value: DateValue) => void = () => {};

  private onTouched: () => void = () => {};

  registerOnChange(fn: (value: DateValue) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
}
