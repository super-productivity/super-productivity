import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  inject,
} from '@angular/core';
import { MatCalendar } from '@angular/material/datepicker';
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
        >
          <mat-icon class="sp-drop-icon sp-drop-icon-left">
            {{ calendar.currentView === 'year' ? 'arrow_drop_up' : 'arrow_drop_down' }}
          </mat-icon>
          <span>{{ monthLabel }}</span>
        </button>

        <button
          mat-button
          type="button"
          class="mat-calendar-period-button sp-year-button"
          (click)="yearLabelClicked()"
        >
          <span>{{ yearLabel }}</span>
          <mat-icon
            iconPositionEnd
            class="sp-drop-icon sp-drop-icon-right"
          >
            {{
              calendar.currentView === 'multi-year' ? 'arrow_drop_up' : 'arrow_drop_down'
            }}
          </mat-icon>
        </button>

        <div class="mat-calendar-spacer"></div>

        <button
          mat-icon-button
          type="button"
          class="mat-calendar-previous-button"
          [disabled]="!previousEnabled()"
          (click)="previousClicked()"
        >
          <mat-icon>chevron_left</mat-icon>
        </button>

        <button
          mat-icon-button
          type="button"
          class="mat-calendar-next-button"
          [disabled]="!nextEnabled()"
          (click)="nextClicked()"
        >
          <mat-icon>chevron_right</mat-icon>
        </button>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DateTimePickerHeaderComponent<D> {
  calendar = inject<MatCalendar<D>>(MatCalendar);
  private _dateAdapter = inject<DateAdapter<D>>(DateAdapter);
  private _cdr = inject(ChangeDetectorRef);

  constructor() {
    this.calendar.stateChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this._cdr.markForCheck();
    });
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
