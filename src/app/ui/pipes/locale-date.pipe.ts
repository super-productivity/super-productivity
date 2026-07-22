import { inject, Pipe, PipeTransform } from '@angular/core';
import { DatePipe } from '@angular/common';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';
import { Log } from '../../core/log';
import { DEFAULT_LOCALE } from '../../core/locale.constants';

// Module-scoped: Angular creates one pure-pipe instance per binding per
// embedded view, so per-instance state would warn once per row, not once.
// DEFAULT_LOCALE ('en-gb') resolves to the 'en' data registered statically
// at bootstrap, so the fallback pipe never depends on lazy locale registration.
const FALLBACK_DATE_PIPE = new DatePipe(DEFAULT_LOCALE);
const WARNED_LOCALES = new Set<string>();

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
    } catch {
      // Angular throws NG0701 when locale data for `effectiveLocale` isn't
      // registered — reachable since "System default" follows the browser's
      // regional locale, which can be any BCP-47 tag. Fall back to the
      // always-registered default locale so the date still renders.
      let fallback: string | null;
      try {
        fallback = FALLBACK_DATE_PIPE.transform(value, format, timezone, DEFAULT_LOCALE);
      } catch {
        // Both locales failed => the value itself is unformattable, not a
        // locale problem. Stay silent (matching safeFormatDate) so a bad
        // value cannot poison the per-locale warn set below.
        return null;
      }
      // The fallback succeeding is the only prod-safe discriminant between
      // "unregistered locale" and "bad value": DatePipe rewraps both as
      // NG02100, and ngDevMode strips the messages in production builds.
      // Deliberately not logging the error/value — the raw date is user
      // content and log history is exportable (sync rule 9).
      if (!WARNED_LOCALES.has(effectiveLocale)) {
        WARNED_LOCALES.add(effectiveLocale);
        Log.warn(
          `LocaleDatePipe: cannot format with locale "${effectiveLocale}", ` +
            `using "${DEFAULT_LOCALE}"`,
        );
      }
      return fallback;
    }
  }
}
