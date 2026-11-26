import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  inject,
  OnInit,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FieldType } from '@ngx-formly/material';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { MatInput } from '@angular/material/input';
import { MatTimepicker, MatTimepickerInput } from '@angular/material/timepicker';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { InputTimeDirective } from '../input-time.directive';
import { TimepickerClockStrDirective } from '../../timepicker-clock-str/timepicker-clock-str.directive';
import { DateTimeFormatService } from '../../../core/date-time-format/date-time-format.service';

/**
 * Formly `time` field type storing a canonical `HH:mm` string. Renders a native
 * `<input type="time">` (see {@link InputTimeDirective}) when the browser/OS
 * clock already matches the configured 12h/24h format, MatTimepicker otherwise.
 */
@Component({
  selector: 'input-time-formly',
  templateUrl: './input-time-formly.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    InputTimeDirective,
    MatInput,
    MatTimepicker,
    MatTimepickerInput,
    TimepickerClockStrDirective,
    FormsModule,
    FormlyModule,
    ReactiveFormsModule,
  ],
})
export class InputTimeFormlyComponent
  extends FieldType<FormlyFieldConfig>
  implements OnInit
{
  readonly useNativeTimeInput = inject(DateTimeFormatService).useNativeTimeInput;
  private readonly _cdr = inject(ChangeDetectorRef);
  private readonly _destroyRef = inject(DestroyRef);

  ngOnInit(): void {
    // The MatTimepicker branch reads formControl.value/disabled in the
    // template, which OnPush misses on outside patches (form reset, synced config).
    this.formControl.events
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe(() => this._cdr.markForCheck());
  }

  onClockStrChange(clockStr: string | null): void {
    // '' like the native input, so `required` flags an empty or invalid entry
    this.formControl.setValue(clockStr ?? '');
    this.formControl.markAsDirty();
  }
}
