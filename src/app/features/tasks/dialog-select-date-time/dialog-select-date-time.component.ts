import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  ViewChild,
} from '@angular/core';
import { FormsModule, NgModel } from '@angular/forms';

import { MatButton } from '@angular/material/button';
import {
  MatDatepicker,
  MatDatepickerInput,
  MatDatepickerToggle,
} from '@angular/material/datepicker';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatFormField, MatLabel, MatPrefix } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import {
  MatTimepicker,
  MatTimepickerInput,
  MatTimepickerToggle,
} from '@angular/material/timepicker';

import { TranslatePipe } from '@ngx-translate/core';

import { T } from '../../../t.const';

export interface DialogSelectDateTimeData {
  dateTime?: number;
}

@Component({
  selector: 'dialog-select-date-time',
  templateUrl: './dialog-select-date-time.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    FormsModule,
    MatButton,
    MatDialogActions,
    MatDialogClose,
    MatDialogContent,
    MatDialogTitle,
    MatFormField,
    MatIcon,
    MatInput,
    MatLabel,
    MatDatepicker,
    MatDatepickerInput,
    MatDatepickerToggle,
    MatPrefix,
    MatTimepicker,
    MatTimepickerInput,
    MatTimepickerToggle,
    TranslatePipe,
  ],
})
export class DialogSelectDateTimeComponent {
  @ViewChild('datepickerInput') datepickerInput!: NgModel;
  @ViewChild('timepickerInput') timepickerInput!: NgModel;

  private readonly _dialogData = inject<DialogSelectDateTimeData>(MAT_DIALOG_DATA);
  private readonly _dialogRef = inject(
    MatDialogRef<DialogSelectDateTimeComponent, number>,
  );

  // Default to today's midnight if dialog was spawned without data
  readonly dateTime = signal<Date | null>(
    this._dialogData.dateTime
      ? new Date(this._dialogData.dateTime)
      : new Date(new Date().setHours(0, 0, 0, 0)),
  );

  readonly hasDateTime = computed(() => this.dateTime() !== null);

  T: typeof T = T;

  onDateTimeChange(dt: Date | null): void {
    // Both inputs are different representations of the same underlying value
    // so editing one should mean the other was edited too
    this.datepickerInput.control.markAsTouched();
    this.timepickerInput.control.markAsTouched();

    if (!(dt instanceof Date) || isNaN(dt.getTime())) {
      this.dateTime.set(null);
      return;
    }

    let d: Date | null = this.datepickerInput.control.value;
    let t: Date | null = this.timepickerInput.control.value;

    // Apply reasonable defaults if the user cleared either input previously:
    // 1. Today's date if the date is missing
    // 2. Midnight if the time is missing
    d ??= new Date(new Date().setHours(0, 0, 0, 0));
    t ??= new Date(new Date().setHours(0, 0, 0, 0));

    this.dateTime.set(
      new Date(
        d.getFullYear(),
        d.getMonth(),
        d.getDate(),
        t.getHours(),
        t.getMinutes(),
        t.getSeconds(),
        t.getMilliseconds(),
      ),
    );
  }

  onSaveClick(): void {
    this._dialogRef.close(this.dateTime()!.getTime());
  }
}
