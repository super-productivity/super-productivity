import { inject, Pipe, PipeTransform } from '@angular/core';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';

@Pipe({ name: 'numberToMonth' })
export class NumberToMonthPipe implements PipeTransform {
  private readonly _dateTimeFormatService = inject(DateTimeFormatService);

  // Templates pass `locale` so the pure pipe re-runs on a locale change.
  transform(
    value: number | string,
    locale: string = this._dateTimeFormatService.textLocale(),
  ): string | undefined {
    const month = parseInt(String(value), 10);
    if (!(month >= 1 && month <= 12)) {
      return undefined;
    }
    return new Intl.DateTimeFormat(locale, { month: 'long' }).format(
      new Date(2000, month - 1, 1),
    );
  }
}
