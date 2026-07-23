import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { ScheduleEvent } from '../schedule.model';
import { ScheduleEventComponent } from '../schedule-event/schedule-event.component';
import { safeFormatDate } from 'src/app/util/safe-format-date';
import { ScheduleService } from '../schedule.service';
import { DateTimeFormatService } from 'src/app/core/date-time-format/date-time-format.service';
import { parseDbDateStr } from 'src/app/util/parse-db-date-str';
import { TranslatePipe, TranslateService, TranslateStore } from '@ngx-translate/core';
import { getPluralKey } from '../../../util/get-plural-key';

@Component({
  selector: 'schedule-month',
  imports: [ScheduleEventComponent, TranslatePipe],
  templateUrl: './schedule-month.component.html',
  styleUrl: './schedule-month.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
})
export class ScheduleMonthComponent {
  private _scheduleService = inject(ScheduleService);
  private _dateTimeFormatService = inject(DateTimeFormatService);
  private _translateService = inject(TranslateService);
  private _translateStore = inject(TranslateStore);

  readonly events = input<ScheduleEvent[] | null>([]);
  readonly daysToShow = input<string[]>([]);
  readonly weeksToShow = input<number>(6);
  readonly firstDayOfWeek = input<number>(1);

  // Generate weekday headers based on firstDayOfWeek setting
  readonly weekdayHeaders = computed(() => {
    const firstDay = this.firstDayOfWeek();
    const headers: string[] = [];
    const isoTextLocale = this._dateTimeFormatService.isoTextLocale();
    const formatter = isoTextLocale
      ? new Intl.DateTimeFormat(isoTextLocale, { weekday: 'short' })
      : null;
    const locale = this._dateTimeFormatService.currentLocale();

    // Create a date for each day of week (using a week starting on Sunday)
    // January 2, 2000 was a Sunday
    const sundayDate = new Date(2000, 0, 2);

    for (let i = 0; i < 7; i++) {
      const dayIndex = (firstDay + i) % 7;
      const date = new Date(sundayDate);
      date.setDate(sundayDate.getDate() + dayIndex);
      headers.push(
        formatter ? formatter.format(date) : safeFormatDate(date, 'EEE', locale),
      );
    }

    return headers;
  });

  // Precompute the day-of-month label for every visible day, keyed on the day
  // list + current locale. Replaces a per-cell `| localeDate: 'd'` pipe (up to
  // 42 cells) so no date formatting happens during change detection; the map
  // only recomputes when the days or the locale change.
  readonly dayNumberByDay = computed<Record<string, string>>(() => {
    const locale = this._dateTimeFormatService.currentLocale();
    const map: Record<string, string> = {};
    for (const day of this.daysToShow()) {
      map[day] = safeFormatDate(day, 'd', locale);
    }
    return map;
  });

  // Determine the reference month from the displayed days
  // Find the first day that's actually in the target month (not padding days)
  readonly referenceMonth = computed(() => {
    const days = this.daysToShow();
    if (days.length === 0) return new Date();

    // Use the middle day as reference (around day 14-15 of the month)
    // This ensures we get a day that's actually in the target month
    const middleIndex = Math.floor(days.length / 2);
    return parseDbDateStr(days[middleIndex]);
  });

  getDayClass(day: string): string {
    return this._scheduleService.getDayClass(day, this.referenceMonth());
  }

  getWeekIndex(dayIndex: number): number {
    return Math.floor(dayIndex / 7);
  }

  getDayIndex(dayIndex: number): number {
    return dayIndex % 7;
  }

  getEventsForDay(day: string): ScheduleEvent[] {
    return this._scheduleService.getEventsForDay(day, this.events() || []);
  }

  getMoreEventsKey(count: number): string {
    return getPluralKey(
      this._translateService,
      this._translateStore,
      count,
      'F.SCHEDULE.MORE_EVENTS',
    );
  }

  getEventDayStr(ev: ScheduleEvent): string | null {
    return this._scheduleService.getEventDayStr(ev);
  }
}
