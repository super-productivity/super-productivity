import { Injectable, inject } from '@angular/core';
import { MatDatepickerIntl } from '@angular/material/datepicker';
import { TranslateService } from '@ngx-translate/core';
import { T } from '../../t.const';

@Injectable()
export class TranslateMatDatepickerIntl extends MatDatepickerIntl {
  private _translateService = inject(TranslateService);

  constructor() {
    super();
    this._translateService.onLangChange.subscribe(() => {
      this._updateLabels();
    });
    this._translateService.onTranslationChange.subscribe(() => {
      this._updateLabels();
    });
    this._translateService.onDefaultLangChange.subscribe(() => {
      this._updateLabels();
    });
    this._updateLabels();
  }

  private _updateLabels(): void {
    this.calendarLabel = this._translateService.instant(T.DATETIME_SCHEDULE.MONTH);
    this.openCalendarLabel = this._translateService.instant(T.F.TASK.CMP.SCHEDULE);
    this.prevMonthLabel = this._translateService.instant(
      T.DATETIME_SCHEDULE.PREVIOUS_MONTH,
    );
    this.nextMonthLabel = this._translateService.instant(T.DATETIME_SCHEDULE.NEXT_MONTH);
    this.prevYearLabel = this._translateService.instant(
      T.DATETIME_SCHEDULE.PREVIOUS_YEAR,
    );
    this.nextYearLabel = this._translateService.instant(T.DATETIME_SCHEDULE.NEXT_YEAR);
    this.prevMultiYearLabel = this._translateService.instant(
      T.DATETIME_SCHEDULE.PREVIOUS_24_YEARS,
    );
    this.nextMultiYearLabel = this._translateService.instant(
      T.DATETIME_SCHEDULE.NEXT_24_YEARS,
    );
    this.switchToMonthViewLabel = this._translateService.instant(
      T.DATETIME_SCHEDULE.SWITCH_TO_YEAR_VIEW,
    );
    this.switchToMultiYearViewLabel = this._translateService.instant(
      T.DATETIME_SCHEDULE.SWITCH_TO_MULTI_YEAR_VIEW,
    );

    this.changes.next();
  }
}
