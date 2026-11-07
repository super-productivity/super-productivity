import { inject, Pipe, PipeTransform } from '@angular/core';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';
import { dateStrToUtcDate } from '../../util/date-str-to-utc-date';

const PUNCTUATION_ONLY = /^\p{P}+$/u;

@Pipe({ name: 'dayOfMonth' })
export class DayOfMonthPipe implements PipeTransform {
  private readonly _dateTimeFormatService = inject(DateTimeFormatService);

  // Intl decides order, punctuation and inflection (pl "30 września", de "30. September").
  transform(
    dateStr: string,
    locale: string = this._dateTimeFormatService.textLocale(),
    isWithMonth: boolean = false,
  ): string {
    const date = dateStrToUtcDate(dateStr);
    const formatter = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' });
    if (isWithMonth) {
      return formatter.format(date);
    }
    // A day-only format drops ordinal dots (de "30." -> "30"), so keep the
    // punctuation the locale puts after the day in a full date.
    const parts = formatter.formatToParts(date);
    const dayIndex = parts.findIndex((part) => part.type === 'day');
    const next = parts[dayIndex + 1];
    const suffix = next?.type === 'literal' ? next.value.trim() : '';
    return parts[dayIndex].value + (PUNCTUATION_ONLY.test(suffix) ? suffix : '');
  }
}
