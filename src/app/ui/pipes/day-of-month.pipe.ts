import { inject, Pipe, PipeTransform } from '@angular/core';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';
import { dateStrToUtcDate } from '../../util/date-str-to-utc-date';

@Pipe({ name: 'dayOfMonth' })
export class DayOfMonthPipe implements PipeTransform {
  private readonly _dateTimeFormatService = inject(DateTimeFormatService);

  // Intl decides order, punctuation and inflection (pl "30 września", de "30. September").
  transform(
    dateStr: string,
    locale: string = this._dateTimeFormatService.textLocale(),
    isWithMonth: boolean = false,
  ): string {
    return new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      ...(isWithMonth && { month: 'long' }),
    }).format(dateStrToUtcDate(dateStr));
  }
}
