import { inject, Pipe, PipeTransform } from '@angular/core';
import { dateStrToUtcDate } from '../../util/date-str-to-utc-date';
import { TranslateService } from '@ngx-translate/core';
import { T } from 'src/app/t.const';
import { isDBDateStr } from '../../util/get-db-date-str';
import { formatMonthDayWithYearIfNeeded } from '../../util/format-month-day.util';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';
import { DateService } from '../../core/date/date.service';

@Pipe({
  name: 'localDateStr',
  standalone: true,
})
export class LocalDateStrPipe implements PipeTransform {
  private _dateTimeFormatService = inject(DateTimeFormatService);
  private translateService = inject(TranslateService);
  private _dateService = inject(DateService);

  /**
   * @param todayStr the app's today; pass a signal value such as
   * `todayDateStr()` so the pure pipe re-runs when the day changes. Defaults to
   * DateService's today (honours the start-of-next-day setting).
   */
  transform(value: string | null | undefined, todayStr?: string): string | null {
    if (typeof value !== 'string' || !isDBDateStr(value)) {
      return null;
    }
    const today =
      todayStr && isDBDateStr(todayStr) ? todayStr : this._dateService.todayStr();
    if (value === today) {
      const translation = this.translateService.instant(T.G.TODAY_TAG_TITLE);
      if (translation.length <= 7) {
        return translation;
      }
    }

    const d = dateStrToUtcDate(value);
    // Use the configured locale if available, otherwise fall back to default
    const locale = this._dateTimeFormatService.currentLocale();
    return formatMonthDayWithYearIfNeeded(d, locale, dateStrToUtcDate(today));
  }
}
