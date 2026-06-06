import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  inject,
} from '@angular/core';
import { MatCalendar, MatDatepickerIntl } from '@angular/material/datepicker';
import { DateAdapter } from '@angular/material/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslateService } from '@ngx-translate/core';

@Component({
  selector: 'datetime-picker-header',
  standalone: true,
  imports: [MatButtonModule, MatIconModule],
  template: `
    <div class="mat-calendar-header">
      <div class="mat-calendar-controls">
        <button
          mat-button
          type="button"
          class="mat-calendar-period-button sp-month-button"
          (click)="monthLabelClicked()"
          [attr.aria-label]="monthButtonLabel"
        >
          <span>{{ monthLabel }}</span>
        </button>

        <button
          mat-button
          type="button"
          class="mat-calendar-period-button sp-year-button"
          (click)="yearLabelClicked()"
          [attr.aria-label]="yearButtonLabel"
        >
          <span>{{ yearLabel }}</span>
          <mat-icon
            iconPositionEnd
            class="sp-drop-icon sp-drop-icon-right"
          >
            {{ calendar.currentView === 'month' ? 'arrow_drop_down' : 'arrow_drop_up' }}
          </mat-icon>
        </button>

        <div class="mat-calendar-spacer"></div>

        @if (calendar.currentView !== 'year') {
          <button
            mat-icon-button
            type="button"
            class="mat-calendar-previous-button"
            [disabled]="!previousEnabled()"
            (click)="previousClicked()"
            [attr.aria-label]="prevButtonLabel"
          >
            <mat-icon>chevron_left</mat-icon>
          </button>

          <button
            mat-icon-button
            type="button"
            class="mat-calendar-next-button"
            [disabled]="!nextEnabled()"
            (click)="nextClicked()"
            [attr.aria-label]="nextButtonLabel"
          >
            <mat-icon>chevron_right</mat-icon>
          </button>
        }
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DateTimePickerHeaderComponent<D> {
  calendar = inject<MatCalendar<D>>(MatCalendar);
  private _dateAdapter = inject<DateAdapter<D>>(DateAdapter);
  private _cdr = inject(ChangeDetectorRef);
  private _intl = inject(MatDatepickerIntl);
  private _translateService = inject(TranslateService);

  constructor() {
    this.calendar.stateChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this._cdr.markForCheck();
    });
    this._intl.changes.pipe(takeUntilDestroyed()).subscribe(() => {
      this._cdr.markForCheck();
    });
  }

  get prevButtonLabel(): string {
    if (this.calendar.currentView === 'month') {
      return this._intl.prevMonthLabel;
    }
    return this.calendar.currentView === 'year'
      ? this._intl.prevYearLabel
      : this._intl.prevMultiYearLabel;
  }

  get nextButtonLabel(): string {
    if (this.calendar.currentView === 'month') {
      return this._intl.nextMonthLabel;
    }
    return this.calendar.currentView === 'year'
      ? this._intl.nextYearLabel
      : this._intl.nextMultiYearLabel;
  }

  get monthButtonLabel(): string {
    return this.calendar.currentView === 'month'
      ? this._translateService.instant('DATETIME_SCHEDULE.SWITCH_TO_YEAR_VIEW')
      : this._intl.switchToMonthViewLabel;
  }

  get yearButtonLabel(): string {
    return this.calendar.currentView === 'multi-year'
      ? this._intl.switchToMonthViewLabel
      : this._translateService.instant('DATETIME_SCHEDULE.SWITCH_TO_MULTI_YEAR_VIEW');
  }

  get monthLabel(): string {
    if (this.calendar.currentView === 'year') {
      const selected = this.calendar.selected;
      if (selected) {
        const month = this._dateAdapter.getMonth(selected as D);
        return this._dateAdapter.getMonthNames('long')[month];
      }
    }
    const month = this._dateAdapter.getMonth(this.calendar.activeDate);
    return this._dateAdapter.getMonthNames('long')[month];
  }

  get yearLabel(): string {
    if (this.calendar.currentView === 'multi-year') {
      const selected = this.calendar.selected;
      if (selected) {
        return this._dateAdapter.getYearName(selected as D);
      }
    }
    return this._dateAdapter.getYearName(this.calendar.activeDate);
  }

  monthLabelClicked(): void {
    const isTogglingToMonth = this.calendar.currentView === 'year';
    this.calendar.currentView = isTogglingToMonth ? 'month' : 'year';
    if (isTogglingToMonth && this.calendar.selected) {
      this.calendar.activeDate = this.calendar.selected as D;
    }
  }

  yearLabelClicked(): void {
    const isTogglingToMonth = this.calendar.currentView === 'multi-year';
    this.calendar.currentView = isTogglingToMonth ? 'month' : 'multi-year';
    if (isTogglingToMonth && this.calendar.selected) {
      this.calendar.activeDate = this.calendar.selected as D;
    }
  }

  previousClicked(): void {
    const activeDate = this.calendar.activeDate;
    if (this.calendar.currentView === 'month') {
      const prevMonth = this._dateAdapter.addCalendarMonths(activeDate, -1);
      this.calendar.activeDate = this._dateAdapter.createDate(
        this._dateAdapter.getYear(prevMonth),
        this._dateAdapter.getMonth(prevMonth),
        1,
      );
    } else if (this.calendar.currentView === 'year') {
      const prevYear = this._dateAdapter.addCalendarYears(activeDate, -1);
      this.calendar.activeDate = this._dateAdapter.createDate(
        this._dateAdapter.getYear(prevYear),
        0,
        1,
      );
    } else {
      this.calendar.activeDate = this._dateAdapter.addCalendarYears(activeDate, -24);
    }
  }

  nextClicked(): void {
    const activeDate = this.calendar.activeDate;
    if (this.calendar.currentView === 'month') {
      const nextMonth = this._dateAdapter.addCalendarMonths(activeDate, 1);
      this.calendar.activeDate = this._dateAdapter.createDate(
        this._dateAdapter.getYear(nextMonth),
        this._dateAdapter.getMonth(nextMonth),
        1,
      );
    } else if (this.calendar.currentView === 'year') {
      const nextYear = this._dateAdapter.addCalendarYears(activeDate, 1);
      this.calendar.activeDate = this._dateAdapter.createDate(
        this._dateAdapter.getYear(nextYear),
        0,
        1,
      );
    } else {
      this.calendar.activeDate = this._dateAdapter.addCalendarYears(activeDate, 24);
    }
  }

  previousEnabled(): boolean {
    if (!this.calendar.minDate) {
      return true;
    }
    return !this._isSameView(this.calendar.activeDate, this.calendar.minDate);
  }

  nextEnabled(): boolean {
    if (!this.calendar.maxDate) {
      return true;
    }
    return !this._isSameView(this.calendar.activeDate, this.calendar.maxDate);
  }

  private _isSameView(date1: D, date2: D): boolean {
    if (this.calendar.currentView === 'month') {
      return (
        this._dateAdapter.getYear(date1) === this._dateAdapter.getYear(date2) &&
        this._dateAdapter.getMonth(date1) === this._dateAdapter.getMonth(date2)
      );
    }
    if (this.calendar.currentView === 'year') {
      return this._dateAdapter.getYear(date1) === this._dateAdapter.getYear(date2);
    }
    // multi-year view
    const y1 = this._dateAdapter.getYear(date1);
    const y2 = this._dateAdapter.getYear(date2);
    return Math.floor(y1 / 24) === Math.floor(y2 / 24);
  }
}
