import { computed, effect, inject, Injectable } from '@angular/core';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { DateAdapter } from '@angular/material/core';
import { DEFAULT_LOCALE, DateTimeLocale } from 'src/app/core/locale.constants';

@Injectable({
  providedIn: 'root',
})
export class DateTimeFormatService {
  private readonly _globalConfigService = inject(GlobalConfigService);
  private _dateAdapter = inject(DateAdapter);

  // Signal for the locale to use
  readonly currentLocale = computed<DateTimeLocale>(() => {
    return this._globalConfigService.localization()?.dateTimeLocale || DEFAULT_LOCALE;
  });

  /** Test formats to detect locale-specific time and date formats (e.g., 24h vs 12h, DD/MM vs MM/DD) */
  private readonly _testFormats = computed(() => {
    const locale = this.currentLocale();
    const testDate = new Date(2000, 11, 31, 13, 0, 0);

    return {
      // "1:00 PM" (en-US) | "13:00" (en-GB)
      time: testDate.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' }),
      date: {
        // "12/31/2000" (en-US) | "31/12/2000" (en-GB)
        raw: testDate.toLocaleDateString(locale),
        // "MM/dd/yyyy" (en-US) | "dd/MM/yyyy" (en-GB)
        format: testDate
          .toLocaleDateString(locale)
          .replace('31', 'dd')
          .replace('12', 'MM')
          .replace('2000', 'yyyy'),
      },
    };
  });

  // For detecting if current locale uses 24-hour format (used in schedule component)
  readonly is24HourFormat = computed(() => {
    return this._testFormats().time.includes('13');
  });

  /** Detects the actual date format based on locale ('dd/MM/yyyy', 'MM/dd/yyyy', 'dd.MM.yyyy', etc) */
  readonly dateFormat = computed(() => {
    const localizedDate = this._testFormats().date;

    return {
      raw: localizedDate.format,
      humanReadable: localizedDate.format.toUpperCase(),
    };
  });

  constructor() {
    // Use effect to reactively update date adapter locale when config changes
    effect(() => {
      const cfgValue = this._globalConfigService.localization()?.dateTimeLocale;
      if (cfgValue) this.setDateAdapterLocale(cfgValue);
    });
  }

  /** Set the locale for the date adapter formatting */
  setDateAdapterLocale(locale: DateTimeLocale): void {
    this._dateAdapter.setLocale(locale);
  }

  /**
   * Format a timestamp to time string based on locale format
   *
   * @example
   * // For en-US locale
   * formatTime(new Date(2000, 11, 31, 13, 0, 0).getTime()); // 1:00 PM
   *
   * // For en-GB locale
   * formatTime(new Date(2000, 11, 31, 13, 0, 0).getTime()); // 13:00
   */
  formatTime(timestamp: number, locale: DateTimeLocale = this.currentLocale()): string {
    return new Date(timestamp).toLocaleTimeString(locale, {
      hour: 'numeric',
      minute: 'numeric',
    });
  }

  /**
   * Format a date to string based on locale format
   *
   * @example
   * // For en-US locale
   * formatDate(new Date(2000, 11, 31), 'en-US'); // 12/31/2000
   *
   * // For en-GB locale
   * formatDate(new Date(2000, 11, 31), 'en-GB'); // 31/12/2000
   */
  formatDate(date: Date, locale: DateTimeLocale = this.currentLocale()): string {
    const formatter = new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });

    return formatter.format(date);
  }

  // Extract separator from format string
  extractSeparator(format: string): string {
    const foundSeparator = format.match(/[^\w]+/)?.[0];
    return foundSeparator || '/';
  }

  /**
   * Parse a string date based on locale format
   * Supported formats: `DD/MM/YYYY`, `MM/DD/YYYY`, `DD.MM.YYYY`, `DD. MM. YYYY`, etc
   * Time parsing is not supported - will be set to 00:00:00
   *
   * @example
   * // For en-US locale
   * parseStringToDate('12/31/2000', 'MM/dd/yyyy'); // Date object for Dec 31, 2000
   *
   * // For en-GB locale
   * parseStringToDate('31/12/2000', 'dd/MM/yyyy'); // Date object for Dec 31, 2000
   *
   * // For ru-RU locale
   * parseStringToDate('31.12.2000', 'dd.MM.yyyy'); // Date object for Dec 31, 2000
   *
   * // For ko-KR locale
   * parseStringToDate('2000. 12. 31.', 'yyyy. MM. dd.'); // Date object for Dec 31, 2000
   */
  parseStringToDate(dateString: string, format: string): Date | null {
    const separator = this.extractSeparator(format);
    const formatParts = format.split(separator);
    const dateParts = dateString
      .trim()
      .split(separator)
      .filter((part) => part.trim() !== '');

    // Basic validation to ensure we have the expected number of parts
    if (formatParts.length !== 3 || dateParts.length !== 3) return null;

    // Build a format mapping by matching positions
    const values: Record<string, number> = {};
    formatParts.forEach((formatPart, i) => {
      const key = formatPart
        .trim()
        .toLowerCase() // normalize to lowercase for easier matching
        .replace(/[^\w]+/g, '');
      const val = parseInt(dateParts[i].trim(), 10);
      if (isNaN(val)) return;
      values[key] = val;
    });

    const year = values['yyyy'];
    const month = values['mm'];
    const day = values['dd'];

    if (year === undefined || month === undefined || day === undefined) return null;
    if (year.toString().length !== 4 || day > 31 || day < 1 || month > 12 || month < 1) {
      return null;
    }

    const date = new Date(year, month - 1, day);

    // Validate the date by checking if constructed date matches input values
    const isValid =
      date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day;

    return isValid ? date : null;
  }
}
