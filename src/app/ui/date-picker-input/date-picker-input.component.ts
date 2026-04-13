import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  forwardRef,
  inject,
  input,
  signal,
} from '@angular/core';
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
import { dateStrToUtcDate } from 'src/app/util/date-str-to-utc-date';

type DateValue = Date | null;

export const DATE_PICKER_MIN_DEFAULT = '1900-01-01';
export const DATE_PICKER_MAX_DEFAULT = '2999-12-31';

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
  changeDetection: ChangeDetectionStrategy.OnPush,
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
  min = input<Date | string | undefined>(DATE_PICKER_MIN_DEFAULT);
  max = input<Date | string | undefined>(DATE_PICKER_MAX_DEFAULT);

  required = input<boolean>(false);
  isInvalid = input<boolean | undefined>(undefined); // boolean - validation control by parent, undefined - internal validation
  errorMessage = input<string | undefined>(undefined); // instead of default error message

  innerValue = signal<DateValue>(null);
  private _cd = inject(ChangeDetectorRef);

  toDate(value: Date | string): Date {
    return value instanceof Date ? value : new Date(value);
  }

  formatDate(value: Date | string | undefined): string {
    if (!value) return '';
    return getDbDateStr(this.toDate(value));
  }

  validateDate(value: Date): boolean {
    const minVal = this.min();
    const maxVal = this.max();
    if (minVal != null) {
      const minDate = this.toDate(minVal);
      if (!isNaN(minDate.getTime()) && value < minDate) return false;
    }
    if (maxVal != null) {
      const maxDate = this.toDate(maxVal);
      if (!isNaN(maxDate.getTime()) && value > maxDate) return false;
    }
    return true;
  }

  writeValue(value: unknown): void {
    if (!value) {
      this.innerValue.set(null);
    } else if (value instanceof Date) {
      this.innerValue.set(value);
    } else if (typeof value === 'string') {
      const parsed = dateStrToUtcDate(value);
      this.innerValue.set(isNaN(parsed.getTime()) ? null : parsed);
    } else {
      this.innerValue.set(null);
    }
    this._cd.markForCheck();
  }

  onValueChange(value: DateValue): void {
    if (!value) {
      this.innerValue.set(null);
      this.onChange(null);
      this.onTouched();
      return;
    }

    if (!this.validateDate(value)) {
      this.innerValue.set(null);
      this.onChange(null);
    } else {
      this.innerValue.set(value);
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
