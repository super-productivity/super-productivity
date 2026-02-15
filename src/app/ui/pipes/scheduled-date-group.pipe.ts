import { inject, Pipe, PipeTransform } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { T } from 'src/app/t.const';
import { getDbDateStr } from '../../util/get-db-date-str';
import { dateStrToUtcDate } from '../../util/date-str-to-utc-date';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Pipe that formats scheduled date group keys with day of week.
 * Input: YYYY-MM-DD date string or special strings like "No date"
 * Output: "Wed 1/15" or "Today" or passthrough for non-date strings
 */
@Pipe({
  name: 'scheduledDateGroup',
  standalone: true,
  pure: false,
})
export class ScheduledDateGroupPipe implements PipeTransform {
  private _dateTimeFormatService = inject(DateTimeFormatService);
  private _translateService = inject(TranslateService);

  transform(value: unknown): string | null {
    if (value === null || value === undefined) {
      return null;
    }

    // Ensure value is a string
    if (typeof value !== 'string') {
      return String(value);
    }

    // Check if it's a date string (YYYY-MM-DD format)
    if (!DATE_REGEX.test(value)) {
      // Pass through non-date strings like "No date", "No tag", etc.
      return value;
    }

    const todayStr = getDbDateStr();
    if (value === todayStr) {
      return this._translateService.instant(T.G.TODAY_TAG_TITLE);
    }

    const date = dateStrToUtcDate(value);
    const locale = this._dateTimeFormatService.currentLocale();

    // Format with weekday and date: "Wed 1/15"
    const formatter = new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      month: 'numeric',
      day: 'numeric',
    });

    return formatter.format(date);
  }
}
