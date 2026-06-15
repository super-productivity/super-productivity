import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FieldType } from '@ngx-formly/material';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { DialogScheduleTaskComponent } from '../../features/planner/dialog-schedule-task/dialog-schedule-task.component';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';
import { dateStrToUtcDate } from '../../util/date-str-to-utc-date';
import { getDbDateStr } from '../../util/get-db-date-str';
import { T } from '../../t.const';

@Component({
  selector: 'formly-date-btn',
  standalone: true,
  imports: [FormlyModule, MatButtonModule, MatIcon, MatTooltip, TranslateModule],
  templateUrl: './formly-date-btn.component.html',
  styleUrl: './formly-date-btn.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormlyDateBtnComponent extends FieldType<FormlyFieldConfig> {
  private _dialog = inject(MatDialog);
  private _dateTimeFormatService = inject(DateTimeFormatService);
  private _translateService = inject(TranslateService);

  readonly T = T;

  get dateValStr(): string {
    const val = this.formControl.value;
    if (!val) {
      return '';
    }
    const date = val instanceof Date ? val : dateStrToUtcDate(val);
    if (isNaN(date.getTime())) {
      return '';
    }
    const locale = this._dateTimeFormatService.currentLocale();
    return date.toLocaleDateString(locale, {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  openDialog(): void {
    const currentVal = this.formControl.value;
    let targetDay: string | undefined;

    if (currentVal) {
      const date = currentVal instanceof Date ? currentVal : dateStrToUtcDate(currentVal);
      if (!isNaN(date.getTime())) {
        targetDay = getDbDateStr(date);
      }
    }

    let minDate: Date | null = null;
    let maxDate: Date | null = null;

    if (this.props.minDateKey && this.model) {
      const minVal = this.model[this.props.minDateKey];
      if (minVal) {
        minDate = minVal instanceof Date ? minVal : dateStrToUtcDate(minVal);
      }
    }

    if (this.props.maxDateKey && this.model) {
      const maxVal = this.model[this.props.maxDateKey];
      if (maxVal) {
        maxDate = maxVal instanceof Date ? maxVal : dateStrToUtcDate(maxVal);
      }
    }

    this._dialog
      .open(DialogScheduleTaskComponent, {
        autoFocus: false,
        data: {
          isSelectDueOnly: true,
          showQuickAccess: true,
          isSubmitOnQuickAccess: false,
          targetDay,
          showTime: false,
          showReminder: false,
          minDate,
          maxDate,
        },
      })
      .afterClosed()
      .subscribe((result) => {
        if (result) {
          const newDateStr = getDbDateStr(result.date);
          this.formControl.setValue(newDateStr);
          this.formControl.markAsDirty();
          this.formControl.markAsTouched();
        }
      });
  }

  clear(): void {
    this.formControl.setValue(null);
    this.formControl.markAsDirty();
    this.formControl.markAsTouched();
  }
}
