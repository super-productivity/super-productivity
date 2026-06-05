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
      ? this._intl.switchToMultiYearViewLabel
      : this._intl.switchToMonthViewLabel;
  }

  get yearButtonLabel(): string {
    return this.calendar.currentView === 'month'
      ? this._intl.switchToMultiYearViewLabel
      : this._intl.switchToMonthViewLabel;
  }

  get monthLabel(): string {
    const month = this._dateAdapter.getMonth(this.calendar.activeDate);
    return this._dateAdapter.getMonthNames('long')[month];
  }

  get yearLabel(): string {
    return this._dateAdapter.getYearName(this.calendar.activeDate);
  }

  monthLabelClicked(): void {
    this.calendar.currentView = this.calendar.currentView === 'year' ? 'month' : 'year';
  }

  yearLabelClicked(): void {
    this.calendar.currentView =
      this.calendar.currentView === 'multi-year' ? 'month' : 'multi-year';
  }

  previousClicked(): void {
    this.calendar.activeDate =
      this.calendar.currentView === 'month'
        ? this._dateAdapter.addCalendarMonths(this.calendar.activeDate, -1)
        : this._dateAdapter.addCalendarYears(
            this.calendar.activeDate,
            this.calendar.currentView === 'year' ? -1 : -24,
          );
  }

  nextClicked(): void {
    this.calendar.activeDate =
      this.calendar.currentView === 'month'
        ? this._dateAdapter.addCalendarMonths(this.calendar.activeDate, 1)
        : this._dateAdapter.addCalendarYears(
            this.calendar.activeDate,
            this.calendar.currentView === 'year' ? 1 : 24,
          );
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
