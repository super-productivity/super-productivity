import { inject, Pipe, PipeTransform } from '@angular/core';
import { DateService } from '../../core/date/date.service';
import { ShortTimeHtmlPipe } from './short-time-html.pipe';
import { formatMonthDayWithYearIfNeeded } from '../../util/format-month-day.util';
import { getBadgeToday } from './date-has-other-year.pipe';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';

@Pipe({ name: 'shortPlannedAt', standalone: true })
export class ShortPlannedAtPipe implements PipeTransform {
  private _shortTimeHtmlPipe = inject(ShortTimeHtmlPipe);
  private _dateTimeFormatService = inject(DateTimeFormatService);
  private _dateService = inject(DateService);

  /**
   * @param todayStr the app's today; pass a signal value such as
   * `todayDateStr()` so the pure pipe re-runs when the day changes. Defaults to
   * DateService's today (honours the start-of-next-day setting).
   */
  transform(value?: number | null, timeOnly?: boolean, todayStr?: string): string | null {
    if (typeof value !== 'number') {
      return null;
    }

    if (this._dateService.isToday(value) || timeOnly) {
      return this._shortTimeHtmlPipe.transform(value);
    } else {
      const locale = this._dateTimeFormatService.currentLocale();
      return formatMonthDayWithYearIfNeeded(
        new Date(value),
        locale,
        getBadgeToday(todayStr, this._dateService),
      );
    }
  }
}
