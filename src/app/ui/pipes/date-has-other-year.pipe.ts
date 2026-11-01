import { inject, Pipe, PipeTransform } from '@angular/core';
import { DateService } from '../../core/date/date.service';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';
import { dateStrToUtcDate } from '../../util/date-str-to-utc-date';
import { isDBDateStr } from '../../util/get-db-date-str';
import { isOutsideDisplayedYear } from '../../util/format-month-day.util';

/**
 * The app's today as a Date: a given `todayStr` (pass a signal value such as
 * `todayDateStr()` so pure pipes re-run when the day changes) or DateService's
 * logical today (start-of-next-day setting).
 */
export const getBadgeToday = (
  todayStr: string | undefined,
  dateService: Pick<DateService, 'getLogicalTodayDate'>,
): Date =>
  todayStr && isDBDateStr(todayStr)
    ? dateStrToUtcDate(todayStr)
    : dateService.getLogicalTodayDate();

/**
 * Whether the badge for a date string or timestamp shows a year (#10804). Used
 * to give only those badges a wider button, so current-year layouts stay as
 * they are.
 */
@Pipe({ name: 'dateHasOtherYear', standalone: true })
export class DateHasOtherYearPipe implements PipeTransform {
  private _dateTimeFormatService = inject(DateTimeFormatService);
  private _dateService = inject(DateService);

  transform(value: string | number | null | undefined, todayStr?: string): boolean {
    let date: Date;
    if (typeof value === 'number') {
      date = new Date(value);
    } else if (typeof value === 'string' && isDBDateStr(value)) {
      date = dateStrToUtcDate(value);
    } else {
      return false;
    }
    return isOutsideDisplayedYear(
      date,
      this._dateTimeFormatService.currentLocale(),
      getBadgeToday(todayStr, this._dateService),
    );
  }
}
