import { inject, Pipe, PipeTransform } from '@angular/core';
import { DateService } from '../../core/date/date.service';
import { ShortTimeHtmlPipe } from './short-time-html.pipe';
import { formatMonthDay } from '../../util/format-month-day.util';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';

@Pipe({ name: 'shortPlannedAt', standalone: true })
export class ShortPlannedAtPipe implements PipeTransform {
  private _shortTimeHtmlPipe = inject(ShortTimeHtmlPipe);
  private _dateTimeFormatService = inject(DateTimeFormatService);
  private _dateService = inject(DateService);

  transform(value?: number | null, timeOnly?: boolean): string | null {
    if (typeof value !== 'number') {
      return null;
    }

    if (this._dateService.isToday(value) || timeOnly) {
      return this._shortTimeHtmlPipe.transform(value);
    } else {
      const locale = this._dateTimeFormatService.currentLocale();
      return formatMonthDay(new Date(value), locale);
    }
  }
}
