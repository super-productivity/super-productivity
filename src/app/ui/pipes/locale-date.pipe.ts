import { inject, Pipe, PipeTransform } from '@angular/core';
import { DatePipe } from '@angular/common';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';
import { Log } from '../../core/log';
import { DEFAULT_LOCALE } from '../../core/locale.constants';

/**
 * Custom date pipe that respects the user's configured locale
 * Drop-in replacement for Angular's DatePipe
 */
@Pipe({
  name: 'localeDate',
  standalone: true,
})
export class LocaleDatePipe implements PipeTransform {
  private _dateTimeFormatService = inject(DateTimeFormatService);
  private _datePipe: DatePipe | null = null;
  private _lastLocale: string | undefined;
  // Fallback pipe, reused instead of re-allocated on every failed transform.
  // DEFAULT_LOCALE ('en-gb') resolves to the 'en' data registered statically
  // at bootstrap, so this path never depends on lazy locale registration.
  private readonly _fallbackDatePipe = new DatePipe(DEFAULT_LOCALE);
  // Many pipe instances render many dates per view; warn at most once per
  // unregistered locale instead of flooding the console.
  private readonly _warnedLocales = new Set<string>();

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

    try {
      return this._datePipe.transform(value, format, timezone, effectiveLocale);
    } catch (e) {
      // Angular throws NG0701 when locale data for `effectiveLocale` isn't
      // registered — reachable since "System default" follows the browser's
      // regional locale, which can be any BCP-47 tag. Fall back to the
      // always-registered default locale so the date still renders.
      if (!this._warnedLocales.has(effectiveLocale)) {
        this._warnedLocales.add(effectiveLocale);
        Log.warn(
          `LocaleDatePipe: cannot format with locale "${effectiveLocale}", ` +
            `using "${DEFAULT_LOCALE}"`,
          e,
        );
      }
      try {
        return this._fallbackDatePipe.transform(value, format, timezone, DEFAULT_LOCALE);
      } catch {
        return null;
      }
    }
  }
}
