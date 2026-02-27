import { inject, Pipe, PipeTransform } from '@angular/core';
import { DatePipe } from '@angular/common';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';

/**
 * Custom date pipe that respects the user's configured locale
 * Drop-in replacement for Angular's DatePipe
 */
@Pipe({
  name: 'localeDate',
  standalone: true,
  pure: false, // Need to be impure to react to locale changes
})
export class LocaleDatePipe implements PipeTransform {
  private _dateTimeFormatService = inject(DateTimeFormatService);
  private _datePipe: DatePipe | null = null;
  private _lastLocale: string | undefined;

  transform(
    value: Date | string | number | null | undefined,
    format?: string,
    timezone?: string,
    locale?: string,
  ): string | null {
    // Use explicitly provided locale or configured locale
    const effectiveLocale = locale || this._dateTimeFormatService.currentLocale();

    // Create or recreate DatePipe if locale changed
    if (!this._datePipe || this._lastLocale !== effectiveLocale) {
      this._datePipe = new DatePipe(effectiveLocale);
      this._lastLocale = effectiveLocale;
    }

    if (value == null || (typeof value === 'number' && !Number.isFinite(value))) {
      return null;
    }

    return this._datePipe.transform(value, format, timezone, effectiveLocale);
  }
}
