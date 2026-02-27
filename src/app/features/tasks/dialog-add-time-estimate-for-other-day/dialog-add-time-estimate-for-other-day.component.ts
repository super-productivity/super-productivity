import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { T } from '../../../t.const';
import { FormsModule } from '@angular/forms';
import { HelpSectionComponent } from '../../../ui/help-section/help-section.component';
import { InputDurationSliderComponent } from '../../../ui/duration/input-duration-slider/input-duration-slider.component';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { LocaleDatePipe } from 'src/app/ui/pipes/locale-date.pipe';
import { TranslatePipe } from '@ngx-translate/core';
import { DateTimeFormatService } from 'src/app/core/date-time-format/date-time-format.service';
import { DatePickerInputComponent } from '../../../ui/date-picker-input/date-picker-input.component';

export interface NewTimeEntry {
  timeSpent: number;
  date: Date | null;
}

@Component({
  selector: 'dialog-time-estimate',
  templateUrl: './dialog-add-time-estimate-for-other-day.component.html',
  styleUrls: ['./dialog-add-time-estimate-for-other-day.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogTitle,
    FormsModule,
    MatDialogContent,
    HelpSectionComponent,
    InputDurationSliderComponent,
    MatDialogActions,
    MatButton,
    MatDialogClose,
    MatIcon,
    LocaleDatePipe,
    TranslatePipe,
    DatePickerInputComponent,
  ],
})
export class DialogAddTimeEstimateForOtherDayComponent {
  public dateTimeFormatService = inject(DateTimeFormatService);
  private _matDialogRef =
    inject<MatDialogRef<DialogAddTimeEstimateForOtherDayComponent>>(MatDialogRef);

  T: typeof T = T;
  newEntry: NewTimeEntry = {
    date: null,
    timeSpent: 0,
  };

  submit(): void {
    this._matDialogRef.close(this.newEntry);
  }
}
