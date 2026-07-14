import { Injectable, inject, Injector } from '@angular/core';
import { NativeDateAdapter } from '@angular/material/core';
import { DateTimeFormatService } from './date-time-format.service';
import { DEFAULT_FIRST_DAY_OF_WEEK } from 'src/app/core/locale.constants';
import { GlobalConfigService } from '../../features/config/global-config.service';

/** Custom DateAdapter that handles locale-aware date parsing and formatting */
@Injectable({ providedIn: 'root' })
export class CustomDateAdapter extends NativeDateAdapter {
  private readonly _globalConfigService = inject(GlobalConfigService);

  // Use a getter to avoid circular dependency issues with DateTimeFormatService
  private readonly _injector = inject(Injector);
  private get _dateTimeFormatService(): DateTimeFormatService {
    return this._injector.get(DateTimeFormatService);
  }

  override getFirstDayOfWeek(): number {
    const cfgValue = this._globalConfigService.localization()?.firstDayOfWeek;

    // If not set or reset - use Monday as default (ISO 8601 standard)
    // Note: Must use explicit null/undefined check since 0 (Sunday) is a valid value
    if (cfgValue === null || cfgValue === undefined) return DEFAULT_FIRST_DAY_OF_WEEK;

    // Default should be monday, if we have an invalid value for some reason
    return cfgValue >= 0 ? cfgValue : DEFAULT_FIRST_DAY_OF_WEEK;
  }

  override parse(value: any, format: string): Date | null {
    if (!value) return null;
    if (value instanceof Date) return this.isValid(value) ? value : null;
    if (typeof value !== 'string') return super.parse(value, format);

    // Parse using locale-aware format
    const parsed = this._dateTimeFormatService.parseStringToDate(
      value,
      this._dateTimeFormatService.dateFormat().raw,
    );

    return parsed !== null ? parsed : super.parse(value, format);
  }

  override format(
    date: Date,
    displayFormat: Intl.DateTimeFormatOptions | string,
  ): string {
    if (!this.isValid(date)) throw Error('DateAdapter: Cannot format invalid date.');

    // locale-specific format
    const localeSpecificFormat = this._dateTimeFormatService.dateFormat().raw;
    if (displayFormat === localeSpecificFormat) {
      return this._dateTimeFormatService.formatDate(date);
    }

    // Spelled-out month/weekday labels (e.g. the calendar's "July 2026" header)
    // follow the UI language when the ISO 8601 option is active. Numeric and
    // time-only formats keep the configured locale, so ISO stays YYYY-MM-DD and
    // the 24h clock is preserved (#8987 follow-up).
    if (this._hasSpelledOutName(displayFormat)) {
      return this._withTextLocale(() => super.format(date, displayFormat));
    }

    // For other formats, use default
    return super.format(date, displayFormat);
  }

  // Calendar weekday header row ('M T W ...'). Localized to the UI language for
  // the ISO 8601 option; unchanged for every other locale.
  override getDayOfWeekNames(style: 'long' | 'short' | 'narrow'): string[] {
    return this._withTextLocale(() => super.getDayOfWeekNames(style));
  }

  // Month names shown in the calendar's year view.
  override getMonthNames(style: 'long' | 'short' | 'narrow'): string[] {
    return this._withTextLocale(() => super.getMonthNames(style));
  }

  /**
   * Run `fn` with the adapter locale temporarily swapped to the ISO text locale
   * (the UI language, exposed only when the ISO 8601 option is selected). When
   * no ISO text locale is set the callback runs unchanged. Direct field
   * assignment is used instead of `setLocale()` so no `localeChanges` event
   * fires during the swap.
   */
  private _withTextLocale<T>(fn: () => T): T {
    const textLocale = this._dateTimeFormatService.isoTextLocale();
    if (!textLocale) return fn();

    const prevLocale = this.locale;
    this.locale = textLocale;
    try {
      return fn();
    } finally {
      this.locale = prevLocale;
    }
  }

  private _hasSpelledOutName(
    displayFormat: Intl.DateTimeFormatOptions | string,
  ): boolean {
    if (typeof displayFormat === 'string') return false;
    const spelledOut = ['long', 'short', 'narrow'];
    return (
      spelledOut.includes(displayFormat.weekday as string) ||
      spelledOut.includes(displayFormat.month as string)
    );
  }
}
