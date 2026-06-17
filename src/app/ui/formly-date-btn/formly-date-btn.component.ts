import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FieldType } from '@ngx-formly/material';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslateModule } from '@ngx-translate/core';
import { DialogScheduleTaskComponent } from '../../features/planner/dialog-schedule-task/dialog-schedule-task.component';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';
import { dateStrToUtcDate } from '../../util/date-str-to-utc-date';
import { getDbDateStr } from '../../util/get-db-date-str';
import { T } from '../../t.const';

interface FormlyDateBtnProps {
  label?: string;
  minDateKey?: string;
  maxDateKey?: string;
}

interface ScheduleDateResult {
  date: Date;
}

const parseDateValue = (value: unknown): Date | null => {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value !== 'string') {
    return null;
  }
  try {
    const date = dateStrToUtcDate(value);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
};

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

  readonly T = T;

  get dateValStr(): string {
    const date = parseDateValue(this.formControl.value);
    if (!date) {
      return '';
    }
    return date.toLocaleDateString(this._dateTimeFormatService.currentLocale(), {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  openDialog(): void {
    const currentDate = parseDateValue(this.formControl.value);
    const model = this.model as Record<string, unknown> | undefined;
    const props = this.props as FormlyDateBtnProps;
    const minDate = props.minDateKey ? parseDateValue(model?.[props.minDateKey]) : null;
    const maxDate = props.maxDateKey ? parseDateValue(model?.[props.maxDateKey]) : null;

    this._dialog
      .open(DialogScheduleTaskComponent, {
        autoFocus: false,
        data: {
          isSelectDueOnly: true,
          showQuickAccess: true,
          isSubmitOnQuickAccess: false,
          targetDay: currentDate ? getDbDateStr(currentDate) : undefined,
          showTime: false,
          showReminder: false,
          minDate,
          maxDate,
        },
      })
      .afterClosed()
      .subscribe((result: ScheduleDateResult | false | undefined) => {
        if (result && result.date) {
          this.formControl.setValue(getDbDateStr(result.date));
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
